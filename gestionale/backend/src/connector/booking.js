const { extractConfirmationRequest } = require("../parser/bookingStepParser");
const cheerio = require("cheerio");

const BASE_URL = "https://www.ilportaledellautomobilista.it";

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function resolveUrl(action) {
  if (!action) return "";
  if (/^https?:\/\//i.test(action)) return action;
  return `${BASE_URL}${action}`;
}

function buildDetailPayload(html) {
  const $ = cheerio.load(html || "");
  const payload = new URLSearchParams();

  const form = $("form")
    .filter((_, node) => {
      const formNode = $(node);
      const action = String(formNode.attr("action") || "").toLowerCase();
      if (!action.includes("/prenotazione/")) return false;
      return formNode.find("input[type='hidden']").length > 0;
    })
    .first();

  if (!form.length) {
    return { payload, action: "" };
  }

  form.find("input").each((_, input) => {
    const node = $(input);
    const name = node.attr("name");
    const type = String(node.attr("type") || "text").toLowerCase();
    if (!name) return;

    if (["submit", "button", "image", "file"].includes(type)) return;
    if (["checkbox", "radio"].includes(type)) {
      if (node.attr("checked")) payload.append(name, node.val() || "on");
      return;
    }

    payload.append(name, node.val() || "");
  });

  form.find("select").each((_, select) => {
    const node = $(select);
    const name = node.attr("name");
    if (!name) return;
    const selected = node.find("option[selected]").first();
    const value = selected.length ? selected.attr("value") || "" : node.find("option").first().attr("value") || "";
    payload.append(name, value);
  });

  form.find("textarea").each((_, textarea) => {
    const node = $(textarea);
    const name = node.attr("name");
    if (!name) return;
    payload.append(name, node.val() || "");
  });

  return {
    payload,
    action: resolveUrl(form.attr("action") || ""),
  };
}

function applyFields(payload, fields = {}) {
  Object.entries(fields || {}).forEach(([key, value]) => {
    if (!key) return;
    if (value === undefined || value === null) return;
    payload.set(String(key), String(value));
  });
}

function setAction(payload, actionKey, actionValue = "Dettaglio") {
  Array.from(payload.keys())
    .filter((name) => String(name).startsWith("action:"))
    .forEach((name) => payload.delete(name));

  if (actionKey) {
    payload.set(actionKey, actionValue);
  }
}

function serializePayloadRaw(payload) {
  if (typeof payload === "string") return payload;
  const parts = [];
  for (const [key, value] of payload.entries()) {
    parts.push(`${encodeURIComponent(key).replace(/%3A/gi, ":")}=${encodeURIComponent(value)}`);
  }
  return parts.join("&");
}

async function postPortalForm(client, url, payload, referer) {
  const response = await client.post(url, serializePayloadRaw(payload), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: referer || `${BASE_URL}/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH`,
    },
  });

  return response.data;
}

async function cercaCandidatoInDettaglio(client, detailHtml, options = {}) {
  const { payload, action } = buildDetailPayload(detailHtml);
  const url = resolveUrl(options.url || action || "/prenotazione/disponibilitaSessioneEsameEP/Select_listCandidati.action");

  setAction(payload, "action:Select_listCandidati", "Dettaglio");

  const foglioRosa = normalizeText(options.codiceFoglioRosa || options.marcaOperativa || "");
  const cognomePrefix = normalizeText(options.cognomePrefix || options.cognome || "");

  if (foglioRosa) {
    payload.set("disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.theRichiestaEmissioneDocumentoAbilitazioneEP.codiceFoglioRosa", foglioRosa);
  }
  if (cognomePrefix) {
    payload.set("disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.theRichiestaEmissioneDocumentoAbilitazioneEP.thePersonaFisica.descrizioneCognomePersonaFisica", cognomePrefix.slice(0, 3));
  }

  // Bypass captcha: il portale accetta visualizzaCaptcha=false come parametro
  // per saltare completamente il controllo captcha (stesso meccanismo usato da
  // iPatenteCloud e GeCA). Parametro lato-server Struts2 intenzionale.
  payload.set("disponibilitaSessioneEsameEPView.visualizzaCaptcha", "false");

  applyFields(payload, options.fields || {});

  return postPortalForm(client, url, payload, options.referer);
}

/**
 * Prenotazione diretta via GET URL con tutti i parametri in query string.
 * Approccio usato da iPatenteCloud per SQI e SGOS: costruisce l'URL completo
 * con visualizzaCaptcha=false e action:CreateSIP_saveNewElementCandidato=Conferma,
 * evitando gli step intermedi e bypassando il captcha.
 *
 * @param {Object} client - HTTP client con sessione attiva
 * @param {Object} params
 * @param {string} params.idVerbale        - selectRowId sessione esame
 * @param {string} params.tipoSessione     - "SQI" | "SGOS"
 * @param {string} params.codiceFoglioRosa - marca/foglio rosa candidato
 * @param {string} params.cognome          - cognome candidato (anche parziale)
 * @param {string} params.turnoEsaminatore - turno 1-6 (M1-M6 / P1-P6)
 * @param {string} [params.lingua]         - codice lingua (default "IT")
 * @param {string} [params.audio]          - supporto audio "S"/"N" (default "N")
 * @param {string} [params.progressivoAula]- per SGOS con aula specifica
 */
async function prenotazioneDirectUrl(client, params = {}) {
  const {
    idVerbale,
    tipoSessione = "SQI",
    codiceFoglioRosa,
    cognome,
    turnoEsaminatore,
    lingua = "IT",
    audio = "N",
    progressivoAula,
  } = params;

  if (!idVerbale || !codiceFoglioRosa || !cognome || !turnoEsaminatore) {
    throw new Error("prenotazioneDirectUrl: idVerbale, codiceFoglioRosa, cognome e turnoEsaminatore sono obbligatori");
  }

  const qp = new URLSearchParams({
    pageStatus: "New",
    "disponibilitaSessioneEsameEPView.disponibilitaSessioneEsameEPFrom.selectRowId": String(idVerbale),
    "disponibilitaSessioneEsameEPView.indicatoreTipoSessione": String(tipoSessione),
    "disponibilitaSessioneEsameEPView.visualizzaCaptcha": "false",   // ← bypass captcha
    "disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.theRichiestaEmissioneDocumentoAbilitazioneEP.codiceFoglioRosa": String(codiceFoglioRosa),
    "disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.theRichiestaEmissioneDocumentoAbilitazioneEP.thePersonaFisica.descrizioneCognomePersonaFisica": String(cognome),
    "disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.codiceLinguaPrenotazioneCandidato": String(lingua),
    "disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.supportoAudio": String(audio),
    "disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.turnoEsaminatore": String(turnoEsaminatore),
    "action:CreateSIP_saveNewElementCandidato": "Conferma",
  });

  if (progressivoAula) {
    qp.set("disponibilitaSessioneEsameEPView.disponibilitaSessioneEsameEPFrom.theAulaEP.progressivoAula", String(progressivoAula));
  }

  const url = `${BASE_URL}/prenotazione/disponibilitaSessioneEsameEP/Select_listCandidati.action?${qp.toString()}`;

  const response = await client.get(url, {
    headers: {
      Referer: `${BASE_URL}/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH`,
    },
  });

  return response.data;
}

async function confermaNuovoCandidato(client, html, options = {}) {
  const { payload, action } = buildDetailPayload(html);
  const url = resolveUrl(options.url || action || "/prenotazione/disponibilitaSessioneEsameEP/SelectCandidato_viewNewCandidato.action");

  payload.set("disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.turnoEsaminatore", String(options.turnoEsaminatore ?? "0"));
  if (options.codiceLingua) {
    payload.set("disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.codiceLinguaPrenotazioneCandidato", String(options.codiceLingua));
  }
  if (options.supportoAudio) {
    payload.set("disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.supportoAudio", String(options.supportoAudio));
  }
  if (options.codiceTipoPagamento) {
    payload.set("disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.codiceTipoPagamento", String(options.codiceTipoPagamento));
  }
  if (options.indicatoreTipoEsamePrenotato) {
    payload.set("disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.indicatoreTipoEsamePrenotato", String(options.indicatoreTipoEsamePrenotato));
  }

  applyFields(payload, options.fields || {});

  return postPortalForm(client, url, payload, options.referer);
}

async function modificaCandidatoPrenotazione(client, html, options = {}) {
  const { payload, action } = buildDetailPayload(html);
  const url = resolveUrl(options.url || action || "/prenotazione/disponibilitaSessioneEsameEP/SelectCandidato_editElementCandidato.action");
  applyFields(payload, options.fields || {});
  return postPortalForm(client, url, payload, options.referer);
}

async function eliminaCandidatoPrenotazione(client, html, options = {}) {
  const { payload, action } = buildDetailPayload(html);
  const url = resolveUrl(options.url || action || "/prenotazione/disponibilitaSessioneEsameEP/SelectCandidato_viewDeletingElementCandidato.action");
  applyFields(payload, options.fields || {});
  return postPortalForm(client, url, payload, options.referer);
}

async function sostituisciCandidatoPrenotazione(client, html, options = {}) {
  const { payload, action } = buildDetailPayload(html);
  const url = resolveUrl(options.url || action || "/prenotazione/disponibilitaSessioneEsameEP/SelectCandidato_viewSostituisciCandidato.action");
  applyFields(payload, options.fields || {});
  return postPortalForm(client, url, payload, options.referer);
}

async function prenotaSessione(client, sessione) {
  const action = sessione?.action || "";
  const url = resolveUrl(action);

  const formData = new URLSearchParams();
  const hiddenFields = sessione?.hiddenFields || {};

  Object.entries(hiddenFields).forEach(([name, value]) => {
    formData.append(name, value == null ? "" : String(value));
  });

  if (sessione?.sessionId && !formData.has("sessionId")) {
    formData.append("sessionId", sessione.sessionId);
  }

  const res = await client.post(url, serializePayloadRaw(formData), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer:
        "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH",
    },
  });

  return res.data;
}

async function confermaPrenotazione(client, step2Html) {
  const request = extractConfirmationRequest(step2Html);

  if (!request || !request.url) {
    throw new Error("Form di conferma non trovato in step2.html");
  }

  const res = await client.post(request.url, serializePayloadRaw(request.payload), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer:
        "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH",
    },
  });

  return res.data;
}

module.exports = {
  prenotaSessione,
  confermaPrenotazione,
  cercaCandidatoInDettaglio,
  confermaNuovoCandidato,
  modificaCandidatoPrenotazione,
  eliminaCandidatoPrenotazione,
  sostituisciCandidatoPrenotazione,
  prenotazioneDirectUrl,
  // Esposti per uso da sessioneDettaglio controller
  buildDetailPayload,
  setAction,
  serializePayloadRaw,
  postPortalForm,
};

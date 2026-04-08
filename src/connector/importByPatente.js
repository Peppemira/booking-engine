const cheerio = require("cheerio");
const supabase = require("../database/supabase");
const { loginAndGetJar } = require("./portalSession");
const { makeHttpClient, loadMenu, readSituazioneCandidati } = require("./portalHttp");
const { parseSearchResults } = require("../parser/searchResultsParser");
const { parsePortalCandidates } = require("../parser/candidateParser");

const SEARCH_URLS = [
  "https://www.ilportaledellautomobilista.it/prenotazione/richiestaEmissioneDocumentoAbilitazioneEP/Read_pagingSituazioneCandidati.action",
  "https://www.ilportaledellautomobilista.it/prenotazione/richiestaEmissioneDocumentoAbilitazioneEP/ReadSituazioneCandidati_pagingSituazioneCandidati.action",
  "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/ReadSituazioneCandidati_pagingSituazioneCandidati.action",
  "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsame/ReadSituazioneCandidati_pagingSituazioneCandidati.action",
];
const SEARCH_REFERERS = [
  "https://www.ilportaledellautomobilista.it/prenotazione/richiestaEmissioneDocumentoAbilitazioneEP/Read_initActionSituazioneCandidati.action?pageStatus=SEARCH",
  "https://www.ilportaledellautomobilista.it/prenotazione/richiestaEmissioneDocumentoAbilitazioneEP/Read_initActionSituazioneCandidati.action",
  "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH",
  "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsame/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH",
];

function pickFirst(fields, keys, fallback = null) {
  for (const key of keys) {
    const value = fields?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return fallback;
}

function sanitizeKey(name) {
  return String(name || "")
    .replace(/[\[\]]/g, "_")
    .replace(/\.+/g, "_")
    .replace(/__+/g, "_")
    .replace(/^_+|_+$/g, "")
    .trim();
}

function extractFormFields(html) {
  const $ = cheerio.load(html || "");
  const mapped = {};

  $("input, select, textarea").each((_, element) => {
    const el = $(element);
    const keyRaw = el.attr("name") || el.attr("id");
    if (!keyRaw) return;

    const key = sanitizeKey(keyRaw);
    if (!key) return;

    let value = "";
    const tag = String(element.tagName || "").toLowerCase();
    if (tag === "select") {
      value = el.find("option[selected]").first().val() || el.find("option").first().val() || "";
    } else {
      value = el.val() || "";
    }

    const normalized = String(value || "").trim();
    if (normalized) mapped[key] = normalized;
  });

  return {
    ...mapped,
    nome: pickFirst(mapped, ["nome", "Nome", "anagrafica_nome"]),
    cognome: pickFirst(mapped, ["cognome", "Cognome", "anagrafica_cognome"]),
    codiceFiscale: pickFirst(mapped, ["codiceFiscale", "codice_fiscale", "cf"]),
    numeroPatente: pickFirst(mapped, ["numeroPatente", "patente_numero", "patente_numeroPatente"]),
    dataRilascio: pickFirst(mapped, ["dataRilascio", "data_rilascio", "patente_rilasciata_il"]),
    dataScadenza: pickFirst(mapped, ["dataScadenza", "data_scadenza", "patente_scade_il"]),
    enteRilascio: pickFirst(mapped, ["enteRilascio", "ente_rilascio", "patente_ente_rilascio"]),
    abilitazioni: pickFirst(mapped, ["abilitazioni", "abilitazioni_possedute"]),
  };
}

function findPatenteFromText(html) {
  const text = String(html || "").toUpperCase();
  const match = text.match(/[A-Z]{1,3}\d{5,12}/);
  return match ? match[0] : null;
}

function buildSearchPayload(criteria = {}) {
  const payload = new URLSearchParams();

  const cognome = pickFirst(criteria, ["cognome"]);
  const numeroPatente = pickFirst(criteria, ["numeroPatente", "patente_numero"]);
  const protocollo = pickFirst(criteria, ["protocolloCertificatoMedico", "protocollo"]);
  const marca = pickFirst(criteria, ["marcaOperativa", "marca"]);
  const codiceFiscale = pickFirst(criteria, ["codiceFiscale", "codice_fiscale", "cf"]);
  const codiceAutoscuola = pickFirst(criteria, ["codiceAutoscuola", "codice_autoscuola", "autoscuolaCodice", "codiceScuola"]);

  if (cognome) {
    payload.append("cognome", cognome);
    payload.append("anagrafica.cognome", cognome);
  }

  if (numeroPatente) {
    payload.append("numeroPatente", numeroPatente);
    payload.append("patente.numero", numeroPatente);
  }

  if (protocollo) {
    payload.append("protocolloCertificatoMedico", protocollo);
    payload.append("certificato.protocollo", protocollo);
  }

  if (marca) {
    payload.append("marcaOperativa", marca);
    payload.append("marca.operativa", marca);
  }

  if (codiceFiscale) {
    payload.append("codiceFiscale", codiceFiscale);
    payload.append("anagrafica.codiceFiscale", codiceFiscale);
  }

  if (codiceAutoscuola) {
    payload.append("codiceAutoscuola", codiceAutoscuola);
    payload.append("autoscuola.codice", codiceAutoscuola);
    payload.append("codiceScuola", codiceAutoscuola);
    payload.append("codiceImpresa", codiceAutoscuola);
  }

  const statoFiltro = String(criteria?.statoFiltro || "").trim().toLowerCase();
  if (statoFiltro) {
    const statoCandidati = statoFiltro === "passati" ? "PRENOTATI" : "DA PRENOTARE";
    payload.append("statoCandidati", statoCandidati);
    payload.append("statoRichiesta", "ATTIVA");
  }

  payload.append("action:Read_paging", "Ricerca");
  return payload;
}

async function followPortalRedirectChain(http, html, refererUrl = "") {
  let currentHtml = String(html || "");
  let currentReferer = String(refererUrl || "").trim();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (!currentHtml) break;

    const $ = cheerio.load(currentHtml || "");

    const needsPin =
      currentHtml.includes("SSO - Pin Validation")
      || currentHtml.includes('name="loginView.pin"')
      || $("form#LoginForm, form[name='LoginForm']").length > 0;

    if (needsPin) {
      const pinForm = $("form#LoginForm, form[name='LoginForm']").first();
      const pinActionRaw = String(pinForm.attr("action") || "").trim();
      const pinAction = pinActionRaw.startsWith("http") ? pinActionRaw : `https://www.ilportaledellautomobilista.it${pinActionRaw}`;
      const pinValue = String(process.env.PORTAL_PIN || "").trim();
      if (!pinAction || !pinValue) break;

      const pinData = new URLSearchParams();
      pinForm.find("input[type='hidden']").each((_, input) => {
        const name = $(input).attr("name");
        const value = $(input).attr("value") || "";
        if (name) pinData.append(name, value);
      });
      pinData.append("loginView.pin", pinValue);
      pinData.append("action:Pin_executePinValidation", "Conferma");

      const pinRes = await http.post(pinAction, pinData, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...(currentReferer ? { Referer: currentReferer } : {}),
        },
      });

      currentHtml = String(pinRes.data || "");
      currentReferer = pinAction;
      continue;
    }

    const postForm = $("form[name='postform']").first();
    if (!postForm.length) break;

    const dispatchActionRaw = String(postForm.attr("action") || "").trim();
    const dispatchAction = dispatchActionRaw.startsWith("http") ? dispatchActionRaw : `https://www.ilportaledellautomobilista.it${dispatchActionRaw}`;
    if (!dispatchAction) break;

    const dispatchPayload = new URLSearchParams();
    postForm.find("input[type='hidden']").each((_, input) => {
      const name = $(input).attr("name");
      const value = $(input).attr("value") || "";
      if (name) dispatchPayload.append(name, value);
    });
    if (!Array.from(dispatchPayload.keys()).length) break;

    const dispatchRes = await http.post(dispatchAction, dispatchPayload, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(currentReferer ? { Referer: currentReferer } : {}),
      },
    });

    currentHtml = String(dispatchRes.data || "");
    currentReferer = dispatchAction;
  }

  return currentHtml;
}

function cloneParams(params) {
  const cloned = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    cloned.append(key, value);
  }
  return cloned;
}

async function extractCandidatesFromDetailFlow(http, html = "") {
  const $ = cheerio.load(html || "");
  const forms = $("form").toArray();
  let targetForm = null;

  for (const formNode of forms) {
    const form = $(formNode);
    const hasRadio = form.find('input[type="radio"][name*="selectRowId" i]').length > 0;
    const hasDetail = form.find('input[type="submit"],button').toArray().some((el) => /dettaglio/i.test(String($(el).attr("value") || $(el).text() || "")));
    if (hasRadio && hasDetail) {
      targetForm = form;
      break;
    }
  }

  if (!targetForm) return [];

  const actionRaw = String(targetForm.attr("action") || "").trim();
  const action = actionRaw.startsWith("http") ? actionRaw : `https://www.ilportaledellautomobilista.it${actionRaw}`;
  if (!action) return [];

  const basePayload = new URLSearchParams();
  targetForm.find("input,select,textarea").each((_, element) => {
    const el = $(element);
    const name = String(el.attr("name") || "").trim();
    if (!name) return;
    const type = String(el.attr("type") || "").toLowerCase();
    if (type === "radio") return;
    if (type === "checkbox") {
      if (el.attr("checked")) {
        basePayload.append(name, String(el.val() || "on"));
      }
      return;
    }
    if (element.tagName && String(element.tagName).toLowerCase() === "select") {
      const selected = el.find("option[selected]").first().val() || el.find("option").first().val() || "";
      basePayload.append(name, String(selected || ""));
      return;
    }
    basePayload.append(name, String(el.val() || ""));
  });

  const radios = targetForm.find('input[type="radio"][name*="selectRowId" i]').toArray().map((el) => ({
    name: String($(el).attr("name") || "").trim(),
    value: String($(el).attr("value") || "").trim(),
  })).filter((row) => row.name && row.value);

  const unique = new Map();

  for (const radio of radios.slice(0, 30)) {
    const payload = cloneParams(basePayload);
    Array.from(payload.keys()).forEach((key) => {
      if (String(key).startsWith("action:")) payload.delete(key);
    });
    payload.set(radio.name, radio.value);
    payload.set("action:Select_listCandidati", "Dettaglio");

    try {
      const res = await http.post(action, payload, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: action,
        },
      });

      const detailHtml = String(res.data || "");
      const parsed = parsePortalCandidates(detailHtml);
      parsed.forEach((candidate) => {
        const key = String(candidate?.codice_fiscale || `${candidate?.cognome || ""}|${candidate?.nome || ""}|${candidate?.codice_candidato || ""}`).trim().toUpperCase();
        if (!key) return;
        unique.set(key, candidate);
      });
    } catch {
    }
  }

  return Array.from(unique.values());
}

async function searchCandidateHtml(http, criteria = {}) {
  const payload = buildSearchPayload(criteria);

  if (Array.from(payload.keys()).length <= 1) {
    const baseHtml = await readSituazioneCandidati(http);
    return followPortalRedirectChain(http, baseHtml, SEARCH_REFERERS[0]);
  }

  let bestHtml = "";
  for (const referer of SEARCH_REFERERS) {
    try {
      await http.get(referer);
    } catch {}

    for (const searchUrl of SEARCH_URLS) {
      try {
        const response = await http.post(searchUrl, payload, {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: referer,
          },
        });

        const firstPass = await followPortalRedirectChain(http, response.data || "", referer);
        if (!bestHtml && firstPass) bestHtml = firstPass;
        if (parseSearchResults(firstPass).length > 0) {
          return firstPass;
        }
      } catch {}
    }
  }

  return bestHtml || "";
}

function buildDbRow(dettaglioFields, patente) {
  return {
    cognome: pickFirst(dettaglioFields, ["cognome", "Cognome"], null),
    nome: pickFirst(dettaglioFields, ["nome", "Nome"], null),
    codice_fiscale: pickFirst(dettaglioFields, ["codiceFiscale", "codice_fiscale", "cf"], `PAT-${patente}`),
    patente_numero: patente,
    patente_rilasciata_il: pickFirst(dettaglioFields, ["dataRilascio", "data_rilascio", "patente_rilasciata_il"]),
    patente_scade_il: pickFirst(dettaglioFields, ["dataScadenza", "data_scadenza", "patente_scade_il"]),
    patente_ente_rilascio: pickFirst(dettaglioFields, ["enteRilascio", "ente_rilascio", "patente_ente_rilascio"]),
    abilitazioni_possedute: pickFirst(dettaglioFields, ["abilitazioni", "abilitazioni_possedute"]),
    raw_portale: dettaglioFields,
    categoria_patente: pickFirst(dettaglioFields, ["categoriaPatente", "categoria_patente", "categoria"], "B"),
    tentativi_quiz: Number.isFinite(Number(dettaglioFields?.tentativi_quiz)) ? Number(dettaglioFields.tentativi_quiz) : 0,
    stato: pickFirst(dettaglioFields, ["stato"], "attivo"),
  };
}

async function loadDettaglioCompleto(http, patente, searchHtml) {
  if (!patente) return searchHtml || "";

  const $ = cheerio.load(searchHtml || "");
  let detailUrl = "";

  $("a[href]").each((_, a) => {
    if (detailUrl) return;
    const href = $(a).attr("href") || "";
    const text = ($(a).text() || "").toUpperCase();
    const hrefUpper = href.toUpperCase();
    if (hrefUpper.includes("DETTAGL") || text.includes("DETTAGL") || hrefUpper.includes(String(patente).toUpperCase())) {
      detailUrl = href.startsWith("http") ? href : `https://www.ilportaledellautomobilista.it${href}`;
    }
  });

  if (!detailUrl) {
    return searchHtml || "";
  }

  try {
    const detailRes = await http.get(detailUrl);
    return detailRes.data || searchHtml || "";
  } catch {
    return searchHtml || "";
  }
}

async function importCandidate(input = {}) {
  const { http } = await createPortalHttpClient();
  return importCandidateWithHttp(http, input);
}

async function createPortalHttpClient() {
  const jar = await loginAndGetJar({
    username: process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
    password: process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
    pin: process.env.PORTAL_PIN,
  });

  const http = makeHttpClient(jar);
  await loadMenu(http);
  return { http, jar };
}

async function importCandidateWithHttp(http, input = {}) {
  const userFields = input.fields && typeof input.fields === "object" ? input.fields : {};
  const html = await searchCandidateHtml(http, input);

  const fields = {
    ...extractFormFields(html),
    ...userFields,
  };

  const patente =
    pickFirst(
      {
        ...input,
        ...fields,
      },
      ["numeroPatente", "patente_numero", "numero_patente"]
    ) || findPatenteFromText(html);

  if (!patente) {
    throw new Error("Nessuna patente trovata nei risultati del portale");
  }

  const dettaglioHtml = await loadDettaglioCompleto(http, patente, html);
  const dettaglioFields = {
    ...fields,
    ...extractFormFields(dettaglioHtml),
  };

  const dbRow = buildDbRow(dettaglioFields, patente);

  const { data, error } = await supabase
    .from("candidates")
    .upsert(dbRow, { onConflict: "patente_numero" })
    .select("id,nome,cognome,codice_fiscale,patente_numero")
    .single();

  if (error) throw error;

  return data || dbRow;
}

async function searchCandidates(input = {}) {
  const { http } = await createPortalHttpClient();
  const html = await searchCandidateHtml(http, input);
  let results = parseSearchResults(html);

  if (!results.length) {
    const fromDetail = await extractCandidatesFromDetailFlow(http, html);
    if (fromDetail.length) {
      results = fromDetail.map((row) => ({
        cognome: row.cognome || "",
        nome: row.nome || "",
        numeroPatente: row.numeroPatente || row.patente_numero || "",
        codiceFiscale: row.codice_fiscale || "",
        stato: row.stato || (String(input?.statoFiltro || "").toLowerCase() === "passati" ? "passato" : "attivo"),
        rawCandidate: row,
      }));
    }
  }

  return {
    html,
    results,
  };
}

async function importMassivo(input = {}) {
  const { http } = await createPortalHttpClient();
  const html = await searchCandidateHtml(http, input);
  let parsed = parseSearchResults(html);

  if (!parsed.length) {
    const fromDetail = await extractCandidatesFromDetailFlow(http, html);
    if (fromDetail.length) {
      parsed = fromDetail.map((row) => ({
        cognome: row.cognome || "",
        nome: row.nome || "",
        numeroPatente: row.numeroPatente || row.patente_numero || "",
        codiceFiscale: row.codice_fiscale || "",
        stato: row.stato || (String(input?.statoFiltro || "").toLowerCase() === "passati" ? "passato" : "attivo"),
        rawCandidate: row,
      }));
    }
  }

  const requested = Array.isArray(input.candidates)
    ? input.candidates.map((candidate) => String(candidate?.numeroPatente || "").trim()).filter(Boolean)
    : [];

  const lista = requested.length
    ? parsed.filter((candidate) => requested.includes(String(candidate.numeroPatente || "").trim()))
    : parsed;

  const imported = [];
  const errors = [];

  for (const candidato of lista) {
    try {
      const numeroPatente = String(candidato?.numeroPatente || "").trim();
      if (!numeroPatente) {
        const rawCandidate = candidato?.rawCandidate && typeof candidato.rawCandidate === "object" ? candidato.rawCandidate : {};
        const fallbackCode = String(candidato?.codiceFiscale || rawCandidate?.codice_fiscale || "").trim();
        const payload = {
          nome: String(candidato?.nome || rawCandidate?.nome || "").trim() || null,
          cognome: String(candidato?.cognome || rawCandidate?.cognome || "").trim() || null,
          codice_fiscale: fallbackCode || `LEGACYIMPORT-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
          categoria_patente: String(rawCandidate?.categoria_patente || input?.categoria_patente || "B").trim() || "B",
          stato: String(candidato?.stato || rawCandidate?.stato || (String(input?.statoFiltro || "").toLowerCase() === "passati" ? "passato" : "attivo")).trim() || "attivo",
          raw_portale: {
            ...(rawCandidate || {}),
            source: "situazione-candidati-detail-flow",
            codice_autoscuola: String(input?.codiceAutoscuola || "").trim() || null,
          },
        };

        const { data, error } = await supabase
          .from("candidates")
          .upsert([payload], { onConflict: "codice_fiscale" })
          .select("id,nome,cognome,codice_fiscale,patente_numero")
          .single();

        if (error) throw error;
        imported.push(data || payload);
        continue;
      }

      const row = await importCandidateWithHttp(http, {
        ...input,
        cognome: candidato.cognome || input.cognome,
        numeroPatente: candidato.numeroPatente,
        fields: {
          ...(input.fields || {}),
          nome: candidato.nome,
          cognome: candidato.cognome,
          numeroPatente: candidato.numeroPatente,
        },
      });

      imported.push(row);
    } catch (error) {
      errors.push({
        numeroPatente: candidato.numeroPatente,
        message: error.message,
      });
    }
  }

  return {
    parsed: parsed.length,
    selected: lista.length,
    imported,
    errors,
  };
}

async function importByPatente(payload = {}) {
  return importCandidate(payload);
}

module.exports = {
  importByPatente,
  importCandidate,
  importMassivo,
  searchCandidates,
  extractFormFields,
};

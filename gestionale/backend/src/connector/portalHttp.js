const axios = require("axios").default;
const { wrapper } = require("axios-cookiejar-support");
const cheerio = require("cheerio");

const PORTAL_BASE_URL = "https://www.ilportaledellautomobilista.it";
const PRENOTAZIONE_ENTRY_URLS = [
  "https://www.ilportaledellautomobilista.it/SSO/SSOLogin/DispatcherEntry_executeDispatch.action?goto=https%3A%2F%2Fwww.ilportaledellautomobilista.it%2Fprenotazione",
  "https://www.ilportaledellautomobilista.it/SSO/SSOLogin/DispatcherEntry_executeDispatch.action?goto=http%3A%2F%2Fwww.ilportaledellautomobilista.it%2Fprenotazione",
  "https://www.ilportaledellautomobilista.it/prenotazione",
];
const SESSIONI_SEARCH_URLS = {
  default: [
    "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH",
    "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsame/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH",
    "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action",
    "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsame/Read_initActionSessioniQuizInterne.action",
  ],
  approved: [
    "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizApprovate.action?pageStatus=SEARCH",
    "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsame/Read_initActionSessioniQuizApprovate.action?pageStatus=SEARCH",
    "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizApprovate.action",
    "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsame/Read_initActionSessioniQuizApprovate.action",
  ],
};

// =============================================================================
// UTILITY HELPERS
// =============================================================================

function pushPortalTrace(trace, step, details = {}) {
  if (!Array.isArray(trace)) return;
  trace.push({
    at: new Date().toISOString(),
    step,
    ...details,
  });
}

function resolvePortalUrl(action) {
  if (!action) return action;
  if (action.startsWith("http://") || action.startsWith("https://")) return action;
  return `${PORTAL_BASE_URL}${action}`;
}

function extractHtmlTitle(html) {
  if (typeof html !== "string" || !html.trim()) return "";
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return normalizeWhitespace(match?.[1] || "");
}

function isPortalHome(html) {
  if (typeof html !== "string") return false;
  const normalized = html.toLowerCase();
  return (
    normalized.includes("title>il portale dell") &&
    normalized.includes("- home") &&
    !normalized.includes("disponibilitasessioneesameep")
  );
}

function isServiceUnavailableBySchedule(html) {
  if (typeof html !== "string") return false;
  const normalized = html.toLowerCase();
  return (
    normalized.includes("l'applicazione è disponibile") ||
    normalized.includes("l&apos;applicazione è disponibile") ||
    normalized.includes("disponibile dalle 08:00 alle 21:00")
  );
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractPortalMessage(html) {
  if (typeof html !== "string") return "";

  const $ = cheerio.load(html);
  const selectors = [
    ".alert",
    ".alert-warning",
    ".alert-danger",
    ".error",
    ".errors",
    ".message",
    ".messages",
    "#messages",
    "#message",
    "#errorMessages",
  ];

  for (const selector of selectors) {
    const text = normalizeWhitespace($(selector).first().text());
    if (text && text.length > 10) {
      return text;
    }
  }

  const plainText = normalizeWhitespace($.root().text());
  const scheduleMatch = plainText.match(/l['']applicazione[^.]*disponibile[^.]*(?:\.|$)/i);
  if (scheduleMatch?.[0]) {
    return normalizeWhitespace(scheduleMatch[0]);
  }

  const genericMatch = plainText.match(/disponibile dalle\s*\d{2}:\d{2}\s*alle\s*\d{2}:\d{2}/i);
  if (genericMatch?.[0]) {
    return `L'applicazione è ${normalizeWhitespace(genericMatch[0])}`;
  }

  return "";
}

function getServiceUnavailableMessage(html) {
  if (!isServiceUnavailableBySchedule(html)) {
    return "";
  }
  return extractPortalMessage(html) || "Portale prenotazione non disponibile in questa fascia oraria (08:00-21:00)";
}

function hasSessionResultsTable(html) {
  if (typeof html !== "string") return false;
  const $ = cheerio.load(html);
  let found = false;

  const plainText = normalizeWhitespace($.root().text()).toLowerCase();
  if (plainText.includes("elementi trovati") && plainText.includes("data ses")) {
    return true;
  }

  $("table").each((_, table) => {
    if (found) return;
    const headers = $(table)
      .find("th")
      .map((__, th) => normalizeWhitespace($(th).text()).toLowerCase())
      .get();

    const hasTipoEsame = headers.some((h) => h.includes("tipo esame") || h === "esame");
    const hasData = headers.some((h) => h.includes("data esame") || h.includes("data ipotetica") || h.includes("data ses"));
    const hasPosti = headers.some((h) => h.includes("posti"));
    const hasAutoscuola = headers.some((h) => h.includes("autosc"));
    const hasAbbrevCapacity = headers.some((h) => h.includes("cand poss"));
    const hasLimitePren = headers.some((h) => h.includes("limite pren"));

    if (
      (hasTipoEsame && hasData && hasPosti) ||
      (hasTipoEsame && hasAutoscuola) ||
      (hasData && hasAbbrevCapacity && hasLimitePren)
    ) {
      found = true;
    }
  });

  return found;
}

function getSessionPageDiagnostics(html) {
  const $ = cheerio.load(html || "");
  const hasSearchForm =
    $(
      "form#RicercaDisponibilitaSessioneEsameEP, form[name='RicercaDisponibilitaSessioneEsameEP'], form[name='RicercaDisponibilitaSessioneEsame']"
    ).length > 0;
  const hasDispatcherForm = $("form[name='postform']").length > 0;

  return {
    title: extractHtmlTitle(html),
    isHome: isPortalHome(html),
    hasSearchForm,
    hasDispatcherForm,
    hasSessionTable: hasSessionResultsTable(html),
    portalMessage: extractPortalMessage(html),
  };
}

function readDefaultSelectValue($, select) {
  const selected = $(select).find("option[selected]").first();
  if (selected.length) {
    return selected.attr("value") || "";
  }
  const first = $(select).find("option").first();
  return first.length ? first.attr("value") || "" : "";
}

function formatDateDDMMYYYY(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  return `${day}/${month}/${year}`;
}

function normalizeRequestedSessionState(value) {
  const state = String(value || "").trim().toUpperCase();
  if (!state) return "";
  if (state.startsWith("APPROVAT")) return "APPROVATA";
  if (state.startsWith("APERT")) return "APERTA";
  if (state.startsWith("CHIUS")) return "CHIUSA";
  return state;
}

function findStatusValueFromSelect($, form, requestedState) {
  const normalizedState = normalizeRequestedSessionState(requestedState);
  if (!normalizedState) return "";

  const select = $(form)
    .find('select[name*="theStatoDisponibilitaSessioneEsameEP.selectRowId"]')
    .first();
  if (!select.length) return "";

  const options = select
    .find("option")
    .map((_, option) => ({
      value: String($(option).attr("value") || "").trim(),
      text: normalizeWhitespace($(option).text()).toUpperCase(),
    }))
    .get();

  const pick = (predicate) => {
    const found = options.find(predicate);
    return found?.value || "";
  };

  if (normalizedState === "APERTA") {
    return (
      pick((option) => option.value === "A|") ||
      pick((option) => /APERT|DISPONIB|PRENOTAB/.test(option.text))
    );
  }

  if (normalizedState === "CHIUSA") {
    return pick((option) => /CHIUS|NON\s*PRENOT|ESAUR|COMPLET/.test(option.text));
  }

  if (normalizedState === "APPROVATA") {
    return pick((option) => /APPROVAT/.test(option.text));
  }

  return pick((option) => option.text.includes(normalizedState));
}

function setFirstMatchingField(payload, matcher, value) {
  if (!value) return;
  const key = Array.from(payload.keys()).find((name) => matcher(String(name || "")));
  if (!key) return;
  const current = String(payload.get(key) || "").trim();
  if (!current) {
    payload.set(key, value);
  }
}

function toPortalDate(value) {
  if (!value) return "";
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const [, year, month, day] = m;
  return `${day}/${month}/${year}`;
}

function applySessionSearchDefaults(payload, options = {}) {
  const requestedState = normalizeRequestedSessionState(options?.requestedState);
  const requestedStatusValue = String(options?.statusValue || "").trim();
  const searchFilters =
    options?.searchFilters && typeof options.searchFilters === "object"
      ? options.searchFilters
      : {};

  if (requestedStatusValue) {
    const statusKey = Array.from(payload.keys()).find((name) =>
      String(name || "").includes("theStatoDisponibilitaSessioneEsameEP.selectRowId")
    );
    if (statusKey) {
      payload.set(statusKey, requestedStatusValue);
    }
  } else if (requestedState !== "APPROVATA") {
    setFirstMatchingField(
      payload,
      (name) => name.includes("theStatoDisponibilitaSessioneEsameEP.selectRowId"),
      "A|"
    );
  }

  if (requestedState === "APPROVATA") {
    const approvataKey = Array.from(payload.keys()).find((name) =>
      /approvata$/i.test(String(name || ""))
    );
    if (approvataKey) {
      payload.set(approvataKey, "S");
    }
  }

  const fromFilter = toPortalDate(searchFilters.dataDa);
  const toFilter = toPortalDate(searchFilters.dataA);

  if (fromFilter) {
    setFirstMatchingField(
      payload,
      (name) => name.includes("EPFrom.dataDisponibiltaEsaminatore"),
      fromFilter
    );
  } else {
    const today = new Date();
    setFirstMatchingField(
      payload,
      (name) => name.includes("EPFrom.dataDisponibiltaEsaminatore"),
      formatDateDDMMYYYY(today)
    );
  }

  if (toFilter) {
    setFirstMatchingField(
      payload,
      (name) => name.includes("EPTo.dataDisponibiltaEsaminatore"),
      toFilter
    );
  } else {
    const today = new Date();
    const maxRangeDate = new Date(today);
    maxRangeDate.setDate(maxRangeDate.getDate() + 29);
    setFirstMatchingField(
      payload,
      (name) => name.includes("EPTo.dataDisponibiltaEsaminatore"),
      formatDateDDMMYYYY(maxRangeDate)
    );
  }

  const ufficioMctc = String(process.env.PORTAL_UFFICIO_MCTC || "").trim();
  if (ufficioMctc) {
    setFirstMatchingField(
      payload,
      (name) => name.includes("theDisponibilitaEsaminatoreEP.codUfficioMCTC"),
      ufficioMctc
    );
  }

  setFirstMatchingField(
    payload,
    (name) =>
      name.endsWith(".indicatoreConseguimentoEsame") ||
      name.includes("indicatoreConseguimentoEsame"),
    "P"
  );

  // Tipo sessione: usa il valore richiesto (SGOS per Guide/Orali, SCQC per CQC, default SQI)
  const tipoSessioneMap = { "SGOS": "SGOS", "SCQC": "SCQC", "SQI": "SQI", "SQA": "SQI" };
  const tipoSessioneValue = tipoSessioneMap[String(searchFilters?.tipoEsame || "").toUpperCase()] || "SQI";
  setFirstMatchingField(
    payload,
    (name) =>
      name.endsWith(".indicatoreTipoSessione") || name.includes("indicatoreTipoSessione"),
    tipoSessioneValue
  );

  // Tipo prova: Q=Quiz per SQI, G=Guida o O=Orale per SGOS
  const tipoProvaMap = { "SGOS": "G", "SCQC": "Q", "SQI": "Q", "SQA": "Q" };
  const tipoProvaValue = tipoProvaMap[String(searchFilters?.tipoEsame || "").toUpperCase()] || "Q";
  setFirstMatchingField(
    payload,
    (name) =>
      name.endsWith(".indicatoreTipoProvaEsame") || name.includes("indicatoreTipoProvaEsame"),
    tipoProvaValue
  );

  const approvataValue = requestedState === "APPROVATA" ? "S" : "N";
  setFirstMatchingField(
    payload,
    (name) => /approvata$/i.test(String(name || "")),
    approvataValue
  );
}

function applySearchSubmitAction(payload, discoveredSubmitActionKeys = []) {
  const discovered = Array.isArray(discoveredSubmitActionKeys)
    ? discoveredSubmitActionKeys.filter((key) => String(key || "").startsWith("action:"))
    : [];

  discovered.forEach((key) => {
    if (!payload.has(key)) {
      payload.append(key, "");
    }
  });

  const clearActionKeys = Array.from(payload.keys()).filter((key) =>
    /action:.*(clear|undo|annulla)/i.test(String(key || ""))
  );
  clearActionKeys.forEach((key) => payload.delete(key));

  const actionKeys = Array.from(payload.keys()).filter((key) =>
    String(key || "").startsWith("action:")
  );

  if (!actionKeys.length) {
    payload.append("action:Read_paging", "Ricerca");
    return;
  }

  const preferredKeys = actionKeys.filter((key) =>
    /(read_paging|read_ricerca|ricerca|search)/i.test(key)
  );
  const selectedKey = preferredKeys[0] || actionKeys[0];

  actionKeys.forEach((key) => {
    if (key !== selectedKey) {
      payload.delete(key);
    }
  });

  payload.set(selectedKey, "Ricerca");
}

function clonePayload(payload) {
  const cloned = new URLSearchParams();
  for (const [key, value] of payload.entries()) {
    cloned.append(key, value);
  }
  return cloned;
}

/**
 * Serializza URLSearchParams mantenendo i ":" letterali nei nomi dei parametri.
 * URLSearchParams.toString() codifica ":" come "%3A", ma Struts2 DMI richiede
 * il prefisso "action:" con il colon letterale per riconoscere il Dynamic Method Invocation.
 * Senza questa correzione, il portale restituisce 404 per ogni form submission.
 */
function serializePayloadRaw(payload) {
  const parts = [];
  for (const [key, value] of payload.entries()) {
    // Encode key e value, poi ripristina i ":" nel nome del parametro
    const encodedKey = encodeURIComponent(key).replace(/%3A/gi, ":");
    const encodedValue = encodeURIComponent(value);
    parts.push(`${encodedKey}=${encodedValue}`);
  }
  return parts.join("&");
}

function buildSearchPayloadVariants(payload) {
  const variants = [];
  const seen = new Set();

  function pushVariant(nextPayload) {
    const signature = nextPayload.toString();
    if (!signature || seen.has(signature)) return;
    seen.add(signature);
    variants.push(nextPayload);
  }

  pushVariant(clonePayload(payload));

  const actionKeys = Array.from(payload.keys()).filter((key) =>
    String(key || "").startsWith("action:")
  );
  if (!actionKeys.length) {
    const withPaging = clonePayload(payload);
    withPaging.set("action:Read_paging", "Ricerca");
    pushVariant(withPaging);

    const withRicerca = clonePayload(payload);
    withRicerca.set("action:Read_ricerca", "Ricerca");
    pushVariant(withRicerca);
    return variants;
  }

  actionKeys.forEach((selectedKey) => {
    const nextPayload = clonePayload(payload);
    actionKeys.forEach((key) => {
      if (key !== selectedKey) {
        nextPayload.delete(key);
      }
    });
    nextPayload.set(selectedKey, "Ricerca");
    pushVariant(nextPayload);
  });

  return variants;
}

function extractAutoSubmitForm($) {
  const postForm = $("form[name='postform']").first();
  if (postForm.length) return postForm;

  const forms = $("form").toArray();
  for (const formNode of forms) {
    const form = $(formNode);
    const action = String(form.attr("action") || "");
    const hiddenInputs = form.find("input[type='hidden']");
    if (!hiddenInputs.length) continue;

    const interactiveElements = form.find(
      "input:not([type='hidden']), select, textarea, button"
    );
    if (interactiveElements.length) continue;

    if (/dispatch|sso|entry|execute/i.test(action)) {
      return form;
    }
  }

  return $([]);
}

function buildHiddenFormPayload($, form) {
  const formData = new URLSearchParams();
  form.find("input[type='hidden']").each((_, input) => {
    const name = $(input).attr("name");
    const value = $(input).attr("value") || "";
    if (name) formData.append(name, value);
  });
  return formData;
}

function buildSearchPayloadFromForm($, form, searchFilters = {}) {
  const payload = new URLSearchParams();
  const submitActionKeys = new Set();

  $(form)
    .find("input")
    .each((_, input) => {
      const $input = $(input);
      const name = $input.attr("name");
      const type = String($input.attr("type") || "text").toLowerCase();
      if (!name) return;

      if (type === "submit" || type === "button" || type === "image" || type === "file") {
        if (String(name).startsWith("action:")) {
          submitActionKeys.add(String(name));
        }
        return;
      }

      if (type === "checkbox" || type === "radio") {
        if ($input.attr("checked")) {
          payload.append(name, $input.val() || "on");
        }
        return;
      }

      payload.append(name, $input.val() || "");
    });

  $(form)
    .find("select")
    .each((_, select) => {
      const $select = $(select);
      const name = $select.attr("name");
      if (!name) return;
      payload.append(name, readDefaultSelectValue($, select));
    });

  $(form)
    .find("textarea")
    .each((_, textarea) => {
      const $textarea = $(textarea);
      const name = $textarea.attr("name");
      if (!name) return;
      payload.append(name, $textarea.val() || "");
    });

  const requestedStatusValue = findStatusValueFromSelect($, form, searchFilters?.stato);

  applySearchSubmitAction(payload, Array.from(submitActionKeys));
  applySessionSearchDefaults(payload, {
    statusValue: requestedStatusValue,
    requestedState: searchFilters?.stato,
    searchFilters,
  });

  return payload;
}

async function submitSessionSearchIfPresent(
  client,
  html,
  refererUrl,
  trace = null,
  searchFilters = {}
) {
  const $ = cheerio.load(html || "");

  const form = $(
    "form#RicercaDisponibilitaSessioneEsameEP, form[name='RicercaDisponibilitaSessioneEsameEP'], form[name='RicercaDisponibilitaSessioneEsame']"
  ).first();
  if (!form.length) {
    pushPortalTrace(trace, "search.form.missing", {
      diagnostics: getSessionPageDiagnostics(html),
    });
    return html;
  }

  const action = resolvePortalUrl(form.attr("action"));
  if (!action) {
    pushPortalTrace(trace, "search.action.missing", {});
    return html;
  }

  // Costruisci payload esattamente dal form HTML (include token CSRF single-use)
  const payload = buildSearchPayloadFromForm($, form, searchFilters);

  pushPortalTrace(trace, "search.submit", {
    action,
    payloadKeys: Array.from(payload.keys()),
    actionKeys: Array.from(payload.keys()).filter((k) => String(k).startsWith("action:")),
  });

  // UN SOLO tentativo POST — il token CSRF è single-use, non possiamo riprovare
  try {
    const rawBody = serializePayloadRaw(payload);
    const result = await client.post(action, rawBody, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: refererUrl || action,
        Origin: PORTAL_BASE_URL,
      },
    });

    let resultHtml = result.data;

    // Segui dispatcher chain se necessario
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (typeof resultHtml !== "string") break;
      const $d = cheerio.load(resultHtml || "");
      const dispForm = extractAutoSubmitForm($d);
      if (!dispForm.length) break;
      const dispAction = resolvePortalUrl(dispForm.attr("action"));
      if (!dispAction) break;
      const dispData = buildHiddenFormPayload($d, dispForm);
      if (!Array.from(dispData.keys()).length) break;

      pushPortalTrace(trace, "search.dispatcher", { action: dispAction });
      const dispRes = await client.post(dispAction, serializePayloadRaw(dispData), {
        headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: action },
      });
      resultHtml = dispRes.data;
    }

    const diagnostics = getSessionPageDiagnostics(resultHtml);
    pushPortalTrace(trace, "search.result", { diagnostics });
    return resultHtml;
  } catch (error) {
    pushPortalTrace(trace, "search.error", {
      action,
      status: error?.response?.status || null,
      message: String(error?.message || "").slice(0, 500),
    });
    // Se il POST fallisce (tipicamente 404 con Struts2 DMI), ritorna l'HTML originale
    // Il chiamante userà il browser fallback
    return html;
  }
}

// =============================================================================
// CLIENT HTTP
// =============================================================================

function makeHttpClient(jar) {
  return wrapper(
    axios.create({
      jar,
      withCredentials: true,
      timeout: 30000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "max-age=0",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
      maxRedirects: 10,
    })
  );
}

// =============================================================================
// FUNZIONI PRENOTAZIONE ESAMI (originali)
// =============================================================================

async function loadMenu(client) {
  const url =
    "https://www.ilportaledellautomobilista.it/prenotazione/menu/LoadMenu_execute.action";
  const res = await client.get(url);
  return res.data;
}

async function warmPrenotazioneContext(client, trace = null) {
  for (const url of PRENOTAZIONE_ENTRY_URLS) {
    try {
      pushPortalTrace(trace, "prenotazione.entry.attempt", { url });
      const response = await client.get(url);
      let html = response.data;
      pushPortalTrace(trace, "prenotazione.entry.got", {
        url,
        title: extractHtmlTitle(html),
        diagnostics: getSessionPageDiagnostics(html),
      });

      // Follow dispatcher chain — il portale restituisce un postform con campi nascosti
      // che DEVE essere inviato per inizializzare il contesto SSO del modulo prenotazione.
      // Senza questo passaggio, tutte le pagine successive restituiscono la homepage.
      for (let chainStep = 0; chainStep < 5; chainStep++) {
        if (typeof html !== "string") break;
        const $d = cheerio.load(html);
        const postForm = $d("form[name='postform']").first();
        if (!postForm.length) break;

        const action = resolvePortalUrl(postForm.attr("action"));
        if (!action) break;

        const formData = new URLSearchParams();
        let fieldCount = 0;
        postForm.find("input[type='hidden']").each((_, input) => {
          const name = $d(input).attr("name");
          const value = $d(input).attr("value") || "";
          if (name) { formData.append(name, value); fieldCount++; }
        });
        if (!fieldCount) break;

        pushPortalTrace(trace, "prenotazione.dispatcher.post", { action, fields: fieldCount, chainStep });
        const dispRes = await client.post(action, serializePayloadRaw(formData), {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: url,
          },
        });
        html = dispRes.data;
        pushPortalTrace(trace, "prenotazione.dispatcher.result", {
          title: extractHtmlTitle(html),
          diagnostics: getSessionPageDiagnostics(html),
          chainStep,
        });
      }

      // Se riceviamo una pagina PIN, gestiscila
      if (typeof html === "string" && (html.includes("SSO - Pin Validation") || html.includes('name="loginView.pin"'))) {
        const pinValue = process.env.PORTAL_PIN;
        if (pinValue) {
          const $pin = cheerio.load(html);
          const pinForm = $pin("form#LoginForm, form[name='LoginForm']").first();
          const pinAction = resolvePortalUrl(pinForm.attr("action"));
          if (pinAction) {
            const pinData = new URLSearchParams();
            pinForm.find("input[type='hidden']").each((_, input) => {
              const name = $pin(input).attr("name");
              const value = $pin(input).attr("value") || "";
              if (name) pinData.append(name, value);
            });
            pinData.append("loginView.pin", pinValue);
            pinData.append("action:Pin_executePinValidation", "Conferma");
            const pinRes = await client.post(pinAction, serializePayloadRaw(pinData), {
              headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: url },
            });
            html = pinRes.data;
            pushPortalTrace(trace, "prenotazione.pin.submitted", { title: extractHtmlTitle(html) });
          }
        }
      }

      // Se siamo finiti sulla HOME, l'SSO non ha funzionato con questo URL.
      // Prova il prossimo URL invece di restituire la homepage.
      if (isPortalHome(html)) {
        pushPortalTrace(trace, "prenotazione.entry.home.skip", {
          url,
          title: extractHtmlTitle(html),
        });
        continue;
      }

      pushPortalTrace(trace, "prenotazione.entry.success", {
        url,
        title: extractHtmlTitle(html),
        diagnostics: getSessionPageDiagnostics(html),
      });
      return html;
    } catch (error) {
      pushPortalTrace(trace, "prenotazione.entry.error", {
        url,
        status: error?.response?.status || null,
        message: String(error?.message || "").slice(0, 500),
      });
    }
  }

  // Se tutti gli URL entry restituiscono HOME, prova ad accedere direttamente al modulo.
  // Il server dovrebbe fare il redirect SSO automaticamente.
  const directUrls = [
    `${PORTAL_BASE_URL}/prenotazione/menu/LoadMenu_execute.action`,
    `${PORTAL_BASE_URL}/prenotazione`,
  ];
  for (const directUrl of directUrls) {
    try {
      pushPortalTrace(trace, "prenotazione.direct.attempt", { url: directUrl });
      const directRes = await client.get(directUrl);
      let html = directRes.data;

      // Segui eventuale catena di dispatcher/postform
      for (let chainStep = 0; chainStep < 5; chainStep++) {
        if (typeof html !== "string") break;
        const $d = cheerio.load(html);
        const postForm = $d("form[name='postform']").first();
        if (!postForm.length) break;

        const action = resolvePortalUrl(postForm.attr("action"));
        if (!action) break;

        const formData = new URLSearchParams();
        let fieldCount = 0;
        postForm.find("input[type='hidden']").each((_, input) => {
          const name = $d(input).attr("name");
          const value = $d(input).attr("value") || "";
          if (name) { formData.append(name, value); fieldCount++; }
        });
        if (!fieldCount) break;

        pushPortalTrace(trace, "prenotazione.direct.dispatcher", { action, fields: fieldCount, chainStep });
        const dispRes = await client.post(action, serializePayloadRaw(formData), {
          headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: directUrl },
        });
        html = dispRes.data;
      }

      if (!isPortalHome(html)) {
        pushPortalTrace(trace, "prenotazione.direct.success", {
          url: directUrl,
          title: extractHtmlTitle(html),
        });
        return html;
      }
      pushPortalTrace(trace, "prenotazione.direct.home", { url: directUrl });
    } catch (e) {
      pushPortalTrace(trace, "prenotazione.direct.error", {
        url: directUrl,
        status: e?.response?.status,
        message: String(e?.message || "").slice(0, 300),
      });
    }
  }

  pushPortalTrace(trace, "prenotazione.warmup.failed", { message: "Tutti gli URL restituiscono HOME" });
  return "";
}

async function openSessionSearchPage(client, trace = null, requestedState = "") {
  const failed404 = [];
  const normalizedState = normalizeRequestedSessionState(requestedState);
  const searchUrls =
    normalizedState === "APPROVATA"
      ? SESSIONI_SEARCH_URLS.approved
      : SESSIONI_SEARCH_URLS.default;

  for (const url of searchUrls) {
    try {
      pushPortalTrace(trace, "session.open.attempt", { url });
      const response = await client.get(url);
      pushPortalTrace(trace, "session.open.success", {
        url,
        title: extractHtmlTitle(response.data),
        diagnostics: getSessionPageDiagnostics(response.data),
      });
      return { html: response.data, url };
    } catch (error) {
      const status = error?.response?.status;
      if (status === 404) {
        failed404.push(url);
        pushPortalTrace(trace, "session.open.404", { url });
        continue;
      }
      pushPortalTrace(trace, "session.open.error", {
        url,
        status: status || null,
        message: String(error?.message || "").slice(0, 500),
      });
      throw error;
    }
  }

  throw new Error(`Nessun URL sedute valido (404): ${failed404.join(" | ")}`);
}

async function readSessioniQuizInterne(client, options = {}) {
  const trace = Array.isArray(options?.trace) ? options.trace : null;
  const searchFilters =
    options?.searchFilters && typeof options.searchFilters === "object"
      ? options.searchFilters
      : {};

  pushPortalTrace(trace, "session.read.start", {});

  await warmPrenotazioneContext(client, trace);

  try {
    await loadMenu(client);
    pushPortalTrace(trace, "menu.load.success", {});
  } catch (_menuError) {
    pushPortalTrace(trace, "menu.load.error", {
      message: String(_menuError?.message || "").slice(0, 500),
    });
  }

  const opened = await openSessionSearchPage(client, trace, searchFilters?.stato);
  const url = opened.url;
  let html = opened.html;

  for (let i = 0; i < 3; i += 1) {
    if (
      typeof html === "string" &&
      (html.includes("SSO - Pin Validation") || html.includes('name="loginView.pin"'))
    ) {
      const $ = cheerio.load(html);
      const pinForm = $("form#LoginForm, form[name='LoginForm']").first();
      const pinAction = resolvePortalUrl(pinForm.attr("action"));

      if (!pinAction) {
        break;
      }

      const pinValue = options?.pin || process.env.PORTAL_PIN;
      if (!pinValue) {
        throw new Error("PORTAL_PIN mancante per validazione PIN lato HTTP");
      }

      const pinData = new URLSearchParams();
      pinForm.find("input[type='hidden']").each((_, input) => {
        const name = $(input).attr("name");
        const value = $(input).attr("value") || "";
        if (name) pinData.append(name, value);
      });

      pinData.append("loginView.pin", pinValue);
      pinData.append("action:Pin_executePinValidation", "Conferma");

      const pinRes = await client.post(pinAction, serializePayloadRaw(pinData), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: url,
        },
      });

      pushPortalTrace(trace, "pin.submit", { action: pinAction });
      html = pinRes.data;
      continue;
    }

    if (isPortalHome(html)) {
      pushPortalTrace(trace, "session.redirect.home", { url });
      html = (await client.get(url)).data;
      continue;
    }

    if (typeof html !== "string" || !html.includes("DispatcherEntry_executeDispatch")) {
      break;
    }

    const $ = cheerio.load(html);
    const action = resolvePortalUrl($("form[name='postform']").attr("action"));
    if (!action) break;

    const formData = new URLSearchParams();
    $("form[name='postform'] input[type='hidden']").each((_, input) => {
      const name = $(input).attr("name");
      const value = $(input).attr("value") || "";
      if (name) formData.append(name, value);
    });

    try {
      pushPortalTrace(trace, "dispatcher.initial.post", { action });
      const dispatcherRes = await client.post(action, serializePayloadRaw(formData), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: url,
        },
      });

      html = dispatcherRes.data;
      pushPortalTrace(trace, "dispatcher.initial.result", {
        diagnostics: getSessionPageDiagnostics(html),
      });
    } catch (error) {
      if (error?.response?.status === 404) {
        pushPortalTrace(trace, "dispatcher.initial.404", { action });
        break;
      }
      pushPortalTrace(trace, "dispatcher.initial.error", {
        action,
        status: error?.response?.status || null,
        message: String(error?.message || "").slice(0, 500),
      });
      throw error;
    }
  }

  html = await submitSessionSearchIfPresent(client, html, url, trace, searchFilters);

  pushPortalTrace(trace, "session.read.final", {
    diagnostics: getSessionPageDiagnostics(html),
  });

  const unavailableMessage = getServiceUnavailableMessage(html);
  if (unavailableMessage) {
    pushPortalTrace(trace, "session.read.unavailable", { message: unavailableMessage });
    throw new Error(unavailableMessage);
  }

  return html;
}

async function readSituazioneCandidati(client) {
  const url =
    "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/ReadSituazioneCandidati_pagingSituazioneCandidati.action";
  const res = await client.get(url, {
    headers: {
      Referer:
        "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH",
    },
  });

  const unavailableMessage = getServiceUnavailableMessage(res.data);
  if (unavailableMessage) {
    throw new Error(unavailableMessage);
  }

  return res.data;
}

// =============================================================================
// FUNZIONI RICHIESTA PATENTI (nuove — replica GeCA)
// =============================================================================

/**
 * Helper comune: analizza la risposta HTML del portale /RichiestaPatenti/
 * Restituisce { stato, messaggio, token, html }
 * stati: "ok" | "errore" | "messaggio" | "login" | "nonesiste"
 */
function parseRichiestaPatentiResponse(html) {
  if (typeof html !== "string" || !html.trim()) {
    return { stato: "errore", messaggio: "Risposta vuota dal portale", token: "", html };
  }

  const $ = cheerio.load(html);
  let stato = "";
  let messaggio = "";
  let token = "";

  // Estrai token struts (usato da foglio rosa e altre azioni)
  $("input[name='token'], input[name='struts.token'], input[name='tokenFoglioRosaFrom']").each(
    (_, el) => {
      const val = $(el).attr("value") || "";
      if (val) token = val;
    }
  );

  const plainText = normalizeWhitespace($.root().text());

  // Orario servizio non disponibile
  if (/dalle 08:00 alle 21:00/i.test(plainText)) {
    return {
      stato: "errore",
      messaggio:
        "I servizi del Portale dell'Automobilista sono disponibili dalle 08:00 alle 21:00.",
      token,
      html,
    };
  }
  if (/non è momentaneamente disponibile/i.test(plainText)) {
    return {
      stato: "errore",
      messaggio:
        "I servizi del Portale dell'Automobilista non sono al momento disponibili.",
      token,
      html,
    };
  }

  // FIX #3: parentesi corrette per precedenza operatori
  if (
    ($("#login-user").length && /itnull/i.test($("#login-user").html() || "")) ||
    $("#LoginFom_button_value_login").length ||
    $(".img_accedi").length
  ) {
    return {
      stato: "login",
      messaggio: "Sessione scaduta, ripetere il login.",
      token,
      html,
    };
  }

  // Pagina inesistente
  if (/la pagina cercata non esiste/i.test(plainText)) {
    return {
      stato: "nonesiste",
      messaggio: "Ricevuto errore 'Pagina Inesistente', riprovare.",
      token,
      html,
    };
  }

  // Errori portale
  const errNode = $(".errore-desc, .errori").first();
  if (errNode.length) {
    return {
      stato: "errore",
      messaggio: normalizeWhitespace(errNode.text()),
      token,
      html,
    };
  }

  // Messaggi informativi
  const msgNode = $(".messaggi, .messaggio").first();
  if (msgNode.length) {
    messaggio = normalizeWhitespace(msgNode.text());
    stato = "messaggio";
  }

  // Segnale di successo: pulsante "Indietro" tipico delle pagine di dettaglio
  if (
    $("#Ins_checkRicercaPrenotazione_button_value_undoFromNew").length ||
    $("#noTastoInvio_button_value_backFromNew").length
  ) {
    stato = "ok";
    messaggio = "";
  }

  if (!stato) stato = "ok";

  return { stato, messaggio, token, html };
}

/**
 * 1. CERCA CANDIDATO per cognome + numero patente
 *    Replica: recupera() → rad1.Checked
 *    GeCA endpoint: /RichiestaPatenti/prenotazionePatente/Read_initAction.action
 */
async function cercaCandidatoPerPatente(client, { cognome, numeroPatente }, trace = null) {
  const url =
    `https://www.ilportaledellautomobilista.it/RichiestaPatenti/prenotazionePatente/Read_initAction.action` +
    `?&pageStatus=NEW` +
    `&prenotazionePatenteView.prenotazionePatenteFrom.theTipoMotivoRichiesta.selectRowId=E|` +
    `&pageStatus=NEW` +
    `&prenotazionePatenteView.cognome=${encodeURIComponent(String(cognome || "").trim())}` +
    `&prenotazionePatenteView.tipoAnagraficheSpeciali=1` +
    `&prenotazionePatenteView.prenotazionePatenteFrom.numeroPatente=${encodeURIComponent(String(numeroPatente || "").trim())}` +
    `&action:Ins_checkRicercaPrenotazione=Ricerca`;

  pushPortalTrace(trace, "cercaCandidato.get", { url });

  const res = await client.get(url);
  const parsed = parseRichiestaPatentiResponse(res.data);

  pushPortalTrace(trace, "cercaCandidato.result", {
    stato: parsed.stato,
    messaggio: parsed.messaggio,
  });

  if (
    parsed.stato === "errore" ||
    parsed.stato === "login" ||
    parsed.stato === "nonesiste"
  ) {
    throw new Error(parsed.messaggio || `Errore portale: ${parsed.stato}`);
  }

  const $ = cheerio.load(parsed.html);
  const dati = {};

  const fieldMap = {
    cognome: '[name*="theAnagrafica.cognome"], [name*="cognome"]',
    nome: '[name*="theAnagrafica.nome"], [name*="nome"]',
    codiceFiscale: '[name*="theAnagrafica.codiceFiscale"], [name*="codiceFiscale"]',
    dataNascita: '[name*="theAnagrafica.dataNascitaString"], [name*="dataNascita"]',
    comuneNascita: '[name*="theComuneNascita"]',
    sesso: '[name*="theAnagrafica.sesso"]',
    numeroPatente: '[name*="numeroPatente"]',
    categoriePatente: '[name*="categoriePatente"]',
  };

  for (const [key, selector] of Object.entries(fieldMap)) {
    const el = $(selector).first();
    if (el.length) {
      dati[key] = normalizeWhitespace(el.val() || el.text() || "");
    }
  }

  return {
    trovato: parsed.stato === "ok",
    messaggio: parsed.messaggio,
    token: parsed.token,
    dati,
    html: parsed.html,
  };
}

/**
 * 2. CERCA CANDIDATO per protocollo medico
 *    Replica: recupera() → rad2.Checked
 *    GeCA endpoint: /RichiestaPatenti/richiestaCertificatoMedico/ReadVerCertificato_initVerCertMed.action
 */
async function cercaCandidatoPerProtocolloMedico(
  client,
  { protocolloMedico },
  trace = null
) {
  const url =
    `https://www.ilportaledellautomobilista.it/RichiestaPatenti/richiestaCertificatoMedico/ReadVerCertificato_initVerCertMed.action` +
    `?richiestaCertificatoMedicoView.richiestaCertificatoMedicoFrom.protocolloCertificatoMedico=${encodeURIComponent(String(protocolloMedico || "").trim())}` +
    `&action:ReadVerCertificato_pagingVerCertMed=Ricerca`;

  pushPortalTrace(trace, "cercaCandidatoCM.get", { url });

  const res = await client.get(url);
  const parsed = parseRichiestaPatentiResponse(res.data);

  pushPortalTrace(trace, "cercaCandidatoCM.result", {
    stato: parsed.stato,
    messaggio: parsed.messaggio,
  });

  if (
    parsed.stato === "errore" ||
    parsed.stato === "login" ||
    parsed.stato === "nonesiste"
  ) {
    throw new Error(parsed.messaggio || `Errore portale: ${parsed.stato}`);
  }

  const $ = cheerio.load(parsed.html);
  const dati = {};

  const fieldMap = {
    cognome: '[name*="cognome"]',
    nome: '[name*="nome"]',
    codiceFiscale: '[name*="codiceFiscale"]',
    dataNascita: '[name*="dataNascita"]',
    numeroPatente: '[name*="numeroPatente"]',
    scadenzaCM: '[name*="dataScadenza"]',
  };

  for (const [key, selector] of Object.entries(fieldMap)) {
    const el = $(selector).first();
    if (el.length) {
      dati[key] = normalizeWhitespace(el.val() || el.text() || "");
    }
  }

  return {
    trovato: parsed.stato === "ok",
    messaggio: parsed.messaggio,
    token: parsed.token,
    dati,
    html: parsed.html,
  };
}

/**
 * 3. CERCA RICHIESTA per marca operativa
 *    Replica: recuperadamarca()
 *    GeCA endpoint: /RichiestaPatenti/richiesta/Read_initAction.action
 */
async function cercaRichiestaPerMarca(
  client,
  { marcaOperativa },
  trace = null
) {
  const baseUrl =
    "https://www.ilportaledellautomobilista.it/RichiestaPatenti/richiesta/Read_initAction.action";

  // Step 1: carica pagina base (come fa GeCA prima della ricerca)
  pushPortalTrace(trace, "cercaMarca.base.get", { baseUrl });
  await client.get(baseUrl);

  // Step 2: ricerca con marca operativa
  const searchUrl =
    `${baseUrl}` +
    `?richiestaView.richiestaFrom.marcaOperativa=${encodeURIComponent(String(marcaOperativa || "").trim())}` +
    `&richiestaView.richiestaFrom.patente=` +
    `&richiestaView.richiestaFrom.theAnagrafica.codiceFiscale=` +
    `&richiestaView.cognome=` +
    `&richiestaView.nome=` +
    `&richiestaView.dataNascita=` +
    `&richiestaView.richiestaFrom.theAnagrafica.theComuneNascita.theProvinciaNascita.selectRowId=` +
    `&richiestaView.richiestaFrom.theAnagrafica.theComuneNascita.selectRowId=` +
    `&richiestaView.richiestaFrom.theAnagrafica.theStatoEstero.selectRowId=` +
    `&action:Read_paging=Ricerca`;

  pushPortalTrace(trace, "cercaMarca.search.get", { searchUrl });
  const res = await client.get(searchUrl);
  const parsed = parseRichiestaPatentiResponse(res.data);

  pushPortalTrace(trace, "cercaMarca.result", { stato: parsed.stato });

  if (
    parsed.stato === "errore" ||
    parsed.stato === "login" ||
    parsed.stato === "nonesiste"
  ) {
    throw new Error(parsed.messaggio || `Errore portale: ${parsed.stato}`);
  }

  const $ = cheerio.load(parsed.html);
  const righe = [];

  $("table tbody tr").each((_, tr) => {
    const cells = $(tr)
      .find("td")
      .map((__, td) => normalizeWhitespace($(td).text()))
      .get();
    if (cells.length >= 4 && cells[0]) {
      righe.push({
        marcaOperativa: cells[0] || "",
        cognome: cells[1] || "",
        nome: cells[2] || "",
        tipoRichiesta: cells[3] || "",
        stato: cells[4] || "",
        data: cells[5] || "",
      });
    }
  });

  return {
    trovato: righe.length > 0,
    messaggio: parsed.messaggio,
    token: parsed.token,
    righe,
    html: parsed.html,
  };
}

/**
 * 4. CERCA RICHIESTE ESAME per autoscuola
 *    Replica: RITENTAPATA() e AGGIORNAPATA()
 *    GeCA endpoint: /RichiestaPatenti/richiestaEsame/Read_initAction.action
 */
async function cercaRichiesteEsame(
  client,
  { idAutAg, codUfficioMctc = "", marcaOperativa = "" },
  trace = null
) {
  let url =
    `https://www.ilportaledellautomobilista.it/RichiestaPatenti/richiestaEsame/Read_initAction.action` +
    `?pageStatus=SEARCH` +
    `&richiestaPerEsameView.richiestaFrom.idAutAg=${encodeURIComponent(String(idAutAg || ""))}` +
    `&richiestaPerEsameView.richiestaFrom.theUfficioMctcOperativo.codiceUffOperativo=${encodeURIComponent(String(codUfficioMctc || ""))}`;

  if (marcaOperativa) {
    url +=
      `&richiestaPerEsameView.richiestaFrom.marcaOperativa=${encodeURIComponent(String(marcaOperativa).trim())}` +
      `&action:Read_paging=Ricerca`;
  }

  pushPortalTrace(trace, "cercaRichiesteEsame.get", { url });

  // FIX #2: un solo GET, riuso res.data
  const res = await client.get(url);
  const parsed = parseRichiestaPatentiResponse(res.data);

  pushPortalTrace(trace, "cercaRichiesteEsame.result", { stato: parsed.stato });

  if (parsed.stato === "errore" || parsed.stato === "login") {
    throw new Error(parsed.messaggio || `Errore portale: ${parsed.stato}`);
  }

  const $ = cheerio.load(parsed.html);
  const righe = [];

  $("table tbody tr").each((_, tr) => {
    const cells = $(tr)
      .find("td")
      .map((__, td) => normalizeWhitespace($(td).text()))
      .get();
    if (cells.length >= 3 && cells[0]) {
      righe.push({
        marcaOperativa: cells[0] || "",
        cognome: cells[1] || "",
        nome: cells[2] || "",
        tipoEsame: cells[3] || "",
        stato: cells[4] || "",
      });
    }
  });

  return {
    trovato: righe.length > 0,
    messaggio: parsed.messaggio,
    token: parsed.token,
    righe,
    html: parsed.html,
  };
}

/**
 * 5. NUOVA ISCRIZIONE ESAME
 *    Replica: Button1_Click() → azione NUOVAISCRIZIONE
 *    GeCA endpoint: POST /RichiestaPatenti/richiesta/Read_paging.action
 */
async function nuovaIscrizioneEsame(
  client,
  { idAutAg, codUfficioMctc, campi = {} },
  trace = null
) {
  const url =
    "https://www.ilportaledellautomobilista.it/RichiestaPatenti/richiesta/Read_paging.action";

  const payload = new URLSearchParams({
    "richiestaView.richiestaFrom.idAutAg": String(idAutAg || ""),
    "richiestaView.richiestaFrom.theUfficioMctcOperativo.codiceUffOperativo":
      String(codUfficioMctc || ""),
    "richiestaView.richiestaFrom.theAnagrafica.cognome": String(campi.cognome || ""),
    "richiestaView.richiestaFrom.theAnagrafica.nome": String(campi.nome || ""),
    "richiestaView.richiestaFrom.theAnagrafica.codiceFiscale": String(
      campi.codiceFiscale || ""
    ),
    "richiestaView.richiestaFrom.theAnagrafica.dataNascitaString": String(
      campi.dataNascita || ""
    ),
    "richiestaView.richiestaFrom.theAnagrafica.sesso": String(campi.sesso || ""),
    "richiestaView.richiestaFrom.theAnagrafica.theComuneNascita.selectRowId": String(
      campi.comuneNascitaId || ""
    ),
    "richiestaView.richiestaFrom.theAnagrafica.theStatoEstero.selectRowId": String(
      campi.statoEsteroId || ""
    ),
    "richiestaView.richiestaFrom.numeroPatente": String(campi.numeroPatente || ""),
    "richiestaView.richiestaFrom.theCategoriaPatente.selectRowId": String(
      campi.categoriaPatenteId || ""
    ),
    "richiestaView.richiestaFrom.theTipoMotivoRichiesta.selectRowId": String(
      campi.tipoMotivoId || "E|"
    ),
    "action:Ins_checkRicercaPrenotazione": "Ricerca",
    ...(campi.extraFields || {}),
  });

  pushPortalTrace(trace, "nuovaIscrizione.post", {
    url,
    payloadKeys: Array.from(payload.keys()),
  });

  const res = await client.post(url, serializePayloadRaw(payload), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer:
        "https://www.ilportaledellautomobilista.it/RichiestaPatenti/richiesta/Read_initAction.action",
    },
  });

  const parsed = parseRichiestaPatentiResponse(res.data);

  pushPortalTrace(trace, "nuovaIscrizione.result", {
    stato: parsed.stato,
    messaggio: parsed.messaggio,
  });

  if (parsed.stato === "errore" || parsed.stato === "login") {
    throw new Error(parsed.messaggio || `Errore nuova iscrizione: ${parsed.stato}`);
  }

  return {
    successo: parsed.stato === "ok",
    messaggio: parsed.messaggio,
    token: parsed.token,
    html: parsed.html,
  };
}

/**
 * 6. FOGLIO ROSA — Stampa / Ristampa
 *    Replica: STAMPAFRPATA()
 *    GeCA endpoint: /RichiestaPatenti/foglioRosa/Read_initActionStampa.action
 */
async function foglioRosa(client, { token = "", ristampa = false }, trace = null) {
  const baseAction = ristampa ? "Read_initActionRistampa" : "Read_initActionStampa";
  const pagingAction = ristampa ? "Read_pagingRistampa" : "Read_pagingStampa";
  const base = "https://www.ilportaledellautomobilista.it/RichiestaPatenti/foglioRosa";

  // Step 1: apri pagina foglio rosa
  let url = `${base}/${baseAction}.action?pageStatus=SEARCH`;
  if (ristampa) url += "&menu=Ristampa";

  pushPortalTrace(trace, "foglioRosa.step1.get", { url });
  const res1 = await client.get(url);
  const parsed1 = parseRichiestaPatentiResponse(res1.data);

  if (parsed1.stato === "errore" || parsed1.stato === "login") {
    throw new Error(parsed1.messaggio || "Errore accesso foglio rosa");
  }

  const tokenStep1 = parsed1.token || token;

  // Step 2: richiesta con token (come fa GeCA dopo aver letto il token dalla pagina)
  if (tokenStep1) {
    const url2 =
      `${base}/${baseAction}.action` +
      `?struts.token.name=tokenFoglioRosaFrom` +
      `&tokenFoglioRosaFrom=${encodeURIComponent(tokenStep1)}`;

    pushPortalTrace(trace, "foglioRosa.step2.get", { url: url2 });
    const res2 = await client.get(url2);
    const parsed2 = parseRichiestaPatentiResponse(res2.data);

    if (parsed2.stato === "errore" || parsed2.stato === "login") {
      throw new Error(parsed2.messaggio || "Errore step 2 foglio rosa");
    }

    const tokenStep2 = parsed2.token || tokenStep1;

    // Step 3: paging con token aggiornato
    const url3 =
      `${base}/${pagingAction}.action` +
      `?struts.token.name=tokenFoglioRosaFrom` +
      `&tokenFoglioRosaFrom=${encodeURIComponent(tokenStep2)}`;

    pushPortalTrace(trace, "foglioRosa.step3.get", { url: url3 });
    const res3 = await client.get(url3);
    const parsed3 = parseRichiestaPatentiResponse(res3.data);

    pushPortalTrace(trace, "foglioRosa.result", { stato: parsed3.stato });

    return {
      successo: parsed3.stato === "ok" || parsed3.stato === "messaggio",
      messaggio: parsed3.messaggio,
      token: parsed3.token,
      html: parsed3.html,
    };
  }

  return {
    successo: parsed1.stato === "ok",
    messaggio: parsed1.messaggio,
    token: tokenStep1,
    html: parsed1.html,
  };
}

/**
 * 7. RINNOVO PATENTE
 *    Replica: verrinnovab() / verificarinnovoemissionerinnovo()
 *    GeCA endpoint: /RichiestaPatenti/richiesta/ReadAcqRinnAgenzia_pagingAcqRinnAgenzia.action
 */
async function rinnovoPatente(
  client,
  { numeroPatente, codiceMotivo = "R" },
  trace = null
) {
  const url =
    `https://www.ilportaledellautomobilista.it/RichiestaPatenti/richiesta/ReadAcqRinnAgenzia_pagingAcqRinnAgenzia.action` +
    `?richiestaView.richiestaRinnAgenziaFrom.codiceMotivo=${encodeURIComponent(codiceMotivo)}` +
    `&richiestaView.richiestaRinnAgenziaFrom.patente=${encodeURIComponent(String(numeroPatente || "").trim())}`;

  pushPortalTrace(trace, "rinnovoPatente.get", { url });
  const res = await client.get(url);
  const parsed = parseRichiestaPatentiResponse(res.data);

  pushPortalTrace(trace, "rinnovoPatente.result", { stato: parsed.stato });

  if (parsed.stato === "errore" || parsed.stato === "login") {
    throw new Error(parsed.messaggio || "Errore rinnovo patente");
  }

  return {
    successo: parsed.stato === "ok" || parsed.stato === "messaggio",
    messaggio: parsed.messaggio,
    token: parsed.token,
    html: parsed.html,
  };
}

/**
 * 8. CERCA CQC per codice fiscale
 *    Replica: recuperadaticqcguidaAsync()
 *    GeCA endpoint: /RichiestaPatenti/prenotazioneCqc/ReadAgenziaPatItaCqc_newElementPatItaCqcAg.action
 */
async function cercaCQCPerCodFisc(
  client,
  { codiceFiscale, patenteItaliana = "" },
  trace = null
) {
  const url =
    `https://www.ilportaledellautomobilista.it/RichiestaPatenti/prenotazioneCqc/ReadAgenziaPatItaCqc_newElementPatItaCqcAg.action` +
    `?prenotazionePatenteCqcView.prenotazioneCartaQualificazioneConducenteEPFrom.marcaOperativa=` +
    `&prenotazionePatenteCqcView.prenotazioneCartaQualificazioneConducenteEPFrom.codiceStato=` +
    `&prenotazionePatenteCqcView.prenotazioneCartaQualificazioneConducenteEPFrom.dataDecorrenzaStatoString=` +
    `&prenotazionePatenteCqcView.prenotazioneCartaQualificazioneConducenteEPTo.dataDecorrenzaStatoString=` +
    `&prenotazionePatenteCqcView.cognome=` +
    `&prenotazionePatenteCqcView.prenotazioneCartaQualificazioneConducenteEPFrom.patenteItalianaPosseduta=${encodeURIComponent(String(patenteItaliana || ""))}` +
    `&pageStatus=NEW_CQC` +
    `&prenotazionePatenteCqcView.prenotazioneCartaQualificazioneConducenteEPFrom.theTipoMotivoRichiestaEP.selectRowId=R|` +
    `&prenotazionePatenteCqcView.prenotazioneCartaQualificazioneConducenteEPFrom.codiceFiscaleRichiedente=${encodeURIComponent(String(codiceFiscale || "").trim())}`;

  pushPortalTrace(trace, "cercaCQC.get", { url });
  const res = await client.get(url);
  const parsed = parseRichiestaPatentiResponse(res.data);

  pushPortalTrace(trace, "cercaCQC.result", { stato: parsed.stato });

  if (parsed.stato === "errore" || parsed.stato === "login") {
    throw new Error(parsed.messaggio || "Errore ricerca CQC");
  }

  const $ = cheerio.load(parsed.html);
  const dati = {};

  const fieldMap = {
    cognome: '[name*="cognome"]',
    nome: '[name*="nome"]',
    codiceFiscale: '[name*="codiceFiscale"]',
    dataNascita: '[name*="dataNascita"]',
    categoriaPatente: '[name*="categoriaPatente"], [name*="patenteItalianaPosseduta"]',
    scadenzaCQC: '[name*="dataScadenzaCqc"], [name*="dataScadenza"]',
  };

  for (const [key, selector] of Object.entries(fieldMap)) {
    const el = $(selector).first();
    if (el.length) dati[key] = normalizeWhitespace(el.val() || el.text() || "");
  }

  return {
    trovato: parsed.stato === "ok",
    messaggio: parsed.messaggio,
    token: parsed.token,
    dati,
    html: parsed.html,
  };
}

/**
 * 9. CAMBIO CODICE AUTOSCUOLA
 *    Replica: cambiocodice2() / CAMBIOCODICE1()
 *    GeCA endpoint: /RichiestaPatenti/richiestaEsame/SearchCambioCodAutoscuola_pagingCambioCodiceAutoscuola.action
 */
async function cambioCodiceAutoscuola(
  client,
  { marcaOperativa, nuovoCodiceAutoscuola },
  trace = null
) {
  const url =
    "https://www.ilportaledellautomobilista.it/RichiestaPatenti/richiestaEsame/SearchCambioCodAutoscuola_pagingCambioCodiceAutoscuola.action";

  const payload = new URLSearchParams({
    "richiestaPerEsameView.richiestaFrom.marcaOperativa": String(marcaOperativa || "").trim(),
    "richiestaPerEsameView.nuovoCodiceAutoscuola": String(nuovoCodiceAutoscuola || "").trim(),
    "action:SearchCambioCodAutoscuola_pagingCambioCodiceAutoscuola": "Ricerca",
  });

  pushPortalTrace(trace, "cambioCodice.post", { url });

  const res = await client.post(url, serializePayloadRaw(payload), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer:
        "https://www.ilportaledellautomobilista.it/RichiestaPatenti/richiestaEsame/ReadCambioCodAut_initActionCambioCodAut.action",
    },
  });

  const parsed = parseRichiestaPatentiResponse(res.data);
  pushPortalTrace(trace, "cambioCodice.result", { stato: parsed.stato });

  if (parsed.stato === "errore" || parsed.stato === "login") {
    throw new Error(parsed.messaggio || "Errore cambio codice autoscuola");
  }

  return {
    successo: parsed.stato === "ok" || parsed.stato === "messaggio",
    messaggio: parsed.messaggio,
    token: parsed.token,
    html: parsed.html,
  };
}

// =============================================================================
// VERBALI — Conseguimento / CQC / Revisione
// =============================================================================

/**
 * Legge i Verbali dal Portale dell'Automobilista.
 *
 * @param {object} client  - axios con cookie jar
 * @param {object} options
 *   tipo       : 'VAC'|'VSC'|'VAQ'|'VSQ'|'VSR'|'VSRCQCC'  (default 'VSC')
 *   tipoEsame  : 'QUIZ'|'GUIDA'|'ORALE'|'SCRITTO' (default '' = tutti)
 *   dataFrom   : 'DD/MM/YYYY' (default oggi - 6 giorni)
 *   dataTo     : 'DD/MM/YYYY' (default oggi, max 7 giorni da dataFrom)
 *   codUfficio : codice ufficio MCTC (default da env PORTAL_UFFICIO_MCTC)
 *   trace      : array per diagnostica (opzionale)
 * @returns {Promise<string>} HTML della pagina risultati
 */
async function readVerbali(client, options = {}) {
  const trace = Array.isArray(options?.trace) ? options.trace : null;

  // Mappa tipo → URL e action submit
  const TIPO_CONFIG = {
    VAC:     { path: "Read_initActionVerbaliApertiConseguimento",    submit: "action:ReadConseguimento_pagingConseguimento" },
    VSC:     { path: "Read_initActionVerbaliSvoltiConseguimento",    submit: "action:ReadConseguimento_pagingConseguimento" },
    VACA:    { path: "Read_initActionVerbaliAnnullatiConseguimento", submit: "action:VerbaleAnnullato_pagingVerbaleAnnullato" },
    SVCO:    { path: "Read_initActionVerbaliAnnullatiConseguimento", submit: "action:VerbaleAnnullato_pagingVerbaleAnnullato" },
    VAQ:     { path: "Read_initActionVerbaliApertiCqc",              submit: "action:ReadCqc_pagingCQC" },
    VSQ:     { path: "Read_initActionVerbaliSvoltiCqc",              submit: "action:ReadCqc_pagingCQC" },
    VAQA:    { path: "Read_initActionVerbaliAnnullatiCqc",           submit: "action:VerbaleAnnullatoCqc_pagingVerbaleAnnullatoCqc" },
    SVSQ:    { path: "Read_initActionVerbaliAnnullatiCqc",           submit: "action:VerbaleAnnullatoCqc_pagingVerbaleAnnullatoCqc" },
    VSR:     { path: "Read_initActionVerbaliSvoltiRevisione",        submit: "action:ReadRevisione_pagingRevisione" },
    SVRO:    { path: "Read_initActionVerbaliAnnullatiRevisione",     submit: "action:VerbaleAnnullatoRevisione_pagingVerbaleAnnullatoRevisione" },
    VSRCQCC: { path: "Read_initActionVerbaliSvoltiCqcRev",           submit: "action:ReadRevisione_pagingRevisione" },
    SVROCQC: { path: "Read_initActionVerbaliAnnullatiRevisioneCqc",  submit: "action:VerbaleAnnullatoRevisioneCqc_pagingVerbaleAnnullatoRevisioneCqc" },
  };

  const tipo = (options.tipo || "VSC").toUpperCase();
  const cfg = TIPO_CONFIG[tipo] || TIPO_CONFIG["VSC"];

  const PORTAL_BASE = "https://www.ilportaledellautomobilista.it";
  const baseUrl = `${PORTAL_BASE}/prenotazione/sessioneEsameAbilitazioneEP/${cfg.path}.action`;

  // Date di default: ultimi 7 giorni (massimo consentito dal portale)
  function todayDDMMYYYY() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
  }
  function daysAgoDDMMYYYY(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
  }

  // Converti date ISO (YYYY-MM-DD) → DD/MM/YYYY se necessario
  function ensureDDMMYYYY(val) {
    if (!val) return "";
    const isoMatch = String(val).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
    return String(val); // già DD/MM/YYYY o altro formato
  }
  const dataFrom = ensureDDMMYYYY(options.dataFrom) || daysAgoDDMMYYYY(6);
  const dataTo   = ensureDDMMYYYY(options.dataTo)   || todayDDMMYYYY();
  const codUfficio = options.codUfficio || process.env.PORTAL_UFFICIO_MCTC || "";

  pushPortalTrace(trace, "verbali.read.start", { tipo, dataFrom, dataTo, codUfficio });

  // 0) Warm-up: naviga al contesto prenotazione + menu (come iPatente Cloud)
  try {
    await warmPrenotazioneContext(client, trace);
    pushPortalTrace(trace, "verbali.warmup.done", {});
  } catch (_warmErr) {
    pushPortalTrace(trace, "verbali.warmup.error", { message: String(_warmErr?.message || "").slice(0, 300) });
  }
  try {
    await loadMenu(client);
    pushPortalTrace(trace, "verbali.menu.done", {});
  } catch (_menuErr) {
    pushPortalTrace(trace, "verbali.menu.error", { message: String(_menuErr?.message || "").slice(0, 300) });
  }

  // 1) GET pagina di ricerca per ottenere il form e il token CSRF
  let getResp;
  try {
    getResp = await client.get(`${baseUrl}?pageStatus=SEARCH`, {
      headers: { Referer: `${PORTAL_BASE}/prenotazione/menu/LoadMenu_execute.action` },
    });
  } catch (err) {
    pushPortalTrace(trace, "verbali.get.error", { message: String(err?.message || "").slice(0, 300) });
    throw err;
  }

  let html = getResp.data;
  pushPortalTrace(trace, "verbali.get.done", { title: extractHtmlTitle(html), diagnostics: getSessionPageDiagnostics(html) });

  // 2) Gestisci redirect PIN / dispatcher / homepage (come readSessioniQuizInterne)
  for (let redirectAttempt = 0; redirectAttempt < 3; redirectAttempt++) {
    if (typeof html !== "string") break;

    // PIN validation
    if (html.includes("SSO - Pin Validation") || html.includes('name="loginView.pin"')) {
      const $pin = cheerio.load(html);
      const pinForm = $pin("form#LoginForm, form[name='LoginForm']").first();
      const pinAction = resolvePortalUrl(pinForm.attr("action"));
      const pinValue = options?.pin || process.env.PORTAL_PIN;
      if (!pinAction || !pinValue) break;

      const pinData = new URLSearchParams();
      pinForm.find("input[type='hidden']").each((_, input) => {
        const name = $pin(input).attr("name");
        const value = $pin(input).attr("value") || "";
        if (name) pinData.append(name, value);
      });
      pinData.append("loginView.pin", pinValue);
      pinData.append("action:Pin_executePinValidation", "Conferma");
      const pinRes = await client.post(pinAction, serializePayloadRaw(pinData), {
        headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: baseUrl },
      });
      html = pinRes.data;
      pushPortalTrace(trace, "verbali.pin.submit", {});
      continue;
    }

    // Portal homepage redirect
    if (isPortalHome(html)) {
      pushPortalTrace(trace, "verbali.redirect.home", {});
      html = (await client.get(`${baseUrl}?pageStatus=SEARCH`, {
        headers: { Referer: `${PORTAL_BASE}/prenotazione/menu/LoadMenu_execute.action` },
      })).data;
      continue;
    }

    // Dispatcher auto-submit form
    if (html.includes("DispatcherEntry_executeDispatch")) {
      const $disp = cheerio.load(html);
      const dispForm = $disp("form[name='postform']").first();
      const dispAction = resolvePortalUrl(dispForm.attr("action"));
      if (!dispAction) break;
      const dispData = new URLSearchParams();
      dispForm.find("input[type='hidden']").each((_, input) => {
        const name = $disp(input).attr("name");
        const value = $disp(input).attr("value") || "";
        if (name) dispData.append(name, value);
      });
      html = (await client.post(dispAction, serializePayloadRaw(dispData), {
        headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: baseUrl },
      })).data;
      pushPortalTrace(trace, "verbali.dispatcher.submit", {});
      continue;
    }

    // Login redirect
    if (html.includes("Login_initAction")) {
      pushPortalTrace(trace, "verbali.redirect.login", {});
      throw new Error("Sessione scaduta: effettuare di nuovo il login al portale");
    }

    break;
  }

  // Dump HTML snippet per debug (primi 1500 char)
  const htmlSnippet = typeof html === "string" ? html.slice(0, 1500) : "";
  pushPortalTrace(trace, "verbali.after-redirects", {
    title: extractHtmlTitle(html),
    diagnostics: getSessionPageDiagnostics(html),
    htmlSnippet,
  });

  // 3) Costruisci payload dal form HTML (include token CSRF)
  const $ = cheerio.load(html);

  // Cerca il form di ricerca con vari selettori — il portale usa nomi diversi per verbali
  const formSelectors = [
    "form#RicercaSessioneEsameAbilitazioneEP",
    "form[name='RicercaSessioneEsameAbilitazioneEP']",
    "form[id*='Ricerca']",
    "form[name*='Ricerca']",
    "form[action*='paging']",
    "form[action*='Paging']",
    "form[action*='sessioneEsameAbilitazione']",
  ];
  let form = $([]);
  let matchedSelector = "";
  for (const sel of formSelectors) {
    form = $(sel).first();
    if (form.length) { matchedSelector = sel; break; }
  }

  // Fallback: qualsiasi form con almeno 2 input hidden e non è postform/login
  if (!form.length) {
    $("form").each((_, f) => {
      if (form.length) return;
      const $f = $(f);
      const name = String($f.attr("name") || "").toLowerCase();
      if (name === "postform" || name === "loginform") return;
      const hiddenCount = $f.find("input[type='hidden']").length;
      const hasDateInput = $f.find("input[name*='data'], input[name*='Data']").length > 0;
      if (hiddenCount >= 2 && hasDateInput) {
        form = $f;
        matchedSelector = `fallback(name=${$f.attr("name") || $f.attr("id") || "unnamed"})`;
      }
    });
  }

  // Log tutti i form trovati nella pagina per debug
  const allForms = [];
  $("form").each((_, f) => {
    const $f = $(f);
    allForms.push({
      id: $f.attr("id") || "",
      name: $f.attr("name") || "",
      action: String($f.attr("action") || "").slice(0, 150),
      inputCount: $f.find("input").length,
      hiddenCount: $f.find("input[type='hidden']").length,
    });
  });

  pushPortalTrace(trace, "verbali.form.search", {
    matchedSelector,
    formFound: form.length > 0,
    allForms,
  });

  // DEBUG: salva HTML del form per analisi (solo la prima volta)
  try {
    const fs = require("fs");
    const dumpPath = require("path").join(__dirname, "../../_debug_verbali_form.html");
    if (!fs.existsSync(dumpPath)) {
      const formHtml = form.length ? $.html(form) : "NO FORM FOUND - Full page:\n" + (typeof html === "string" ? html.slice(0, 50000) : "N/A");
      fs.writeFileSync(dumpPath, formHtml, "utf-8");
      console.log(`[readVerbali] DEBUG: Form HTML salvato in ${dumpPath}`);
    }
  } catch (dumpErr) { /* ignore */ }

  const formAction = resolvePortalUrl(form.attr("action")) || baseUrl;

  const payload = new URLSearchParams();

  // Campi nascosti (token CSRF incluso)
  form.find("input[type='hidden']").each((_, el) => {
    const name = $(el).attr("name");
    const value = $(el).attr("value") || "";
    if (name) payload.append(name, value);
  });

  // Se il form non aveva hidden fields, proviamo a raccoglierli dalla pagina intera
  if (!Array.from(payload.keys()).length) {
    pushPortalTrace(trace, "verbali.form.noHiddenFields", { formAction });
    // Raccogli token dalla pagina (potrebbe essere fuori dal form)
    $("input[type='hidden'][name='struts.token.name'], input[type='hidden'][name*='token']").each((_, el) => {
      const name = $(el).attr("name");
      const value = $(el).attr("value") || "";
      if (name) payload.append(name, value);
    });
    const tokenName = payload.get("struts.token.name");
    if (tokenName) {
      const tokenValue = $(`input[type='hidden'][name='${tokenName}']`).attr("value") || "";
      if (tokenValue) payload.set(tokenName, tokenValue);
    }
  }

  // Leggi anche i <select> dal form (il codice originale leggeva solo input[type='hidden'])
  const selectInfo = [];
  form.find("select").each((_, sel) => {
    const name = $(sel).attr("name");
    if (!name) return;
    const options_list = [];
    $(sel).find("option").each((__, opt) => {
      options_list.push({ value: $(opt).attr("value") || "", text: $(opt).text().trim(), selected: !!$(opt).attr("selected") });
    });
    const selected = $(sel).find("option[selected]").attr("value");
    const firstVal = $(sel).find("option").first().attr("value") || "";
    payload.set(name, selected !== undefined ? selected : firstVal);
    selectInfo.push({ name, options: options_list, setValue: selected !== undefined ? selected : firstVal });
  });

  // Log tutti i select per debug
  if (selectInfo.length) {
    console.log("[readVerbali] SELECT fields:", selectInfo.map(s => `${s.name} = [${s.options.map(o => o.value + ":" + o.text).join(", ")}]`).join(" | "));
  } else {
    console.log("[readVerbali] WARNING: Nessun <select> trovato nel form!");
  }
  pushPortalTrace(trace, "verbali.form.selects", { selectInfo });

  // Prefisso campi ricerca verbali
  const PFX = "sessioneEsameAbilitazioneEPView.sessioneEsameAbilitazioneEPFrom.";

  // Ufficio MCTC obbligatorio
  if (codUfficio) {
    payload.set(`${PFX}theUfficioCompetenteMCTCAN.codUfficioMCTC`, codUfficio);
  }

  // Intervallo date (max 7 giorni)
  // Campo "da": sessioneEsameAbilitazioneEPView.sessioneEsameAbilitazioneEPFrom.dataVerbaleEsameAbilitazione
  // Campo "a":  sessioneEsameAbilitazioneEPView.sessioneEsameAbilitazioneEPTo.dataVerbaleEsameAbilitazione
  const PFX_TO = "sessioneEsameAbilitazioneEPView.sessioneEsameAbilitazioneEPTo.";
  payload.set(`${PFX}dataVerbaleEsameAbilitazione`, dataFrom);
  payload.set(`${PFX_TO}dataVerbaleEsameAbilitazione`, dataTo);

  // ═══════════════════════════════════════════════════════════════════
  // Tipo Esame filter (QUIZ, GUIDA, ORALE, SCRITTO)
  // Campo portale: theTipoProvaSessioneEsameAbilitazioneEP.codiceTipoProvaSedutaEsame
  // Valori: I=QUIZ, G=GUIDA, O=ORALE, S=SCRITTO (default I)
  // ═══════════════════════════════════════════════════════════════════
  const tipoEsame = (options.tipoEsame || "").toUpperCase().trim();
  if (tipoEsame) {
    // Mappa nome tipo → codice portale
    const TIPO_CODICE_MAP = { "QUIZ": "I", "GUIDA": "G", "ORALE": "O", "SCRITTO": "S" };
    const codice = TIPO_CODICE_MAP[tipoEsame] || tipoEsame;

    // Nome esatto del campo dal form del portale
    const TIPO_FIELD = `${PFX}theTipoProvaSessioneEsameAbilitazioneEP.codiceTipoProvaSedutaEsame`;

    // Cerca prima tra i campi già nel payload (letti dal form HTML)
    const existingKey = Array.from(payload.keys()).find(k =>
      k.includes("codiceTipoProvaSedutaEsame") || k.includes("TipoProvaSessioneEsame")
    );

    if (existingKey) {
      payload.set(existingKey, codice);
      console.log(`[readVerbali] tipoEsame=${tipoEsame} → EXISTING: "${existingKey}" = "${codice}"`);
    } else {
      // Inietta il campo direttamente
      payload.set(TIPO_FIELD, codice);
      console.log(`[readVerbali] tipoEsame=${tipoEsame} → INJECTED: "${TIPO_FIELD}" = "${codice}"`);
    }
    pushPortalTrace(trace, "verbali.tipoEsame.set", { tipoEsame, codice, field: existingKey || TIPO_FIELD });
  }

  // Submit button
  payload.set(cfg.submit, "Ricerca");

  pushPortalTrace(trace, "verbali.post.start", {
    formAction, tipo,
    payloadKeys: Array.from(payload.keys()),
    payloadSize: payload.toString().length,
  });

  // 4) POST ricerca
  let postResp;
  try {
    postResp = await client.post(formAction, serializePayloadRaw(payload), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: baseUrl,
      },
    });
  } catch (err) {
    if (err?.response?.status === 404) {
      pushPortalTrace(trace, "verbali.post.404", { formAction });
      throw new Error(`Endpoint verbali non trovato (404): ${formAction}`);
    }
    throw err;
  }

  html = postResp.data;
  const postSnippet = typeof html === "string" ? html.slice(0, 1500) : "";
  pushPortalTrace(trace, "verbali.post.done", {
    diagnostics: getSessionPageDiagnostics(html),
    title: extractHtmlTitle(html),
    htmlSnippet: postSnippet,
  });

  // Controlla servizio non disponibile
  const unavailable = getServiceUnavailableMessage(html);
  if (unavailable) {
    pushPortalTrace(trace, "verbali.unavailable", { message: unavailable });
    throw new Error(unavailable);
  }

  return html;
}

// =============================================================================
// SESSIONI APPROVATE — Patente (SQA) e CQC (SCQCA)
// =============================================================================

/**
 * Legge le Sessioni Approvate (SQA = Patente, SCQCA = CQC).
 * @param {object} client
 * @param {object} options
 *   tipo    : 'SQA' | 'SCQCA'  (default 'SQA')
 *   dataDa  : 'YYYY-MM-DD' (default oggi)
 *   dataA   : 'YYYY-MM-DD' (default oggi +29 gg)
 *   trace   : array diagnostica
 * @returns {Promise<string>} HTML
 */
async function readSessioniApprovate(client, options = {}) {
  const trace = Array.isArray(options?.trace) ? options.trace : null;
  const tipo = (options.tipo || "SQA").toUpperCase();

  const PATH_MAP = {
    SQA:   "Read_initActionSessioniQuizApprovate",
    SCQCA: "Read_initActionSessioniCqcApprovate",
  };

  const PORTAL_BASE = "https://www.ilportaledellautomobilista.it";
  const pathName = PATH_MAP[tipo] || PATH_MAP["SQA"];
  const url = `${PORTAL_BASE}/prenotazione/disponibilitaSessioneEsameEP/${pathName}.action`;

  pushPortalTrace(trace, "sessioni_approvate.start", { tipo, url });

  // Warm-up contesto prenotazione + menu
  try { await warmPrenotazioneContext(client, trace); } catch (_e) {}
  try { await loadMenu(client); } catch (_e) {}

  const res = await client.get(`${url}?pageStatus=SEARCH`, {
    headers: { Referer: `${PORTAL_BASE}/prenotazione/menu/LoadMenu_execute.action` },
  });

  let html = res.data;

  // Gestisci redirect PIN/dispatcher/homepage
  for (let i = 0; i < 3; i++) {
    if (typeof html !== "string") break;
    if (html.includes("SSO - Pin Validation") || html.includes('name="loginView.pin"')) {
      const $p = cheerio.load(html);
      const pForm = $p("form#LoginForm, form[name='LoginForm']").first();
      const pAction = resolvePortalUrl(pForm.attr("action"));
      const pinVal = options?.pin || process.env.PORTAL_PIN;
      if (!pAction || !pinVal) break;
      const pData = new URLSearchParams();
      pForm.find("input[type='hidden']").each((_, inp) => { const n = $p(inp).attr("name"); if (n) pData.append(n, $p(inp).attr("value") || ""); });
      pData.append("loginView.pin", pinVal);
      pData.append("action:Pin_executePinValidation", "Conferma");
      html = (await client.post(pAction, serializePayloadRaw(pData), { headers: { "Content-Type": "application/x-www-form-urlencoded" } })).data;
      continue;
    }
    if (isPortalHome(html)) {
      html = (await client.get(`${url}?pageStatus=SEARCH`, { headers: { Referer: `${PORTAL_BASE}/prenotazione/menu/LoadMenu_execute.action` } })).data;
      continue;
    }
    if (html.includes("DispatcherEntry_executeDispatch")) {
      const $d = cheerio.load(html);
      const dForm = $d("form[name='postform']").first();
      const dAction = resolvePortalUrl(dForm.attr("action"));
      if (!dAction) break;
      const dData = new URLSearchParams();
      dForm.find("input[type='hidden']").each((_, inp) => { const n = $d(inp).attr("name"); if (n) dData.append(n, $d(inp).attr("value") || ""); });
      html = (await client.post(dAction, serializePayloadRaw(dData), { headers: { "Content-Type": "application/x-www-form-urlencoded" } })).data;
      continue;
    }
    break;
  }

  pushPortalTrace(trace, "sessioni_approvate.after-redirects", { title: extractHtmlTitle(html), diagnostics: getSessionPageDiagnostics(html) });

  // Submit il form di ricerca se presente (come readSessioniQuizInterne)
  html = await submitSessionSearchIfPresent(client, html, url, trace, { stato: "APPROVATA" });
  pushPortalTrace(trace, "sessioni_approvate.done", { title: extractHtmlTitle(html), diagnostics: getSessionPageDiagnostics(html) });

  const unavailable = getServiceUnavailableMessage(html);
  if (unavailable) throw new Error(unavailable);

  return html;
}

// =============================================================================
// SESSIONI CQC
// =============================================================================

/**
 * Legge le Sessioni CQC (SCQC).
 * @param {object} client
 * @param {object} options
 *   dataDa : 'YYYY-MM-DD' (default oggi)
 *   dataA  : 'YYYY-MM-DD' (default oggi +29 gg)
 *   trace  : array diagnostica
 * @returns {Promise<string>} HTML
 */
async function readSessioniCqc(client, options = {}) {
  const trace = Array.isArray(options?.trace) ? options.trace : null;
  const PORTAL_BASE = "https://www.ilportaledellautomobilista.it";
  const url = `${PORTAL_BASE}/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniCqc.action`;

  // Ricicla la stessa logica di readSessioniQuizInterne ma con URL CQC
  const searchFilters = options.searchFilters || {};

  pushPortalTrace(trace, "sessioni_cqc.start", { url });

  // Warm-up contesto prenotazione + menu
  try { await warmPrenotazioneContext(client, trace); } catch (_e) {}
  try { await loadMenu(client); } catch (_e) {}

  // GET per ottenere il form
  const getRes = await client.get(`${url}?pageStatus=SEARCH`, {
    headers: { Referer: `${PORTAL_BASE}/prenotazione/menu/LoadMenu_execute.action` },
  });

  let html = getRes.data;

  // Gestisci redirect PIN/dispatcher/homepage
  for (let i = 0; i < 3; i++) {
    if (typeof html !== "string") break;
    if (html.includes("SSO - Pin Validation") || html.includes('name="loginView.pin"')) {
      const $p = cheerio.load(html);
      const pForm = $p("form#LoginForm, form[name='LoginForm']").first();
      const pAction = resolvePortalUrl(pForm.attr("action"));
      const pinVal = options?.pin || process.env.PORTAL_PIN;
      if (!pAction || !pinVal) break;
      const pData = new URLSearchParams();
      pForm.find("input[type='hidden']").each((_, inp) => { const n = $p(inp).attr("name"); if (n) pData.append(n, $p(inp).attr("value") || ""); });
      pData.append("loginView.pin", pinVal);
      pData.append("action:Pin_executePinValidation", "Conferma");
      html = (await client.post(pAction, serializePayloadRaw(pData), { headers: { "Content-Type": "application/x-www-form-urlencoded" } })).data;
      continue;
    }
    if (isPortalHome(html)) {
      html = (await client.get(`${url}?pageStatus=SEARCH`, { headers: { Referer: `${PORTAL_BASE}/prenotazione/menu/LoadMenu_execute.action` } })).data;
      continue;
    }
    if (html.includes("DispatcherEntry_executeDispatch")) {
      const $d = cheerio.load(html);
      const dForm = $d("form[name='postform']").first();
      const dAction = resolvePortalUrl(dForm.attr("action"));
      if (!dAction) break;
      const dData = new URLSearchParams();
      dForm.find("input[type='hidden']").each((_, inp) => { const n = $d(inp).attr("name"); if (n) dData.append(n, $d(inp).attr("value") || ""); });
      html = (await client.post(dAction, serializePayloadRaw(dData), { headers: { "Content-Type": "application/x-www-form-urlencoded" } })).data;
      continue;
    }
    break;
  }

  const unavailable = getServiceUnavailableMessage(html);
  if (unavailable) throw new Error(unavailable);

  // Submit il form di ricerca se presente
  html = await submitSessionSearchIfPresent(client, html, url, trace, searchFilters);
  pushPortalTrace(trace, "sessioni_cqc.done", { diagnostics: getSessionPageDiagnostics(html) });
  return html;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // --- Originali: prenotazione esami ---
  makeHttpClient,
  loadMenu,
  warmPrenotazioneContext,
  readSessioniQuizInterne,
  readSituazioneCandidati,
  getSessionPageDiagnostics,

  // --- Verbali (conseguimento + CQC + revisione) ---
  readVerbali,

  // --- Sessioni Approvate ---
  readSessioniApprovate,

  // --- Sessioni CQC ---
  readSessioniCqc,

  // --- Nuove: RichiestaPatenti (replica GeCA) ---
  cercaCandidatoPerPatente,
  cercaCandidatoPerProtocolloMedico,
  cercaRichiestaPerMarca,
  cercaRichiesteEsame,
  nuovaIscrizioneEsame,
  foglioRosa,
  rinnovoPatente,
  cercaCQCPerCodFisc,
  cambioCodiceAutoscuola,

  // --- Utility per altri moduli ---
  serializePayloadRaw,
};

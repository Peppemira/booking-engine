const axios = require("axios").default;
const { wrapper } = require("axios-cookiejar-support");
const cheerio = require("cheerio");

const PORTAL_BASE_URL = "https://www.ilportaledellautomobilista.it";
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
  const scheduleMatch = plainText.match(/l['’]applicazione[^.]*disponibile[^.]*(?:\.|$)/i);
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

  $("table").each((_, table) => {
    if (found) return;
    const headers = $(table)
      .find("th")
      .map((__, th) => normalizeWhitespace($(th).text()).toLowerCase())
      .get();

    const hasTipoEsame = headers.some((h) => h.includes("tipo esame"));
    const hasData = headers.some((h) => h.includes("data esame") || h.includes("data ipotetica"));
    const hasPosti = headers.some((h) => h.includes("posti"));
    const hasAutoscuola = headers.some((h) => h.includes("autosc"));

    if ((hasTipoEsame && hasData && hasPosti) || (hasTipoEsame && hasAutoscuola)) {
      found = true;
    }
  });

  return found;
}

function getSessionPageDiagnostics(html) {
  const $ = cheerio.load(html || "");
  const hasSearchForm = $("form#RicercaDisponibilitaSessioneEsameEP, form[name='RicercaDisponibilitaSessioneEsameEP'], form[name='RicercaDisponibilitaSessioneEsame']").length > 0;
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

  const select = $(form).find('select[name*="theStatoDisponibilitaSessioneEsameEP.selectRowId"]').first();
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
    return pick((option) => option.value === "A|") || pick((option) => /APERT|DISPONIB|PRENOTAB/.test(option.text));
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

function applySessionSearchDefaults(payload, options = {}) {
  const requestedState = normalizeRequestedSessionState(options?.requestedState);
  const requestedStatusValue = String(options?.statusValue || "").trim();
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
    const approvataKey = Array.from(payload.keys()).find((name) => /approvata$/i.test(String(name || "")));
    if (approvataKey) {
      payload.set(approvataKey, "Y");
    }
  }

  const now = new Date();
  const future = new Date(now);
  future.setDate(future.getDate() + 30);

  setFirstMatchingField(
    payload,
    (name) => name.includes("EPFrom.dataDisponibiltaEsaminatore"),
    formatDateDDMMYYYY(now)
  );

  setFirstMatchingField(
    payload,
    (name) => name.includes("EPTo.dataDisponibiltaEsaminatore"),
    formatDateDDMMYYYY(future)
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

  const actionKeys = Array.from(payload.keys()).filter((key) => String(key || "").startsWith("action:"));

  if (!actionKeys.length) {
    payload.append("action:Read_paging", "Ricerca");
    return;
  }

  const preferredKeys = actionKeys.filter((key) => /(read_paging|read_ricerca|ricerca|search)/i.test(key));
  const selectedKey = preferredKeys[0] || actionKeys[0];
  payload.set(selectedKey, "Ricerca");
}

function clonePayload(payload) {
  const cloned = new URLSearchParams();
  for (const [key, value] of payload.entries()) {
    cloned.append(key, value);
  }
  return cloned;
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

  const actionKeys = Array.from(payload.keys()).filter((key) => String(key || "").startsWith("action:"));
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

    const interactiveElements = form.find("input:not([type='hidden']), select, textarea, button");
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
  });

  return payload;
}

async function submitSessionSearchIfPresent(client, html, refererUrl, searchFilters = {}) {
  async function followDispatcherChain(initialHtml, currentReferer) {
    let currentHtml = initialHtml;
    let referer = currentReferer;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (typeof currentHtml !== "string") break;
      const $dispatch = cheerio.load(currentHtml || "");
      const form = extractAutoSubmitForm($dispatch);
      if (!form.length) break;

      const action = resolvePortalUrl(form.attr("action"));
      if (!action) break;

      const formData = buildHiddenFormPayload($dispatch, form);
      if (!Array.from(formData.keys()).length) break;

      const dispatcherRes = await client.post(action, formData, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: referer,
        },
      });

      currentHtml = dispatcherRes.data;
      referer = action;
    }

    return currentHtml;
  }

  const $ = cheerio.load(html || "");
  const form = $("form#RicercaDisponibilitaSessioneEsameEP, form[name='RicercaDisponibilitaSessioneEsameEP'], form[name='RicercaDisponibilitaSessioneEsame']").first();
  if (!form.length) return html;

  const action = resolvePortalUrl(form.attr("action"));
  if (!action) return html;

  const payload = buildSearchPayloadFromForm($, form, searchFilters);
  const payloadVariants = buildSearchPayloadVariants(payload);

  const fallbackAction = resolvePortalUrl("/prenotazione/disponibilitaSessioneEsameEP/Read_paging.action");
  const actionCandidates = Array.from(new Set([action, fallbackAction].filter(Boolean)));

  try {
    let bestHtml = html;

    for (const candidateAction of actionCandidates) {
      for (const candidatePayload of payloadVariants) {
        const result = await client.post(candidateAction, candidatePayload, {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: refererUrl,
          },
        });

        const searchedHtml = await followDispatcherChain(result.data, candidateAction);
        const diagnostics = getSessionPageDiagnostics(searchedHtml);

        if (diagnostics.hasSessionTable) {
          return searchedHtml;
        }

        if (!diagnostics.isHome) {
          bestHtml = searchedHtml;
        }
      }
    }

    return bestHtml;
  } catch (error) {
    if (error?.response?.status === 404) {
      return html;
    }
    throw error;
  }
}

function makeHttpClient(jar) {
  return wrapper(
    axios.create({
      jar,
      withCredentials: true,
      timeout: 30000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      maxRedirects: 10,
    })
  );
}

async function loadMenu(client) {
  const url =
    "https://www.ilportaledellautomobilista.it/prenotazione/menu/LoadMenu_execute.action";
  const res = await client.get(url);
  return res.data;
}

async function openSessionSearchPage(client, requestedState = "") {
  const failed404 = [];
  const normalizedState = normalizeRequestedSessionState(requestedState);
  const searchUrls = normalizedState === "APPROVATA" ? SESSIONI_SEARCH_URLS.approved : SESSIONI_SEARCH_URLS.default;

  for (const url of searchUrls) {
    try {
      const response = await client.get(url);
      return { html: response.data, url };
    } catch (error) {
      const status = error?.response?.status;
      if (status === 404) {
        failed404.push(url);
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Nessun URL sedute valido (404): ${failed404.join(" | ")}`);
}

async function readSessioniQuizInterne(client, options = {}) {
  const searchFilters = options?.searchFilters && typeof options.searchFilters === "object" ? options.searchFilters : {};
  try {
    await loadMenu(client);
  } catch (_menuError) {
  }

  const opened = await openSessionSearchPage(client, searchFilters?.stato);
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

      const pinValue = process.env.PORTAL_PIN;
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

      const pinRes = await client.post(pinAction, pinData, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: url,
        },
      });

      html = pinRes.data;
      continue;
    }

    if (isPortalHome(html)) {
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
      const dispatcherRes = await client.post(action, formData, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: url,
        },
      });

      html = dispatcherRes.data;
    } catch (error) {
      if (error?.response?.status === 404) {
        break;
      }
      throw error;
    }
  }

  html = await submitSessionSearchIfPresent(client, html, url, searchFilters);

  const unavailableMessage = getServiceUnavailableMessage(html);
  if (unavailableMessage) {
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

module.exports = {
  makeHttpClient,
  loadMenu,
  readSessioniQuizInterne,
  readSituazioneCandidati,
  getSessionPageDiagnostics,
};

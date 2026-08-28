const puppeteer = require("puppeteer");
const { CookieJar } = require("tough-cookie");
const { makeHttpClient, serializePayloadRaw } = require("./portalHttp");
const fs = require("fs");
const path = require("path");

// In-memory cache of HTTP session jars per username/pin (to avoid full login on every request)
const portalSessionJarCache = new Map();
const DEFAULT_SESSION_TTL_MS = 20 * 60 * 1000; // 20 minuti

function pushDiag(trace, step, extra = {}) {
  if (!Array.isArray(trace)) return;
  trace.push({ at: new Date().toISOString(), step, ...extra });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFirstSelector(page, selectors, timeout = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    for (const selector of selectors) {
      const found = await page.$(selector);
      if (found) return selector;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Nessun selettore trovato: ${selectors.join(", ")}`);
}

function jarFromPuppeteerCookies(cookies) {
  const jar = new CookieJar();
  for (const cookie of cookies) {
    const domain = cookie.domain?.startsWith(".")
      ? cookie.domain.slice(1)
      : cookie.domain;
    const url = `https://${domain}${cookie.path || "/"}`;
    const cookieStr = `${cookie.name}=${cookie.value}; Domain=${cookie.domain}; Path=${cookie.path || "/"}; ${
      cookie.httpOnly ? "HttpOnly; " : ""
    }${cookie.secure ? "Secure; " : ""}`;
    jar.setCookieSync(cookieStr, url);
  }
  return jar;
}

async function handlePinIfPresent(page, pinValue) {
  const pinSelector = await waitFirstSelector(page, [
    'input[name="loginView.pin"]',
    'input[name="pin"]',
    'input[id*="pin" i]',
  ], 5000).catch(() => null);

  const btnSelector = 'input[name="action:Pin_executePinValidation"], button[name="action:Pin_executePinValidation"], input[type="submit"]';

  const pinField = pinSelector ? await page.$(pinSelector) : null;
  if (!pinField) return false;

  if (!pinValue) {
    throw new Error("PIN richiesto ma mancante");
  }

  await page.focus(pinSelector);
  await page.click(pinSelector, { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type(pinSelector, pinValue, { delay: 15 });

  await Promise.allSettled([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }),
    page.click(btnSelector),
  ]);

  return true;
}

async function extractLoginPageMessage(page) {
  const message = await page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
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
      "#msgError",
    ];

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (!node) continue;
      const text = normalize(node.textContent);
      if (text.length > 10) return text;
    }

    const paragraphs = Array.from(document.querySelectorAll("p, li, div"))
      .map((node) => normalize(node.textContent))
      .filter(Boolean);

    const businessRule = paragraphs.find(
      (text) =>
        /dal\s*1\s*ottobre\s*2021/i.test(text) ||
        /accesso\s+con\s+le\s+credenziali/i.test(text) ||
        /solo\s+tramite\s+spid/i.test(text)
    );

    if (businessRule) return businessRule;

    const fallback = normalize(document.body?.innerText || "");
    if (fallback.length > 0) {
      const match = fallback.match(/(accesso[^.]*credenziali[^.]*\.|area riservata[^.]*spid[^.]*\.)/i);
      if (match?.[1]) return normalize(match[1]);
    }

    return "";
  });

  return String(message || "").trim();
}

async function loginAndGetJar(options = {}) {
  const username = options.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME;
  const password = options.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD;
  const pin = options.pin || process.env.PORTAL_PIN;

  if (!username || !password) {
    throw new Error("PORTAL_USER/PORTAL_PASS mancanti nel .env");
  }

  const headless = process.env.PORTAL_HEADLESS === "true";

  const browser = await puppeteer.launch({
    headless,
    defaultViewport: { width: 1366, height: 768 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);

    await page.goto("https://www.ilportaledellautomobilista.it/SSO/SSOLogin/Login_initAction.action", {
      waitUntil: "domcontentloaded",
    });

    const userSel = await waitFirstSelector(page, [
      'input[name="loginView.beanUtente.userName"]',
      'input[name="loginView.username"]',
      'input[name="username"]',
      'input[type="text"]',
    ]);

    const passSel = await waitFirstSelector(page, [
      'input[name="loginView.beanUtente.password"]',
      'input[name="loginView.password"]',
      'input[name="password"]',
      'input[type="password"]',
    ]);

    const loginBtnSel = 'input[name="action:Login_executeLogin"]';

    await page.click(userSel, { clickCount: 3 });
    await page.type(userSel, username, { delay: 15 });

    await page.click(passSel, { clickCount: 3 });
    await page.type(passSel, password, { delay: 15 });

    await Promise.allSettled([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
      page.click(loginBtnSel),
    ]);

    console.log("URL dopo login:", page.url());

    await handlePinIfPresent(page, pin);
    console.log("URL dopo PIN:", page.url());

    const currentUrl = page.url().toLowerCase();
    if (currentUrl.includes("/sso/ssologin/")) {
      const portalMessage = await extractLoginPageMessage(page);
      if (portalMessage) {
        throw new Error(`Login SSO non completato: ${portalMessage}`);
      }
      throw new Error("Login SSO non completato: ancora su pagina login");
    }

    const cookies = await page.cookies();
    return jarFromPuppeteerCookies(cookies);
  } finally {
    await browser.close();
  }
}

async function getOrLoginJar(options = {}) {
  const username = options.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME;
  const password = options.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD;
  const pin = options.pin || process.env.PORTAL_PIN;

  if (!username || !password) {
    throw new Error("PORTAL_USER/PORTAL_PASS mancanti nel .env");
  }

  const key = `${username}::${pin || ""}`;
  const ttlMs = Number(process.env.PORTAL_SESSION_TTL_MS || DEFAULT_SESSION_TTL_MS);
  const now = Date.now();

  const cached = portalSessionJarCache.get(key);
  if (cached && now - cached.createdAt < ttlMs) {
    return cached.jar;
  }

  const jar = await loginAndGetJar({ username, password, pin });
  portalSessionJarCache.set(key, { jar, createdAt: now });
  return jar;
}

function invalidatePortalSession(options = {}) {
  const username = options.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME;
  const pin = options.pin || process.env.PORTAL_PIN;
  if (!username) return;
  const key = `${username}::${pin || ""}`;
  portalSessionJarCache.delete(key);
}

async function diagnosePortalLogin(options = {}) {
  const username = options.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME;
  const password = options.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD;
  const pin = options.pin || process.env.PORTAL_PIN;
  const trace = [];

  if (!username || !password) {
    return {
      success: false,
      stage: "missing-credentials",
      error: "PORTAL_USER/PORTAL_PASS mancanti",
      trace,
    };
  }

  const headless = process.env.PORTAL_HEADLESS === "true";
  const browser = await puppeteer.launch({
    headless,
    defaultViewport: { width: 1366, height: 768 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (["image", "font", "stylesheet"].includes(type)) {
        req.abort();
        return;
      }
      req.continue();
    });

    page.setDefaultTimeout(30000);
    const loginUrl = "https://www.ilportaledellautomobilista.it/SSO/SSOLogin/Login_initAction.action";

    pushDiag(trace, "goto.login", { url: loginUrl });
    await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
    pushDiag(trace, "goto.login.done", { url: page.url() });

    const userSel = await waitFirstSelector(page, [
      'input[name="loginView.beanUtente.userName"]',
      'input[name="loginView.username"]',
      'input[name="username"]',
      'input[type="text"]',
    ]);
    const passSel = await waitFirstSelector(page, [
      'input[name="loginView.beanUtente.password"]',
      'input[name="loginView.password"]',
      'input[name="password"]',
      'input[type="password"]',
    ]);
    pushDiag(trace, "selectors.found", { userSel, passSel });

    const loginBtnSel = 'input[name="action:Login_executeLogin"]';

    await page.click(userSel, { clickCount: 3 });
    await page.type(userSel, username, { delay: 15 });
    await page.click(passSel, { clickCount: 3 });
    await page.type(passSel, password, { delay: 15 });

    pushDiag(trace, "submit.login", { button: loginBtnSel });
    await Promise.allSettled([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }),
      page.click(loginBtnSel),
    ]);

    pushDiag(trace, "post.login", { url: page.url() });

    const pinHandled = await handlePinIfPresent(page, pin).catch((error) => {
      pushDiag(trace, "pin.error", { message: String(error?.message || "") });
      throw error;
    });

    if (pinHandled) {
      pushDiag(trace, "pin.handled", { url: page.url() });
    } else {
      pushDiag(trace, "pin.not-present", { url: page.url() });
    }

    const finalUrl = page.url();
    const currentUrl = finalUrl.toLowerCase();
    const pageTitle = await page.title().catch(() => "");

    if (currentUrl.includes("/sso/ssologin/")) {
      const portalMessage = await extractLoginPageMessage(page);
      const message = portalMessage || "Login SSO non completato: ancora su pagina login";
      pushDiag(trace, "login.blocked", { finalUrl, pageTitle, message });
      return {
        success: false,
        stage: "sso-login-page",
        finalUrl,
        pageTitle,
        error: message,
        trace,
      };
    }

    const cookies = await page.cookies();
    pushDiag(trace, "login.success", { finalUrl, pageTitle, cookies: cookies.length });

    return {
      success: true,
      stage: "authenticated",
      finalUrl,
      pageTitle,
      cookies: cookies.length,
      trace,
    };
  } catch (error) {
    pushDiag(trace, "login.exception", { message: String(error?.message || "") });
    return {
      success: false,
      stage: "exception",
      error: String(error?.message || "Errore login portale"),
      trace,
    };
  } finally {
    await browser.close();
  }
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

function resolveStatusValueFromOptions(options = [], requestedState = "") {
  const normalizedState = normalizeRequestedSessionState(requestedState);
  const normalizedOptions = Array.isArray(options)
    ? options.map((option) => ({
      value: String(option?.value || "").trim(),
      text: String(option?.text || "").replace(/\s+/g, " ").trim().toUpperCase(),
    }))
    : [];

  const pick = (predicate) => {
    const found = normalizedOptions.find(predicate);
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

  return "";
}

const BROWSER_PERSISTENT_ENABLED = String(process.env.PORTAL_BROWSER_PERSISTENT || "false").toLowerCase() === "true";
let persistentBrowser = null;
let persistentPage = null;
let persistentLastLoginAt = 0;
let persistentLastTabType = "";  // Ultimo tipo tab usato (SQI, SGOS, etc.) per fast path

// Cache stato dettaglio per fast-path della stampa: dopo readSessioneDettaglioViaBrowser
// la pagina ha il form Select_listCandidati caricato via setContent, ma page.url() non riflette
// questo stato (resta sull'URL della ricerca). Memorizziamo i parametri per consentire
// alla stampa di skippare ricerca+selezione+dettaglio quando il dettaglio è già in DOM.
let persistentDetailUsername = "";       // username dell'ultimo dettaglio caricato
let persistentDetailSessionIndex = -1;   // sessionIndex dell'ultimo dettaglio
let persistentDetailSearchKey = "";      // dataDa|dataA|stato dell'ultimo dettaglio
let persistentDetailHtml = "";           // HTML del dettaglio (per re-setContent se la pagina ha perso lo stato)
let persistentDetailLoadedAt = 0;        // timestamp creazione cache (TTL)

// Mutex per serializzare accesso al browser persistente (evita conflitti tra richieste concorrenti)
let _browserMutex = Promise.resolve();
function acquireBrowserLock() {
  let release;
  const prev = _browserMutex;
  _browserMutex = new Promise((resolve) => { release = resolve; });
  return prev.then(() => release);
}

async function getBrowserAndPageForSession(username, password, pin, trace) {
  const headless = process.env.PORTAL_HEADLESS === "true";

  if (!BROWSER_PERSISTENT_ENABLED) {
    const browser = await puppeteer.launch({
      headless,
      defaultViewport: { width: 1366, height: 768 },
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (["image", "font", "stylesheet", "media", "other"].includes(type)) {
        req.abort();
        return;
      }
      req.continue();
    });
    page.setDefaultTimeout(20000);
    return { browser, page, isPersistent: false, releaseLock: () => {} };
  }

  // Acquisisce accesso esclusivo al browser persistente
  const releaseLock = await acquireBrowserLock();

  try {
    const maxAgeMs = 20 * 60 * 1000;
    const now = Date.now();

    if (persistentBrowser && persistentPage && now - persistentLastLoginAt < maxAgeMs) {
      try {
        // verifica che la pagina sia ancora viva
        await persistentPage.title();
        return { browser: persistentBrowser, page: persistentPage, isPersistent: true, releaseLock };
      } catch {
        try {
          await persistentBrowser.close();
        } catch {
        }
        persistentBrowser = null;
        persistentPage = null;
        // Invalida cache dettaglio: la pagina è morta, lo stato non è più valido
        persistentDetailUsername = "";
        persistentDetailSessionIndex = -1;
        persistentDetailSearchKey = "";
        persistentDetailHtml = "";
        persistentDetailLoadedAt = 0;
      }
    }

    const browser = await puppeteer.launch({
      headless,
      defaultViewport: { width: 1366, height: 768 },
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (["image", "font", "stylesheet", "media", "other"].includes(type)) {
        req.abort();
        return;
      }
      req.continue();
    });
    page.setDefaultTimeout(20000);

    persistentBrowser = browser;
    persistentPage = page;
    persistentLastLoginAt = 0;

    return { browser, page, isPersistent: true, releaseLock };
  } catch (err) {
    releaseLock();
    throw err;
  }
}

async function readSessioniQuizInterneViaBrowser(options = {}) {
  const username = options.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME;
  const password = options.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD;
  const pin = options.pin || process.env.PORTAL_PIN;
  const trace = Array.isArray(options.trace) ? options.trace : null;
  const searchFilters = options?.searchFilters && typeof options.searchFilters === "object" ? options.searchFilters : {};
  const requestedState = normalizeRequestedSessionState(searchFilters?.stato);
  const captureSubmitResponsePath = String(options.captureSubmitResponsePath || "").trim();
  const captureSubmitPostDataPath = String(options.captureSubmitPostDataPath || "").trim();

  if (!username || !password) {
    throw new Error("PORTAL_USER/PORTAL_PASS mancanti nel .env");
  }

  const today = new Date();
  const toDate = new Date(today);
  toDate.setDate(toDate.getDate() + 29);

  const fromDateValue = formatDateDDMMYYYY(today);
  const toDateValue = formatDateDDMMYYYY(toDate);

  const { browser, page, isPersistent, releaseLock } = await getBrowserAndPageForSession(username, password, pin, trace);

  try {
    let skipLogin = false;
    if (isPersistent && persistentLastLoginAt > 0) {
      try {
        const currentUrl = await page.url();
        if (currentUrl.includes("/prenotazione")) {
          skipLogin = true;
          pushDiag(trace, "browser.login.skip", { url: currentUrl });
        }
      } catch {
        skipLogin = false;
      }
    }

    if (!skipLogin) {
      await page.goto("https://www.ilportaledellautomobilista.it/SSO/SSOLogin/Login_initAction.action", {
        waitUntil: "domcontentloaded",
      });

      const userSel = await waitFirstSelector(page, [
        'input[name="loginView.beanUtente.userName"]',
        'input[name="loginView.username"]',
        'input[name="username"]',
        'input[id*="user" i]',
        'input[type="email"]',
        'input[type="text"]',
      ], 8000).catch(() => null);

      const passSel = await waitFirstSelector(page, [
        'input[name="loginView.beanUtente.password"]',
        'input[name="loginView.password"]',
        'input[name="password"]',
        'input[id*="pass" i]',
        'input[type="password"]',
      ], 8000).catch(() => null);

      if (userSel && passSel) {
        const loginBtnSel = 'input[name="action:Login_executeLogin"], button[name="action:Login_executeLogin"], input[type="submit"], button[type="submit"]';

        await page.click(userSel, { clickCount: 3 });
        await page.type(userSel, username, { delay: 15 });
        await page.click(passSel, { clickCount: 3 });
        await page.type(passSel, password, { delay: 15 });

        await Promise.allSettled([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
          page.click(loginBtnSel),
        ]);

        pushDiag(trace, "browser.login.done", { url: page.url() });

        await handlePinIfPresent(page, pin);
        pushDiag(trace, "browser.pin.done", { url: page.url() });
        if (isPersistent) {
          persistentLastLoginAt = Date.now();
        }
      } else {
        pushDiag(trace, "browser.login.skip", { url: page.url() });
      }
    }

    const searchUrl = requestedState === "APPROVATA"
      ? "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizApprovate.action?pageStatus=SEARCH"
      : "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH";
    const menuSearchHref = requestedState === "APPROVATA"
      ? 'a[href*="Read_initActionSessioniQuizApprovate.action?pageStatus=SEARCH"]'
      : 'a[href*="Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH"]';
    const searchFormSelector = 'form#RicercaDisponibilitaSessioneEsameEP, form[name="RicercaDisponibilitaSessioneEsameEP"], form[name="RicercaDisponibilitaSessioneEsame"]';

    let preparedSearchForm = false;
    let lastPrepareError = null;
    const maxPrepareAttempts = skipLogin ? 3 : 8;

    for (let prepareAttempt = 0; prepareAttempt < maxPrepareAttempts && !preparedSearchForm; prepareAttempt += 1) {
      try {
        await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
        if (!skipLogin) await sleep(800);

        for (let i = 0; i < 6; i += 1) {
          const hasSearchForm = await page.$(searchFormSelector);
          if (hasSearchForm) break;

          const hasPin = await page.$('input[name="loginView.pin"], input[name="pin"], input[id*="pin" i]');
          if (hasPin) {
            await handlePinIfPresent(page, pin);
            await sleep(200);
            continue;
          }

          const postForm = await page.$('form[name="postform"]');
          if (postForm) {
            await Promise.allSettled([
              page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
              page.$eval('form[name="postform"]', (form) => form.submit()),
            ]);
            await sleep(150);
            continue;
          }

          await sleep(skipLogin ? 50 : 200);
        }

        const hasSearchFormBeforeWait = await page.$(searchFormSelector);
        if (!hasSearchFormBeforeWait) {
          const menuSessioniQuizInterne = await page.$(menuSearchHref);
          if (menuSessioniQuizInterne) {
            await Promise.allSettled([
              page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
              menuSessioniQuizInterne.click(),
            ]);
            if (!skipLogin) await sleep(300);
          }
        }

        await page.waitForSelector(searchFormSelector, { timeout: skipLogin ? 8000 : 30000 });

        // Singola evaluate: compila stato + date per ridurre i round-trip
        await page.evaluate((params) => {
          const { requested, fVal, tVal } = params;

          // 1. Stato
          if (requested) {
            const select = document.querySelector('select[name*="theStatoDisponibilitaSessioneEsameEP.selectRowId"]');
            if (select) {
              const opts = Array.from(select.options || []).map(o => ({
                value: String(o.value || ""),
                text: String(o.text || "").replace(/\s+/g, " ").trim().toUpperCase(),
              }));
              const pick = pred => (opts.find(pred) || {}).value || "";
              let val = "";
              if (requested === "APPROVATA") val = pick(o => /APPROVAT/.test(o.text));
              else if (requested === "CHIUSA") val = pick(o => /CHIUS|NON\s*PRENOT|ESAUR|COMPLET/.test(o.text));
              else if (requested === "APERTA") val = pick(o => o.value === "A|") || pick(o => /APERT|DISPONIB|PRENOTAB/.test(o.text));
              if (val) { select.value = val; const optNode = opts.find(o => o.value === val); }
              select.dispatchEvent(new Event("change", { bubbles: true }));
            }
          }

          // 2. Date
          const fEl = document.querySelector('input[name*="EPFrom.dataDisponibiltaEsaminatore"]');
          if (fEl) { fEl.value = fVal; fEl.dispatchEvent(new Event("change", { bubbles: true })); }
          const tEl = document.querySelector('input[name*="EPTo.dataDisponibiltaEsaminatore"]');
          if (tEl) { tEl.value = tVal; tEl.dispatchEvent(new Event("change", { bubbles: true })); }
        }, { requested: requestedState, fVal: fromDateValue, tVal: toDateValue }).catch(() => null);

        preparedSearchForm = true;
      } catch (prepareError) {
        lastPrepareError = prepareError;
        const message = String(prepareError?.message || "");
        if (!/execution context was destroyed/i.test(message)) {
          throw prepareError;
        }
      }
    }

    if (!preparedSearchForm && lastPrepareError) {
      throw lastPrepareError;
    }

    // Solo se requestedState è specificato (non vuoto = "Tutti")
    if (requestedState) {
      await page.evaluate((requested) => {
        const statusField = document.querySelector('select[name*="theStatoDisponibilitaSessioneEsameEP.selectRowId"]');
        if (!statusField) return;

        const options = Array.from(statusField.options || []);
        const normalizedOptions = options.map((option) => ({
          value: String(option.value || ""),
          text: String(option.text || "").replace(/\s+/g, " ").trim().toUpperCase(),
        }));
        const pick = (predicate) => {
          const found = normalizedOptions.find(predicate);
          return found?.value || "";
        };

        let targetValue = "";
        if (requested === "APPROVATA") {
          targetValue = pick((option) => /APPROVAT/.test(option.text));
        } else if (requested === "CHIUSA") {
          targetValue = pick((option) => /CHIUS|NON\s*PRENOT|ESAUR|COMPLET/.test(option.text));
        } else if (requested === "APERTA") {
          targetValue = pick((option) => option.value === "A|") || pick((option) => /APERT|DISPONIB|PRENOTAB/.test(option.text));
        }
        // Se requested è vuoto non modificare il dropdown

        if (targetValue) {
          statusField.value = targetValue;
          const optionNode = options.find((option) => String(option.value || "") === targetValue);
          if (optionNode) optionNode.selected = true;
        }

        statusField.dispatchEvent(new Event("change", { bubbles: true }));
      }, requestedState).catch(() => null);
    }

    const beforeSubmitValues = await page.evaluate(() => {
      const form = document.querySelector('form#RicercaDisponibilitaSessioneEsameEP, form[name="RicercaDisponibilitaSessioneEsameEP"], form[name="RicercaDisponibilitaSessioneEsame"]');
      if (!form) return {};

      const readValue = (selector) => {
        const node = form.querySelector(selector);
        return node ? String(node.value || "") : "";
      };

      return {
        status: readValue('select[name*="theStatoDisponibilitaSessioneEsameEP.selectRowId"]'),
        statusOptions: (() => {
          const select = form.querySelector('select[name*="theStatoDisponibilitaSessioneEsameEP.selectRowId"]');
          if (!select) return [];
          return Array.from(select.options || []).map((option) => ({
            value: String(option.value || ""),
            text: String(option.text || "").replace(/\s+/g, " ").trim(),
            selected: !!option.selected,
          }));
        })(),
        fromDate: readValue('input[name*="EPFrom.dataDisponibiltaEsaminatore"]'),
        toDate: readValue('input[name*="EPTo.dataDisponibiltaEsaminatore"]'),
      };
    }).catch(() => ({}));

    pushDiag(trace, "browser.search.submit", {
      fromDate: beforeSubmitValues.fromDate || fromDateValue,
      toDate: beforeSubmitValues.toDate || toDateValue,
      status: beforeSubmitValues.status || "",
      statusOptions: beforeSubmitValues.statusOptions || [],
      url: page.url(),
    });

    const requestedStatusValue = resolveStatusValueFromOptions(beforeSubmitValues.statusOptions, requestedState) || beforeSubmitValues.status || "";

    // =========================================================================
    // SUBMIT: click nativo sul bottone "Ricerca" — evita problemi di encoding
    // dei parametri action: di Struts2 DMI che causano 404 con fetch/axios.
    // Il browser gestisce nativamente l'encoding del form submission.
    // =========================================================================
    const searchBtnSelector = `${searchFormSelector} input[name="action:Read_paging"], ${searchFormSelector} input[type="submit"]`;
    const hasSearchBtn = await page.$(searchBtnSelector);
    if (!hasSearchBtn) {
      throw new Error("search-submit-button-not-found");
    }

    pushDiag(trace, "browser.search.submit.click", { url: page.url() });

    await Promise.allSettled([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
      page.click(searchBtnSelector),
    ]);

    // Attendi che la tabella risultati appaia — usa waitForSelector invece di sleep fissi
    if (skipLogin) {
      await page.waitForSelector('#listTable, table.table, table[id*="list"]', { timeout: 15000 }).catch(() => null);
    } else {
      await sleep(1500);
    }

    // Se atterriamo su una pagina PIN, gestiscila (raro con sessione persistente)
    const hasPin2 = await page.$('input[name="loginView.pin"], input[name="pin"]');
    if (hasPin2) {
      await handlePinIfPresent(page, pin);
      await sleep(300);
    }

    // Se atterriamo su un postform dispatcher, seguilo
    for (let dispRetry = 0; dispRetry < 3; dispRetry++) {
      const hasPostForm = await page.$('form[name="postform"]');
      if (!hasPostForm) break;
      await Promise.allSettled([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
        page.$eval('form[name="postform"]', (form) => form.submit()),
      ]);
      await sleep(150);
    }

    let capturedSubmitResponseHtml = await page.content();
    let capturedSubmitPostData = "";

    pushDiag(trace, "browser.search.submit.response", {
      status: 200,
      url: page.url(),
      htmlLength: capturedSubmitResponseHtml.length,
      title: await page.title(),
    });

    if (captureSubmitResponsePath) {
      const targetPath = path.isAbsolute(captureSubmitResponsePath)
        ? captureSubmitResponsePath
        : path.join(process.cwd(), captureSubmitResponsePath);
      if (capturedSubmitResponseHtml) {
        fs.writeFileSync(targetPath, capturedSubmitResponseHtml, "utf8");
        pushDiag(trace, "browser.search.captured", {
          path: targetPath,
          length: capturedSubmitResponseHtml.length,
        });
      } else {
        pushDiag(trace, "browser.search.captured.missing", {
          path: targetPath,
        });
      }
    }

    if (captureSubmitPostDataPath) {
      const targetPath = path.isAbsolute(captureSubmitPostDataPath)
        ? captureSubmitPostDataPath
        : path.join(process.cwd(), captureSubmitPostDataPath);
      if (capturedSubmitPostData) {
        fs.writeFileSync(targetPath, capturedSubmitPostData, "utf8");
        pushDiag(trace, "browser.search.postData.captured", {
          path: targetPath,
          length: capturedSubmitPostData.length,
        });
      } else {
        pushDiag(trace, "browser.search.postData.missing", {
          path: targetPath,
        });
      }
    }

    // Solo se non persistente attendi ulteriormente (il contenuto è già stato catturato sopra)
    if (!skipLogin) await sleep(500);
    pushDiag(trace, "browser.search.done", { url: page.url() });

    return await page.content();
  } finally {
    if (!isPersistent) {
      await browser.close();
    }
    releaseLock();
  }
}

async function runManualSessionFlowViaBrowser(options = {}) {
  const username = options.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME;
  const password = options.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD;
  const pin = options.pin || process.env.PORTAL_PIN;
  const trace = Array.isArray(options.trace) ? options.trace : null;

  if (!username || !password) {
    throw new Error("PORTAL_USER/PORTAL_PASS mancanti nel .env");
  }

  const requestedSessionIndex = Number.isFinite(Number(options.sessionIndex)) ? Number(options.sessionIndex) : 0;
  const requestedTurnoIndex = Number.isFinite(Number(options.turnoIndex)) ? Number(options.turnoIndex) : 0;
  const candidate = options?.candidate && typeof options.candidate === "object" ? options.candidate : null;
  const confirmInsert = options?.confirmInsert === true;

  const today = new Date();
  const toDate = new Date(today);
  toDate.setDate(toDate.getDate() + 29);
  const fromDateValue = formatDateDDMMYYYY(today);
  const toDateValue = formatDateDDMMYYYY(toDate);

  const { browser, page, isPersistent, releaseLock } = await getBrowserAndPageForSession(username, password, pin, trace);

  try {
    page.setDefaultTimeout(30000);

    let skipLogin = false;
    if (isPersistent && persistentLastLoginAt > 0) {
      try {
        const currentUrl = await page.url();
        if (currentUrl.includes("/prenotazione") || currentUrl.includes("/portale-automobilista") || currentUrl.includes("/web/")) {
          skipLogin = true;
        }
      } catch { skipLogin = false; }
    }

    if (!skipLogin) {
    await page.goto("https://www.ilportaledellautomobilista.it/SSO/SSOLogin/Login_initAction.action", {
      waitUntil: "domcontentloaded",
    });

    const userSel = await waitFirstSelector(page, [
      'input[name="loginView.beanUtente.userName"]',
      'input[name="loginView.username"]',
      'input[name="username"]',
      'input[id*="user" i]',
      'input[type="email"]',
      'input[type="text"]',
    ], 8000).catch(() => null);

    const passSel = await waitFirstSelector(page, [
      'input[name="loginView.beanUtente.password"]',
      'input[name="loginView.password"]',
      'input[name="password"]',
      'input[id*="pass" i]',
      'input[type="password"]',
    ], 8000).catch(() => null);

    if (userSel && passSel) {
      const loginBtnSel = 'input[name="action:Login_executeLogin"], button[name="action:Login_executeLogin"], input[type="submit"], button[type="submit"]';
      await page.click(userSel, { clickCount: 3 });
      await page.type(userSel, username, { delay: 15 });
      await page.click(passSel, { clickCount: 3 });
      await page.type(passSel, password, { delay: 15 });

      await Promise.allSettled([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
        page.click(loginBtnSel),
      ]);

      pushDiag(trace, "manual.browser.login.done", { url: page.url() });
      await handlePinIfPresent(page, pin);
      pushDiag(trace, "manual.browser.pin.done", { url: page.url() });
    }
    if (isPersistent) persistentLastLoginAt = Date.now();
    } // fine if (!skipLogin)

    const searchUrl = "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH";
    const searchFormSelector = 'form#RicercaDisponibilitaSessioneEsameEP, form[name="RicercaDisponibilitaSessioneEsameEP"], form[name="RicercaDisponibilitaSessioneEsame"]';

    let preparedSearchForm = false;
    let lastPrepareError = null;

    for (let prepareAttempt = 0; prepareAttempt < 8 && !preparedSearchForm; prepareAttempt += 1) {
      try {
        await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
        await sleep(1200);

        for (let i = 0; i < 10; i += 1) {
          await sleep(250);
          const hasSearchForm = await page.$(searchFormSelector);
          if (hasSearchForm) break;

          const hasPin = await page.$('input[name="loginView.pin"], input[name="pin"], input[id*="pin" i]');
          if (hasPin) {
            await handlePinIfPresent(page, pin);
            await sleep(400);
            continue;
          }

          const postForm = await page.$('form[name="postform"]');
          if (postForm) {
            await Promise.allSettled([
              page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
              page.$eval('form[name="postform"]', (form) => form.submit()),
            ]);
            await sleep(400);
          }
        }

        const hasSearchFormBeforeWait = await page.$(searchFormSelector);
        if (!hasSearchFormBeforeWait) {
          const menuSessioniQuizInterne = await page.$('a[href*="Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH"]');
          if (menuSessioniQuizInterne) {
            await Promise.allSettled([
              page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
              menuSessioniQuizInterne.click(),
            ]);
            await sleep(500);
          }
        }

        await page.waitForSelector(searchFormSelector, { timeout: 30000 });
        await sleep(300);

        await page.$eval(
          `${searchFormSelector} select[name*="theStatoDisponibilitaSessioneEsameEP.selectRowId"]`,
          (select) => {
            const hasOpen = Array.from(select.options || []).some((option) => option.value === "A|");
            select.value = hasOpen ? "A|" : select.value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
          }
        ).catch(() => null);

        const fromSelector = `${searchFormSelector} input[name*="EPFrom.dataDisponibiltaEsaminatore"]`;
        const toSelector = `${searchFormSelector} input[name*="EPTo.dataDisponibiltaEsaminatore"]`;

        // Usa evaluate() perché i campi hanno jQuery datepicker che intercetta click/type
        await page.evaluate((fSel, tSel, fVal, tVal) => {
          const fEl = document.querySelector(fSel);
          if (fEl) { fEl.value = fVal; fEl.dispatchEvent(new Event("change", { bubbles: true })); }
          const tEl = document.querySelector(tSel);
          if (tEl) { tEl.value = tVal; tEl.dispatchEvent(new Event("change", { bubbles: true })); }
        }, fromSelector, toSelector, fromDateValue, toDateValue);

        preparedSearchForm = true;
      } catch (prepareError) {
        lastPrepareError = prepareError;
        const message = String(prepareError?.message || "");
        if (!/execution context was destroyed/i.test(message)) {
          throw prepareError;
        }
      }
    }

    if (!preparedSearchForm && lastPrepareError) {
      throw lastPrepareError;
    }

    const searchSubmit = await page.evaluate(async ({ searchFormSelector, fromDate, toDate }) => {
      const form = document.querySelector(searchFormSelector);
      if (!form) return { error: "search-form-not-found" };

      const formData = new FormData(form);
      const keys = Array.from(formData.keys());
      const findKey = (needle) => keys.find((key) => String(key || "").includes(needle)) || "";

      const fromKey = findKey("EPFrom.dataDisponibiltaEsaminatore");
      const toKey = findKey("EPTo.dataDisponibiltaEsaminatore");
      const statusKey = findKey("theStatoDisponibilitaSessioneEsameEP.selectRowId");
      if (fromKey) formData.set(fromKey, fromDate);
      if (toKey) formData.set(toKey, toDate);
      if (statusKey) formData.set(statusKey, "A|");

      formData.delete("action:Read_clearSearch");
      formData.set("action:Read_paging", "Ricerca");

      const body = new URLSearchParams();
      for (const [key, value] of formData.entries()) {
        body.append(String(key || ""), typeof value === "string" ? value : String(value || ""));
      }

      const action = String(form.getAttribute("action") || "").trim() || window.location.href;
      const submitUrl = new URL(action, window.location.href).toString();

      const response = await fetch(submitUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        credentials: "include",
      });

      return {
        status: response.status,
        url: response.url || submitUrl,
        html: await response.text(),
      };
    }, {
      searchFormSelector,
      fromDate: fromDateValue,
      toDate: toDateValue,
    });

    if (searchSubmit?.error) {
      throw new Error(String(searchSubmit.error));
    }

    await page.setContent(String(searchSubmit?.html || ""), { waitUntil: "domcontentloaded" });
    pushDiag(trace, "manual.search.done", { status: searchSubmit?.status || null, url: searchSubmit?.url || "" });

    const sessions = await page.evaluate(() => {
      const readText = (node) => String(node?.textContent || "").replace(/\s+/g, " ").trim();
      const rows = Array.from(document.querySelectorAll("tr"));
      const found = [];
      rows.forEach((row) => {
        const radio = row.querySelector('input[type="radio"][name*="selectRowId" i]');
        if (!radio) return;
        const cells = Array.from(row.querySelectorAll("td")).map(readText);
        found.push({
          radioName: String(radio.getAttribute("name") || ""),
          radioValue: String(radio.value || ""),
          data: cells[3] || "",
          tipoEsame: cells[5] || "",
          amPm: cells[6] || "",
          ufficioProv: cells[7] || "",
          localita: cells[8] || "",
          aula: cells[9] || "",
          turni: cells[10] || "",
          totalePosti: cells[13] || "",
          postiAutoscuola: cells[15] || "",
          propriePrenotazioni: cells[16] || "",
          stato: cells[18] || "",
        });
      });
      return found;
    });

    if (!Array.isArray(sessions) || !sessions.length) {
      throw new Error("Nessuna seduta disponibile nel risultato portale");
    }

    const selectedSessionIndex = Math.max(0, Math.min(requestedSessionIndex, sessions.length - 1));
    const selectedSession = sessions[selectedSessionIndex];

    pushDiag(trace, "manual.session.selected", {
      selectedSessionIndex,
      data: selectedSession?.data || "",
      tipoEsame: selectedSession?.tipoEsame || "",
    });

    const detailSubmit = await page.evaluate(async ({ radioName, radioValue }) => {
      const forms = Array.from(document.querySelectorAll("form"));
      const targetForm = forms.find((form) => {
        const hasRadio = form.querySelector(`input[type="radio"][name="${CSS.escape(radioName)}"]`);
        const detailButton = Array.from(form.querySelectorAll("input[type='submit'],button")).find((el) => /dettaglio/i.test(String(el.value || el.textContent || "")));
        return !!hasRadio && !!detailButton;
      }) || forms.find((form) => !!Array.from(form.querySelectorAll("input[type='submit'],button")).find((el) => /dettaglio/i.test(String(el.value || el.textContent || ""))));

      if (!targetForm) return { error: "detail-form-not-found" };

      const fd = new FormData(targetForm);
      if (radioName) fd.set(radioName, radioValue || "");
      fd.delete("action:Read_paging");
      fd.delete("action:Read_clearSearch");
      fd.set("action:Select_listCandidati", "Dettaglio");

      const body = new URLSearchParams();
      for (const [key, value] of fd.entries()) {
        body.append(String(key || ""), typeof value === "string" ? value : String(value || ""));
      }

      const action = String(targetForm.getAttribute("action") || "").trim() || window.location.href;
      const url = new URL(action, window.location.href).toString();
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        credentials: "include",
      });

      return {
        status: response.status,
        url: response.url || url,
        html: await response.text(),
      };
    }, {
      radioName: selectedSession?.radioName || "",
      radioValue: selectedSession?.radioValue || "",
    });

    if (detailSubmit?.error) {
      throw new Error(String(detailSubmit.error));
    }

    await page.setContent(String(detailSubmit?.html || ""), { waitUntil: "domcontentloaded" });

    const detailData = await page.evaluate(() => {
      const readText = (node) => String(node?.textContent || "").replace(/\s+/g, " ").trim();
      const pageText = readText(document.body);

      const messages = [
        ...Array.from(document.querySelectorAll(".alert,.alert-warning,.alert-danger,.error,.errors,.message,.messages,#messages,#message,#errorMessages"))
          .map(readText)
          .filter(Boolean),
      ];

      const turnRows = [];
      Array.from(document.querySelectorAll("tr")).forEach((row) => {
        const radio = row.querySelector('input[type="radio"]');
        if (!radio) return;
        const cells = Array.from(row.querySelectorAll("td")).map(readText);
        if (cells.length < 4) return;
        turnRows.push({
          radioName: String(radio.getAttribute("name") || ""),
          radioValue: String(radio.value || ""),
          turno: cells[1] || "",
          orarioTurno: cells[3] || "",
          utentiTurno: cells[4] || "",
          codCiaAutoscuola: cells[5] || "",
        });
      });

      const normalizeHeader = (value) => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
      const splitNominativo = (value) => {
        const raw = String(value || "").replace(/\s+/g, " ").trim();
        if (!raw) return { cognome: "", nome: "" };
        const parts = raw.split(" ").filter(Boolean);
        if (parts.length <= 1) return { cognome: raw, nome: "" };
        return {
          cognome: parts[0] || "",
          nome: parts.slice(1).join(" "),
        };
      };
      const candidateRows = [];
      Array.from(document.querySelectorAll("table")).forEach((table) => {
        const headers = [];
        table.querySelectorAll("thead th").forEach((th) => headers.push(normalizeHeader(readText(th))));
        if (!headers.length) {
          const firstRowHeaders = table.querySelectorAll("tr:first-child th");
          firstRowHeaders.forEach((th) => headers.push(normalizeHeader(readText(th))));
        }

        const hasCognome = headers.some((header) => header.includes("cognome"));
        const hasNome = headers.some((header) => header.includes("nome"));
        const hasNominativo = headers.some((header) => header.includes("nominativo"));
        if (!hasCognome && !hasNominativo) {
          return;
        }

        const idx = {
          marcaOperativa: headers.findIndex((header) => header.includes("marca operativa")),
          cognome: headers.findIndex((header) => header.includes("cognome")),
          nome: headers.findIndex((header) => {
            if (!header) return false;
            if (header.includes("cognome")) return false;
            return header === "nome" || /^nome(\b|\s|$)/.test(header);
          }),
          nominativo: headers.findIndex((header) => header.includes("nominativo")),
          codiceStatino: headers.findIndex((header) => header.includes("codice statino") || header.includes("codice cand")),
          dataEmissioneStatino: headers.findIndex((header) => header.includes("emissione")),
          scadenza: headers.findIndex((header) => header.includes("scadenza")),
          abilitazioneRichiesta: headers.findIndex((header) => header.includes("abilitazione") || header.includes("categoria patente") || header.includes("patente richiesta") || header.includes("tipo iscrizione")),
          tipoEsame: headers.findIndex((header) => header.includes("tipo esame")),
        };

        const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
        bodyRows.forEach((row) => {
          const cells = Array.from(row.querySelectorAll("td")).map(readText);
          if (!cells.length) return;

          const nominativoValue = idx.nominativo >= 0 ? cells[idx.nominativo] || "" : "";
          let cognomeValue = idx.cognome >= 0 ? cells[idx.cognome] || "" : "";
          let nomeValue = idx.nome >= 0 ? cells[idx.nome] || "" : "";
          if ((!cognomeValue || !nomeValue) && nominativoValue) {
            const split = splitNominativo(nominativoValue);
            if (!cognomeValue) cognomeValue = split.cognome || "";
            if (!nomeValue) nomeValue = split.nome || "";
          }
          if (!cognomeValue && !nomeValue) return;

          const normalizedIdentity = normalizeHeader(`${cognomeValue} ${nomeValue}`);
          const codiceStatinoValue = idx.codiceStatino >= 0 ? cells[idx.codiceStatino] || "" : "";
          const isSeatPlaceholder =
            /(posto prenotato|posto disponibile|posto libero|posto occupato|prenotato)/.test(normalizedIdentity) &&
            !normalizeHeader(codiceStatinoValue);
          if (isSeatPlaceholder) return;

          candidateRows.push({
            marca_operativa: idx.marcaOperativa >= 0 ? cells[idx.marcaOperativa] || "" : "",
            cognome: cognomeValue,
            nome: nomeValue,
            nominativo: nominativoValue || `${cognomeValue} ${nomeValue}`.trim(),
            codice_statino: idx.codiceStatino >= 0 ? cells[idx.codiceStatino] || "" : "",
            data_emissione_statino: idx.dataEmissioneStatino >= 0 ? cells[idx.dataEmissioneStatino] || "" : "",
            scadenza: idx.scadenza >= 0 ? cells[idx.scadenza] || "" : "",
            abilitazione_richiesta: idx.abilitazioneRichiesta >= 0 ? cells[idx.abilitazioneRichiesta] || "" : "",
            categoria_patente: idx.abilitazioneRichiesta >= 0 ? cells[idx.abilitazioneRichiesta] || "" : "",
            tipo_esame: idx.tipoEsame >= 0 ? cells[idx.tipoEsame] || "" : "",
          });
        });
      });

      return {
        pageText,
        messages,
        turni: turnRows,
        candidates: candidateRows,
      };
    });

    const turni = Array.isArray(detailData?.turni) ? detailData.turni : [];
    const selectedTurnoIndex = turni.length
      ? Math.max(0, Math.min(requestedTurnoIndex, turni.length - 1))
      : -1;
    const selectedTurno = selectedTurnoIndex >= 0 ? turni[selectedTurnoIndex] : null;

    pushDiag(trace, "manual.detail.loaded", {
      selectedTurnoIndex,
      turniTotal: turni.length,
      detailUrl: detailSubmit?.url || "",
    });

    const newCandidateSubmit = await page.evaluate(async ({ radioName, radioValue, candidate, confirmInsert, selectedTurnoIndex }) => {
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();

      const extractMessages = () => {
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
        const found = [];
        selectors.forEach((selector) => {
          const node = document.querySelector(selector);
          if (!node) return;
          const text = normalize(node.textContent);
          if (text) found.push(text);
        });
        return Array.from(new Set(found));
      };

      const inferRequiredFields = () => {
        const forms = Array.from(document.querySelectorAll("form"));
        const target = forms.find((form) =>
          Array.from(form.querySelectorAll("input,select,textarea")).some((el) => {
            const marker = `${el.getAttribute("name") || ""} ${el.getAttribute("id") || ""}`.toLowerCase();
            return marker.includes("candid") || marker.includes("nomin") || marker.includes("lingua") || marker.includes("supporto") || marker.includes("turno");
          })
        );

        if (!target) return [];
        const fields = [];
        target.querySelectorAll("input,select,textarea").forEach((el) => {
          const type = String(el.getAttribute("type") || "").toLowerCase();
          if (["hidden", "submit", "button", "image", "file"].includes(type)) return;
          const name = String(el.getAttribute("name") || "").trim();
          const id = String(el.getAttribute("id") || "").trim();
          if (!name && !id) return;
          const marker = `${name} ${id}`.toLowerCase();
          let semantic = "other";
          if (marker.includes("nomin") || marker.includes("nome") || marker.includes("cogn")) semantic = "nominativo";
          else if (marker.includes("cod") && marker.includes("cand")) semantic = "codice_candidato";
          else if (marker.includes("turn")) semantic = "turno";
          else if (marker.includes("lingua")) semantic = "lingua";
          else if (marker.includes("support") || marker.includes("audio")) semantic = "supporto_audio";

          fields.push({
            name,
            id,
            type: el.tagName.toLowerCase() === "select" ? "select" : (type || "text"),
            semantic,
          });
        });
        return fields;
      };

      const forms = Array.from(document.querySelectorAll("form"));
      const targetForm = forms.find((form) =>
        Array.from(form.querySelectorAll("input[type='submit'],button")).some((el) => /nuovo\s*candidato/i.test(String(el.value || el.textContent || "")))
      );

      if (!targetForm) {
        return {
          error: "new-candidate-button-not-found",
          html: document.documentElement.outerHTML,
          requiredFields: inferRequiredFields(),
          messages: extractMessages(),
        };
      }

      const fd = new FormData(targetForm);
      if (radioName) {
        fd.set(radioName, radioValue || "");
      }

      const submitControl = Array.from(targetForm.querySelectorAll("input[type='submit'],button")).find((el) => /nuovo\s*candidato/i.test(String(el.value || el.textContent || "")));
      if (submitControl) {
        const submitName = String(submitControl.getAttribute("name") || "").trim();
        if (submitName) {
          fd.set(submitName, String(submitControl.value || submitControl.textContent || "Nuovo Candidato").trim());
        }
      }

      const body = new URLSearchParams();
      for (const [key, value] of fd.entries()) {
        body.append(String(key || ""), typeof value === "string" ? value : String(value || ""));
      }

      const action = String(targetForm.getAttribute("action") || "").trim() || window.location.href;
      const url = new URL(action, window.location.href).toString();
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        credentials: "include",
      });

      const html = await response.text();
      const result = {
        status: response.status,
        url: response.url || url,
        html,
        requiredFields: [],
        messages: [],
      };

      if (!confirmInsert) {
        return result;
      }

      document.open();
      document.write(html || "");
      document.close();

      const formForConfirm = Array.from(document.querySelectorAll("form")).find((form) =>
        Array.from(form.querySelectorAll("input[type='submit'],button")).some((el) => /conferma/i.test(String(el.value || el.textContent || "")))
      );

      result.requiredFields = inferRequiredFields();
      result.messages = extractMessages();

      if (!formForConfirm) {
        result.error = "confirm-form-not-found";
        result.html = document.documentElement.outerHTML;
        return result;
      }

      const setBySemantic = (semantic, value) => {
        if (!String(value || "").trim()) return;
        const field = result.requiredFields.find((entry) => entry.semantic === semantic);
        if (!field) return;
        const selector = field.name
          ? `[name="${CSS.escape(field.name)}"]`
          : (field.id ? `#${CSS.escape(field.id)}` : "");
        if (!selector) return;
        const node = document.querySelector(selector);
        if (!node) return;

        if (node.tagName.toLowerCase() === "select") {
          const target = String(value || "").trim().toLowerCase();
          const options = Array.from(node.options || []);
          const exact = options.find((opt) => String(opt.value || "").trim().toLowerCase() === target);
          const byText = options.find((opt) => String(opt.text || "").trim().toLowerCase().includes(target));
          const selected = exact || byText;
          if (selected) {
            node.value = selected.value;
            selected.selected = true;
          }
        } else {
          node.value = String(value || "").trim();
        }
      };

      const nominativo = candidate?.nominativo || [candidate?.cognome, candidate?.nome].filter(Boolean).join(" ").trim();
      setBySemantic("nominativo", nominativo);
      setBySemantic("codice_candidato", candidate?.codiceCandidato || candidate?.codice_fiscale || candidate?.codiceFiscale);
      setBySemantic("lingua", candidate?.lingua || "ITALIANO");
      setBySemantic("supporto_audio", candidate?.supportoAudio || "NO");

      if (selectedTurnoIndex >= 0) {
        const turnoField = result.requiredFields.find((entry) => entry.semantic === "turno");
        if (turnoField) {
          const selector = turnoField.name
            ? `[name="${CSS.escape(turnoField.name)}"]`
            : (turnoField.id ? `#${CSS.escape(turnoField.id)}` : "");
          const node = selector ? document.querySelector(selector) : null;
          if (node && node.tagName.toLowerCase() === "select") {
            const options = Array.from(node.options || []);
            const boundedIndex = Math.max(0, Math.min(selectedTurnoIndex, Math.max(options.length - 1, 0)));
            const byIndex = options[boundedIndex];
            if (byIndex) {
              node.value = byIndex.value;
              byIndex.selected = true;
            }
          }
        }
      }

      const fdConfirm = new FormData(formForConfirm);
      const confirmButton = Array.from(formForConfirm.querySelectorAll("input[type='submit'],button")).find((el) => /conferma/i.test(String(el.value || el.textContent || "")));
      if (confirmButton) {
        const submitName = String(confirmButton.getAttribute("name") || "").trim();
        if (submitName) {
          fdConfirm.set(submitName, String(confirmButton.value || confirmButton.textContent || "Conferma").trim());
        }
      }

      const bodyConfirm = new URLSearchParams();
      for (const [key, value] of fdConfirm.entries()) {
        bodyConfirm.append(String(key || ""), typeof value === "string" ? value : String(value || ""));
      }

      const actionConfirm = String(formForConfirm.getAttribute("action") || "").trim() || window.location.href;
      const urlConfirm = new URL(actionConfirm, window.location.href).toString();
      const responseConfirm = await fetch(urlConfirm, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: bodyConfirm.toString(),
        credentials: "include",
      });

      result.status = responseConfirm.status;
      result.url = responseConfirm.url || urlConfirm;
      result.html = await responseConfirm.text();
      return result;
    }, {
      radioName: selectedTurno?.radioName || "",
      radioValue: selectedTurno?.radioValue || "",
      candidate,
      confirmInsert,
      selectedTurnoIndex,
    });

    const newCandidateHtml = String(newCandidateSubmit?.html || "");
    if (newCandidateHtml) {
      await page.setContent(newCandidateHtml, { waitUntil: "domcontentloaded" });
    }

    const finalMessage = await page.evaluate(() => {
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
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
        const node = document.querySelector(selector);
        if (!node) continue;
        const text = normalize(node.textContent);
        if (text) return text;
      }

      const text = normalize(document.body?.innerText || "");
      const matches = [
        /non\s+ci\s+sono\s+posti\s+disponibili[^.]*\.?/i,
        /selezionare\s+un\s+elemento\s+dall['’]elenco[^.]*\.?/i,
      ];
      for (const regex of matches) {
        const match = text.match(regex);
        if (match?.[0]) return normalize(match[0]);
      }
      return "";
    });

    const finalMessageText = String(finalMessage || newCandidateSubmit?.messages?.[0] || newCandidateSubmit?.error || "").trim();
    const noSeats = /non\s+ci\s+sono\s+posti\s+disponibili/i.test(finalMessageText);

    pushDiag(trace, "manual.new-candidate.done", {
      status: newCandidateSubmit?.status || null,
      message: finalMessageText,
      noSeats,
    });

    return {
      sessions,
      selectedSessionIndex,
      selectedSession,
      detail: {
        url: detailSubmit?.url || "",
        status: detailSubmit?.status || null,
      },
      candidates: Array.isArray(detailData?.candidates) ? detailData.candidates : [],
      turni,
      selectedTurnoIndex,
      selectedTurno,
      newCandidate: {
        url: newCandidateSubmit?.url || "",
        status: newCandidateSubmit?.status || null,
        message: finalMessageText,
        noSeats,
        confirmAttempted: confirmInsert,
        missingButton: newCandidateSubmit?.error === "new-candidate-button-not-found",
        requiredFields: Array.isArray(newCandidateSubmit?.requiredFields) ? newCandidateSubmit.requiredFields : [],
      },
    };
  } finally {
    if (!isPersistent) {
      await browser.close();
    }
    releaseLock();
  }
}

async function readSituazioneCandidatiDettaglioViaBrowser(options = {}) {
  const username = options.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME;
  const password = options.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD;
  const pin = options.pin || process.env.PORTAL_PIN;
  const trace = Array.isArray(options.trace) ? options.trace : null;

  if (!username || !password) {
    throw new Error("PORTAL_USER/PORTAL_PASS mancanti nel .env");
  }

  const { browser, page, isPersistent, releaseLock } = await getBrowserAndPageForSession(username, password, pin, trace);

  try {
    page.setDefaultTimeout(30000);

    // 1) Login (skip se sessione persistente attiva)
    let skipLogin = false;
    if (isPersistent && persistentLastLoginAt > 0) {
      try {
        const currentUrl = await page.url();
        if (currentUrl.includes("/prenotazione") || currentUrl.includes("/portale-automobilista") || currentUrl.includes("/web/")) {
          skipLogin = true;
        }
      } catch { skipLogin = false; }
    }

    if (!skipLogin) {
    await page.goto("https://www.ilportaledellautomobilista.it/SSO/SSOLogin/Login_initAction.action", {
      waitUntil: "domcontentloaded",
    });

    const userSel = await waitFirstSelector(
      page,
      [
        'input[name="loginView.beanUtente.userName"]',
        'input[name="loginView.username"]',
        'input[name="username"]',
        'input[id*="user" i]',
        'input[type="email"]',
        'input[type="text"]',
      ],
      8000,
    ).catch(() => null);

    const passSel = await waitFirstSelector(
      page,
      [
        'input[name="loginView.beanUtente.password"]',
        'input[name="loginView.password"]',
        'input[name="password"]',
        'input[id*="pass" i]',
        'input[type="password"]',
      ],
      8000,
    ).catch(() => null);

    if (userSel && passSel) {
      const loginBtnSel =
        'input[name="action:Login_executeLogin"], button[name="action:Login_executeLogin"], input[type="submit"], button[type="submit"]';
      await page.click(userSel, { clickCount: 3 });
      await page.type(userSel, username, { delay: 15 });
      await page.click(passSel, { clickCount: 3 });
      await page.type(passSel, password, { delay: 15 });

      await Promise.allSettled([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
        page.click(loginBtnSel),
      ]);

      pushDiag(trace, "situazione.login.done", { url: page.url() });
      await handlePinIfPresent(page, pin);
      pushDiag(trace, "situazione.pin.done", { url: page.url() });
    }
    if (isPersistent) persistentLastLoginAt = Date.now();
    } // fine if (!skipLogin)

    // 2) Vai a "Situazione Candidati"
    const searchUrl =
      "https://www.ilportaledellautomobilista.it/prenotazione/richiestaEmissioneDocumentoAbilitazioneEP/Read_initActionSituazioneCandidati.action?pageStatus=SEARCH";
    await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
    await sleep(1500);
    pushDiag(trace, "situazione.search.page", { url: page.url() });

    // 3) Imposta Stato Candidati = "Da prenotare" se possibile
    await page.evaluate(() => {
      const normalize = (v) => String(v || "").replace(/\s+/g, " ").trim().toUpperCase();
      const selects = Array.from(document.querySelectorAll("select"));
      const target = selects.find((sel) => {
        const name = String(sel.name || "").toLowerCase();
        return name.includes("situazionecandidatibean.indicatorestatocandidati");
      });
      if (!target) return;
      const options = Array.from(target.options || []);
      const found =
        options.find((o) => normalize(o.textContent).includes("DA PRENOTARE")) ||
        options.find((o) => normalize(o.textContent).includes("PRENOTARE"));
      if (found) {
        target.value = found.value;
        found.selected = true;
        target.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    // 4) Clicca RICERCA
    await Promise.allSettled([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
      page.click(
        'input[type="submit"][value="Ricerca"], input[value="RICERCA"], button[value="Ricerca"], button:contains("Ricerca")',
      ),
    ]).catch(() => undefined);
    await sleep(1500);
    pushDiag(trace, "situazione.search.done", { url: page.url() });

    // 5) Seleziona la prima riga (radio/checkbox) e clicca DETTAGLIO
    const detailClickResult = await page.evaluate(() => {
      const normalize = (v) => String(v || "").replace(/\s+/g, " ").trim().toUpperCase();

      const form = document.querySelector("form") || document;
      if (!form) {
        return { clicked: false, reason: "no-form" };
      }

      // seleziona il primo radio/checkbox legato alla situazione candidati
      const pickRow = () => {
        const inputs = Array.from(form.querySelectorAll('input[type="radio"],input[type="checkbox"]'));
        const target =
          inputs.find((i) => {
            const name = String(i.name || "").toLowerCase();
            return (
              name.includes("selectrowidsituazionecandidati") ||
              name.includes("selectrowidapprova")
            );
          }) || inputs[0];
        if (target) {
          target.checked = true;
          target.click();
          return true;
        }
        return false;
      };

      const rowPicked = pickRow();

      const buttons = Array.from(
        form.querySelectorAll('input[type="submit"],button[type="submit"],input[type="button"],button'),
      );

      // priorità: name action:Select_listCandidati (come da HTML), poi id, poi testo
      const dettaglioBtn =
        buttons.find((b) =>
          String(b.name || "").toLowerCase().includes("action:select_listcandidati"),
        ) ||
        buttons.find((b) =>
          String(b.id || "").toLowerCase().includes("read_paging_button_value_viewelement"),
        ) ||
        buttons.find((b) => normalize(b.value || b.textContent).includes("DETTAGLIO"));
      if (!dettaglioBtn) {
        return { clicked: false, rowPicked, reason: "button-not-found" };
      }

      dettaglioBtn.click();
      return { clicked: true, rowPicked, reason: "ok" };
    });

    pushDiag(trace, "situazione.detail.click", detailClickResult || {});

    if (detailClickResult?.clicked) {
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(
        () => undefined,
      );
      await sleep(1500);
    }
    pushDiag(trace, "situazione.detail.page", { url: page.url() });

    // 6) Leggi tabella dettaglio
    const detailRows = await page.evaluate(() => {
      const readText = (node) =>
        String(node?.textContent || "").replace(/\s+/g, " ").trim();
      const rows = [];
      const table = document.querySelector("#elencoSituazioneCandidati");
      if (!table) return rows;

      Array.from(table.querySelectorAll("tbody tr")).forEach((tr) => {
        const cells = Array.from(tr.querySelectorAll("td")).map(readText);
        if (!cells.length) return;

        const marcaOperativa = cells[0] || "";
        const cognome = cells[1] || "";
        const nome = cells[2] || "";
        const codiceStatino = cells[3] || "";
        const dataEmissione = cells[4] || "";
        const dataScadenza = cells[5] || "";
        const categoria = cells[6] || "";
        const tipoEsame = cells[7] || "";

        if (!cognome && !nome && !codiceStatino) return;

        rows.push({
          marca_operativa: marcaOperativa || null,
          cognome,
          nome,
          codice_statino: codiceStatino || null,
          data_emissione_statino: dataEmissione || null,
          data_scadenza_statino: dataScadenza || null,
          categoria_patente: categoria || "",
          tipo_esame: tipoEsame || null,
          data_iscrizione: dataEmissione || "",
        });
      });

      return rows;
    });

    pushDiag(trace, "situazione.detail.parsed", {
      total: Array.isArray(detailRows) ? detailRows.length : 0,
    });

    return {
      success: true,
      rows: Array.isArray(detailRows) ? detailRows : [],
      trace,
    };
  } finally {
    if (!isPersistent) {
      await browser.close();
    }
    releaseLock();
  }
}

/**
 * Legge la lista "Situazione Candidati" via browser persistente.
 * Restituisce HTML grezzo della pagina risultati (come readPortalSearchViaBrowser).
 *
 * @param {object} options
 *   username, password, pin: credenziali
 *   tipoConseguimento: "P" (Patente) | "Q" (CQC) | "" (tutti)
 *   tipoProva: "Q" (Quiz) | "G" (Guida) | "O" (Orale) | "" (tutti)
 *   statoCandidati: "A" (Da prenotare) | "P" (Prenotati) | "D" (Diniegati) | "" (tutti)
 *   trace: array diagnostica
 * @returns {Promise<string>} HTML della pagina risultati
 */
async function readSituazioneCandidatiListViaBrowser(options = {}) {
  const username = options.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME;
  const password = options.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD;
  const pin = options.pin || process.env.PORTAL_PIN;
  const trace = Array.isArray(options.trace) ? options.trace : null;
  const tipoConseguimento = options.tipoConseguimento || "P";
  const tipoProva = options.tipoProva || "";
  const statoCandidati = options.statoCandidati || "";

  if (!username || !password) {
    throw new Error("PORTAL_USER/PORTAL_PASS mancanti nel .env");
  }

  const PORTAL_BASE = "https://www.ilportaledellautomobilista.it";
  const searchUrl = `${PORTAL_BASE}/prenotazione/richiestaEmissioneDocumentoAbilitazioneEP/Read_initActionSituazioneCandidati.action?pageStatus=SEARCH`;

  pushDiag(trace, "situazione.list.start", { tipoConseguimento, tipoProva, statoCandidati });

  const { browser, page, isPersistent, releaseLock } = await getBrowserAndPageForSession(username, password, pin, trace);

  try {
    // --- LOGIN ---
    let skipLogin = false;
    if (isPersistent && persistentLastLoginAt > 0) {
      try {
        const currentUrl = await page.url();
        if (currentUrl.includes("/prenotazione") || currentUrl.includes("/portale-automobilista") || currentUrl.includes("/web/")) {
          skipLogin = true;
          pushDiag(trace, "situazione.list.login.skip", { url: currentUrl });
        }
      } catch { skipLogin = false; }
    }

    if (!skipLogin) {
      await page.goto(`${PORTAL_BASE}/SSO/SSOLogin/Login_initAction.action`, { waitUntil: "domcontentloaded" });
      const userSel = await waitFirstSelector(page, [
        'input[name="loginView.beanUtente.userName"]', 'input[name="username"]', 'input[type="text"]',
      ], 8000).catch(() => null);
      const passSel = await waitFirstSelector(page, [
        'input[name="loginView.beanUtente.password"]', 'input[name="password"]', 'input[type="password"]',
      ], 8000).catch(() => null);

      if (userSel && passSel) {
        await page.click(userSel, { clickCount: 3 });
        await page.type(userSel, username, { delay: 15 });
        await page.click(passSel, { clickCount: 3 });
        await page.type(passSel, password, { delay: 15 });

        const loginBtnSel = 'input[name="action:Login_executeLogin"], input[type="submit"], button[type="submit"]';
        await Promise.allSettled([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
          page.click(loginBtnSel),
        ]);
        await handlePinIfPresent(page, pin);
        if (isPersistent) persistentLastLoginAt = Date.now();
      }
    }

    // --- NAVIGATE ---
    await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
    if (!skipLogin) await sleep(800);

    // Attendi che il form sia presente
    const formSelector = 'form[name*="RichiestaEmissione"], form[id*="RichiestaEmissione"], form[action*="SituazioneCandidati"], form';
    for (let i = 0; i < 6; i++) {
      const hasForm = await page.$('select[name*="situazioneCandidatiBean"]');
      if (hasForm) break;

      const hasPin = await page.$('input[name="loginView.pin"], input[name="pin"]');
      if (hasPin) { await handlePinIfPresent(page, pin); await sleep(200); continue; }

      const postForm = await page.$('form[name="postform"]');
      if (postForm) {
        await Promise.allSettled([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
          page.$eval('form[name="postform"]', (form) => form.submit()),
        ]);
        await sleep(150);
        continue;
      }
      await sleep(skipLogin ? 50 : 200);
    }

    // --- FILL FORM ---
    // Il form "Situazione Candidati" ha dropdown condizionali gestiti da JS del portale:
    //   1. indicatoreTipoSessione = "C" (CONSEGUIMENTO) — OBBLIGATORIO, altrimenti il form non è valido
    //   2. indicatoreConseguimentoEsame = "P" (PATENTE) | "Q" (CQC)
    //   3. indicatoreStatoCandidati = "D" (DA PRENOTARE) | "P" (PRENOTATI)
    //   4. indicatoreTipoProvaEsameDaPrenotare = "T" (TEORIA) | "G" (GUIDA) — solo se DA PRENOTARE
    //   5. indicatoreStatoRichiesta = "A" (ATTIVA) | "S" (SCADUTA) — solo se DA PRENOTARE
    // I dropdown 3-5 appaiono/scompaiono tramite changeIndicatoreTipoSessione() e changeIndicatoreStatoCandidati()

    // Step 1: imposta "Tipo Sessione" = CONSEGUIMENTO e triggera il JS del portale
    await page.evaluate(() => {
      const sel = document.getElementById("indicatoreTipoSessione");
      if (sel) {
        sel.value = "C";
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        // Il portale ha un onchange="changeIndicatoreTipoSessione()" che mostra/nasconde sezioni
        if (typeof changeIndicatoreTipoSessione === "function") changeIndicatoreTipoSessione();
      }
    });
    await sleep(300); // Attendi che il DOM si aggiorni

    // Step 2: imposta il tipo conseguimento (Patente/CQC)
    await page.evaluate((tipoConseguimento) => {
      const findSelect = (partialName) => {
        const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
        return Array.from(document.querySelectorAll("select")).find(s => norm(s.name).includes(norm(partialName)));
      };
      const consSelect = findSelect("indicatoreConseguimentoEsame");
      if (consSelect) {
        const val = tipoConseguimento || "P";
        const opts = Array.from(consSelect.options);
        const target = opts.find(o => o.value === val) || opts.find(o => val === "P" ? /PATENTE/i.test(o.text) : /CQC/i.test(o.text));
        if (target) { consSelect.value = target.value; consSelect.dispatchEvent(new Event("change", { bubbles: true })); }
      }
    }, tipoConseguimento);

    // Step 3: imposta stato candidati (D=Da prenotare, P=Prenotati) — serve sleep perché
    // changeIndicatoreStatoCandidati() mostra/nasconde sezioni con date e tipo prova
    await page.evaluate((statoCandidati) => {
      const findSelect = (partialName) => {
        const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
        return Array.from(document.querySelectorAll("select")).find(s => norm(s.name).includes(norm(partialName)));
      };
      const statoSelect = findSelect("indicatoreStatoCandidati");
      if (statoSelect) {
        const portalValue = (statoCandidati === "P") ? "P" : "D";
        const opts = Array.from(statoSelect.options);
        const target = opts.find(o => o.value === portalValue);
        if (target) {
          statoSelect.value = target.value;
          statoSelect.dispatchEvent(new Event("change", { bubbles: true }));
          if (typeof changeIndicatoreStatoCandidati === "function") changeIndicatoreStatoCandidati();
        }
      }
    }, statoCandidati);
    await sleep(300); // Attendi che il DOM si aggiorni dopo cambio stato

    // Step 4: compila i campi specifici per lo stato selezionato
    const formReady = await page.evaluate((params) => {
      const { tipoProva, statoCandidati } = params;
      const findSelect = (partialName) => {
        const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
        return Array.from(document.querySelectorAll("select")).find(s => norm(s.name).includes(norm(partialName)));
      };

      if (statoCandidati === "P") {
        // ── PRENOTATI: compilare tipo prova (Q/G/O/S) e date (obbligatorie, max 7gg) ──
        // Tipo prova per prenotati: indicatoreTipoProvaEsame (Q=Quiz, G=Guida, O=Orale, S=Scritto)
        const tipoProvaSelect = findSelect("indicatoreTipoProvaEsame");
        if (tipoProvaSelect && tipoProva) {
          // Mappa frontend T→Q (Teoria→Quiz nel contesto prenotati)
          let val = tipoProva;
          if (val === "T") val = "Q";
          const opts = Array.from(tipoProvaSelect.options);
          const target = opts.find(o => o.value === val);
          if (target) { tipoProvaSelect.value = target.value; tipoProvaSelect.dispatchEvent(new Event("change", { bubbles: true })); }
        }

        // Date: dataFrom e dataTo (obbligatorie per Prenotati, max 7 giorni)
        // I candidati prenotati hanno sessioni nel FUTURO, quindi da oggi a +7 giorni
        const today = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const fmt = (d) => pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear();
        const fromDate = today;

        const toDate = new Date(today); toDate.setDate(toDate.getDate() + 6);

        const dataFromEl = document.getElementById("datepicker1") ||
          document.querySelector('input[name*="situazioneCandidatiBean.dataFrom"]');
        if (dataFromEl) { dataFromEl.value = fmt(fromDate); dataFromEl.dispatchEvent(new Event("change", { bubbles: true })); }

        const dataToEl = document.getElementById("datepicker2") ||
          document.querySelector('input[name*="situazioneCandidatiBean.dataTo"]');
        if (dataToEl) { dataToEl.value = fmt(toDate); dataToEl.dispatchEvent(new Event("change", { bubbles: true })); }
      } else {
        // ── DA PRENOTARE: stato richiesta + tipo prova ──
        // Stato richiesta = ATTIVA
        const statoRichiestaSelect = findSelect("indicatoreStatoRichiesta");
        if (statoRichiestaSelect) {
          const opts = Array.from(statoRichiestaSelect.options);
          const attiva = opts.find(o => o.value === "A" || /ATTIVA/i.test(o.text));
          if (attiva) { statoRichiestaSelect.value = attiva.value; statoRichiestaSelect.dispatchEvent(new Event("change", { bubbles: true })); }
        }

        // Tipo prova per Da prenotare: indicatoreTipoProvaEsameDaPrenotare (T=Teoria, G=Guida)
        if (tipoProva) {
          const tipoProvaDaPrenotare = findSelect("indicatoreTipoProvaEsameDaPrenotare");
          if (tipoProvaDaPrenotare) {
            const opts = Array.from(tipoProvaDaPrenotare.options);
            const target = opts.find(o => o.value === tipoProva) ||
              opts.find(o => tipoProva === "T" ? /TEORIA/i.test(o.text) : /GUIDA/i.test(o.text));
            if (target) { tipoProvaDaPrenotare.value = target.value; tipoProvaDaPrenotare.dispatchEvent(new Event("change", { bubbles: true })); }
          }
        }
      }

      // Trova submit
      let btn = document.getElementById("RicercaSituazioneCandidati_button_value_searchElement");
      if (!btn) btn = document.querySelector('input[type="submit"][value="Ricerca"]');
      if (btn) { btn.scrollIntoView(); return true; }
      return false;
    }, { tipoProva, statoCandidati });

    if (!formReady) {
      pushDiag(trace, "situazione.list.submit.notfound");
      throw new Error("Submit button non trovato per Situazione Candidati");
    }

    // --- SUBMIT ---
    // Il pulsante ha name="action:ReadSituazioneCandidati_pagingSituazioneCandidati"
    // Usiamo evaluate + form.submit() come fallback perché il selettore CSS con ":" nel name può essere problematico
    await Promise.allSettled([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
      page.evaluate(() => {
        // Prova click diretto sul bottone Ricerca
        const btn = document.getElementById("RicercaSituazioneCandidati_button_value_searchElement")
          || document.querySelector('input[type="submit"][value="Ricerca"]');
        if (btn) { btn.click(); return; }
        // Fallback: submit del form
        const form = document.getElementById("RicercaSituazioneCandidati")
          || document.querySelector('form[name="RicercaSituazioneCandidati"]');
        if (form) form.submit();
      }),
    ]);

    if (skipLogin) {
      await page.waitForSelector('#listTable, table, .alert, .errors, #messaggioRicerca', { timeout: 15000 }).catch(() => null);
    } else {
      await sleep(1500);
    }

    // Handle PIN e dispatcher post-submit
    const hasPin = await page.$('input[name="loginView.pin"], input[name="pin"]');
    if (hasPin) { await handlePinIfPresent(page, pin); await sleep(200); }
    for (let dispRetry = 0; dispRetry < 3; dispRetry++) {
      const hasPostForm = await page.$('form[name="postform"]');
      if (!hasPostForm) break;
      await Promise.allSettled([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }),
        page.$eval('form[name="postform"]', (form) => form.submit()),
      ]);
      await sleep(100);
    }

    // Dump diagnostico della pagina lista
    try {
      const dumpDir = path.resolve(__dirname, "../../diagnostica-dump");
      if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });
      fs.writeFileSync(path.join(dumpDir, "browser-situazione-candidati.html"), await page.content(), "utf8");
    } catch (_) {}

    // --- STEP 2: per ogni riga nella tabella riepilogativa, seleziona radio + DETTAGLIO ---
    // La tabella #listTable ha righe con radio button e colonne:
    // Sel., Uff. Prov., Autoscuola, Tipo Esame, Abilitazione Richiesta, Nr. Candidati, Stato Candidati
    // Per ogni riga → click radio → click DETTAGLIO → leggi tabella dettaglio → INDIETRO

    const rowCount = await page.evaluate(() => {
      const table = document.getElementById("listTable");
      if (!table) return 0;
      const rows = table.querySelectorAll("tbody tr");
      let count = 0;
      rows.forEach(tr => {
        const radio = tr.querySelector('input[type="radio"]');
        if (radio) count++;
      });
      return count;
    });

    pushDiag(trace, "situazione.list.done", { rowCount });

    if (rowCount === 0) {
      // Nessuna riga riepilogativa — restituisci HTML vuoto
      return await page.content();
    }

    // Raccogli tutti i candidati iterando le righe
    const allCandidates = [];
    const detailIntestazioni = [];

    for (let rowIdx = 0; rowIdx < rowCount; rowIdx++) {
      pushDiag(trace, "situazione.detail.row", { rowIdx });

      // Seleziona la riga radio e clicca DETTAGLIO
      const clicked = await page.evaluate((idx) => {
        const table = document.getElementById("listTable");
        if (!table) return false;
        const rows = Array.from(table.querySelectorAll("tbody tr"));
        let radioIdx = 0;
        for (const tr of rows) {
          const radio = tr.querySelector('input[type="radio"]');
          if (radio) {
            if (radioIdx === idx) {
              radio.checked = true;
              radio.click();
              radio.dispatchEvent(new Event("change", { bubbles: true }));
              return true;
            }
            radioIdx++;
          }
        }
        return false;
      }, rowIdx);

      if (!clicked) continue;
      await sleep(200);

      // Clicca DETTAGLIO
      await Promise.allSettled([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
        page.evaluate(() => {
          // Cerca il bottone DETTAGLIO per ID, name o testo
          let btn = document.querySelector('#RicercaSituazioneCandidati_button_value_viewElement, #Read_paging_button_value_viewElement');
          if (!btn) {
            const allBtns = Array.from(document.querySelectorAll('input[type="submit"], button'));
            btn = allBtns.find(b => /DETTAGLIO/i.test(b.value || b.textContent));
          }
          if (!btn) {
            const allBtns = Array.from(document.querySelectorAll('input[type="submit"], button'));
            btn = allBtns.find(b => String(b.name || "").toLowerCase().includes("viewelement"));
          }
          if (btn) btn.click();
        }),
      ]);

      await page.waitForSelector('table, .alert', { timeout: 15000 }).catch(() => null);

      // Dump della pagina dettaglio
      try {
        const dumpDir = path.resolve(__dirname, "../../diagnostica-dump");
        fs.writeFileSync(path.join(dumpDir, `browser-situazione-candidati-detail-${rowIdx}.html`), await page.content(), "utf8");
      } catch (_) {}

      // Leggi la tabella dettaglio candidati
      const detailData = await page.evaluate(() => {
        const readText = (el) => String(el?.textContent || "").replace(/\s+/g, " ").trim();
        const intestazioni = [];
        const righe = [];

        // Cerca la tabella dei candidati — priorità: elencoSituazioneCandidati, listTable, o la più popolata
        let table = document.getElementById("elencoSituazioneCandidati");
        if (!table || table.querySelectorAll("tbody tr").length === 0) {
          const lt = document.getElementById("listTable");
          if (lt && lt.querySelectorAll("tbody tr").length > 0) table = lt;
        }
        if (!table || table.querySelectorAll("tbody tr").length === 0) {
          // Fallback: tabella con più righe e >= 5 colonne
          let bestCount = 0;
          const tables = Array.from(document.querySelectorAll("table"));
          for (const t of tables) {
            const ths = t.querySelectorAll("thead th").length;
            const trs = t.querySelectorAll("tbody tr").length;
            if (ths >= 5 && trs > bestCount) { bestCount = trs; table = t; }
          }
        }
        if (!table) return { intestazioni, righe };

        table.querySelectorAll("thead th").forEach(th => intestazioni.push(readText(th)));
        table.querySelectorAll("tbody tr").forEach(tr => {
          const cells = [];
          tr.querySelectorAll("td").forEach(td => cells.push(readText(td)));
          if (cells.length >= 3 && cells.some(c => c.length > 0)) righe.push(cells);
        });
        return { intestazioni, righe };
      });

      if (detailData.intestazioni.length && !detailIntestazioni.length) {
        detailIntestazioni.push(...detailData.intestazioni);
      }
      allCandidates.push(...detailData.righe);

      pushDiag(trace, "situazione.detail.parsed", { rowIdx, candidates: detailData.righe.length });

      // Torna INDIETRO alla lista
      await Promise.allSettled([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
        page.evaluate(() => {
          let btn = document.querySelector('input[type="submit"][value="INDIETRO"], input[type="submit"][value="Indietro"]');
          if (!btn) {
            const allBtns = Array.from(document.querySelectorAll('input[type="submit"], button'));
            btn = allBtns.find(b => /INDIETRO/i.test(b.value || b.textContent));
          }
          if (btn) { btn.click(); return; }
          // Fallback: torna con history.back
          window.history.back();
        }),
      ]);
      await sleep(300);

      // Attendi che la tabella lista riappaia
      await page.waitForSelector('#listTable', { timeout: 10000 }).catch(() => null);
    }

    pushDiag(trace, "situazione.alldetails.done", {
      totalCandidates: allCandidates.length,
      intestazioni: detailIntestazioni.length,
    });

    // Costruisci un HTML sintetico con i risultati per compatibilità col parser del controller
    // Usiamo un formato che il cheerio parser del controller può leggere facilmente
    const syntheticHtml = `<table id="elencoSituazioneCandidati"><thead><tr>${
      detailIntestazioni.map(h => `<th>${h}</th>`).join("")
    }</tr></thead><tbody>${
      allCandidates.map(row => `<tr>${row.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")
    }</tbody></table>`;

    // Salva il dump sintetico
    try {
      const dumpDir = path.resolve(__dirname, "../../diagnostica-dump");
      if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });
      fs.writeFileSync(path.join(dumpDir, "browser-situazione-candidati-all.html"), syntheticHtml, "utf8");
    } catch (_) {}

    return syntheticHtml;
  } finally {
    if (!isPersistent) {
      await browser.close();
    }
    releaseLock();
  }
}

/**
 * Legge la lista dei candidati prenotati per una seduta (Sessioni Quiz Interne)
 * dalla pagina di dettaglio che contiene la tabella `#listPrenotazioneCandidatoEP`.
 *
 * Flusso:
 *  - login
 *  - apertura pagina Sessioni Quiz Interne
 *  - ricerca (stato APERTA, intervallo date predefinito)
 *  - selezione riga di seduta (sessionIndex)
 *  - apertura dettaglio con lista prenotazioni
 *  - parsing tabella `#listPrenotazioneCandidatoEP` con esclusione dei placeholder "POSTO PRENOTATO"
 */
async function readPrenotazioniSessioneQuizInterneViaBrowser(options = {}) {
  const username = options.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME;
  const password = options.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD;
  const pin = options.pin || process.env.PORTAL_PIN;
  const trace = Array.isArray(options.trace) ? options.trace : null;

  if (!username || !password) {
    throw new Error("PORTAL_USER/PORTAL_PASS mancanti nel .env");
  }

  const requestedSessionIndex = Number.isFinite(Number(options.sessionIndex))
    ? Number(options.sessionIndex)
    : 0;

  const today = new Date();
  const toDate = new Date(today);
  toDate.setDate(toDate.getDate() + 29);
  const fromDateValue = formatDateDDMMYYYY(today);
  const toDateValue = formatDateDDMMYYYY(toDate);

  const { browser, page, isPersistent, releaseLock } = await getBrowserAndPageForSession(username, password, pin, trace);

  try {
    page.setDefaultTimeout(30000);

    // 1) Login portale (skip se sessione persistente attiva)
    let skipLogin = false;
    if (isPersistent && persistentLastLoginAt > 0) {
      try {
        const currentUrl = await page.url();
        if (currentUrl.includes("/prenotazione") || currentUrl.includes("/portale-automobilista") || currentUrl.includes("/web/")) {
          skipLogin = true;
        }
      } catch { skipLogin = false; }
    }

    if (!skipLogin) {
    await page.goto(
      "https://www.ilportaledellautomobilista.it/SSO/SSOLogin/Login_initAction.action",
      {
        waitUntil: "domcontentloaded",
      },
    );

    const userSel = await waitFirstSelector(
      page,
      [
        'input[name="loginView.beanUtente.userName"]',
        'input[name="loginView.username"]',
        'input[name="username"]',
        'input[id*="user" i]',
        'input[type="email"]',
        'input[type="text"]',
      ],
      8000,
    ).catch(() => null);

    const passSel = await waitFirstSelector(
      page,
      [
        'input[name="loginView.beanUtente.password"]',
        'input[name="loginView.password"]',
        'input[name="password"]',
        'input[id*="pass" i]',
        'input[type="password"]',
      ],
      8000,
    ).catch(() => null);

    if (userSel && passSel) {
      const loginBtnSel =
        'input[name="action:Login_executeLogin"], button[name="action:Login_executeLogin"], input[type="submit"], button[type="submit"]';
      await page.click(userSel, { clickCount: 3 });
      await page.type(userSel, username, { delay: 15 });
      await page.click(passSel, { clickCount: 3 });
      await page.type(passSel, password, { delay: 15 });

      await Promise.allSettled([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
        page.click(loginBtnSel),
      ]);

      pushDiag(trace, "prenotazioni.login.done", { url: page.url() });
      await handlePinIfPresent(page, pin);
      pushDiag(trace, "prenotazioni.pin.done", { url: page.url() });
    }
    if (isPersistent) persistentLastLoginAt = Date.now();
    } // fine if (!skipLogin)

    // 2) Pagina Sessioni Quiz Interne + ricerca
    const searchUrl =
      "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH";
    const searchFormSelector =
      'form#RicercaDisponibilitaSessioneEsameEP, form[name="RicercaDisponibilitaSessioneEsameEP"], form[name="RicercaDisponibilitaSessioneEsame"]';

    let preparedSearchForm = false;
    let lastPrepareError = null;

    for (let attempt = 0; attempt < 8 && !preparedSearchForm; attempt += 1) {
      try {
        await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
        await sleep(1200);

        for (let i = 0; i < 10; i += 1) {
          await sleep(250);
          const hasSearchForm = await page.$(searchFormSelector);
          if (hasSearchForm) break;

          const hasPin = await page.$(
            'input[name="loginView.pin"], input[name="pin"], input[id*="pin" i]',
          );
          if (hasPin) {
            await handlePinIfPresent(page, pin);
            await sleep(400);
            continue;
          }

          const postForm = await page.$('form[name="postform"]');
          if (postForm) {
            await Promise.allSettled([
              page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
              page.$eval('form[name="postform"]', (form) => form.submit()),
            ]);
            await sleep(400);
          }
        }

        await page.waitForSelector(searchFormSelector, { timeout: 30000 });
        await sleep(300);

        // Stato = APERTA (A|)
        await page
          .$eval(
            `${searchFormSelector} select[name*="theStatoDisponibilitaSessioneEsameEP.selectRowId"]`,
            (select) => {
              const hasOpen = Array.from(select.options || []).some(
                (option) => option.value === "A|",
              );
              select.value = hasOpen ? "A|" : select.value;
              select.dispatchEvent(new Event("change", { bubbles: true }));
            },
          )
          .catch(() => null);

        const fromSelector = `${searchFormSelector} input[name*="EPFrom.dataDisponibiltaEsaminatore"]`;
        const toSelector = `${searchFormSelector} input[name*="EPTo.dataDisponibiltaEsaminatore"]`;

        // Usa evaluate() perché i campi hanno jQuery datepicker che intercetta click/type
        await page.evaluate((fSel, tSel, fVal, tVal) => {
          const fEl = document.querySelector(fSel);
          if (fEl) { fEl.value = fVal; fEl.dispatchEvent(new Event("change", { bubbles: true })); }
          const tEl = document.querySelector(tSel);
          if (tEl) { tEl.value = tVal; tEl.dispatchEvent(new Event("change", { bubbles: true })); }
        }, fromSelector, toSelector, fromDateValue, toDateValue);

        preparedSearchForm = true;
      } catch (prepareError) {
        lastPrepareError = prepareError;
        const message = String(prepareError?.message || "");
        if (!/execution context was destroyed/i.test(message)) {
          throw prepareError;
        }
      }
    }

    if (!preparedSearchForm && lastPrepareError) {
      throw lastPrepareError;
    }

    const searchSubmit = await page.evaluate(
      async ({ searchFormSelector, fromDate, toDate }) => {
        const form = document.querySelector(searchFormSelector);
        if (!form) return { error: "search-form-not-found" };

        const formData = new FormData(form);
        const keys = Array.from(formData.keys());
        const findKey = (needle) =>
          keys.find((key) => String(key || "").includes(needle)) || "";

        const fromKey = findKey("EPFrom.dataDisponibiltaEsaminatore");
        const toKey = findKey("EPTo.dataDisponibiltaEsaminatore");
        const statusKey = findKey("theStatoDisponibilitaSessioneEsameEP.selectRowId");
        if (fromKey) formData.set(fromKey, fromDate);
        if (toKey) formData.set(toKey, toDate);
        if (statusKey) formData.set(statusKey, "A|");

        formData.delete("action:Read_clearSearch");
        formData.set("action:Read_paging", "Ricerca");

        const body = new URLSearchParams();
        for (const [key, value] of formData.entries()) {
          body.append(String(key || ""), typeof value === "string" ? value : String(value || ""));
        }

        const action = String(form.getAttribute("action") || "").trim() || window.location.href;
        const submitUrl = new URL(action, window.location.href).toString();

        const response = await fetch(submitUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
          credentials: "include",
        });

        return {
          status: response.status,
          url: response.url || submitUrl,
          html: await response.text(),
        };
      },
      {
        searchFormSelector,
        fromDate: fromDateValue,
        toDate: toDateValue,
      },
    );

    if (searchSubmit?.error) {
      throw new Error(String(searchSubmit.error));
    }

    await page.setContent(String(searchSubmit?.html || ""), { waitUntil: "domcontentloaded" });
    pushDiag(trace, "prenotazioni.search.done", {
      status: searchSubmit?.status || null,
      url: searchSubmit?.url || "",
    });

    // 3) Estrai sedute e scegli quella richiesta
    const sessions = await page.evaluate(() => {
      const readText = (node) => String(node?.textContent || "").replace(/\s+/g, " ").trim();
      const rows = Array.from(document.querySelectorAll("tr"));
      const found = [];
      rows.forEach((row) => {
        const radio = row.querySelector('input[type="radio"][name*="selectRowId" i]');
        if (!radio) return;
        const cells = Array.from(row.querySelectorAll("td")).map(readText);
        found.push({
          radioName: String(radio.getAttribute("name") || ""),
          radioValue: String(radio.value || ""),
          data: cells[3] || "",
          tipoEsame: cells[5] || "",
          amPm: cells[6] || "",
          ufficioProv: cells[7] || "",
          localita: cells[8] || "",
          aula: cells[9] || "",
          turni: cells[10] || "",
          totalePosti: cells[13] || "",
          postiAutoscuola: cells[15] || "",
          propriePrenotazioni: cells[16] || "",
          stato: cells[18] || "",
        });
      });
      return found;
    });

    if (!Array.isArray(sessions) || !sessions.length) {
      throw new Error("Nessuna seduta disponibile nel risultato portale");
    }

    const selectedSessionIndex = Math.max(
      0,
      Math.min(requestedSessionIndex, sessions.length - 1),
    );
    const selectedSession = sessions[selectedSessionIndex];

    pushDiag(trace, "prenotazioni.session.selected", {
      selectedSessionIndex,
      data: selectedSession?.data || "",
      tipoEsame: selectedSession?.tipoEsame || "",
    });

    // 4) Apri dettaglio seduta con lista prenotazioni
    const detailSubmit = await page.evaluate(
      async ({ radioName, radioValue }) => {
        const forms = Array.from(document.querySelectorAll("form"));
        const targetForm =
          forms.find((form) => {
            const hasRadio = form.querySelector(
              `input[type="radio"][name="${CSS.escape(radioName)}"]`,
            );
            const detailButton = Array.from(
              form.querySelectorAll("input[type='submit'],button"),
            ).find((el) =>
              /dettaglio/i.test(String(el.value || el.textContent || "")),
            );
            return !!hasRadio && !!detailButton;
          }) ||
          forms.find((form) =>
            Array.from(form.querySelectorAll("input[type='submit'],button")).find((el) =>
              /dettaglio/i.test(String(el.value || el.textContent || "")),
            ),
          );

        if (!targetForm) return { error: "detail-form-not-found" };

        const fd = new FormData(targetForm);
        if (radioName) fd.set(radioName, radioValue || "");
        fd.delete("action:Read_paging");
        fd.delete("action:Read_clearSearch");
        fd.set("action:Select_listCandidati", "Dettaglio");

        const body = new URLSearchParams();
        for (const [key, value] of fd.entries()) {
          body.append(String(key || ""), typeof value === "string" ? value : String(value || ""));
        }

        const action = String(targetForm.getAttribute("action") || "").trim() || window.location.href;
        const url = new URL(action, window.location.href).toString();
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
          credentials: "include",
        });

        return {
          status: response.status,
          url: response.url || url,
          html: await response.text(),
        };
      },
      {
        radioName: selectedSession?.radioName || "",
        radioValue: selectedSession?.radioValue || "",
      },
    );

    if (detailSubmit?.error) {
      throw new Error(String(detailSubmit.error));
    }

    await page.setContent(String(detailSubmit?.html || ""), { waitUntil: "domcontentloaded" });
    pushDiag(trace, "prenotazioni.detail.loaded", {
      url: detailSubmit?.url || "",
      status: detailSubmit?.status || null,
    });

    // 5) Parsing tabella listPrenotazioneCandidatoEP
    const prenotazioni = await page.evaluate(() => {
      const readText = (node) => String(node?.textContent || "").replace(/\s+/g, " ").trim();
      const table = document.querySelector("#listPrenotazioneCandidatoEP");
      if (!table) return [];

      const rows = [];
      Array.from(table.querySelectorAll("tbody tr")).forEach((tr) => {
        const cells = Array.from(tr.querySelectorAll("td")).map(readText);
        if (!cells.length) return;

        const numero = cells[0] || "";
        const patente = cells[3] || "";
        const abilitazione = cells[4] || "";
        const numDomande = cells[5] || "";
        const codiceAutoscuola = cells[6] || "";
        const cognome = cells[7] || "";
        const codiceAnomalia = cells[8] || "";
        const lingua = cells[9] || "";
        const supportoAudio = cells[10] || "";
        const turno = cells[11] || "";
        const esaminatore = cells[12] || "";
        const ente = cells[13] || "";

        const identity = `${cognome}`.toUpperCase();
        const isPlaceholder =
          !cognome ||
          /POSTO\s+PRENOTATO/i.test(identity) ||
          /POSTO\s+DISPONIBILE/i.test(identity) ||
          /POSTO\s+LIBERO/i.test(identity);
        if (isPlaceholder) return;

        rows.push({
          numero,
          patente,
          abilitazione,
          num_domande: numDomande,
          codice_autoscuola: codiceAutoscuola,
          cognome,
          codice_anomalia: codiceAnomalia,
          lingua,
          supporto_audio: supportoAudio,
          turno,
          esaminatore,
          ente,
        });
      });

      return rows;
    });

    pushDiag(trace, "prenotazioni.detail.parsed", {
      total: Array.isArray(prenotazioni) ? prenotazioni.length : 0,
    });

    return {
      success: true,
      trace,
      sessions: sessions,
      selectedSessionIndex,
      selectedSession,
      prenotazioni: Array.isArray(prenotazioni) ? prenotazioni : [],
    };
  } finally {
    if (!isPersistent) {
      await browser.close();
    }
    releaseLock();
  }
}

class PortalSession {
  constructor() {
    this.jar = null;
    this.username = null;
  }

  async login(username, password, pin) {
    try {
      this.jar = await loginAndGetJar({ username, password, pin });
      this.username = username;
      return true;
    } catch (error) {
      console.error("Errore login:", error.message);
      this.jar = null;
      return false;
    }
  }

  async logout() {
    this.jar = null;
    this.username = null;
    return true;
  }

  async isSessionValid() {
    if (!this.jar) return false;
    try {
      const client = makeHttpClient(this.jar);
      const response = await client.get("https://www.ilportaledellautomobilista.it/prenotazione", {
        timeout: 15000,
      });
      const body = typeof response.data === "string" ? response.data : "";
      return !body.toLowerCase().includes("accesso al sistema");
    } catch {
      return false;
    }
  }
}

// =============================================================================
// LOGIN DIRETTO VIA HTTP (SENZA BROWSER)
// =============================================================================
// Via primaria: POST del form a Login_initAction.action + catena dispatcher
// SSO/PIN — lo stesso meccanismo del gestionale IO PATENTE, che il Portale
// accetta. La vecchia GET con credenziali in query string (stile iPatenteCloud)
// resta come fallback: da agosto 2026 il Portale la rimbalza sulla pagina di
// login, ma se un giorno il POST smettesse di funzionare torna utile.
// Tempo: ~100-300ms vs 8-15 secondi con Puppeteer.
// La sessione SSO viene stabilita dalla risposta HTTP (cookie JSESSIONID, ecc.)
// =============================================================================

/**
 * Login diretto via HTTP senza browser — ~100-300ms
 * POST del form di login + catena dispatcher SSO; il PIN viene validato
 * quando il Portale interpone la pagina «SSO - Pin Validation».
 *
 * @param {object} options
 * @param {string} options.username
 * @param {string} options.password
 * @param {string} [options.pin]
 * @returns {Promise<CookieJar>}
 */
async function loginDirectHttp(options = {}) {
  const username = options.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME;
  const password = options.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD;
  const pin      = options.pin      || process.env.PORTAL_PIN;

  if (!username || !password) {
    throw new Error("PORTAL_USER/PORTAL_PASS mancanti nel .env");
  }

  const jar    = new CookieJar();
  const client = makeHttpClient(jar);

  // =========================================================================
  // STEP 1: Login con credenziali — POST del form (via primaria) con
  // fallback alla vecchia GET con credenziali in query string.
  // =========================================================================
  const homeRedirect = "https:%2F%2Fwww.ilportaledellautomobilista.it%2Fweb%2Fportale-automobilista%2Fhomepage-professionista%3Finit";
  const loginUrl = "https://www.ilportaledellautomobilista.it/SSO/SSOLogin/Login_initAction.action";

  console.log("[portalSession] loginDirectHttp STEP1: invio login per utente", username);

  // Helper: esegue una GET con retry su errori di rete transienti (ECONNRESET/ETIMEDOUT/etc).
  // Il portale dell'Automobilista chiude occasionalmente le connessioni TLS durante il
  // redirect chain del login. Un retry con piccolo backoff risolve nella maggior parte dei casi.
  const TRANSIENT_NET_CODES = new Set([
    "ECONNRESET", "ETIMEDOUT", "ECONNABORTED", "EPIPE", "ENETUNREACH",
    "EAI_AGAIN", "ECONNREFUSED", "ERR_SOCKET_CONNECTION_TIMEOUT",
  ]);
  async function getWithRetry(url, cfg = {}, maxAttempts = 4) {
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await client.get(url, cfg);
      } catch (err) {
        lastErr = err;
        const code = String(err?.code || err?.cause?.code || "");
        const status = err?.response?.status;
        // Non ritentare errori HTTP "veri" (gestiti dal chiamante), solo i network reset
        if (status && status !== 502 && status !== 503 && status !== 504) throw err;
        if (!TRANSIENT_NET_CODES.has(code) && !/ECONN|ETIMED|socket hang/i.test(String(err?.message || ""))) {
          throw err;
        }
        if (attempt < maxAttempts) {
          const delayMs = 500 * attempt + Math.floor(Math.random() * 300);
          console.warn(`[portalSession] loginDirectHttp STEP1: ${code || "network"} al tentativo ${attempt}/${maxAttempts}, retry tra ${delayMs}ms...`);
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }
    throw lastErr;
  }

  // POST di un form x-www-form-urlencoded con gli stessi retry di rete di getWithRetry.
  async function postFormWithRetry(url, params, cfg = {}, maxAttempts = 4) {
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await client.post(url, serializePayloadRaw(params), {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Origin: "https://www.ilportaledellautomobilista.it",
            ...(cfg.headers || {}),
          },
          maxRedirects: cfg.maxRedirects ?? 15,
        });
      } catch (err) {
        lastErr = err;
        const code = String(err?.code || err?.cause?.code || "");
        const status = err?.response?.status;
        if (status && status !== 502 && status !== 503 && status !== 504) throw err;
        if (!TRANSIENT_NET_CODES.has(code) && !/ECONN|ETIMED|socket hang/i.test(String(err?.message || ""))) {
          throw err;
        }
        if (attempt < maxAttempts) {
          const delayMs = 500 * attempt + Math.floor(Math.random() * 300);
          console.warn(`[portalSession] loginDirectHttp STEP1: ${code || "network"} (POST) al tentativo ${attempt}/${maxAttempts}, retry tra ${delayMs}ms...`);
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }
    throw lastErr;
  }

  // Segue l'auto-submit del dispatcher SSO e l'eventuale pagina «SSO - Pin
  // Validation» che il Portale interpone dopo il login (catena del gestionale).
  let pinGestitoInCatena = false;
  async function seguiCatenaSsoPin(resp, currentUrl) {
    const cheerio = require("cheerio");
    for (let i = 0; i < 6; i++) {
      const html = typeof resp?.data === "string" ? resp.data : "";
      const low = html.toLowerCase();
      const $ = cheerio.load(html || "");

      if (low.includes("sso - pin validation") || low.includes("loginview.pin")) {
        if (!pin) break; // il chiamante vedrà la pagina PIN e fallirà con messaggio chiaro
        let form = $("form#LoginForm, form[name='LoginForm']").first();
        if (!form.length) form = $("form").first();
        if (!form.length) break;
        const action = form.attr("action");
        const resolved = action
          ? (action.startsWith("http") ? action : "https://www.ilportaledellautomobilista.it" + action)
          : "https://www.ilportaledellautomobilista.it/SSO/SSOLogin/DispatcherEntry_executeDispatch.action";
        const data = new URLSearchParams();
        form.find("input[type='hidden']").each((_, input) => {
          const name = $(input).attr("name");
          if (name) data.append(name, $(input).attr("value") || "");
        });
        data.set("loginView.pin", pin);
        data.set("action:Pin_executePinValidation", "Conferma");
        console.log("[portalSession] loginDirectHttp STEP1: catena SSO → POST ri-validazione PIN");
        resp = await postFormWithRetry(resolved, data, { headers: { Referer: currentUrl } });
        currentUrl = resolved;
        pinGestitoInCatena = true;
        continue;
      }

      if (low.includes("dispatcherentry_executedispatch")) {
        let form = $("form[name='postform'], form[name='postForm']").first();
        if (!form.length) form = $("form").first();
        if (!form.length) break;
        const action = form.attr("action");
        const resolved = action
          ? (action.startsWith("http") ? action : "https://www.ilportaledellautomobilista.it" + action)
          : currentUrl;
        const data = new URLSearchParams();
        form.find("input").each((_, input) => {
          const name = $(input).attr("name");
          const type = String($(input).attr("type") || "").toLowerCase();
          if (!name || type === "submit" || type === "button" || type === "image") return;
          data.append(name, $(input).attr("value") || "");
        });
        console.log("[portalSession] loginDirectHttp STEP1: catena SSO → POST dispatcher");
        resp = await postFormWithRetry(resolved, data, { headers: { Referer: currentUrl } });
        currentUrl = resolved;
        continue;
      }

      break;
    }
    return resp;
  }

  // Esito del login: falliti = ancora sulla pagina di login o messaggio d'errore.
  function esitoLogin(resp) {
    const finalUrl  = String(resp?.request?.res?.responseUrl || resp?.config?.url || "").toLowerCase();
    const htmlLower = String(resp?.data || "").toLowerCase();
    const htmlTitle = (String(resp?.data || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
    const failed =
      htmlLower.includes("credenziali errate") ||
      htmlLower.includes("username o password errat") ||
      htmlLower.includes("beanutente.password") ||
      htmlLower.includes("login_executelogin") ||
      (finalUrl.includes("/sso/ssologin/") && htmlLower.includes("login_initaction"));
    return { failed, finalUrl, htmlTitle };
  }

  function logEsito(etichetta, resp, esito) {
    console.log(`[portalSession] loginDirectHttp STEP1 (${etichetta}): finalUrl =`, esito.finalUrl.slice(0, 200));
    console.log(`[portalSession] loginDirectHttp STEP1 (${etichetta}): title =`, esito.htmlTitle.replace(/\s+/g, " ").trim().slice(0, 100));
    console.log(`[portalSession] loginDirectHttp STEP1 (${etichetta}): htmlLen =`, String(resp?.data || "").length);
  }

  // ── Via primaria: POST del form di login (come il gestionale) ─────────────
  const loginForm = new URLSearchParams();
  loginForm.append("loginView.gotoRedirect", "");
  loginForm.append("orgname", "");
  loginForm.append("loginView.beanUtente.userName", username);
  loginForm.append("loginView.beanUtente.password", password);
  loginForm.append("action:Login_executeLogin", "Accedi");

  let response = await postFormWithRetry(loginUrl, loginForm, { maxRedirects: 15, headers: { Referer: loginUrl } }, 4);
  response = await seguiCatenaSsoPin(response, loginUrl);
  let esito = esitoLogin(response);
  logEsito("POST", response, esito);

  // ── Fallback: vecchia GET con credenziali in query string ─────────────────
  if (esito.failed) {
    console.warn("[portalSession] loginDirectHttp STEP1: POST rimbalzato, provo la GET legacy...");
    const legacyLoginUrl =
      loginUrl +
      "?loginView.gotoRedirect=" + homeRedirect +
      "&orgname=" +
      "&loginView.beanUtente.userName=" + encodeURIComponent(username) +
      "&loginView.beanUtente.password=" + encodeURIComponent(password) +
      "&action:Login_executeLogin=Accedi";
    try {
      response = await getWithRetry(legacyLoginUrl, { maxRedirects: 15 }, 4);
    } catch (err) {
      // Se homepage-professionista dà 404, riprova con la homepage generica
      if (err?.response?.status === 404) {
        console.warn("[portalSession] loginDirectHttp: homepage-professionista 404, provo redirect generico");
        const fallbackRedirect = "https:%2F%2Fwww.ilportaledellautomobilista.it%2Fweb%2Fportale-automobilista%2Fhome%3Flogged%3Dtrue";
        const fallbackLoginUrl =
          loginUrl +
          "?loginView.gotoRedirect=" + fallbackRedirect +
          "&orgname=" +
          "&loginView.beanUtente.userName=" + encodeURIComponent(username) +
          "&loginView.beanUtente.password=" + encodeURIComponent(password) +
          "&action:Login_executeLogin=Accedi";
        response = await getWithRetry(fallbackLoginUrl, { maxRedirects: 15 }, 4);
      } else {
        throw err;
      }
    }
    response = await seguiCatenaSsoPin(response, loginUrl);
    esito = esitoLogin(response);
    logEsito("GET legacy", response, esito);
  }

  if (esito.failed) {
    const msg = extractPortalMessage(response?.data || "") || "Credenziali errate o sessione non avviata";
    console.error("[portalSession] loginDirectHttp FALLITO:", msg);
    throw new Error(`Login diretto fallito: ${msg}`);
  }

  console.log("[portalSession] loginDirectHttp STEP1: LOGIN OK");

  // =========================================================================
  // STEP 2: Validazione PIN separata (se PIN configurato)
  // Invece di annidare il PIN nel redirect del login, lo facciamo come step
  // separato — più robusto e compatibile col flusso del portale.
  // =========================================================================
  if (pin && pinGestitoInCatena) {
    console.log("[portalSession] loginDirectHttp STEP2: PIN già validato nella catena SSO, skip");
  } else if (pin) {
    console.log("[portalSession] loginDirectHttp STEP2: validazione PIN...");

    // Controlla se la risposta del login è già una pagina PIN
    let pinHtml = response.data;
    let needsPinPage = typeof pinHtml === "string" &&
      (pinHtml.includes("SSO - Pin Validation") || pinHtml.includes('name="loginView.pin"'));

    // Se non siamo già sulla pagina PIN, navighiamoci
    if (!needsPinPage) {
      try {
        const pinPageUrl = "https://www.ilportaledellautomobilista.it/SSO/SSOLogin/DispatcherEntry_executeDispatch.action" +
          "?loginView.pin=" + encodeURIComponent(pin) +
          "&loginView.gotoRedirect=" + homeRedirect +
          "&orgname=/" +
          "&action:Pin_executePinValidation=Conferma";
        const pinPageResp = await client.get(pinPageUrl, { maxRedirects: 10 });
        pinHtml = pinPageResp.data;
        console.log("[portalSession] loginDirectHttp STEP2: navigato a pagina PIN, title =",
          (String(pinHtml || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim()?.slice(0, 80) || "N/A");
      } catch (pinErr) {
        console.warn("[portalSession] loginDirectHttp STEP2: errore navigazione PIN:", pinErr.message?.slice(0, 200));
      }
    }

    // Se siamo sulla pagina PIN, invia il form
    if (typeof pinHtml === "string" && (pinHtml.includes("SSO - Pin Validation") || pinHtml.includes('name="loginView.pin"'))) {
      const cheerio = require("cheerio");
      const $pin = cheerio.load(pinHtml);
      const pinForm = $pin("form#LoginForm, form[name='LoginForm']").first();
      const pinAction = pinForm.attr("action");
      const resolvedPinAction = pinAction
        ? (pinAction.startsWith("http") ? pinAction : "https://www.ilportaledellautomobilista.it" + pinAction)
        : "https://www.ilportaledellautomobilista.it/SSO/SSOLogin/DispatcherEntry_executeDispatch.action";

      const pinData = new URLSearchParams();
      pinForm.find("input[type='hidden']").each((_, input) => {
        const name = $pin(input).attr("name");
        const value = $pin(input).attr("value") || "";
        if (name) pinData.append(name, value);
      });
      pinData.set("loginView.pin", pin);
      pinData.set("action:Pin_executePinValidation", "Conferma");

      try {
        const pinResp = await client.post(resolvedPinAction, serializePayloadRaw(pinData), {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          maxRedirects: 10,
        });
        const pinTitle = (String(pinResp?.data || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
        console.log("[portalSession] loginDirectHttp STEP2: PIN validato, title =", pinTitle.trim().slice(0, 80));
      } catch (pinPostErr) {
        console.warn("[portalSession] loginDirectHttp STEP2: errore POST PIN:", pinPostErr.message?.slice(0, 200));
      }
    } else {
      console.log("[portalSession] loginDirectHttp STEP2: PIN non richiesto dal portale, skip");
    }
  }

  console.log("[portalSession] loginDirectHttp: COMPLETO (login + PIN)");
  return jar;
}

/**
 * Come getOrLoginJar ma usa loginDirectHttp (velocissimo).
 * Se la sessione in cache è valida la riusa, altrimenti fa un nuovo login HTTP.
 * Fallback automatico a loginAndGetJar (Puppeteer) solo se il login diretto fallisce.
 */
async function getOrLoginJarFast(options = {}) {
  const username = options.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME;
  const password = options.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD;
  const pin      = options.pin      || process.env.PORTAL_PIN;

  if (!username || !password) {
    throw new Error("PORTAL_USER/PORTAL_PASS mancanti nel .env");
  }

  const key   = `fast::${username}::${pin || ""}`;
  const ttlMs = Number(process.env.PORTAL_SESSION_TTL_MS || DEFAULT_SESSION_TTL_MS);
  const now   = Date.now();

  const cached = portalSessionJarCache.get(key);
  if (cached && now - cached.createdAt < ttlMs) {
    return cached.jar;
  }

  let jar;
  try {
    jar = await loginDirectHttp({ username, password, pin });
    console.log("[portalSession] Login diretto HTTP completato in <300ms");
  } catch (err) {
    console.warn("[portalSession] Login diretto fallito, fallback Puppeteer:", err.message);
    jar = await loginAndGetJar({ username, password, pin });
  }

  portalSessionJarCache.set(key, { jar, createdAt: now });
  return jar;
}

/**
 * Estrattore messaggio portale (usato dal login diretto per diagnostica)
 * — mini-clone locale per non creare dipendenza circolare con portalHttp.
 */
function extractPortalMessage(html) {
  const cheerio = require("cheerio");
  try {
    const $ = cheerio.load(html || "");
    for (const sel of [".alert", ".errori p", ".errorMessage li span", ".messaggio"]) {
      const txt = $(sel).first().text().replace(/\s+/g, " ").trim();
      if (txt && txt.length > 3 && txt.length < 400) return txt;
    }
  } catch { /* noop */ }
  return "";
}

// =============================================================================
// GENERIC BROWSER-BASED PORTAL SEARCH
// Handles ALL portal tab types: SQI, SGOS, SQA, SCQC, SCQCA, VAC, VSC, etc.
// Uses native browser form submission to avoid Struts2 DMI encoding issues.
// =============================================================================

/**
 * Configurazione per ogni tipo di pagina portale.
 * searchUrl: URL GET per caricare la pagina di ricerca
 * formSelector: selettore CSS del form di ricerca
 * dateFromSelector: selettore input data "da"
 * dateToSelector: selettore input data "a"
 * statusSelector: selettore select stato sessione (se applicabile)
 * submitSelector: selettore pulsante submit
 * dateRange: "future" (oggi+29gg) o "past" (oggi-6gg)
 */
const PORTAL_TAB_CONFIG = {
  // --- Sessioni Patente ---
  SQI: {
    searchUrl: "/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH",
    formSelector: 'form#RicercaDisponibilitaSessioneEsameEP, form[name="RicercaDisponibilitaSessioneEsameEP"]',
    dateFromSelector: 'input[name*="EPFrom.dataDisponibiltaEsaminatore"]',
    dateToSelector: 'input[name*="EPTo.dataDisponibiltaEsaminatore"]',
    statusSelector: 'select[name*="theStatoDisponibilitaSessioneEsameEP.selectRowId"]',
    submitSelector: 'input[name="action:Read_paging"]',
    dateRange: "future",
  },
  SGOS: {
    searchUrl: "/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniGuideOrali.action?pageStatus=SEARCH",
    formSelector: 'form#RicercaDisponibilitaSessioneEsameEP, form[name="RicercaDisponibilitaSessioneEsameEP"]',
    dateFromSelector: 'input[name*="EPFrom.dataDisponibiltaEsaminatore"]',
    dateToSelector: 'input[name*="EPTo.dataDisponibiltaEsaminatore"]',
    statusSelector: 'select[name*="theStatoDisponibilitaSessioneEsameEP.selectRowId"]',
    submitSelector: 'input[name="action:Read_paging"]',
    dateRange: "future",
  },
  SQA: {
    searchUrl: "/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizApprovate.action?pageStatus=SEARCH",
    formSelector: 'form#RicercaDisponibilitaSessioneEsameEP, form[name="RicercaDisponibilitaSessioneEsameEP"]',
    dateFromSelector: 'input[name*="EPFrom.dataDisponibiltaEsaminatore"]',
    dateToSelector: 'input[name*="EPTo.dataDisponibiltaEsaminatore"]',
    statusSelector: 'select[name*="theStatoDisponibilitaSessioneEsameEP.selectRowId"]',
    submitSelector: 'input[name="action:Read_paging"]',
    dateRange: "future",
  },
  // --- Sessioni CQC ---
  SCQC: {
    searchUrl: "/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniCqc.action?pageStatus=SEARCH",
    formSelector: 'form#RicercaDisponibilitaSessioneEsameEP, form[name="RicercaDisponibilitaSessioneEsameEP"]',
    dateFromSelector: 'input[name*="EPFrom.dataDisponibiltaEsaminatore"]',
    dateToSelector: 'input[name*="EPTo.dataDisponibiltaEsaminatore"]',
    statusSelector: 'select[name*="theStatoDisponibilitaSessioneEsameEP.selectRowId"]',
    submitSelector: 'input[name="action:Read_paging"]',
    dateRange: "future",
  },
  SCQCA: {
    searchUrl: "/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniCqcApprovate.action?pageStatus=SEARCH",
    formSelector: 'form#RicercaDisponibilitaSessioneEsameEP, form[name="RicercaDisponibilitaSessioneEsameEP"]',
    dateFromSelector: 'input[name*="EPFrom.dataDisponibiltaEsaminatore"]',
    dateToSelector: 'input[name*="EPTo.dataDisponibiltaEsaminatore"]',
    statusSelector: 'select[name*="theStatoDisponibilitaSessioneEsameEP.selectRowId"]',
    submitSelector: 'input[name="action:Read_paging"]',
    dateRange: "past30",
  },
  // --- Verbali Conseguimento ---
  VAC: {
    searchUrl: "/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionVerbaliApertiConseguimento.action?pageStatus=SEARCH",
    formSelector: 'form#RicercaSessioneEsameAbilitazioneEP, form[name="RicercaSessioneEsameAbilitazioneEP"]',
    dateFromSelector: 'input[name*="dataVerbaleEsameAbilitazione"]:not([name*="TO"])',
    dateToSelector: 'input[name*="dataVerbaleEsameAbilitazioneTO"]',
    statusSelector: null,
    submitSelector: 'input[name="action:ReadConseguimento_pagingConseguimento"]',
    dateRange: "past7",
  },
  VSC: {
    searchUrl: "/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionVerbaliSvoltiConseguimento.action?pageStatus=SEARCH",
    formSelector: 'form#RicercaSessioneEsameAbilitazioneEP, form[name="RicercaSessioneEsameAbilitazioneEP"]',
    dateFromSelector: 'input[name*="dataVerbaleEsameAbilitazione"]:not([name*="TO"])',
    dateToSelector: 'input[name*="dataVerbaleEsameAbilitazioneTO"]',
    statusSelector: null,
    submitSelector: 'input[name="action:ReadConseguimento_pagingConseguimento"]',
    dateRange: "past7",
  },
  // --- Verbali CQC ---
  VAQ: {
    searchUrl: "/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionVerbaliApertiCqc.action?pageStatus=SEARCH",
    formSelector: 'form#RicercaSessioneEsameAbilitazioneEP, form[name="RicercaSessioneEsameAbilitazioneEP"]',
    dateFromSelector: 'input[name*="dataVerbaleEsameAbilitazione"]:not([name*="TO"])',
    dateToSelector: 'input[name*="dataVerbaleEsameAbilitazioneTO"]',
    statusSelector: null,
    submitSelector: 'input[name="action:ReadCqc_pagingCQC"]',
    dateRange: "past7",
  },
  VSQ: {
    searchUrl: "/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionVerbaliSvoltiCqc.action?pageStatus=SEARCH",
    formSelector: 'form#RicercaSessioneEsameAbilitazioneEP, form[name="RicercaSessioneEsameAbilitazioneEP"]',
    dateFromSelector: 'input[name*="dataVerbaleEsameAbilitazione"]:not([name*="TO"])',
    dateToSelector: 'input[name*="dataVerbaleEsameAbilitazioneTO"]',
    statusSelector: null,
    submitSelector: 'input[name="action:ReadCqc_pagingCQC"]',
    dateRange: "past7",
  },
  // --- Verbali Revisione Patente ---
  VSR: {
    searchUrl: "/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionVerbaliSvoltiRevisione.action?pageStatus=SEARCH",
    formSelector: 'form#RicercaSessioneEsameAbilitazioneEP, form[name="RicercaSessioneEsameAbilitazioneEP"]',
    dateFromSelector: 'input[name*="dataVerbaleEsameAbilitazione"]:not([name*="TO"])',
    dateToSelector: 'input[name*="dataVerbaleEsameAbilitazioneTO"]',
    statusSelector: null,
    submitSelector: 'input[name="action:ReadRevisione_pagingRevisione"]',
    dateRange: "past7",
  },
  VAR: {
    searchUrl: "/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionVerbaliAnnullatiRevisione.action?pageStatus=SEARCH",
    formSelector: 'form#RicercaSessioneEsameAbilitazioneEP, form[name="RicercaSessioneEsameAbilitazioneEP"]',
    dateFromSelector: 'input[name*="dataVerbaleEsameAbilitazione"]:not([name*="TO"])',
    dateToSelector: 'input[name*="dataVerbaleEsameAbilitazioneTO"]',
    statusSelector: null,
    submitSelector: 'input[name="action:ReadRevisione_pagingRevisione"]',
    dateRange: "past7",
  },
  // --- Verbali Revisione CQC ---
  VSRCQC: {
    searchUrl: "/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionVerbaliSvoltiCqcRev.action?pageStatus=SEARCH",
    formSelector: 'form#RicercaSessioneEsameAbilitazioneEP, form[name="RicercaSessioneEsameAbilitazioneEP"]',
    dateFromSelector: 'input[name*="dataVerbaleEsameAbilitazione"]:not([name*="TO"])',
    dateToSelector: 'input[name*="dataVerbaleEsameAbilitazioneTO"]',
    statusSelector: null,
    submitSelector: 'input[name="action:ReadCqc_pagingCQC"]',
    dateRange: "past7",
  },
  VARCQC: {
    searchUrl: "/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionVerbaliAnnullatiRevisioneCqc.action?pageStatus=SEARCH",
    formSelector: 'form#RicercaSessioneEsameAbilitazioneEP, form[name="RicercaSessioneEsameAbilitazioneEP"]',
    dateFromSelector: 'input[name*="dataVerbaleEsameAbilitazione"]:not([name*="TO"])',
    dateToSelector: 'input[name*="dataVerbaleEsameAbilitazioneTO"]',
    statusSelector: null,
    submitSelector: 'input[name="action:ReadCqc_pagingCQC"]',
    dateRange: "past7",
  },
  // --- Verbali Annullati Conseguimento ---
  VANC: {
    searchUrl: "/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionVerbaliAnnullatiConseguimento.action?pageStatus=SEARCH",
    formSelector: 'form#RicercaSessioneEsameAbilitazioneEP, form[name="RicercaSessioneEsameAbilitazioneEP"]',
    dateFromSelector: 'input[name*="dataVerbaleEsameAbilitazione"]:not([name*="TO"])',
    dateToSelector: 'input[name*="dataVerbaleEsameAbilitazioneTO"]',
    statusSelector: null,
    submitSelector: 'input[name="action:ReadConseguimento_pagingConseguimento"]',
    dateRange: "past7",
  },
  // --- Verbali Annullati CQC ---
  VANQ: {
    searchUrl: "/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionVerbaliAnnullatiCqc.action?pageStatus=SEARCH",
    formSelector: 'form#RicercaSessioneEsameAbilitazioneEP, form[name="RicercaSessioneEsameAbilitazioneEP"]',
    dateFromSelector: 'input[name*="dataVerbaleEsameAbilitazione"]:not([name*="TO"])',
    dateToSelector: 'input[name*="dataVerbaleEsameAbilitazioneTO"]',
    statusSelector: null,
    submitSelector: 'input[name="action:ReadCqc_pagingCQC"]',
    dateRange: "past7",
  },
};

function computeDateRange(rangeType, options = {}) {
  const today = new Date();
  let fromDate, toDate;
  if (rangeType === "past7") {
    fromDate = new Date(today); fromDate.setDate(fromDate.getDate() - 6);
    toDate = today;
  } else if (rangeType === "past30") {
    fromDate = new Date(today); fromDate.setDate(fromDate.getDate() - 29);
    toDate = today;
  } else {
    // "future" — default
    fromDate = today;
    toDate = new Date(today); toDate.setDate(toDate.getDate() + 29);
  }

  let resultFrom = options.dateFrom || formatDateDDMMYYYY(fromDate);
  let resultTo = options.dateTo || formatDateDDMMYYYY(toDate);

  // Clamp per past7: il portale accetta max 7 giorni per i verbali
  // Se il client manda un range più ampio, lo riduciamo automaticamente
  if (rangeType === "past7" && resultFrom && resultTo) {
    const parseDDMMYYYY = (s) => {
      const p = String(s).split("/");
      return p.length === 3 ? new Date(+p[2], +p[1] - 1, +p[0]) : null;
    };
    const f = parseDDMMYYYY(resultFrom);
    const t = parseDDMMYYYY(resultTo);
    if (f && t && !isNaN(f) && !isNaN(t)) {
      const diffDays = Math.round((t - f) / (1000 * 60 * 60 * 24));
      if (diffDays > 6) {
        // Sposta fromDate a toDate - 6 giorni
        const clamped = new Date(t);
        clamped.setDate(clamped.getDate() - 6);
        resultFrom = formatDateDDMMYYYY(clamped);
      }
    }
  }

  return { from: resultFrom, to: resultTo };
}

/**
 * Ricerca generica via browser per qualsiasi tab del portale.
 * @param {string} tabType - Tipo tab: SQI, SGOS, SQA, SCQC, SCQCA, VAC, VSC, VAQ, VSQ, VSR
 * @param {object} options
 *   username, password, pin: credenziali
 *   dateFrom, dateTo: date in DD/MM/YYYY (opzionali, calcolate da dateRange)
 *   stato: filtro stato sessione (APERTA, CHIUSA, APPROVATA)
 *   trace: array diagnostica
 * @returns {Promise<string>} HTML della pagina risultati
 */
async function readPortalSearchViaBrowser(tabType, options = {}) {
  const config = PORTAL_TAB_CONFIG[String(tabType).toUpperCase()];
  if (!config) {
    throw new Error(`readPortalSearchViaBrowser: tipo tab sconosciuto "${tabType}". Validi: ${Object.keys(PORTAL_TAB_CONFIG).join(", ")}`);
  }

  const username = options.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME;
  const password = options.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD;
  const pin = options.pin || process.env.PORTAL_PIN;
  const trace = Array.isArray(options.trace) ? options.trace : null;
  const requestedState = normalizeRequestedSessionState(options.stato || "");
  const dates = computeDateRange(config.dateRange, options);

  if (!username || !password) {
    throw new Error("PORTAL_USER/PORTAL_PASS mancanti nel .env");
  }

  const PORTAL_BASE = "https://www.ilportaledellautomobilista.it";
  const searchUrl = `${PORTAL_BASE}${config.searchUrl}`;

  pushDiag(trace, "browser.generic.start", { tabType, searchUrl, dates, requestedState });

  const { browser, page, isPersistent, releaseLock } = await getBrowserAndPageForSession(username, password, pin, trace);

  try {
    // --- LOGIN ---
    let skipLogin = false;
    if (isPersistent && persistentLastLoginAt > 0) {
      try {
        const currentUrl = await page.url();
        // Skip login se siamo già su qualsiasi pagina del portale (non sulla login page)
        if (currentUrl.includes("/prenotazione") || currentUrl.includes("/portale-automobilista") || currentUrl.includes("/web/")) {
          skipLogin = true;
          pushDiag(trace, "browser.generic.login.skip", { url: currentUrl });
        }
      } catch { skipLogin = false; }
    }

    if (!skipLogin) {
      await page.goto(`${PORTAL_BASE}/SSO/SSOLogin/Login_initAction.action`, { waitUntil: "domcontentloaded" });

      const userSel = await waitFirstSelector(page, [
        'input[name="loginView.beanUtente.userName"]', 'input[name="username"]', 'input[type="text"]',
      ], 8000).catch(() => null);
      const passSel = await waitFirstSelector(page, [
        'input[name="loginView.beanUtente.password"]', 'input[name="password"]', 'input[type="password"]',
      ], 8000).catch(() => null);

      if (userSel && passSel) {
        await page.click(userSel, { clickCount: 3 });
        await page.type(userSel, username, { delay: 15 });
        await page.click(passSel, { clickCount: 3 });
        await page.type(passSel, password, { delay: 15 });

        const loginBtnSel = 'input[name="action:Login_executeLogin"], input[type="submit"], button[type="submit"]';
        await Promise.allSettled([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
          page.click(loginBtnSel),
        ]);

        pushDiag(trace, "browser.generic.login.done", { url: page.url() });
        await handlePinIfPresent(page, pin);
        if (isPersistent) persistentLastLoginAt = Date.now();
      }
    }

    // --- FAST PATH: se l'ultimo tab usato è lo stesso, il form è già nel DOM —
    // saltiamo page.goto() e ricompiliamo direttamente date/stato + resubmit.
    // Questo è il caso più comune: l'utente cambia solo il filtro stato sulla stessa tab.
    let preparedForm = false;
    if (skipLogin && persistentLastTabType === tabType) {
      try {
        const existingForm = await page.$(config.formSelector);
        if (existingForm) {
          preparedForm = true;
          pushDiag(trace, "browser.generic.fastpath", { tabType, reuse: true });
        }
      } catch { /* fallback a navigazione normale */ }
    }

    // --- NAVIGATE TO SEARCH PAGE ---
    const maxAttempts = skipLogin ? 3 : 5;
    for (let attempt = 0; attempt < maxAttempts && !preparedForm; attempt++) {
      try {
        await page.goto(searchUrl, { waitUntil: "domcontentloaded" });

        // Con sessione persistente il portale risponde subito, basta un breve wait
        if (!skipLogin) await sleep(800);

        // Handle dispatchers and PIN pages — usa waitForSelector con timeout breve
        // invece di loop con sleep ripetuti
        for (let i = 0; i < 6; i++) {
          const hasForm = await page.$(config.formSelector);
          if (hasForm) break;

          const hasPin = await page.$('input[name="loginView.pin"], input[name="pin"]');
          if (hasPin) { await handlePinIfPresent(page, pin); await sleep(200); continue; }

          const postForm = await page.$('form[name="postform"]');
          if (postForm) {
            await Promise.allSettled([
              page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
              page.$eval('form[name="postform"]', (form) => form.submit()),
            ]);
            await sleep(150);
            continue;
          }

          // Breve attesa prima del prossimo tentativo
          await sleep(skipLogin ? 50 : 200);
        }

        await page.waitForSelector(config.formSelector, { timeout: skipLogin ? 8000 : 20000 });
        preparedForm = true;
      } catch (err) {
        pushDiag(trace, "browser.generic.prepare.retry", { attempt, error: String(err?.message || "").slice(0, 200) });
        if (!/execution context was destroyed/i.test(String(err?.message || ""))) {
          if (attempt >= maxAttempts - 1) throw err;
        }
      }
    }

    // --- FILL FORM + SUBMIT in una singola evaluate per ridurre i round-trip ---
    const requestedTipoEsame = String(options.tipoEsame || "").trim().toUpperCase();
    const codUfficio = process.env.PORTAL_UFFICIO_MCTC || "";

    pushDiag(trace, "browser.generic.submit", {
      tabType, dates, requestedState,
      url: page.url(),
    });

    // Singola evaluate: compila date, stato, tipo esame, ufficio e trova il bottone submit
    const formReady = await page.evaluate((params) => {
      const { fromSel, toSel, fromVal, toVal, statusSel, requested, tipoEsame, ufficio, submitSel } = params;

      // 1. Date
      const fromEl = document.querySelector(fromSel);
      if (fromEl) { fromEl.value = fromVal; fromEl.dispatchEvent(new Event("change", { bubbles: true })); }
      const toEl = document.querySelector(toSel);
      if (toEl) { toEl.value = toVal; toEl.dispatchEvent(new Event("change", { bubbles: true })); }

      // 2. Stato
      if (statusSel && requested) {
        const select = document.querySelector(statusSel);
        if (select) {
          const opts = Array.from(select.options || []).map(o => ({
            value: String(o.value || ""), text: String(o.text || "").replace(/\s+/g, " ").trim().toUpperCase(),
          }));
          const pick = (pred) => (opts.find(pred) || {}).value || "";
          let val = "";
          if (requested === "APPROVATA") val = pick(o => /APPROVAT/.test(o.text));
          else if (requested === "CHIUSA") val = pick(o => /CHIUS/.test(o.text));
          else if (requested === "APERTA") val = pick(o => o.value === "A|") || pick(o => /APERT|DISPONIB/.test(o.text));
          if (val) { select.value = val; }
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }

      // 3. Tipo esame
      if (tipoEsame) {
        const sel = document.querySelector('select[name*="indicatoreTipoProvaEsame"]');
        if (sel) { sel.value = tipoEsame; sel.dispatchEvent(new Event("change", { bubbles: true })); }
      }

      // 4. Ufficio MCTC
      if (ufficio) {
        document.querySelectorAll('input[name*="codUfficioMCTC"]').forEach(inp => { if (!inp.value) inp.value = ufficio; });
      }

      // 5. Trova e prepara il bottone submit
      let btn = document.querySelector(submitSel);
      if (!btn) {
        const forms = document.querySelectorAll('form[id*="Ricerca"], form[name*="Ricerca"]');
        for (const form of forms) { btn = form.querySelector('input[type="submit"]'); if (btn) break; }
      }
      if (btn) { btn.scrollIntoView(); return true; }
      return false;
    }, {
      fromSel: config.dateFromSelector,
      toSel: config.dateToSelector,
      fromVal: dates.from,
      toVal: dates.to,
      statusSel: config.statusSelector || null,
      requested: requestedState,
      tipoEsame: requestedTipoEsame,
      ufficio: codUfficio,
      submitSel: config.submitSelector,
    });

    if (!formReady) {
      throw new Error(`submit button non trovato: ${config.submitSelector}`);
    }

    // Click submit — usa selettore diretto o fallback
    const directBtn = await page.$(config.submitSelector);
    const clickSelector = directBtn ? config.submitSelector : 'form[id*="Ricerca"] input[type="submit"], form[name*="Ricerca"] input[type="submit"]';
    await Promise.allSettled([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
      page.click(clickSelector),
    ]);

    // Dopo submit: attendi che la tabella risultati appaia nel DOM
    if (skipLogin) {
      // Con sessione persistente il portale risponde veloce — waitForSelector è più rapido di sleep
      await page.waitForSelector('#listTable, table.table, table[id*="list"]', { timeout: 12000 }).catch(() => null);
    } else {
      await sleep(1500);
    }

    // Handle PIN e dispatcher — solo se necessario (raro con sessione persistente)
    const hasPin = await page.$('input[name="loginView.pin"], input[name="pin"]');
    if (hasPin) {
      await handlePinIfPresent(page, pin);
      await sleep(200);
    }
    for (let dispRetry = 0; dispRetry < 3; dispRetry++) {
      const hasPostForm = await page.$('form[name="postform"]');
      if (!hasPostForm) break;
      await Promise.allSettled([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }),
        page.$eval('form[name="postform"]', (form) => form.submit()),
      ]);
      await sleep(100);
    }

    const resultHtml = await page.content();
    pushDiag(trace, "browser.generic.done", {
      tabType,
      url: page.url(),
      htmlLength: resultHtml.length,
      title: await page.title().catch(() => ""),
    });

    // Salva HTML per diagnostica
    try {
      const dumpDir = path.resolve(__dirname, "../../diagnostica-dump");
      if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });
      fs.writeFileSync(path.join(dumpDir, `browser-${tabType.toLowerCase()}.html`), resultHtml || "", "utf8");
    } catch (_) {}

    // Salva il tipo tab per il fast path della prossima richiesta
    if (isPersistent) persistentLastTabType = tabType;

    return resultHtml;
  } finally {
    if (!isPersistent) {
      await browser.close();
    }
    releaseLock();
  }
}

/**
 * readPortalPageViaBrowser — Apre una URL generica del portale via Puppeteer
 * (con login + handle PIN + dispatcher) e ritorna l'HTML della pagina.
 *
 * Utile per pagine che NON sono form di ricerca ma viste statiche (es:
 * credito residuo PagoPA, rinnovo gestione, stampa elenco, ecc.).
 *
 * @param {string} pageUrl  URL relativa (es. "/sistema-pagamenti/creditoResiduo/Read_initAction.action")
 * @param {object} options  { username, password, pin, trace }
 * @returns {Promise<string>} HTML della pagina
 */
async function readPortalPageViaBrowser(pageUrl, options = {}) {
  const username = options.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME;
  const password = options.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD;
  const pin = options.pin || process.env.PORTAL_PIN;
  const trace = Array.isArray(options.trace) ? options.trace : null;

  if (!username || !password) {
    throw new Error("PORTAL_USER/PORTAL_PASS mancanti nel .env");
  }
  if (!pageUrl || typeof pageUrl !== "string") {
    throw new Error("pageUrl obbligatoria (es. /sistema-pagamenti/...)");
  }

  const PORTAL_BASE = "https://www.ilportaledellautomobilista.it";
  const fullUrl = pageUrl.startsWith("http") ? pageUrl : `${PORTAL_BASE}${pageUrl}`;

  pushDiag(trace, "browser.page.start", { fullUrl });

  const { browser, page, isPersistent, releaseLock } = await getBrowserAndPageForSession(username, password, pin, trace);

  try {
    // --- LOGIN (skip se browser persistente gia' loggato) ---
    let skipLogin = false;
    if (isPersistent && persistentLastLoginAt > 0) {
      try {
        const currentUrl = await page.url();
        if (currentUrl.includes("/prenotazione") || currentUrl.includes("/portale-automobilista") || currentUrl.includes("/web/") || currentUrl.includes("/sistema-pagamenti") || currentUrl.includes("/RichiestaPatenti")) {
          skipLogin = true;
          pushDiag(trace, "browser.page.login.skip", { url: currentUrl });
        }
      } catch { skipLogin = false; }
    }

    if (!skipLogin) {
      await page.goto(`${PORTAL_BASE}/SSO/SSOLogin/Login_initAction.action`, { waitUntil: "domcontentloaded" });

      const userSel = await waitFirstSelector(page, [
        'input[name="loginView.beanUtente.userName"]', 'input[name="username"]', 'input[type="text"]',
      ], 8000).catch(() => null);
      const passSel = await waitFirstSelector(page, [
        'input[name="loginView.beanUtente.password"]', 'input[name="password"]', 'input[type="password"]',
      ], 8000).catch(() => null);

      if (userSel && passSel) {
        await page.click(userSel, { clickCount: 3 });
        await page.type(userSel, username, { delay: 15 });
        await page.click(passSel, { clickCount: 3 });
        await page.type(passSel, password, { delay: 15 });

        const loginBtnSel = 'input[name="action:Login_executeLogin"], input[type="submit"], button[type="submit"]';
        await Promise.allSettled([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
          page.click(loginBtnSel),
        ]);

        pushDiag(trace, "browser.page.login.done", { url: page.url() });
        await handlePinIfPresent(page, pin);
        if (isPersistent) persistentLastLoginAt = Date.now();
      }
    }

    // --- NAVIGATE ---
    await page.goto(fullUrl, { waitUntil: "domcontentloaded" });

    if (!skipLogin) await sleep(800);

    // Handle dispatcher / PIN
    for (let i = 0; i < 6; i++) {
      const hasPin = await page.$('input[name="loginView.pin"], input[name="pin"]');
      if (hasPin) { await handlePinIfPresent(page, pin); await sleep(200); continue; }

      const postForm = await page.$('form[name="postform"]');
      if (postForm) {
        await Promise.allSettled([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
          page.$eval('form[name="postform"]', (form) => form.submit()),
        ]);
        await sleep(150);
        continue;
      }

      break;
    }

    await sleep(skipLogin ? 300 : 800);

    const resultHtml = await page.content();
    pushDiag(trace, "browser.page.done", {
      url: page.url(),
      htmlLength: resultHtml.length,
      title: await page.title().catch(() => ""),
    });

    // Salva per diagnostica
    try {
      const dumpDir = path.resolve(__dirname, "../../diagnostica-dump");
      if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });
      const safeName = pageUrl.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 80);
      fs.writeFileSync(path.join(dumpDir, `page-${safeName}.html`), resultHtml || "", "utf8");
    } catch (_) {}

    return resultHtml;
  } finally {
    if (!isPersistent) {
      await browser.close();
    }
    releaseLock();
  }
}

/**
 * submitPortalFormViaBrowser — Apre una pagina del portale, compila i campi
 * indicati in `formData` e clicca il bottone submit identificato da `actionName`.
 * Ritorna l'HTML della pagina risultante dopo la submit.
 *
 * @param {string} pageUrl  URL relativa della pagina del portale (es. "/RichiestaPatenti/...")
 * @param {Object} formData  Mappa { fieldName: value } per i campi del form (input/select/textarea)
 * @param {string} actionName  Name dell'input submit da cliccare (es. "action:Read..._pagingAcq...")
 * @param {Object} options  { username, password, pin, trace }
 * @returns {Promise<string>} HTML della pagina risultante
 */
async function submitPortalFormViaBrowser(pageUrl, formData = {}, actionName = "", options = {}) {
  const username = options.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME;
  const password = options.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD;
  const pin = options.pin || process.env.PORTAL_PIN;
  const trace = Array.isArray(options.trace) ? options.trace : null;

  if (!username || !password) {
    throw new Error("PORTAL_USER/PORTAL_PASS mancanti nel .env");
  }
  if (!pageUrl || typeof pageUrl !== "string") {
    throw new Error("pageUrl obbligatoria");
  }

  const PORTAL_BASE = "https://www.ilportaledellautomobilista.it";
  const fullUrl = pageUrl.startsWith("http") ? pageUrl : `${PORTAL_BASE}${pageUrl}`;

  pushDiag(trace, "browser.formSubmit.start", { fullUrl, actionName, fields: Object.keys(formData || {}) });

  const { browser, page, isPersistent, releaseLock } = await getBrowserAndPageForSession(username, password, pin, trace);

  try {
    // --- LOGIN (skip se browser persistente gia' loggato) ---
    let skipLogin = false;
    if (isPersistent && persistentLastLoginAt > 0) {
      try {
        const currentUrl = await page.url();
        if (currentUrl.includes("/prenotazione") || currentUrl.includes("/portale-automobilista") || currentUrl.includes("/web/") || currentUrl.includes("/sistema-pagamenti") || currentUrl.includes("/RichiestaPatenti")) {
          skipLogin = true;
          pushDiag(trace, "browser.formSubmit.login.skip", { url: currentUrl });
        }
      } catch { skipLogin = false; }
    }

    if (!skipLogin) {
      await page.goto(`${PORTAL_BASE}/SSO/SSOLogin/Login_initAction.action`, { waitUntil: "domcontentloaded" });

      const userSel = await waitFirstSelector(page, [
        'input[name="loginView.beanUtente.userName"]', 'input[name="username"]', 'input[type="text"]',
      ], 8000).catch(() => null);
      const passSel = await waitFirstSelector(page, [
        'input[name="loginView.beanUtente.password"]', 'input[name="password"]', 'input[type="password"]',
      ], 8000).catch(() => null);

      if (userSel && passSel) {
        await page.click(userSel, { clickCount: 3 });
        await page.type(userSel, username, { delay: 15 });
        await page.click(passSel, { clickCount: 3 });
        await page.type(passSel, password, { delay: 15 });

        const loginBtnSel = 'input[name="action:Login_executeLogin"], input[type="submit"], button[type="submit"]';
        await Promise.allSettled([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
          page.click(loginBtnSel),
        ]);

        pushDiag(trace, "browser.formSubmit.login.done", { url: page.url() });
        await handlePinIfPresent(page, pin);
        if (isPersistent) persistentLastLoginAt = Date.now();
      }
    }

    // --- NAVIGATE alla pagina del form ---
    await page.goto(fullUrl, { waitUntil: "domcontentloaded" });
    if (!skipLogin) await sleep(800);

    // Handle dispatcher / PIN sulla pagina target
    for (let i = 0; i < 6; i++) {
      const hasPin = await page.$('input[name="loginView.pin"], input[name="pin"]');
      if (hasPin) { await handlePinIfPresent(page, pin); await sleep(200); continue; }

      const postForm = await page.$('form[name="postform"]');
      if (postForm) {
        await Promise.allSettled([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
          page.$eval('form[name="postform"]', (form) => form.submit()),
        ]);
        await sleep(150);
        continue;
      }

      break;
    }

    await sleep(skipLogin ? 300 : 600);

    // --- COMPILA I CAMPI DEL FORM ---
    const fillResult = await page.evaluate((data) => {
      const filled = [];
      const skipped = [];
      for (const [name, value] of Object.entries(data || {})) {
        // Cerca input/select/textarea con questo name (o id come fallback)
        const escName = (window.CSS && CSS.escape) ? CSS.escape(name) : name.replace(/(["\\])/g, "\\$1");
        let el = document.querySelector(`[name="${escName}"]`);
        if (!el) el = document.getElementById(name);
        if (!el) { skipped.push({ name, reason: "not_found" }); continue; }

        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute("type") || "").toLowerCase();

        try {
          if (tag === "select") {
            el.value = value == null ? "" : String(value);
            el.dispatchEvent(new Event("change", { bubbles: true }));
            filled.push({ name, type: "select", value });
          } else if (type === "checkbox" || type === "radio") {
            el.checked = !!value;
            el.dispatchEvent(new Event("change", { bubbles: true }));
            filled.push({ name, type, value: !!value });
          } else if (tag === "textarea" || (tag === "input" && type !== "submit" && type !== "button")) {
            el.value = value == null ? "" : String(value);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            filled.push({ name, type: type || tag, value });
          } else {
            skipped.push({ name, reason: `unsupported_${tag}_${type}` });
          }
        } catch (err) {
          skipped.push({ name, reason: `error: ${err.message}` });
        }
      }
      return { filled, skipped };
    }, formData || {});

    pushDiag(trace, "browser.formSubmit.fill", fillResult);

    // --- CLICCA IL BOTTONE SUBMIT ---
    if (actionName) {
      const escAction = actionName.replace(/(["\\])/g, "\\$1");
      const selector = `input[name="${escAction}"], button[name="${escAction}"]`;
      const btn = await page.$(selector);
      if (!btn) {
        throw new Error(`Bottone submit non trovato per action="${actionName}"`);
      }
      await Promise.allSettled([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
        page.click(selector),
      ]);
      pushDiag(trace, "browser.formSubmit.click.done", { actionName, url: page.url() });
    } else {
      // Fallback: submit del primo form trovato
      const formExists = await page.$("form");
      if (formExists) {
        await Promise.allSettled([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
          page.$eval("form", (form) => form.submit()),
        ]);
        pushDiag(trace, "browser.formSubmit.formSubmit.done", { url: page.url() });
      }
    }

    // Handle dispatcher post-submit
    for (let i = 0; i < 4; i++) {
      const postForm = await page.$('form[name="postform"]');
      if (postForm) {
        await Promise.allSettled([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
          page.$eval('form[name="postform"]', (form) => form.submit()),
        ]);
        await sleep(150);
        continue;
      }
      break;
    }

    await sleep(400);

    const resultHtml = await page.content();
    pushDiag(trace, "browser.formSubmit.done", {
      url: page.url(),
      htmlLength: resultHtml.length,
      title: await page.title().catch(() => ""),
      filledCount: fillResult.filled.length,
      skippedCount: fillResult.skipped.length,
    });

    // Salva per diagnostica
    try {
      const dumpDir = path.resolve(__dirname, "../../diagnostica-dump");
      if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });
      const safeName = pageUrl.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 60);
      const safeAction = String(actionName || "submit").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 40);
      fs.writeFileSync(path.join(dumpDir, `formSubmit-${safeName}-${safeAction}.html`), resultHtml || "", "utf8");
    } catch (_) {}

    return { html: resultHtml, fillResult };
  } finally {
    if (!isPersistent) {
      await browser.close();
    }
    releaseLock();
  }
}

/**
 * readSessioneDettaglioViaBrowser – Apre il portale via Puppeteer, fa la ricerca sessioni,
 * seleziona il radio button corrispondente a sessionIndex, clicca DETTAGLIO,
 * e parsa la pagina dettaglio restituendo campi + turni.
 *
 * @param {Object} options
 * @param {number} options.sessionIndex  - indice riga da selezionare (0-based)
 * @param {string} [options.dataDa]      - data inizio ricerca dd/mm/yyyy
 * @param {string} [options.dataA]       - data fine ricerca dd/mm/yyyy
 * @param {string} [options.stato]       - filtro stato (es. "A|" per APERTA)
 * @param {string} [options.tipoEsame]   - "SQI" | "SGOS" etc.
 * @param {string} [options.username]
 * @param {string} [options.password]
 * @param {string} [options.pin]
 * @param {Array}  [options.trace]
 * @returns {Object} { success, campi, turni, campiNoti, pageTitle, trace }
 */
async function readSessioneDettaglioViaBrowser(options = {}) {
  const username = options.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME;
  const password = options.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD;
  const pin = options.pin || process.env.PORTAL_PIN;
  const trace = Array.isArray(options.trace) ? options.trace : [];

  if (!username || !password) {
    throw new Error("PORTAL_USER/PORTAL_PASS mancanti nel .env");
  }

  const sessionIndex = Number.isFinite(Number(options.sessionIndex)) ? Number(options.sessionIndex) : 0;

  // Date di ricerca: usa quelle passate o default a oggi + 30 giorni
  const today = new Date();
  const toDate = new Date(today);
  toDate.setDate(toDate.getDate() + 30);
  const fromDateValue = options.dataDa || formatDateDDMMYYYY(today);
  const toDateValue = options.dataA || formatDateDDMMYYYY(toDate);

  const statoFilter = options.stato || "A|";

  const { browser, page, isPersistent, releaseLock } = await getBrowserAndPageForSession(username, password, pin, trace);

  try {
    page.setDefaultTimeout(45000);

    // ---- 1. LOGIN (skip se sessione persistente attiva) ----
    let skipLogin = false;
    if (isPersistent && persistentLastLoginAt > 0) {
      try {
        const currentUrl = await page.url();
        if (currentUrl.includes("/prenotazione") || currentUrl.includes("/portale-automobilista") || currentUrl.includes("/web/")) {
          skipLogin = true;
        }
      } catch { skipLogin = false; }
    }

    if (!skipLogin) {
    await page.goto("https://www.ilportaledellautomobilista.it/SSO/SSOLogin/Login_initAction.action", {
      waitUntil: "domcontentloaded",
    });

    const userSel = await waitFirstSelector(page, [
      'input[name="loginView.beanUtente.userName"]',
      'input[name="loginView.username"]',
      'input[name="username"]',
      'input[id*="user" i]',
      'input[type="text"]',
    ], 8000).catch(() => null);

    const passSel = await waitFirstSelector(page, [
      'input[name="loginView.beanUtente.password"]',
      'input[name="loginView.password"]',
      'input[name="password"]',
      'input[id*="pass" i]',
      'input[type="password"]',
    ], 8000).catch(() => null);

    if (userSel && passSel) {
      const loginBtnSel = 'input[name="action:Login_executeLogin"], button[name="action:Login_executeLogin"], input[type="submit"], button[type="submit"]';
      await page.click(userSel, { clickCount: 3 });
      await page.type(userSel, username, { delay: 15 });
      await page.click(passSel, { clickCount: 3 });
      await page.type(passSel, password, { delay: 15 });

      await Promise.allSettled([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
        page.click(loginBtnSel),
      ]);
      pushDiag(trace, "dettaglio.login.done", { url: page.url() });
      await handlePinIfPresent(page, pin);
      pushDiag(trace, "dettaglio.pin.done", { url: page.url() });
    }
    if (isPersistent) persistentLastLoginAt = Date.now();
    } // fine if (!skipLogin)

    // ---- 2. NAVIGA A PAGINA RICERCA SESSIONI ----
    const searchUrl = "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH";
    const searchFormSelector = 'form#RicercaDisponibilitaSessioneEsameEP, form[name="RicercaDisponibilitaSessioneEsameEP"], form[name="RicercaDisponibilitaSessioneEsame"]';

    let preparedSearchForm = false;
    for (let attempt = 0; attempt < 5 && !preparedSearchForm; attempt++) {
      try {
        await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
        await sleep(1200);

        for (let i = 0; i < 10; i++) {
          await sleep(250);
          const hasForm = await page.$(searchFormSelector);
          if (hasForm) break;

          const hasPin = await page.$('input[name="loginView.pin"], input[name="pin"], input[id*="pin" i]');
          if (hasPin) {
            await handlePinIfPresent(page, pin);
            await sleep(400);
            continue;
          }

          const postForm = await page.$('form[name="postform"]');
          if (postForm) {
            await Promise.allSettled([
              page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
              page.$eval('form[name="postform"]', (form) => form.submit()),
            ]);
            await sleep(400);
          }
        }

        await page.waitForSelector(searchFormSelector, { timeout: 20000 });
        await sleep(300);

        // Imposta stato
        await page.$eval(
          `${searchFormSelector} select[name*="theStatoDisponibilitaSessioneEsameEP.selectRowId"]`,
          (select, sv) => {
            const hasVal = Array.from(select.options || []).some((o) => o.value === sv);
            if (hasVal) {
              select.value = sv;
              select.dispatchEvent(new Event("change", { bubbles: true }));
            }
          },
          statoFilter,
        ).catch(() => null);

        // Imposta date
        const fromSelector = `${searchFormSelector} input[name*="EPFrom.dataDisponibiltaEsaminatore"]`;
        const toSelector = `${searchFormSelector} input[name*="EPTo.dataDisponibiltaEsaminatore"]`;
        await page.evaluate((fSel, tSel, fVal, tVal) => {
          const fEl = document.querySelector(fSel);
          if (fEl) { fEl.value = fVal; fEl.dispatchEvent(new Event("change", { bubbles: true })); }
          const tEl = document.querySelector(tSel);
          if (tEl) { tEl.value = tVal; tEl.dispatchEvent(new Event("change", { bubbles: true })); }
        }, fromSelector, toSelector, fromDateValue, toDateValue);

        preparedSearchForm = true;
      } catch (err) {
        if (!/execution context was destroyed/i.test(err?.message || "")) throw err;
      }
    }

    if (!preparedSearchForm) throw new Error("Impossibile preparare il form di ricerca sessioni");

    // ---- 3. SUBMIT RICERCA ----
    const searchSubmit = await page.evaluate(async ({ searchFormSelector, fromDate, toDate, statoFilter }) => {
      const form = document.querySelector(searchFormSelector);
      if (!form) return { error: "search-form-not-found" };

      const formData = new FormData(form);
      const keys = Array.from(formData.keys());
      const findKey = (needle) => keys.find((k) => String(k || "").includes(needle)) || "";

      const fromKey = findKey("EPFrom.dataDisponibiltaEsaminatore");
      const toKey = findKey("EPTo.dataDisponibiltaEsaminatore");
      const statusKey = findKey("theStatoDisponibilitaSessioneEsameEP.selectRowId");
      if (fromKey) formData.set(fromKey, fromDate);
      if (toKey) formData.set(toKey, toDate);
      if (statusKey) formData.set(statusKey, statoFilter);

      formData.delete("action:Read_clearSearch");
      formData.set("action:Read_paging", "Ricerca");

      const body = new URLSearchParams();
      for (const [key, value] of formData.entries()) {
        body.append(String(key || ""), typeof value === "string" ? value : String(value || ""));
      }

      const action = String(form.getAttribute("action") || "").trim() || window.location.href;
      const submitUrl = new URL(action, window.location.href).toString();
      const response = await fetch(submitUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        credentials: "include",
      });

      return {
        status: response.status,
        url: response.url || submitUrl,
        html: await response.text(),
      };
    }, { searchFormSelector, fromDate: fromDateValue, toDate: toDateValue, statoFilter });

    if (searchSubmit?.error) throw new Error(String(searchSubmit.error));

    await page.setContent(String(searchSubmit?.html || ""), { waitUntil: "domcontentloaded" });
    pushDiag(trace, "dettaglio.search.done", { status: searchSubmit?.status, htmlLen: (searchSubmit?.html || "").length });

    // ---- 4. PARSA RIGHE (radio buttons) E SELEZIONA LA RIGA ----
    const sessions = await page.evaluate(() => {
      const readText = (node) => String(node?.textContent || "").replace(/\s+/g, " ").trim();
      const rows = Array.from(document.querySelectorAll("tr"));
      const found = [];
      rows.forEach((row) => {
        const radio = row.querySelector('input[type="radio"][name*="selectRowId" i]');
        if (!radio) return;
        const cells = Array.from(row.querySelectorAll("td")).map(readText);
        found.push({
          radioName: String(radio.getAttribute("name") || ""),
          radioValue: String(radio.value || ""),
          cells,
        });
      });
      return found;
    });

    if (!sessions.length) {
      throw new Error(`Nessuna sessione trovata nella ricerca (${fromDateValue} – ${toDateValue})`);
    }

    const idx = Math.max(0, Math.min(sessionIndex, sessions.length - 1));
    const selected = sessions[idx];
    pushDiag(trace, "dettaglio.session.selected", { idx, total: sessions.length, radioValue: selected.radioValue });

    // ---- 5. CLICK DETTAGLIO (via fetch nel browser, come runManualSessionFlowViaBrowser) ----
    const detailSubmit = await page.evaluate(async ({ radioName, radioValue }) => {
      const forms = Array.from(document.querySelectorAll("form"));
      const targetForm = forms.find((form) => {
        const hasRadio = form.querySelector(`input[type="radio"][name="${CSS.escape(radioName)}"]`);
        const detailButton = Array.from(form.querySelectorAll("input[type='submit'],button")).find((el) =>
          /dettaglio/i.test(String(el.value || el.textContent || "")) ||
          String(el.name || "").toLowerCase().includes("action:select_listcandidati")
        );
        return !!hasRadio && !!detailButton;
      }) || forms.find((form) =>
        !!Array.from(form.querySelectorAll("input[type='submit'],button")).find((el) =>
          /dettaglio/i.test(String(el.value || el.textContent || "")) ||
          String(el.name || "").toLowerCase().includes("action:select_listcandidati")
        )
      );

      if (!targetForm) return { error: "detail-form-not-found" };

      const fd = new FormData(targetForm);
      if (radioName) fd.set(radioName, radioValue || "");
      fd.delete("action:Read_paging");
      fd.delete("action:Read_clearSearch");
      fd.set("action:Select_listCandidati", "Dettaglio");

      const body = new URLSearchParams();
      for (const [key, value] of fd.entries()) {
        body.append(String(key || ""), typeof value === "string" ? value : String(value || ""));
      }

      const action = String(targetForm.getAttribute("action") || "").trim() || window.location.href;
      const url = new URL(action, window.location.href).toString();
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        credentials: "include",
      });

      return {
        status: response.status,
        url: response.url || url,
        html: await response.text(),
      };
    }, { radioName: selected.radioName, radioValue: selected.radioValue });

    if (detailSubmit?.error) throw new Error(String(detailSubmit.error));

    pushDiag(trace, "dettaglio.detail.fetched", { status: detailSubmit?.status, htmlLen: (detailSubmit?.html || "").length });

    // ---- 6. PARSA PAGINA DETTAGLIO ----
    await page.setContent(String(detailSubmit?.html || ""), { waitUntil: "domcontentloaded" });

    const detailData = await page.evaluate(() => {
      const readText = (node) => String(node?.textContent || "").replace(/\s+/g, " ").trim();

      // A) Estrai coppie label→valore da tabelle strutturate (tipico del portale Struts2)
      const campi = {};
      const tables = Array.from(document.querySelectorAll("table"));
      tables.forEach((table) => {
        Array.from(table.querySelectorAll("tr")).forEach((tr) => {
          const tds = Array.from(tr.querySelectorAll("td, th"));
          // Struttura tipica: [label-td, value-td, label-td, value-td, ...]
          for (let i = 0; i < tds.length - 1; i++) {
            const labelEl = tds[i];
            const valueEl = tds[i + 1];
            const labelText = readText(labelEl).replace(/:?\s*$/, "");
            if (!labelText || labelText.length > 80) continue;

            // Il valore è in un input/select o nel testo del td
            const input = valueEl.querySelector("input, select");
            let valueText = "";
            if (input) {
              if (input.tagName === "SELECT") {
                const opt = input.querySelector("option[selected]") || input.querySelector("option:checked");
                valueText = opt ? readText(opt) : String(input.value || "");
              } else {
                valueText = String(input.value || "").trim();
              }
            }
            if (!valueText) valueText = readText(valueEl);

            // Evita di sovrascrivere con valori vuoti e evita label troppo generiche
            if (valueText && !labelText.match(/^([\s\d]+)$/) && labelText !== valueText) {
              campi[labelText] = valueText;
              i++; // salta il value-td
            }
          }
        });
      });

      // B) Cerca anche input hidden/text con label associata
      Array.from(document.querySelectorAll("input[type='text'], input[type='hidden'], input:not([type])")).forEach((input) => {
        const name = String(input.getAttribute("name") || "").trim();
        const val = String(input.value || "").trim();
        if (!name || !val) return;
        const label = document.querySelector(`label[for='${CSS.escape(input.id || "")}']`);
        const labelText = label ? readText(label).replace(/:?\s*$/, "") : "";
        if (labelText && !campi[labelText]) campi[labelText] = val;
      });

      // C) + D) Parsa tabelle turni e candidati
      // IMPORTANTE: il portale Struts2 usa spesso tabelle wrapper annidate.
      // querySelectorAll("thead th") su una tabella wrapper troverebbe header
      // delle tabelle interne, mescolando tutto. Processiamo SOLO tabelle "foglia"
      // (senza tabelle annidate) per evitare duplicazioni.
      const turni = [];
      const candidati = [];

      // Filtra solo tabelle foglia (senza sotto-tabelle)
      const leafTables = tables.filter(t => !t.querySelector("table"));

      // Helper: estrai header di una tabella in modo sicuro
      function getTableHeaders(table) {
        const headers = [];
        // Prima prova thead (solo figli diretti del table, non di sotto-tabelle)
        const thead = table.querySelector(":scope > thead");
        if (thead) {
          thead.querySelectorAll("th, td").forEach((th) => headers.push(readText(th)));
        }
        // Fallback: prima riga se non c'è thead
        if (!headers.length) {
          const firstRow = table.querySelector(":scope > thead > tr, :scope > tbody > tr, :scope > tr");
          if (firstRow) {
            firstRow.querySelectorAll(":scope > th, :scope > td").forEach((cell) => {
              const t = readText(cell);
              if (t) headers.push(t);
            });
          }
        }
        return headers;
      }

      // Helper: estrai body rows (solo figli diretti)
      function getTableBodyRows(table, minCells) {
        const tbody = table.querySelector(":scope > tbody");
        const rowContainer = tbody || table;
        return Array.from(rowContainer.querySelectorAll(":scope > tr")).filter((tr) => {
          return tr.querySelectorAll(":scope > td").length >= minCells;
        });
      }

      const candidatiTableSet = new Set();

      // Prima passata: identifica tabelle candidati
      leafTables.forEach((table, tableIdx) => {
        const headers = getTableHeaders(table);
        // Colonne ESCLUSIVE candidati: Cognome, Patente, Marca Operativa
        // NON "Num. Domande" che appare anche nella tabella turni!
        const isCandidati = headers.some((h) => /cognome|patente|marca.operativa/i.test(h));
        if (!isCandidati || headers.length < 4) return;

        candidatiTableSet.add(tableIdx);
        const hasThead = !!table.querySelector(":scope > thead");
        const bodyRows = getTableBodyRows(table, 4);
        const startIdx = hasThead ? 0 : 1;
        bodyRows.slice(startIdx).forEach((tr) => {
          const cells = Array.from(tr.querySelectorAll(":scope > td")).map(readText);
          if (cells.length < 4) return;
          const cand = {};
          headers.forEach((h, i) => { if (h && cells[i] !== undefined) cand[h] = cells[i] || ""; });
          const radio = tr.querySelector('input[type="radio"]');
          if (radio) {
            cand._radioName = String(radio.getAttribute("name") || "");
            cand._radioValue = String(radio.value || "");
          }
          candidati.push(cand);
        });
      });

      // Seconda passata: tabelle turni (ESCLUSE candidati)
      leafTables.forEach((table, tableIdx) => {
        if (candidatiTableSet.has(tableIdx)) return;
        const headers = getTableHeaders(table);
        // Colonne ESCLUSIVE turni: "Orario*Turno", "Minuti turno", "Categorie Ammesse", "Cod. Tipo Seduta"
        // NON solo "Turno" o "Esaminatore" che appaiono anche nei candidati!
        const isTurni = headers.some((h) => /orario.*turno|minuti.*turno|categori.*ammesse|cod.*tipo.*seduta/i.test(h));
        if (!isTurni || headers.length < 3) return;

        const hasThead = !!table.querySelector(":scope > thead");
        const bodyRows = getTableBodyRows(table, 3);
        const startIdx = hasThead ? 0 : 1;
        bodyRows.slice(startIdx).forEach((tr) => {
          const cells = Array.from(tr.querySelectorAll(":scope > td")).map(readText);
          if (cells.length < 3) return;
          const turno = {};
          headers.forEach((h, i) => { turno[h] = cells[i] || ""; });
          const radio = tr.querySelector('input[type="radio"]');
          if (radio) {
            turno._radioName = String(radio.getAttribute("name") || "");
            turno._radioValue = String(radio.value || "");
          }
          turni.push(turno);
        });
      });

      // E) Messaggi di errore
      const messages = [];
      document.querySelectorAll(".errorMessage, .error, .alert-danger, .alert-error, #errorMessages, .alert-warning").forEach((el) => {
        const t = readText(el);
        if (t) messages.push(t.slice(0, 300));
      });

      // Debug: info struttura tabelle per diagnostica
      const _tableDebug = {
        totalTables: tables.length,
        leafTables: leafTables.length,
        turniCount: turni.length,
        candidatiCount: candidati.length,
        leafTableHeaders: leafTables.map(t => getTableHeaders(t).join(" | ")),
      };

      return {
        campi,
        turni,
        candidati,
        messages,
        _tableDebug,
        pageTitle: readText(document.querySelector("title")),
        htmlLength: (document.body?.innerHTML || "").length,
      };
    });

    // Salva HTML per diagnostica
    try {
      const dumpDir = path.resolve(__dirname, "../../diagnostica-dump");
      if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });
      fs.writeFileSync(path.join(dumpDir, "dettaglio-sessione.html"), detailSubmit?.html || "", "utf8");
    } catch (_) {}

    // Mappa campi noti
    const CAMPI_NOTI = [
      "Tipo Esame", "Ufficio Prov.", "Data Sess.", "Data Limite Pren.",
      "Fascia Oraria", "Località", "Aula", "Capienza Aula",
      "Num. Esaminatori", "Num. Turni", "Tipo Seduta", "Num. Domande",
      "Gruppo", "Autoscuola", "Orario Inizio Primo Turno",
      "Num. posti riservati U.P. per turno",
      "Num. max posti Autoscuola per sessione",
      "Num. max posti Autoscuola per turno",
      "Giorni limite prenotazione", "Indicatore Conto",
    ];

    const campiNoti = {};
    const allCampi = detailData?.campi || {};
    CAMPI_NOTI.forEach((nome) => {
      // Cerca esatta o parziale
      const val = allCampi[nome] || Object.entries(allCampi).find(([k]) => k.toLowerCase().includes(nome.toLowerCase()))?.[1] || "";
      if (val) campiNoti[nome] = val;
    });

    // ── Salva stato dettaglio per la fast-path della stampa ──
    // Dopo setContent(detailHtml) la pagina ha il form Select_listCandidati nel DOM,
    // ma page.url() resta sull'URL della ricerca. Memorizziamo i parametri usati per
    // consentire a readStampaPortaleViaBrowser di skippare login+ricerca+selezione+dettaglio
    // riutilizzando direttamente il DOM caricato.
    if (isPersistent) {
      persistentDetailUsername = username;
      persistentDetailSessionIndex = idx;
      persistentDetailSearchKey = `${fromDateValue}|${toDateValue}|${statoFilter}`;
      persistentDetailHtml = String(detailSubmit?.html || "");
      persistentDetailLoadedAt = Date.now();
      pushDiag(trace, "dettaglio.cache.saved", {
        sessionIndex: idx,
        searchKey: persistentDetailSearchKey,
        htmlLen: persistentDetailHtml.length,
      });
    }

    return {
      success: true,
      sessionIndex: idx,
      campi: allCampi,
      turni: detailData?.turni || [],
      candidati: detailData?.candidati || [],
      campiNoti,
      pageTitle: detailData?.pageTitle || "",
      messages: detailData?.messages || [],
      trace,
    };
  } finally {
    if (!isPersistent) {
      await browser.close();
    }
    releaseLock();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// readStoriaViaBrowser – Naviga al Dettaglio Storico Candidato via Puppeteer
// Stessa pipeline di readSessioneDettaglioViaBrowser, con passo extra "Storia"
// ═══════════════════════════════════════════════════════════════════════════════
async function readStoriaViaBrowser(options = {}) {
  const username = options.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME;
  const password = options.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD;
  const pin = options.pin || process.env.PORTAL_PIN;
  const trace = Array.isArray(options.trace) ? options.trace : [];

  if (!username || !password) throw new Error("PORTAL_USER/PORTAL_PASS mancanti");

  const sessionIndex = Number.isFinite(Number(options.sessionIndex)) ? Number(options.sessionIndex) : 0;
  const candidateMarca = String(options.marcaOperativa || "").trim();
  const candidateCognome = String(options.cognome || "").trim();
  const candidateIndex = Number.isFinite(Number(options.candidateIndex)) ? Number(options.candidateIndex) : -1;

  const today = new Date();
  const toDate = new Date(today); toDate.setDate(toDate.getDate() + 30);
  const fromDateValue = options.dataDa || formatDateDDMMYYYY(today);
  const toDateValue = options.dataA || formatDateDDMMYYYY(toDate);
  const statoFilter = options.stato || "A|";

  const { browser, page, isPersistent, releaseLock } = await getBrowserAndPageForSession(username, password, pin, trace);

  try {
    page.setDefaultTimeout(45000);

    pushDiag(trace, "storia.browser.start", { sessionIndex, candidateMarca, candidateCognome });

    // ── 1. LOGIN (skip se sessione persistente attiva) ──
    let skipLogin = false;
    if (isPersistent && persistentLastLoginAt > 0) {
      try {
        const currentUrl = await page.url();
        if (currentUrl.includes("/prenotazione") || currentUrl.includes("/portale-automobilista") || currentUrl.includes("/web/")) {
          skipLogin = true;
        }
      } catch { skipLogin = false; }
    }

    if (!skipLogin) {
    await page.goto("https://www.ilportaledellautomobilista.it/SSO/SSOLogin/Login_initAction.action", { waitUntil: "domcontentloaded" });

    const userSel = await waitFirstSelector(page, [
      'input[name="loginView.beanUtente.userName"]',
      'input[name="loginView.username"]',
      'input[name="username"]',
      'input[id*="user" i]',
      'input[type="text"]',
    ], 8000).catch(() => null);

    const passSel = await waitFirstSelector(page, [
      'input[name="loginView.beanUtente.password"]',
      'input[name="loginView.password"]',
      'input[name="password"]',
      'input[id*="pass" i]',
      'input[type="password"]',
    ], 8000).catch(() => null);

    if (userSel && passSel) {
      const loginBtnSel = 'input[name="action:Login_executeLogin"], button[name="action:Login_executeLogin"], input[type="submit"], button[type="submit"]';
      await page.click(userSel, { clickCount: 3 });
      await page.type(userSel, username, { delay: 15 });
      await page.click(passSel, { clickCount: 3 });
      await page.type(passSel, password, { delay: 15 });

      await Promise.allSettled([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
        page.click(loginBtnSel),
      ]);
      pushDiag(trace, "storia.login.done", { url: page.url() });
      if (typeof handlePinIfPresent === "function") await handlePinIfPresent(page, pin);
      pushDiag(trace, "storia.pin.done", { url: page.url() });
    } else {
      pushDiag(trace, "storia.login.skipped", { url: page.url() });
    }
    if (isPersistent) persistentLastLoginAt = Date.now();
    } // fine if (!skipLogin)

    // ── 2. NAVIGA A SESSIONI QUIZ INTERNE (pattern identico a readSessioneDettaglioViaBrowser) ──
    const searchUrl = "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH";
    const searchFormSelector = 'form#RicercaDisponibilitaSessioneEsameEP, form[name="RicercaDisponibilitaSessioneEsameEP"], form[name="RicercaDisponibilitaSessioneEsame"]';

    let preparedSearchForm = false;
    for (let attempt = 0; attempt < 5 && !preparedSearchForm; attempt++) {
      try {
        await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
        await sleep(1200);

        for (let i = 0; i < 10; i++) {
          await sleep(250);
          const hasForm = await page.$(searchFormSelector);
          if (hasForm) break;

          const hasPin = await page.$('input[name="loginView.pin"], input[name="pin"], input[id*="pin" i]');
          if (hasPin) {
            if (typeof handlePinIfPresent === "function") await handlePinIfPresent(page, pin);
            await sleep(400);
            continue;
          }

          const postForm = await page.$('form[name="postform"]');
          if (postForm) {
            await Promise.allSettled([
              page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
              page.$eval('form[name="postform"]', (form) => form.submit()),
            ]);
            await sleep(400);
          }
        }

        await page.waitForSelector(searchFormSelector, { timeout: 20000 });
        await sleep(300);

        // Imposta stato con selettore specifico del portale
        await page.$eval(
          `${searchFormSelector} select[name*="theStatoDisponibilitaSessioneEsameEP.selectRowId"]`,
          (select, sv) => {
            const hasVal = Array.from(select.options || []).some((o) => o.value === sv);
            if (hasVal) {
              select.value = sv;
              select.dispatchEvent(new Event("change", { bubbles: true }));
            }
          },
          statoFilter,
        ).catch(() => null);

        // Imposta date con selettori specifici del portale
        const fromSelector = `${searchFormSelector} input[name*="EPFrom.dataDisponibiltaEsaminatore"]`;
        const toSelector = `${searchFormSelector} input[name*="EPTo.dataDisponibiltaEsaminatore"]`;
        await page.evaluate((fSel, tSel, fVal, tVal) => {
          const fEl = document.querySelector(fSel);
          if (fEl) { fEl.value = fVal; fEl.dispatchEvent(new Event("change", { bubbles: true })); }
          const tEl = document.querySelector(tSel);
          if (tEl) { tEl.value = tVal; tEl.dispatchEvent(new Event("change", { bubbles: true })); }
        }, fromSelector, toSelector, fromDateValue, toDateValue);

        preparedSearchForm = true;
      } catch (err) {
        if (!/execution context was destroyed/i.test(err?.message || "")) throw err;
      }
    }

    if (!preparedSearchForm) throw new Error("Impossibile preparare il form di ricerca sessioni (storia)");

    // ── 3. SUBMIT RICERCA (con selettori specifici) ──
    const searchSubmit = await page.evaluate(async ({ searchFormSelector, fromDate, toDate, statoFilter }) => {
      const form = document.querySelector(searchFormSelector);
      if (!form) return { error: "search-form-not-found" };

      const formData = new FormData(form);
      const keys = Array.from(formData.keys());
      const findKey = (needle) => keys.find((k) => String(k || "").includes(needle)) || "";

      const fromKey = findKey("EPFrom.dataDisponibiltaEsaminatore");
      const toKey = findKey("EPTo.dataDisponibiltaEsaminatore");
      const statusKey = findKey("theStatoDisponibilitaSessioneEsameEP.selectRowId");
      if (fromKey) formData.set(fromKey, fromDate);
      if (toKey) formData.set(toKey, toDate);
      if (statusKey) formData.set(statusKey, statoFilter);

      formData.delete("action:Read_clearSearch");
      formData.set("action:Read_paging", "Ricerca");

      const body = new URLSearchParams();
      for (const [key, value] of formData.entries()) {
        body.append(String(key || ""), typeof value === "string" ? value : String(value || ""));
      }

      const action = String(form.getAttribute("action") || "").trim() || window.location.href;
      const submitUrl = new URL(action, window.location.href).toString();
      const response = await fetch(submitUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        credentials: "include",
      });

      return {
        status: response.status,
        url: response.url || submitUrl,
        html: await response.text(),
      };
    }, { searchFormSelector, fromDate: fromDateValue, toDate: toDateValue, statoFilter });

    if (searchSubmit?.error) throw new Error(String(searchSubmit.error));
    await page.setContent(String(searchSubmit?.html || ""), { waitUntil: "domcontentloaded" });
    pushDiag(trace, "storia.search.done", { status: searchSubmit?.status, htmlLen: (searchSubmit?.html || "").length });

    // ── 4. SELEZIONA SESSIONE E CLICCA DETTAGLIO ──
    const sessions = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("tr"));
      return rows.map(row => {
        const radio = row.querySelector('input[type="radio"][name*="selectRowId" i]');
        if (!radio) return null;
        return { radioName: radio.getAttribute("name") || "", radioValue: radio.value || "" };
      }).filter(Boolean);
    });
    if (!sessions.length) throw new Error("Nessuna sessione trovata nel portale");

    const selIdx = Math.max(0, Math.min(sessionIndex, sessions.length - 1));
    const selectedSession = sessions[selIdx];

    const detailSubmit = await page.evaluate(async ({ radioName, radioValue }) => {
      const forms = Array.from(document.querySelectorAll("form"));
      const targetForm = forms.find(f => {
        const hasRadio = f.querySelector(`input[type="radio"][name="${CSS.escape(radioName)}"]`);
        const btn = Array.from(f.querySelectorAll("input[type='submit'],button")).find(el =>
          /dettaglio/i.test(String(el.value || el.textContent || "")) || String(el.name || "").toLowerCase().includes("action:select_listcandidati"));
        return !!hasRadio && !!btn;
      }) || forms[0];
      if (!targetForm) return { error: "detail-form-not-found" };

      const fd = new FormData(targetForm);
      fd.set(radioName, radioValue);
      fd.delete("action:Read_paging");
      fd.delete("action:Read_clearSearch");
      fd.set("action:Select_listCandidati", "Dettaglio");

      const body = new URLSearchParams();
      for (const [k, v] of fd.entries()) body.append(k, typeof v === "string" ? v : String(v));
      const action = targetForm.getAttribute("action") || window.location.href;
      const url = new URL(action, window.location.href).toString();
      const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(), credentials: "include" });
      return { status: resp.status, html: await resp.text() };
    }, { radioName: selectedSession.radioName, radioValue: selectedSession.radioValue });

    if (detailSubmit?.error) throw new Error(detailSubmit.error);
    await page.setContent(String(detailSubmit?.html || ""), { waitUntil: "domcontentloaded" });
    pushDiag(trace, "storia.detail.done", { htmlLen: (detailSubmit?.html || "").length });

    // ── 5. TROVA CANDIDATO E CLICCA STORIA ──
    const storiaResult = await page.evaluate(async ({ marca, cognome, candIdx }) => {
      const readText = (n) => String(n?.textContent || "").replace(/\s+/g, " ").trim();

      // Trova radio dei candidati
      const candidateRadios = [];
      document.querySelectorAll("tr").forEach(row => {
        const radio = row.querySelector('input[type="radio"]');
        if (!radio) return;
        const text = readText(row);
        const cells = Array.from(row.querySelectorAll("td")).map(readText);
        candidateRadios.push({ radioName: radio.getAttribute("name") || "", radioValue: radio.value || "", text, cells });
      });

      if (!candidateRadios.length) return { error: "no-candidate-radios", debug: { totalRadios: 0 } };

      // Seleziona candidato: per marca operativa, cognome, o indice
      let selected = candidateRadios[0];
      if (marca) {
        const found = candidateRadios.find(r => r.text.includes(marca));
        if (found) selected = found;
      } else if (cognome && cognome !== "POSTO PRENOTATO") {
        const found = candidateRadios.find(r => r.text.includes(cognome));
        if (found) selected = found;
      }
      if (candIdx >= 0 && candIdx < candidateRadios.length) {
        selected = candidateRadios[candIdx];
      }

      // Trova il form con il pulsante "Storia"
      const forms = Array.from(document.querySelectorAll("form"));
      let targetForm = forms.find(f => {
        const btn = Array.from(f.querySelectorAll("input[type='submit'],button")).find(el => {
          const nameOrVal = String(el.name || el.value || el.textContent || "").toLowerCase();
          return nameOrVal.includes("storia") || nameOrVal.includes("viewstoriaelement");
        });
        return !!btn;
      }) || forms[0];

      if (!targetForm) return { error: "storia-form-not-found" };

      // Trova il nome dell'action del pulsante Storia
      let storiaActionName = "";
      Array.from(targetForm.querySelectorAll("input[type='submit'],button")).forEach(el => {
        const name = String(el.name || "").toLowerCase();
        if (name.includes("storia") || name.includes("viewstoriaelement")) {
          storiaActionName = el.name || el.getAttribute("name") || "";
        }
      });

      const fd = new FormData(targetForm);
      if (selected.radioName) fd.set(selected.radioName, selected.radioValue);

      // Rimuovi azioni conflittuali
      for (const [k] of fd.entries()) {
        if (k.startsWith("action:") && k !== storiaActionName) fd.delete(k);
      }
      // Imposta azione storia
      if (storiaActionName) {
        fd.set(storiaActionName, "Storia");
      } else {
        fd.set("action:SelectCandidato_viewStoriaElementCandidato", "Storia");
      }

      const body = new URLSearchParams();
      for (const [k, v] of fd.entries()) body.append(k, typeof v === "string" ? v : String(v));

      const action = targetForm.getAttribute("action") || window.location.href;
      const url = new URL(action, window.location.href).toString();
      const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(), credentials: "include" });
      const html = await resp.text();

      return {
        status: resp.status,
        html,
        debug: { candidateRadiosCount: candidateRadios.length, selectedRadio: selected.radioValue, storiaActionName, formAction: action }
      };
    }, { marca: candidateMarca, cognome: candidateCognome, candIdx: candidateIndex });

    if (storiaResult?.error) throw new Error(storiaResult.error);
    pushDiag(trace, "storia.fetch.done", { status: storiaResult?.status, htmlLen: (storiaResult?.html || "").length, ...(storiaResult?.debug || {}) });

    // ── 6. PARSA HTML STORIA ──
    const storiaHtml = String(storiaResult?.html || "");
    // Salva per diagnostica
    try {
      const fs = require("fs");
      const path = require("path");
      const dumpDir = path.resolve(__dirname, "../../diagnostica-dump");
      if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });
      fs.writeFileSync(path.join(dumpDir, "storia-browser-raw.html"), storiaHtml, "utf8");
    } catch (_e) {}

    await page.setContent(storiaHtml, { waitUntil: "domcontentloaded" });

    const storiaData = await page.evaluate(() => {
      const readText = (n) => String(n?.textContent || "").replace(/\s+/g, " ").trim();
      const campi = {};

      // Strategia 1: label + input/select
      document.querySelectorAll("label").forEach(lbl => {
        const labelText = readText(lbl).replace(/:?\s*$/, "");
        if (!labelText || labelText.length > 80) return;

        let val = "";
        // Cerca input/select dopo il label
        const next = lbl.nextElementSibling;
        if (next) {
          if (next.tagName === "INPUT") val = next.value || "";
          else if (next.tagName === "SELECT") {
            const opt = next.querySelector("option[selected]") || next.querySelector("option:checked");
            val = opt ? readText(opt) : next.value || "";
          } else {
            const inp = next.querySelector("input[type='text']");
            const sel = next.querySelector("select");
            if (inp) val = inp.value || "";
            else if (sel) {
              const opt = sel.querySelector("option[selected]") || sel.querySelector("option:checked");
              val = opt ? readText(opt) : sel.value || "";
            }
          }
        }
        // Fallback: cerca nel parent
        if (!val) {
          const parent = lbl.parentElement;
          if (parent) {
            const inp = parent.querySelector("input[type='text']");
            const sel = parent.querySelector("select");
            if (inp && inp !== lbl) val = inp.value || "";
            else if (sel) {
              const opt = sel.querySelector("option[selected]") || sel.querySelector("option:checked");
              val = opt ? readText(opt) : sel.value || "";
            }
          }
        }
        val = String(val).trim();
        if (val && val !== labelText) campi[labelText] = val;
      });

      // Strategia 2 fallback: td label + td value
      document.querySelectorAll("tr").forEach(row => {
        const tds = Array.from(row.querySelectorAll("td, th"));
        for (let i = 0; i < tds.length - 1; i++) {
          const label = readText(tds[i]).replace(/:?\s*$/, "");
          if (!label || label.length > 60 || campi[label]) continue;
          const valueEl = tds[i + 1];
          const inp = valueEl.querySelector("input, select");
          let val = "";
          if (inp) {
            if (inp.tagName === "SELECT") {
              const opt = inp.querySelector("option[selected]") || inp.querySelector("option:checked");
              val = opt ? readText(opt) : inp.value || "";
            } else val = String(inp.value || "").trim();
          }
          if (!val) val = readText(valueEl);
          if (val && label !== val && !/^[\s\d]+$/.test(label)) { campi[label] = val; i++; }
        }
      });

      // Parsa tabella Verbali
      const verbali = [];
      document.querySelectorAll("table").forEach(table => {
        const tableId = (table.id || "").toLowerCase();
        const headers = [];
        const thead = table.querySelector("thead");
        if (thead) thead.querySelectorAll("th, td").forEach(th => headers.push(readText(th)));
        if (!headers.length) {
          const firstRow = table.querySelector("tr");
          if (firstRow) firstRow.querySelectorAll("th, td").forEach(cell => { const t = readText(cell); if (t) headers.push(t); });
        }
        if (!headers.length) return;

        const isVerbali = /esami|verbali/i.test(tableId) ||
          headers.some(h => /data.*verbale|esito.*esame|stato.*pres|desc.*stato/i.test(h)) ||
          headers.some(h => /data|esito|verbale|pres/i.test(h));
        if (!isVerbali) return;

        const hasThead = !!thead;
        const allRows = Array.from(table.querySelectorAll("tr"));
        const bodyRows = table.querySelectorAll("tbody tr").length > 0
          ? Array.from(table.querySelectorAll("tbody tr"))
          : hasThead ? allRows : allRows.slice(1);

        bodyRows.forEach(tr => {
          const cells = Array.from(tr.querySelectorAll("td")).map(readText);
          if (cells.length > 0 && cells.some(c => c.length > 0)) {
            const verb = {};
            headers.forEach((h, i) => { if (h) verb[h] = cells[i] || ""; });
            verbali.push(verb);
          }
        });
      });

      return { campi, verbali, labelsFound: document.querySelectorAll("label").length, tablesFound: document.querySelectorAll("table").length };
    });

    pushDiag(trace, "storia.parsed", { campiCount: Object.keys(storiaData.campi).length, verbaliCount: storiaData.verbali.length });

    return {
      success: true,
      storia: { campi: storiaData.campi, verbali: storiaData.verbali },
      _debug: { htmlLen: storiaHtml.length, labelsFound: storiaData.labelsFound, tablesFound: storiaData.tablesFound },
      trace,
    };
  } finally {
    if (!isPersistent) {
      await browser.close();
    }
    releaseLock();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// readStampaPortaleViaBrowser – Naviga al Dettaglio e clicca Stampa/StampaCandidati/StampaPrenotazione
//   per ottenere il documento ufficiale del Portale dell'Automobilista.
//   stampaType = "stampa" | "stampaCandidati" | "stampaPrenotazione"
// ═══════════════════════════════════════════════════════════════════════════════
async function readStampaPortaleViaBrowser(options = {}) {
  const username = options.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME;
  const password = options.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD;
  const pin = options.pin || process.env.PORTAL_PIN;
  const trace = Array.isArray(options.trace) ? options.trace : [];

  if (!username || !password) throw new Error("PORTAL_USER/PORTAL_PASS mancanti");

  const sessionIndex = Number.isFinite(Number(options.sessionIndex)) ? Number(options.sessionIndex) : 0;
  const stampaType = String(options.stampaType || "stampa").toLowerCase();
  const candidateIndex = Number.isFinite(Number(options.candidateIndex)) ? Number(options.candidateIndex) : -1;
  const candidateMarca = String(options.marcaOperativa || "").trim();

  const today = new Date();
  const toDate = new Date(today); toDate.setDate(toDate.getDate() + 30);
  const fromDateValue = options.dataDa || formatDateDDMMYYYY(today);
  const toDateValue = options.dataA || formatDateDDMMYYYY(toDate);
  const statoFilter = options.stato || "A|";

  const { browser, page, isPersistent, releaseLock } = await getBrowserAndPageForSession(username, password, pin, trace);

  try {
    page.setDefaultTimeout(45000);

    pushDiag(trace, "stampa.browser.start", { stampaType, sessionIndex, candidateIndex });

    // ── 0. FAST PATH: se il browser persistente ha caricato di recente lo stesso dettaglio, salta direttamente allo step 5 ──
    //
    // PROBLEMA RISOLTO: readSessioneDettaglioViaBrowser usa page.setContent() per caricare
    // il dettaglio, ma setContent NON aggiorna page.url() (resta sull'URL della ricerca).
    // Quindi un check basato solo su URL fallisce sempre. Usiamo invece la cache dello stato
    // (popolata dal dettaglio) + verifica DOM, con re-setContent come fallback.
    let fastPathToStampa = false;
    if (isPersistent && persistentLastLoginAt > 0 && persistentDetailLoadedAt > 0) {
      try {
        const cacheAgeMs = Date.now() - persistentDetailLoadedAt;
        const cacheMaxAgeMs = 15 * 60 * 1000; // 15 min, leggermente meno del TTL del browser (20 min)
        const currentSearchKey = `${fromDateValue}|${toDateValue}|${statoFilter}`;
        const matchesUser = persistentDetailUsername === username;
        const matchesSession = persistentDetailSessionIndex === sessionIndex && persistentDetailSearchKey === currentSearchKey;
        const cacheValid = matchesUser && matchesSession && cacheAgeMs < cacheMaxAgeMs;

        if (cacheValid) {
          // Caso A: il DOM ha ancora il form Select_listCandidati (page state intatto dal dettaglio)
          const hasDetailForm = await page.$('form#Select_listCandidati, form[name="Select_listCandidati"]');
          if (hasDetailForm) {
            fastPathToStampa = true;
            pushDiag(trace, "stampa.fastpath.dom", { sessionIndex, ageMs: cacheAgeMs });
            console.log(`[stampa] FAST PATH (DOM intatto): dettaglio già caricato, salto a step 5 (age=${cacheAgeMs}ms)`);
          } else if (persistentDetailHtml) {
            // Caso B: il DOM è stato sovrascritto (es. da altre chiamate Puppeteer in mezzo),
            // ma abbiamo l'HTML in cache. Re-setContent lo ripristina.
            await page.setContent(persistentDetailHtml, { waitUntil: "domcontentloaded" });
            const hasFormAfter = await page.$('form#Select_listCandidati, form[name="Select_listCandidati"]');
            if (hasFormAfter) {
              fastPathToStampa = true;
              pushDiag(trace, "stampa.fastpath.restored", { sessionIndex, ageMs: cacheAgeMs, htmlLen: persistentDetailHtml.length });
              console.log(`[stampa] FAST PATH (HTML ripristinato): cache hit, salto a step 5 (age=${cacheAgeMs}ms)`);
            } else {
              pushDiag(trace, "stampa.fastpath.restoreFailed", { sessionIndex });
              console.log(`[stampa] Restore HTML fallito: form non trovato dopo setContent`);
            }
          }
        } else {
          pushDiag(trace, "stampa.fastpath.miss", { matchesUser, matchesSession, ageMs: cacheAgeMs });
        }
      } catch (err) {
        pushDiag(trace, "stampa.fastpath.error", { error: String(err?.message || err) });
      }
    }

    // ── 1. LOGIN (skip se sessione persistente attiva) ──
    let skipLogin = false;
    if (isPersistent && persistentLastLoginAt > 0) {
      try {
        const currentUrl = await page.url();
        if (currentUrl.includes("/prenotazione") || currentUrl.includes("/portale-automobilista") || currentUrl.includes("/web/")) {
          skipLogin = true;
          pushDiag(trace, "stampa.login.skip", { url: currentUrl });
        }
      } catch { skipLogin = false; }
    }

    if (!skipLogin) {
    await page.goto("https://www.ilportaledellautomobilista.it/SSO/SSOLogin/Login_initAction.action", { waitUntil: "domcontentloaded" });
    const userSel = await waitFirstSelector(page, [
      'input[name="loginView.beanUtente.userName"]', 'input[name="loginView.username"]',
      'input[name="username"]', 'input[id*="user" i]', 'input[type="text"]',
    ], 8000).catch(() => null);
    const passSel = await waitFirstSelector(page, [
      'input[name="loginView.beanUtente.password"]', 'input[name="loginView.password"]',
      'input[name="password"]', 'input[id*="pass" i]', 'input[type="password"]',
    ], 8000).catch(() => null);

    if (userSel && passSel) {
      const loginBtnSel = 'input[name="action:Login_executeLogin"], button[name="action:Login_executeLogin"], input[type="submit"], button[type="submit"]';
      await page.click(userSel, { clickCount: 3 }); await page.type(userSel, username, { delay: 15 });
      await page.click(passSel, { clickCount: 3 }); await page.type(passSel, password, { delay: 15 });
      await Promise.allSettled([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
        page.click(loginBtnSel),
      ]);
      if (typeof handlePinIfPresent === "function") await handlePinIfPresent(page, pin);
    }
    if (isPersistent) persistentLastLoginAt = Date.now();
    } // fine if (!skipLogin)
    pushDiag(trace, "stampa.login.done", { url: page.url() });

    // ── 2-4. RICERCA + SELEZIONE (skip se fast path) ──
    if (!fastPathToStampa) {
    // ── 2. NAVIGA A RICERCA SESSIONI ──
    const searchUrl = "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH";
    const searchFormSelector = 'form#RicercaDisponibilitaSessioneEsameEP, form[name="RicercaDisponibilitaSessioneEsameEP"], form[name="RicercaDisponibilitaSessioneEsame"]';

    let preparedSearchForm = false;
    for (let attempt = 0; attempt < 5 && !preparedSearchForm; attempt++) {
      try {
        await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
        await sleep(1200);
        for (let i = 0; i < 10; i++) {
          await sleep(250);
          const hasForm = await page.$(searchFormSelector);
          if (hasForm) break;
          const hasPin = await page.$('input[name="loginView.pin"], input[name="pin"], input[id*="pin" i]');
          if (hasPin) { if (typeof handlePinIfPresent === "function") await handlePinIfPresent(page, pin); await sleep(400); continue; }
          const postForm = await page.$('form[name="postform"]');
          if (postForm) {
            await Promise.allSettled([
              page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
              page.$eval('form[name="postform"]', (form) => form.submit()),
            ]);
            await sleep(400);
          }
        }
        await page.waitForSelector(searchFormSelector, { timeout: 20000 });
        await sleep(300);
        // Compila stato + date con selettori semplici (no prefisso con virgole)
        await page.evaluate(({ statoVal, fVal, tVal }) => {
          // Stato
          const select = document.querySelector('select[name*="theStatoDisponibilitaSessioneEsameEP.selectRowId"]');
          if (select) {
            // Converti nome stato testuale in valore option
            const opts = Array.from(select.options || []);
            const upper = String(statoVal || "").toUpperCase();
            let targetValue = statoVal;
            if (upper.startsWith("APERT")) targetValue = (opts.find(o => o.value === "A|") || {}).value || "A|";
            else if (upper.startsWith("CHIUS")) targetValue = (opts.find(o => /CHIUS/.test(o.text.toUpperCase())) || {}).value || "";
            else if (upper.startsWith("BLOC")) targetValue = (opts.find(o => o.value === "B|") || {}).value || "B|";
            else if (upper.startsWith("ANNUL")) targetValue = (opts.find(o => o.value === "L|") || {}).value || "L|";
            const hasVal = opts.some(o => o.value === targetValue);
            if (hasVal) { select.value = targetValue; select.dispatchEvent(new Event("change", { bubbles: true })); }
          }
          // Date
          const fEl = document.querySelector('input[name*="EPFrom.dataDisponibiltaEsaminatore"]');
          if (fEl) { fEl.value = fVal; fEl.dispatchEvent(new Event("change", { bubbles: true })); }
          const tEl = document.querySelector('input[name*="EPTo.dataDisponibiltaEsaminatore"]');
          if (tEl) { tEl.value = tVal; tEl.dispatchEvent(new Event("change", { bubbles: true })); }
        }, { statoVal: statoFilter, fVal: fromDateValue, tVal: toDateValue }).catch(() => null);
        preparedSearchForm = true;
      } catch (err) { if (!/execution context was destroyed/i.test(err?.message || "")) throw err; }
    }
    if (!preparedSearchForm) throw new Error("Impossibile preparare form ricerca (stampa)");

    // ── 3. SUBMIT RICERCA (click nativo — Struts2 DMI richiede encoding nativo) ──
    // NB: NON usare `${searchFormSelector} input[...]` — le virgole nel selector padre
    //     fanno sì che querySelector matchi il <form> stesso anziché il bottone.
    const searchBtnSelector = 'input[name="action:Read_paging"][value="Ricerca"]';
    const hasSearchBtn = await page.$(searchBtnSelector);
    if (!hasSearchBtn) throw new Error("search-submit-button-not-found");

    await Promise.allSettled([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
      page.click(searchBtnSelector),
    ]);
    await sleep(1500);

    // Gestisci PIN o postform dispatcher dopo submit
    const hasPin2 = await page.$('input[name="loginView.pin"], input[name="pin"]');
    if (hasPin2) { await handlePinIfPresent(page, pin); await sleep(300); }
    for (let dispRetry = 0; dispRetry < 3; dispRetry++) {
      const hasPostForm = await page.$('form[name="postform"]');
      if (!hasPostForm) break;
      await Promise.allSettled([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
        page.$eval('form[name="postform"]', (form) => form.submit()),
      ]);
      await sleep(150);
    }

    const searchHtml = await page.content();
    console.log(`[stampa] Ricerca completata: htmlLen=${searchHtml.length}, dataDa=${fromDateValue}, dataA=${toDateValue}, stato=${statoFilter}, url=${page.url()}`);

    // Salva HTML di ricerca per diagnostica
    try {
      const fsDiag = require("fs");
      const pathDiag = require("path");
      const dumpDir = pathDiag.resolve(__dirname, "../../diagnostica-dump");
      if (!fsDiag.existsSync(dumpDir)) fsDiag.mkdirSync(dumpDir, { recursive: true });
      fsDiag.writeFileSync(pathDiag.join(dumpDir, "stampa-search-result.html"), searchHtml, "utf8");
    } catch (_e) {}

    pushDiag(trace, "stampa.search.done", { htmlLen: searchHtml.length });

    // ── 4. SELEZIONA SESSIONE E CLICCA DETTAGLIO (click nativi) ──
    const radioSelector = 'input[type="radio"][name*="selectRowId"]';
    const radios = await page.$$(radioSelector);
    console.log(`[stampa] Sessioni (radio) trovate: ${radios.length}`);
    if (!radios.length) {
      const trCount = await page.evaluate(() => document.querySelectorAll("tr").length);
      const bodyText = await page.evaluate(() => {
        const p = document.querySelector("p");
        return p ? p.textContent.trim().substring(0, 200) : "";
      });
      console.log(`[stampa] DEBUG: tr=${trCount}, msg=${bodyText}, url=${page.url()}`);
      throw new Error("Nessuna sessione trovata (stampa)");
    }

    const idx = Math.max(0, Math.min(sessionIndex, radios.length - 1));
    console.log(`[stampa] Selezionando sessione idx=${idx}, click Dettaglio...`);

    // Seleziona radio e clicca Dettaglio via DOM (evita problemi scroll/viewport di ElementHandle.click)
    await page.evaluate((radioIdx) => {
      const radios = document.querySelectorAll('input[type="radio"][name*="selectRowId"]');
      if (radios[radioIdx]) {
        radios[radioIdx].checked = true;
        radios[radioIdx].dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, idx);

    const hasDetailBtn = await page.$('input[name="action:Select_listCandidati"]');
    if (!hasDetailBtn) throw new Error("detail-button-not-found");

    await Promise.allSettled([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
      page.evaluate(() => {
        const btn = document.querySelector('input[name="action:Select_listCandidati"][value="Dettaglio"]');
        if (btn) btn.click();
      }),
    ]);
    console.log(`[stampa] Post-dettaglio: url=${page.url()}`);
    await sleep(1500);

    // Gestisci postform dispatcher
    for (let dispRetry = 0; dispRetry < 3; dispRetry++) {
      const hasPostForm = await page.$('form[name="postform"]');
      if (!hasPostForm) break;
      await Promise.allSettled([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
        page.$eval('form[name="postform"]', (form) => form.submit()),
      ]);
      await sleep(150);
    }

    pushDiag(trace, "stampa.detail.done", { url: page.url() });

    // Salva dettaglio per diagnostica + popola cache per chiamate stampa successive
    let slowPathDetailHtml = "";
    try {
      slowPathDetailHtml = await page.content();
      const fsDiag2 = require("fs");
      const pathDiag2 = require("path");
      const dumpDir2 = pathDiag2.resolve(__dirname, "../../diagnostica-dump");
      if (!fsDiag2.existsSync(dumpDir2)) fsDiag2.mkdirSync(dumpDir2, { recursive: true });
      fsDiag2.writeFileSync(pathDiag2.join(dumpDir2, "stampa-detail-page.html"), slowPathDetailHtml, "utf8");
    } catch (_e) {}

    // Popola cache dettaglio: una stampa successiva per la stessa sessione potrà fast-path
    // (es. utente clicca STAMPA, poi STAMPA CANDIDATI sulla stessa sessione)
    if (isPersistent && slowPathDetailHtml) {
      persistentDetailUsername = username;
      persistentDetailSessionIndex = sessionIndex;
      persistentDetailSearchKey = `${fromDateValue}|${toDateValue}|${statoFilter}`;
      persistentDetailHtml = slowPathDetailHtml;
      persistentDetailLoadedAt = Date.now();
      pushDiag(trace, "stampa.cache.populated", { sessionIndex, htmlLen: slowPathDetailHtml.length });
    }
    } // fine if (!fastPathToStampa)

    // ── 5. STAMPA via fetch() nel contesto della pagina dettaglio ──
    //   Il portale restituisce PDF binari: usiamo arrayBuffer → base64.
    //   Helper inline per fetch + detect PDF/HTML nel contesto evaluate.
    const fetchStampaScript = `
      async function _fetchStampa(url, opts) {
        const resp = await fetch(url, opts);
        const ct = (resp.headers.get("content-type") || "").toLowerCase();
        if (ct.includes("pdf") || ct.includes("octet-stream")) {
          const buf = await resp.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let bin = "";
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
          return { pdfBase64: btoa(bin), status: resp.status, isPdf: true };
        }
        // Controlla se il body inizia con %PDF anche senza content-type
        const text = await resp.text();
        if (text.startsWith("%PDF")) {
          const enc = new TextEncoder();
          const bytes = enc.encode(text);
          let bin = "";
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
          return { pdfBase64: btoa(bin), status: resp.status, isPdf: true };
        }
        return { html: text, status: resp.status, isPdf: false };
      }
    `;
    let html = "";
    let pdfBase64 = "";
    let isPdf = false;
    console.log(`[stampa] Step 5: stampaType=${stampaType}, url=${page.url()}`);

    if (stampaType === "stampaprenotazione") {
      const result = await page.evaluate(new Function("candidateIndex", "candidateMarca", `
        ${fetchStampaScript}
        return (async () => {
          const links = Array.from(document.querySelectorAll('a[href*="stampaSingolaPrenotazioneCandidato"]'));
          if (!links.length) return { error: "no-stampa-links" };
          let targetLink = links[0];
          if (candidateIndex >= 0 && candidateIndex < links.length) targetLink = links[candidateIndex];
          else if (candidateMarca) {
            const found = links.find(l => { const row = l.closest("tr"); return row && row.textContent.includes(candidateMarca); });
            if (found) targetLink = found;
          }
          const href = targetLink.getAttribute("href") || "";
          const url = new URL(href, window.location.href).toString();
          return await _fetchStampa(url, { credentials: "include" });
        })();
      `), candidateIndex, candidateMarca);
      if (result?.error) throw new Error(result.error);
      isPdf = !!result?.isPdf;
      pdfBase64 = result?.pdfBase64 || "";
      html = result?.html || "";

    } else if (stampaType === "stampacandidati") {
      const result = await page.evaluate(new Function(`
        ${fetchStampaScript}
        return (async () => {
          const form = document.querySelector('#Select_listCandidati') || document.querySelector('form[name="Select_listCandidati"]');
          if (!form) return { error: "form-not-found" };
          const fd = new FormData(form);
          for (const k of Array.from(fd.keys())) { if (k.startsWith("action:")) fd.delete(k); }
          fd.set("action:SelectCandidato_stampaPrenotazioneCandidatiPropriAutoscuola", "Stampa Candidati Autoscuola");
          const body = new URLSearchParams();
          for (const [k, v] of fd.entries()) body.append(k, typeof v === "string" ? v : String(v));
          const action = form.getAttribute("action") || window.location.href;
          const url = new URL(action, window.location.href).toString();
          return await _fetchStampa(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(), credentials: "include" });
        })();
      `));
      if (result?.error) throw new Error(result.error);
      isPdf = !!result?.isPdf;
      pdfBase64 = result?.pdfBase64 || "";
      html = result?.html || "";

    } else {
      const result = await page.evaluate(new Function(`
        ${fetchStampaScript}
        return (async () => {
          const form = document.querySelector('#Select_listCandidati') || document.querySelector('form[name="Select_listCandidati"]');
          if (!form) return { error: "form-not-found" };
          const fd = new FormData(form);
          for (const k of Array.from(fd.keys())) { if (k.startsWith("action:")) fd.delete(k); }
          fd.set("action:SelectCandidato_stampaPrenotazioneCandidato", "Stampa");
          const body = new URLSearchParams();
          for (const [k, v] of fd.entries()) body.append(k, typeof v === "string" ? v : String(v));
          const action = form.getAttribute("action") || window.location.href;
          const url = new URL(action, window.location.href).toString();
          return await _fetchStampa(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(), credentials: "include" });
        })();
      `));
      if (result?.error) throw new Error(result.error);
      isPdf = !!result?.isPdf;
      pdfBase64 = result?.pdfBase64 || "";
      html = result?.html || "";
    }
    console.log(`[stampa] Step 5 completato: isPdf=${isPdf}, size=${isPdf ? pdfBase64.length : html.length}, fastPath=${fastPathToStampa}`);

    pushDiag(trace, "stampa.result", { stampaType, isPdf, size: isPdf ? pdfBase64.length : html.length });

    // Salva per diagnostica
    try {
      const fsDiag3 = require("fs");
      const pathDiag3 = require("path");
      const dumpDir3 = pathDiag3.resolve(__dirname, "../../diagnostica-dump");
      if (!fsDiag3.existsSync(dumpDir3)) fsDiag3.mkdirSync(dumpDir3, { recursive: true });
      if (isPdf) {
        fsDiag3.writeFileSync(pathDiag3.join(dumpDir3, `stampa-${stampaType}.pdf`), Buffer.from(pdfBase64, "base64"));
      } else {
        fsDiag3.writeFileSync(pathDiag3.join(dumpDir3, `stampa-${stampaType}.html`), html, "utf8");
      }
    } catch (_e) {}

    return { success: true, html: isPdf ? "" : html, pdfBase64: isPdf ? pdfBase64 : "", isPdf, stampaType, trace };
  } finally {
    if (!isPersistent) {
      await browser.close();
    }
    releaseLock();
  }
}


module.exports = PortalSession;
module.exports.loginAndGetJar = loginAndGetJar;
module.exports.loginDirectHttp = loginDirectHttp;
module.exports.getOrLoginJar = getOrLoginJar;
module.exports.getOrLoginJarFast = getOrLoginJarFast;
module.exports.invalidatePortalSession = invalidatePortalSession;
module.exports.diagnosePortalLogin = diagnosePortalLogin;
module.exports.readSessioniQuizInterneViaBrowser = readSessioniQuizInterneViaBrowser;
module.exports.readPortalSearchViaBrowser = readPortalSearchViaBrowser;
module.exports.readPortalPageViaBrowser = readPortalPageViaBrowser;
module.exports.submitPortalFormViaBrowser = submitPortalFormViaBrowser;
module.exports.PORTAL_TAB_CONFIG = PORTAL_TAB_CONFIG;
module.exports.runManualSessionFlowViaBrowser = runManualSessionFlowViaBrowser;
module.exports.readSituazioneCandidatiDettaglioViaBrowser = readSituazioneCandidatiDettaglioViaBrowser;
module.exports.readPrenotazioniSessioneQuizInterneViaBrowser = readPrenotazioniSessioneQuizInterneViaBrowser;
module.exports.readSituazioneCandidatiListViaBrowser = readSituazioneCandidatiListViaBrowser;
module.exports.readSessioneDettaglioViaBrowser = readSessioneDettaglioViaBrowser;
module.exports.readStoriaViaBrowser = readStoriaViaBrowser;
module.exports.readStampaPortaleViaBrowser = readStampaPortaleViaBrowser;

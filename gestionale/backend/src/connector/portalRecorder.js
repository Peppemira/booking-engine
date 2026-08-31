/**
 * Portal Recorder — sessione interattiva con cattura movimenti utente.
 *
 * Apre un browser Puppeteer VISIBILE (headless: false), esegue il login SSO + PIN
 * automatico riutilizzando le credenziali dal .env, poi passa il controllo
 * all'utente che naviga liberamente sul portale. Ogni click / submit /
 * navigazione / richiesta POST viene registrato in memoria e puo' essere
 * scaricato come JSON alla fine della sessione.
 *
 * API:
 *   startRecording({ username, password, pin, note }) -> { sessionId, status }
 *   stopRecording(sessionId) -> { events, summary }
 *   getStatus(sessionId) -> { events, isActive, startedAt, elapsedMs }
 *   listSessions() -> [ { sessionId, isActive, startedAt, eventCount } ]
 *   clearSession(sessionId) -> { cleared: true }
 */

const puppeteer = require("puppeteer");

// Map: sessionId -> { browser, page, events, startedAt, stoppedAt, note, username }
const recordingSessions = new Map();

function makeSessionId() {
  return "rec_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFirstSelector(page, selectors, timeout = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    for (const selector of selectors) {
      const found = await page.$(selector);
      if (found) return selector;
    }
    await sleep(200);
  }
  throw new Error(`Nessun selettore trovato: ${selectors.join(", ")}`);
}

async function handlePinIfPresent(page, pinValue) {
  const pinSelector = await waitFirstSelector(page, [
    'input[name="loginView.pin"]',
    'input[name="pin"]',
    'input[id*="pin" i]',
  ], 5000).catch(() => null);

  if (!pinSelector) return false;
  if (!pinValue) throw new Error("PIN richiesto ma mancante");

  const btnSelector = 'input[name="action:Pin_executePinValidation"], button[name="action:Pin_executePinValidation"], input[type="submit"]';

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

/**
 * Esegue il login SSO + PIN sul portale e ritorna { browser, page } pronti.
 * Il browser rimane aperto (NON viene chiuso): sara' l'utente a pilotarlo.
 */
async function launchAndLogin({ username, password, pin }) {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null, // usa la dimensione della finestra reale
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--start-maximized",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const pages = await browser.pages();
  const page = pages[0] || (await browser.newPage());
  page.setDefaultTimeout(60000);

  // Naviga alla pagina di login
  await page.goto(
    "https://www.ilportaledellautomobilista.it/SSO/SSOLogin/Login_initAction.action",
    { waitUntil: "domcontentloaded" }
  );

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

  await handlePinIfPresent(page, pin);

  // Verifica che siamo fuori dal dominio SSO
  const currentUrl = (page.url() || "").toLowerCase();
  if (currentUrl.includes("/sso/ssologin/")) {
    throw new Error("Login SSO non completato: ancora sulla pagina di login");
  }

  return { browser, page };
}

/**
 * Installa i listener di cattura eventi sul browser.
 * - framenavigated  -> evento "navigation"
 * - request (POST)  -> evento "request"
 * - click/submit    -> via exposeFunction + evaluateOnNewDocument
 * - nuove tab       -> targetcreated -> installa listener anche li'
 */
async function installRecorders(browser, page, pushEvent) {
  // Handler per una singola page (reinstallato su ogni nuova tab)
  async function attachPage(p) {
    try {
      // Espone funzione JS -> Node per eventi catturati dal browser
      try {
        await p.exposeFunction("__portalRecordEvent", (evt) => {
          try {
            pushEvent({ ...evt, ts: Date.now() });
          } catch (_) {}
        });
      } catch (_) {
        // Gia' esposta (es. dopo reload): ignora
      }

      // Inietta listener in ogni documento caricato dalla tab
      await p.evaluateOnNewDocument(() => {
        // Helper: selettore "umano" dell'elemento
        function buildSelector(el) {
          if (!el || el.nodeType !== 1) return "";
          const parts = [];
          let node = el;
          while (node && node.nodeType === 1 && parts.length < 6) {
            let sel = node.tagName.toLowerCase();
            if (node.id) { sel += "#" + node.id; parts.unshift(sel); break; }
            const cls = (typeof node.className === "string" ? node.className : "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
            if (cls.length) sel += "." + cls.join(".");
            const name = node.getAttribute && node.getAttribute("name");
            if (name) sel += `[name="${name}"]`;
            parts.unshift(sel);
            node = node.parentElement;
          }
          return parts.join(" > ");
        }

        function safeText(el, max = 80) {
          const t = (el.innerText || el.textContent || el.value || "").toString().trim();
          return t.slice(0, max);
        }

        // CLICK
        document.addEventListener("click", (e) => {
          const t = e.target;
          if (!t) return;
          try {
            window.__portalRecordEvent({
              type: "click",
              url: location.href,
              tag: (t.tagName || "").toLowerCase(),
              selector: buildSelector(t),
              text: safeText(t),
              href: t.tagName === "A" ? t.href : undefined,
              name: t.getAttribute && t.getAttribute("name") || undefined,
              value: t.value && t.type !== "password" ? String(t.value).slice(0, 100) : undefined,
            });
          } catch (_) {}
        }, true);

        // SUBMIT
        document.addEventListener("submit", (e) => {
          const f = e.target;
          if (!f || f.tagName !== "FORM") return;
          try {
            const fields = [];
            const inputs = f.querySelectorAll("input, select, textarea");
            for (const el of inputs) {
              const type = (el.type || el.tagName || "").toLowerCase();
              if (type === "password") continue;
              if (type === "hidden") continue;
              const name = el.name || el.id || "";
              if (!name) continue;
              fields.push({
                name: name.slice(0, 60),
                type,
                value: String(el.value || "").slice(0, 120),
              });
              if (fields.length >= 30) break;
            }
            window.__portalRecordEvent({
              type: "submit",
              url: location.href,
              action: f.getAttribute("action") || "",
              method: (f.getAttribute("method") || "GET").toUpperCase(),
              formName: f.getAttribute("name") || f.id || "",
              fields,
            });
          } catch (_) {}
        }, true);

        // CHANGE (per select e input)
        document.addEventListener("change", (e) => {
          const el = e.target;
          if (!el || !el.name) return;
          if ((el.type || "").toLowerCase() === "password") return;
          try {
            window.__portalRecordEvent({
              type: "change",
              url: location.href,
              tag: (el.tagName || "").toLowerCase(),
              name: el.name,
              value: String(el.value || "").slice(0, 120),
            });
          } catch (_) {}
        }, true);
      });

      // Navigazioni della tab principale
      p.on("framenavigated", (frame) => {
        if (frame === p.mainFrame()) {
          try {
            pushEvent({
              type: "navigation",
              url: frame.url(),
              ts: Date.now(),
            });
          } catch (_) {}
        }
      });

      // Richieste POST (utile per tracciare API .action del portale)
      p.on("request", (req) => {
        try {
          const method = req.method();
          if (method !== "POST") return;
          const url = req.url();
          // Filtra solo le .action / .do del portale
          if (!/ilportaledellautomobilista\.it/.test(url)) return;
          if (!/\.(action|do)(\?|$)/.test(url)) return;
          const postData = (req.postData() || "").slice(0, 800);
          pushEvent({
            type: "request",
            url,
            method,
            postData,
            ts: Date.now(),
          });
        } catch (_) {}
      });
    } catch (err) {
      console.error("[recorder] attachPage error:", err.message);
    }
  }

  // Attacca alla pagina corrente
  await attachPage(page);

  // Quando viene aperta una nuova tab/popup -> attacca anche li'
  browser.on("targetcreated", async (target) => {
    try {
      if (target.type() !== "page") return;
      const newPage = await target.page();
      if (!newPage) return;
      pushEvent({ type: "new_tab", url: newPage.url(), ts: Date.now() });
      await attachPage(newPage);
    } catch (_) {}
  });

  // Quando una tab viene chiusa
  browser.on("targetdestroyed", (target) => {
    try {
      if (target.type() !== "page") return;
      pushEvent({ type: "tab_closed", url: target.url(), ts: Date.now() });
    } catch (_) {}
  });
}

/**
 * Avvia una nuova sessione di registrazione.
 */
async function startRecording({ username, password, pin, note }) {
  const sessionId = makeSessionId();
  const events = [];
  const startedAt = Date.now();

  function pushEvent(evt) {
    events.push(evt);
    // Limite difensivo per non saturare la RAM
    if (events.length > 5000) events.splice(0, events.length - 5000);
  }

  pushEvent({ type: "session_start", ts: startedAt, note: note || "" });

  const { browser, page } = await launchAndLogin({ username, password, pin });

  pushEvent({ type: "login_ok", url: page.url(), ts: Date.now() });

  await installRecorders(browser, page, pushEvent);

  // Gestione chiusura inattesa del browser da parte dell'utente
  browser.on("disconnected", () => {
    const s = recordingSessions.get(sessionId);
    if (s && s.isActive) {
      s.isActive = false;
      s.stoppedAt = Date.now();
      s.events.push({ type: "browser_disconnected", ts: Date.now() });
    }
  });

  recordingSessions.set(sessionId, {
    sessionId,
    browser,
    page,
    events,
    startedAt,
    stoppedAt: null,
    isActive: true,
    note: note || "",
    username,
  });

  return {
    sessionId,
    startedAt,
    status: "recording",
  };
}

/**
 * Ferma una sessione di registrazione e chiude il browser.
 */
async function stopRecording(sessionId) {
  const s = recordingSessions.get(sessionId);
  if (!s) throw new Error("Sessione non trovata: " + sessionId);

  if (s.isActive) {
    s.isActive = false;
    s.stoppedAt = Date.now();
    s.events.push({ type: "session_stop", ts: s.stoppedAt });
  }

  try {
    if (s.browser && s.browser.isConnected && s.browser.isConnected()) {
      await s.browser.close();
    }
  } catch (_) {}

  s.browser = null;
  s.page = null;

  return {
    sessionId,
    events: s.events.slice(),
    startedAt: s.startedAt,
    stoppedAt: s.stoppedAt,
    summary: buildSummary(s.events),
  };
}

/**
 * Stato corrente di una sessione (per polling live dalla UI).
 */
function getStatus(sessionId) {
  const s = recordingSessions.get(sessionId);
  if (!s) throw new Error("Sessione non trovata: " + sessionId);
  const elapsed = (s.stoppedAt || Date.now()) - s.startedAt;
  return {
    sessionId,
    isActive: s.isActive,
    startedAt: s.startedAt,
    stoppedAt: s.stoppedAt,
    elapsedMs: elapsed,
    eventCount: s.events.length,
    events: s.events.slice(),
    note: s.note || "",
    username: s.username || "",
    summary: buildSummary(s.events),
  };
}

/**
 * Elenca tutte le sessioni in memoria (attive e chiuse).
 */
function listSessions() {
  const out = [];
  for (const [id, s] of recordingSessions.entries()) {
    out.push({
      sessionId: id,
      isActive: s.isActive,
      startedAt: s.startedAt,
      stoppedAt: s.stoppedAt,
      eventCount: s.events.length,
      note: s.note || "",
      username: s.username || "",
    });
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * Rimuove dalla memoria una sessione gia' chiusa.
 */
async function clearSession(sessionId) {
  const s = recordingSessions.get(sessionId);
  if (!s) return { cleared: false, reason: "not_found" };
  if (s.isActive) {
    try { await stopRecording(sessionId); } catch (_) {}
  }
  recordingSessions.delete(sessionId);
  return { cleared: true };
}

/**
 * Costruisce un riepilogo: pagine visitate, azioni chiave, form submessi.
 */
function buildSummary(events) {
  const pagesVisited = [];
  const pagesSeen = new Set();
  const clicks = [];
  const submits = [];
  const requests = [];

  for (const e of events) {
    if (e.type === "navigation" && e.url && !pagesSeen.has(e.url)) {
      pagesSeen.add(e.url);
      pagesVisited.push(e.url);
    }
    if (e.type === "click" && (e.text || e.href)) {
      clicks.push({
        text: e.text,
        href: e.href,
        selector: e.selector,
        url: e.url,
      });
    }
    if (e.type === "submit") {
      submits.push({
        url: e.url,
        action: e.action,
        method: e.method,
        fieldCount: (e.fields || []).length,
      });
    }
    if (e.type === "request") {
      requests.push({ url: e.url });
    }
  }

  return {
    totalEvents: events.length,
    pagesVisitedCount: pagesVisited.length,
    pagesVisited: pagesVisited.slice(0, 40),
    clicksCount: clicks.length,
    submitsCount: submits.length,
    requestsCount: requests.length,
    submits: submits.slice(0, 20),
  };
}

module.exports = {
  startRecording,
  stopRecording,
  getStatus,
  listSessions,
  clearSession,
};

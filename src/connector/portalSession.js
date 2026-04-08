const puppeteer = require("puppeteer");
const { CookieJar } = require("tough-cookie");
const { makeHttpClient } = require("./portalHttp");

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
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }),
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

module.exports = PortalSession;
module.exports.loginAndGetJar = loginAndGetJar;

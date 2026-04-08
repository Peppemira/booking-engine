/**
 * Unified portal connector (equivalent to GeCA modConnPort).
 * Login SSO, PIN validation, GET/POST requests, recuperaSaldoPunti.
 * Use with a cookie jar (e.g. from portalSession.loginAndGetJar) or do HTTP login here.
 */

const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const tough = require("tough-cookie");
const cheerio = require("cheerio");

const PORTAL_BASE = "https://www.ilportaledellautomobilista.it";

/**
 * Create an HTTP client with cookie jar for the portale.
 * @param {tough.CookieJar} [jar] - Optional; if not provided a new jar is created
 * @returns {object} Axios instance with jar
 */
function createClient(jar) {
  const cookieJar = jar || new tough.CookieJar();
  return wrapper(
    axios.create({
      jar: cookieJar,
      withCredentials: true,
      timeout: 30000,
      maxRedirects: 10,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.85 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    })
  );
}

/**
 * Login to portale (SSO). Equivalent to modConnPort.LoginPortale.
 * @param {object} client - Axios instance with cookie jar
 * @param {string} strUser - Username
 * @param {string} strPass - Password
 * @returns {Promise<string>} HTML response body
 */
async function loginPortale(client, strUser, strPass) {
  const params = new URLSearchParams({
    "loginView.gotoRedirect": "",
    orgname: "",
    "loginView.beanUtente.userName": strUser,
    "loginView.beanUtente.password": strPass,
    "action:Login_executeLogin": "Accedi",
  });

  const response = await client.post(
    `${PORTAL_BASE}/SSO/SSOLogin/Login_initAction.action`,
    params,
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return typeof response.data === "string" ? response.data : JSON.stringify(response.data);
}

/**
 * Validate PIN and follow redirect. Equivalent to modConnPort.autentiPin.
 * @param {object} client - Axios instance with cookie jar
 * @param {string} strPin - PIN
 * @param {string} strLink - Goto link (e.g. https://www.ilportaledellautomobilista.it/prenotazione)
 * @returns {Promise<string>} HTML response body
 */
async function autentiPin(client, strPin, strLink) {
  const gotoEnc = encodeURIComponent(strLink || PORTAL_BASE);
  const params = new URLSearchParams({
    "loginView.pin": strPin,
    "loginView.gotoRedirect": "",
    "lorgname": "/",
    "action:Pin_executePinValidation": "Conferma",
  });

  const response = await client.post(
    `${PORTAL_BASE}/SSO/SSOLogin/DispatcherEntry_executeDispatch.action?goto=${gotoEnc}`,
    params,
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return typeof response.data === "string" ? response.data : JSON.stringify(response.data);
}

/**
 * GET request. Equivalent to modConnPort.InviaGetRequest.
 * @param {object} client - Axios instance
 * @param {string} strLink - Full URL
 * @param {string} [strTipolink] - Label for errors
 * @returns {Promise<string>} Response body
 */
async function inviaGetRequest(client, strLink, strTipolink = "Pagina") {
  const response = await client.get(strLink);
  return typeof response.data === "string" ? response.data : JSON.stringify(response.data);
}

/**
 * POST form urlencoded. Equivalent to modConnPort.InviatPostRequest.
 * @param {object} client - Axios instance
 * @param {string} linkPort - Full URL
 * @param {string[]} contentList - List of "key=value" strings
 * @returns {Promise<string>} Response body
 */
async function inviaPostRequest(client, linkPort, contentList) {
  const body = Array.isArray(contentList) ? contentList.join("&") : String(contentList);
  const response = await client.post(linkPort, body, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return typeof response.data === "string" ? response.data : JSON.stringify(response.data);
}

/**
 * Recupera saldo punti patente (API o pagina). Equivalent to modConnPort.recuperasaldopunti.
 * If the response is JSON with esito true/false, returns it; otherwise parses HTML for errors or login required.
 * @param {object} client - Axios instance with cookie jar (should be logged in)
 * @param {string} linkdest - Full URL (e.g. .../interrogazionipuntipatente/api/v1/puntipatente/cf/CF/NPAT)
 * @param {string} [userp] - Username for retry login
 * @param {string} [passp] - Password for retry login
 * @returns {Promise<string>} JSON string (punti response) or empty on error
 */
async function recuperaSaldoPunti(client, linkdest, userp, passp) {
  let html = "";
  try {
    const response = await client.get(linkdest);
    html = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
  } catch (err) {
    return "";
  }

  if (!html || !html.trim()) return "";

  if (/\"esito\":\s*(?:true|false)/i.test(html)) {
    return html;
  }

  const $ = cheerio.load(html);
  const errNode = $(".errore-desc, .errori").first();
  if (errNode.length) {
    const text = errNode.text().trim();
    if (text) throw new Error(text);
  }

  if ($("#login-user").length || $("#LoginFom_button_value_login").length || $(".img_accedi").length) {
    if (userp && passp) {
      await loginPortale(client, userp, passp);
      return recuperaSaldoPunti(client, linkdest, null, null);
    }
    throw new Error("Login richiesto per interrogazione punti patente.");
  }

  if (html.includes("dalle 08:00 alle 21:00")) {
    throw new Error(
      "I servizi de 'Il Portale dell'Automobilista' a cui si tenta di accedere, sono disponibili dalle 08:00 alle 21:00."
    );
  }
  if (html.includes("non è momentaneamente disponibile")) {
    throw new Error(
      "I servizi de 'Il Portale dell'Automobilista' a cui si tenta di accedere, non sono al momento disponibili."
    );
  }

  return "";
}

module.exports = {
  createClient,
  loginPortale,
  autentiPin,
  inviaGetRequest,
  inviaPostRequest,
  recuperaSaldoPunti,
  PORTAL_BASE,
};

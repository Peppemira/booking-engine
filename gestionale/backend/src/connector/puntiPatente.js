/**
 * Wrapper per interrogazione punti patente (equivalente a uso di modConnPort.recuperasaldopunti).
 * Richiede client portale già loggato (o credenziali per retry).
 */

const {
  createClient,
  loginPortale,
  autentiPin,
  recuperaSaldoPunti,
} = require("./portalConnector");

const PORTAL_BASE = "https://www.ilportaledellautomobilista.it";
const PUNTI_API_PATH = "/interrogazionipuntipatente/api/v1/puntipatente";

/**
 * Get saldo punti patente by codice fiscale and numero patente.
 * @param {object} options
 * @param {string} options.codiceFiscale - Codice fiscale
 * @param {string} options.numeroPatente - Numero patente
 * @param {string} [options.username] - Portale username (for login if needed)
 * @param {string} [options.password] - Portale password
 * @param {string} [options.pin] - Portale PIN (if required after login)
 * @param {object} [options.client] - Existing portal client with cookie jar (if already logged in)
 * @returns {Promise<object|string>} JSON response (e.g. { esito: true, ... }) or raw string
 */
async function getPuntiPatente(options = {}) {
  const { codiceFiscale, numeroPatente, username, password, pin, client: existingClient } = options;
  if (!codiceFiscale || !numeroPatente) {
    throw new Error("codiceFiscale e numeroPatente sono obbligatori");
  }

  const cf = String(codiceFiscale).trim();
  const npat = String(numeroPatente).trim();
  const url = `${PORTAL_BASE}${PUNTI_API_PATH}/cf/${encodeURIComponent(cf)}/${encodeURIComponent(npat)}`;

  let client = existingClient;
  if (!client) {
    if (!username || !password) {
      throw new Error("Fornire client (già loggato) oppure username e password per il portale");
    }
    client = createClient();
    await loginPortale(client, username, password);
    if (pin) {
      await autentiPin(client, pin, `${PORTAL_BASE}/prenotazione`);
    }
  }

  const raw = await recuperaSaldoPunti(client, url, username, password);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

module.exports = {
  getPuntiPatente,
  PUNTI_API_PATH,
};

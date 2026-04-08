/**
 * PuntiPatenteService - equivalente a uso di modConnPort.recuperasaldopunti.
 * Interrogazione saldo punti patente (API ilportaledellautomobilista).
 */

const { getPuntiPatente, PUNTI_API_PATH } = require("../connector/puntiPatente");

const PORTAL_BASE = "https://www.ilportaledellautomobilista.it";

class PuntiPatenteService {
  /**
   * @param {object} [options] - { client, username, password, pin }
   */
  constructor(options = {}) {
    this._client = options.client || null;
    this._username = options.username || null;
    this._password = options.password || null;
    this._pin = options.pin || null;
  }

  setClient(client) {
    this._client = client;
    return this;
  }

  setCredentials(username, password, pin) {
    this._username = username;
    this._password = password;
    this._pin = pin;
    return this;
  }

  /**
   * Recupera saldo punti per codice fiscale e numero patente.
   * @param {string} codiceFiscale
   * @param {string} numeroPatente
   * @returns {Promise<object|string|null>} Risposta JSON API o null
   */
  async getPunti(codiceFiscale, numeroPatente) {
    return getPuntiPatente({
      codiceFiscale,
      numeroPatente,
      client: this._client,
      username: this._username,
      password: this._password,
      pin: this._pin,
    });
  }

  /**
   * Costruisce l'URL dell'API punti (per uso con client portale).
   * @param {string} cf - Codice fiscale
   * @param {string} npat - Numero patente
   * @returns {string}
   */
  static buildPuntiUrl(cf, npat) {
    return `${PORTAL_BASE}${PUNTI_API_PATH}/cf/${encodeURIComponent(cf)}/${encodeURIComponent(npat)}`;
  }
}

module.exports = {
  PuntiPatenteService,
  getPuntiPatente,
  PUNTI_API_PATH,
  PORTAL_BASE,
};

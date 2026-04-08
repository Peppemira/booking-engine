/**
 * SendDocCommService - equivalente a GeCA SendDocComm.
 * Invio documenti di accompagnamento (SDC) verso Agenzia Entrate.
 */

const { sendDCAsync, DEFAULT_BASE } = require("../connector/sendDocComm");

/**
 * @typedef {Object} EsitoSDC
 * @property {boolean} esito
 * @property {string|null} idtrx
 * @property {string|null} progressivo
 * @property {Array<{ codice: string, descrizione: string }>|null} errori
 */

class SendDocCommService {
  /**
   * @param {object} [options] - { baseUrl } (default da AGENZIAENTRATE_BASE_URL)
   */
  constructor(options = {}) {
    this._baseUrl = options.baseUrl || process.env.AGENZIAENTRATE_BASE_URL || DEFAULT_BASE;
  }

  /**
   * Invia documento di accompagnamento (SDC).
   * @param {object} dc - Payload DC (RootObject, vedi GeCA DC.cs)
   * @param {string} usr - Username portale AE
   * @param {string} pwd - Password
   * @param {string} pin - PIN
   * @param {string} piva - P.IVA
   * @param {string} tipoincarico - Tipo incarico
   * @returns {Promise<EsitoSDC>}
   */
  async sendDC(dc, usr, pwd, pin, piva, tipoincarico) {
    return sendDCAsync(dc, usr, pwd, pin, piva, tipoincarico, { baseUrl: this._baseUrl });
  }
}

module.exports = {
  SendDocCommService,
  sendDCAsync,
  DEFAULT_BASE,
};

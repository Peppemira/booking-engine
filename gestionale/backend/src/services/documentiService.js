/**
 * DocumentiService - equivalente GeCA stampepdf, ClasseGestioneStampa, SendDocComm.
 * Generazione/invio documenti (ricevute, dichiarazioni, SDC).
 */

const { SendDocCommService, sendDCAsync } = require("./sendDocCommService");
const { createEsito, createErrore, createDocumDett } = require("../models");
const { createDocumento } = require("../models");

class DocumentiService {
  constructor(options = {}) {
    this._sdc = options.sdc || new SendDocCommService(options.sdcOptions || {});
  }

  /**
   * Invia documento di accompagnamento (SDC) - equivalente SendDocComm.
   * @param {object} dcPayload - RootObject / DC (datiTrasmissione, identificativiFiscali, altriDatiIdentificativi, ...)
   * @param {object} [options] - baseUrl, timeout
   * @returns {Promise<{ esito, idtrx, progressivo, errori }>}
   */
  async inviaDocumentoAccompagnamento(dcPayload, options = {}) {
    const result = await sendDCAsync(this._sdc.getClient(), dcPayload, options);
    return {
      esito: result?.esito ?? false,
      idtrx: result?.idtrx ?? null,
      progressivo: result?.progressivo ?? null,
      errori: result?.errori ?? null,
    };
  }

  /**
   * Parsing risposta Esiti (lista documenti/operazioni).
   */
  parseEsitiResponse(body) {
    if (!body || typeof body !== "object") return { esiti: [], errori: [] };
    const esiti = Array.isArray(body.esiti) ? body.esiti.map((e) => createEsito(e)) : [];
    const errori = Array.isArray(body.errori) ? body.errori.map((e) => createErrore(e)) : [];
    return { esiti, errori };
  }

  /**
   * Crea modello documento per persistenza (metadati).
   */
  createDocumentoMeta(data) {
    return createDocumento(data);
  }
}

const documentiService = new DocumentiService();

module.exports = {
  DocumentiService,
  documentiService,
};

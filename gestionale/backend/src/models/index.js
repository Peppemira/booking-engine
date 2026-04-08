/**
 * Modelli equivalenti GeCAFuture - export centralizzato.
 */

const { createCandidato, candidatoFromRow } = require("./Candidato");
const { createCandidatoInfo } = require("./CandidatoInfo");
const { createEsitoPrenotazione } = require("./EsitoPrenotazione");
const { createEsito, createErrore, createDocumDett } = require("./Esiti");
const {
  createDatiTrasmissione,
  createIdentificativiFiscali,
  createAltriDatiIdentificativi,
  createRootObject,
} = require("./DC");
const { createSessioneEsame } = require("./SessioneEsame");
const { createPraticaPatente } = require("./PraticaPatente");
const { createDocumento } = require("./Documento");
const { createPagamento } = require("./Pagamento");
const { createAutoscuola } = require("./Autoscuola");
const { createPuntiPatenteResponse } = require("./PuntiPatente");

module.exports = {
  createCandidato,
  candidatoFromRow,
  createCandidatoInfo,
  createEsitoPrenotazione,
  createEsito,
  createErrore,
  createDocumDett,
  createDatiTrasmissione,
  createIdentificativiFiscali,
  createAltriDatiIdentificativi,
  createRootObject,
  createSessioneEsame,
  createPraticaPatente,
  createDocumento,
  createPagamento,
  createAutoscuola,
  createPuntiPatenteResponse,
};

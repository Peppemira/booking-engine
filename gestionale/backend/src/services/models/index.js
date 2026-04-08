/**
 * Modelli equivalenti a GeCA (CandidatoInfo, EsitoPrenotazione, DC/Esiti per SDC).
 */

const { createCandidatoInfo } = require("./candidatoInfo");
const { createEsitoPrenotazione } = require("./esitoPrenotazione");

module.exports = {
  createCandidatoInfo,
  createEsitoPrenotazione,
};

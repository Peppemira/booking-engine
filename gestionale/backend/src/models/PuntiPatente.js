/**
 * PuntiPatente - risposta API interrogazione punti patente (portale).
 */

function createPuntiPatenteResponse(data = {}) {
  return {
    esito: data.esito,
    punti: data.punti,
    codiceFiscale: data.codiceFiscale,
    numeroPatente: data.numeroPatente,
    ...data,
  };
}

module.exports = {
  createPuntiPatenteResponse,
};

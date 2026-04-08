/**
 * Esiti - equivalente GeCA Esiti (risultato SDC / documenti Agenzia Entrate).
 */

function createEsito(data = {}) {
  return {
    esito: data.esito ?? false,
    idtrx: data.idtrx ?? null,
    progressivo: data.progressivo ?? null,
    errori: data.errori ?? null,
  };
}

function createErrore(data = {}) {
  return {
    codice: data.codice ?? "",
    descrizione: data.descrizione ?? "",
  };
}

function createDocumDett(data = {}) {
  return {
    idtrx: data.idtrx,
    numeroProgressivo: data.numeroProgressivo,
    data: data.data,
    tipoOperazione: data.tipoOperazione,
    ammontareComplessivo: data.ammontareComplessivo,
    ...data,
  };
}

module.exports = {
  createEsito,
  createErrore,
  createDocumDett,
};

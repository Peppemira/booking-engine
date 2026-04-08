/**
 * DC (RootObject) - equivalente GeCA DC per documenti di accompagnamento SDC.
 */

function createDatiTrasmissione(data = {}) {
  return {
    formato: data.formato,
    ...data,
  };
}

function createIdentificativiFiscali(data = {}) {
  return {
    codicePaese: data.codicePaese,
    partitaIva: data.partitaIva,
    codiceFiscale: data.codiceFiscale,
    ...data,
  };
}

function createAltriDatiIdentificativi(data = {}) {
  return {
    denominazione: data.denominazione,
    cognome: data.cognome,
    nome: data.nome,
    indirizzo: data.indirizzo,
    numeroCivico: data.numeroCivico,
    cap: data.cap,
    comune: data.comune,
    ...data,
  };
}

function createRootObject(data = {}) {
  return {
    datiTrasmissione: data.datiTrasmissione,
    identificativiFiscali: data.identificativiFiscali,
    altriDatiIdentificativi: data.altriDatiIdentificativi,
    ...data,
  };
}

module.exports = {
  createDatiTrasmissione,
  createIdentificativiFiscali,
  createAltriDatiIdentificativi,
  createRootObject,
};

/**
 * Modello EsitoPrenotazione - equivalente a GeCA EsitoPrenotazione.
 * Risultato di una prenotazione esame (successo/errore, messaggio, dati letti).
 */

/**
 * @typedef {Object} EsitoPrenotazione
 * @property {number} index
 * @property {boolean} successo
 * @property {string} messaggio
 * @property {string} [turnoEffettivo]
 * @property {string} [cognome]
 * @property {string} [foglioRosa]
 * @property {string} [dataEsame]
 */

/**
 * Crea un esito prenotazione (equivalente al costruttore GeCA).
 * @param {number} idx - Indice candidato
 * @param {boolean} ok - Successo
 * @param {string} msg - Messaggio
 * @param {string} [turnoEff]
 * @param {string} [cognomeLetto]
 * @param {string} [foglioRosaLetto]
 * @param {string} [dataEsame]
 * @returns {EsitoPrenotazione}
 */
function createEsitoPrenotazione(
  idx,
  ok,
  msg,
  turnoEff = "",
  cognomeLetto = "",
  foglioRosaLetto = "",
  dataEsame = ""
) {
  return {
    index: idx,
    successo: ok,
    messaggio: msg || "",
    turnoEffettivo: turnoEff,
    cognome: cognomeLetto,
    foglioRosa: foglioRosaLetto,
    dataEsame,
  };
}

module.exports = {
  createEsitoPrenotazione,
};

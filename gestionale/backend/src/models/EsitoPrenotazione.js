/**
 * EsitoPrenotazione - equivalente GeCA EsitoPrenotazione.
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

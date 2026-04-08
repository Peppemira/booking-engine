/**
 * CandidatoInfo - equivalente GeCA CandidatoInfo (prenotazione esame).
 */

function createCandidatoInfo(data = {}) {
  return {
    index: data.index,
    nome: data.nome,
    codiceFoglioRosa: data.codiceFoglioRosa || data.codice_foglio_rosa || "",
    turno: data.turno ?? 0,
    tipoEsame: data.tipoEsame || "QUIZ",
    indicatoreTipoSessione: data.indicatoreTipoSessione,
    codiceSeduta: data.codiceSeduta || "",
    lingua: data.lingua,
    audio: data.audio,
    ...data,
  };
}

module.exports = {
  createCandidatoInfo,
};

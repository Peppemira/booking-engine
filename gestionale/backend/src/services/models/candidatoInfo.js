/**
 * Modello CandidatoInfo - equivalente a GeCA CandidatoInfo.
 * Dati candidato per prenotazione esame (quiz/guida).
 */

/**
 * @typedef {Object} CandidatoInfo
 * @property {number} [index]
 * @property {string} [nome]
 * @property {string} codiceFoglioRosa
 * @property {number} [turno]
 * @property {string} [tipoEsame] - QUIZ | ...
 * @property {string} [indicatoreTipoSessione]
 * @property {string} codiceSeduta
 * @property {string} [lingua]
 * @property {string} [audio]
 */

/**
 * Crea un oggetto CandidatoInfo con campi opzionali.
 * @param {Partial<CandidatoInfo>} data
 * @returns {CandidatoInfo}
 */
function createCandidatoInfo(data = {}) {
  return {
    index: data.index,
    nome: data.nome,
    codiceFoglioRosa: data.codiceFoglioRosa || "",
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

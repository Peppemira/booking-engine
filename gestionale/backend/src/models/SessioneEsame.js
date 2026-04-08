/**
 * SessioneEsame - modello seduta/sessione esame (portale).
 */

function createSessioneEsame(data = {}) {
  return {
    selectRowId: data.selectRowId,
    dataEsame: data.dataEsame,
    tipoEsame: data.tipoEsame,
    postiDisponibili: data.postiDisponibili,
    postiPrenotati: data.postiPrenotati,
    limitePrenotazioni: data.limitePrenotazioni,
    ufficio: data.ufficio,
    stato: data.stato,
    raw: data.raw,
    ...data,
  };
}

module.exports = {
  createSessioneEsame,
};

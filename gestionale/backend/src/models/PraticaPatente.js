/**
 * PraticaPatente - modello pratica patente / richiesta (GeCA Trasmiss, visced, richiestaEsame).
 */

function createPraticaPatente(data = {}) {
  return {
    id: data.id,
    autoscuola_id: data.autoscuola_id,
    candidato_id: data.candidato_id,
    tipo_pratica: data.tipo_pratica, // esame_teoria, guida, rinnovo, certificato_medico, ecc.
    categoria: data.categoria,
    stato: data.stato,
    id_richiesta_portale: data.id_richiesta_portale,
    data_richiesta: data.data_richiesta,
    note: data.note,
    created_at: data.created_at,
    updated_at: data.updated_at,
    ...data,
  };
}

module.exports = {
  createPraticaPatente,
};

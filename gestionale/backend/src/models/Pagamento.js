/**
 * Pagamento - modello pagamento/cassa (GeCA cassa, pagoPA, satispay).
 */

function createPagamento(data = {}) {
  return {
    id: data.id,
    autoscuola_id: data.autoscuola_id,
    candidato_id: data.candidato_id,
    tipo: data.tipo, // contanti, pagoPA, satispay, scontrino
    importo: data.importo,
    causale: data.causale,
    idtrx: data.idtrx,
    progressivo: data.progressivo,
    esito: data.esito,
    data_pagamento: data.data_pagamento,
    created_at: data.created_at,
    ...data,
  };
}

module.exports = {
  createPagamento,
};

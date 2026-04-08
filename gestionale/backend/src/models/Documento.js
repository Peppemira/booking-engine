/**
 * Documento - modello documento/stampa (GeCA stampepdf, ClasseGestioneStampa).
 */

function createDocumento(data = {}) {
  return {
    id: data.id,
    autoscuola_id: data.autoscuola_id,
    candidato_id: data.candidato_id,
    tipo: data.tipo, // ricevuta, dichiarazione, modulo_tt746, certificato_medico, ecc.
    nome_file: data.nome_file,
    path: data.path,
    mime_type: data.mime_type || "application/pdf",
    idtrx: data.idtrx,
    progressivo: data.progressivo,
    created_at: data.created_at,
    ...data,
  };
}

module.exports = {
  createDocumento,
};

/**
 * Autoscuola - modello autoscuola / tenant (GeCA datiautos, Datiint).
 */

function createAutoscuola(data = {}) {
  return {
    id: data.id,
    nome: data.nome,
    email: data.email,
    codice_autoscuola: data.codice_autoscuola,
    prefisso: data.prefisso,
    usport: data.usport,
    pasport: data.pasport,
    pinport: data.pinport,
    created_at: data.created_at,
    updated_at: data.updated_at,
    ...data,
  };
}

module.exports = {
  createAutoscuola,
};

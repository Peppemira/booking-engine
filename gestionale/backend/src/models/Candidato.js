/**
 * Modello Candidato / Iscritto (equivalente anagrafe/ModIscritti GeCA).
 * Struttura dati per anagrafica candidati.
 */

function createCandidato(data = {}) {
  return {
    id: data.id,
    autoscuola_id: data.autoscuola_id,
    nome: data.nome || "",
    cognome: data.cognome || "",
    codice_fiscale: data.codice_fiscale || "",
    data_nascita: data.data_nascita,
    comune_nascita: data.comune_nascita,
    provincia_nascita: data.provincia_nascita,
    indirizzo: data.indirizzo,
    cap: data.cap,
    telefono: data.telefono,
    email: data.email,
    categoria_patente: data.categoria_patente,
    patente_numero: data.patente_numero,
    codice_foglio_rosa: data.codice_foglio_rosa,
    codice_autoscuola: data.codice_autoscuola,
    stato: data.stato,
    tentativi_quiz: data.tentativi_quiz,
    raw_portale: data.raw_portale,
    created_at: data.created_at,
    updated_at: data.updated_at,
    ...data,
  };
}

function candidatoFromRow(row) {
  if (!row) return null;
  return createCandidato({
    id: row.id,
    autoscuola_id: row.autoscuola_id,
    nome: row.nome,
    cognome: row.cognome,
    codice_fiscale: row.codice_fiscale,
    data_nascita: row.data_nascita,
    comune_nascita: row.comune_nascita,
    provincia_nascita: row.provincia_nascita,
    indirizzo: row.indirizzo,
    cap: row.cap,
    telefono: row.telefono,
    email: row.email,
    categoria_patente: row.categoria_patente,
    patente_numero: row.patente_numero,
    codice_foglio_rosa: row.codice_foglio_rosa,
    codice_autoscuola: row.codice_autoscuola,
    stato: row.stato,
    tentativi_quiz: row.tentativi_quiz,
    raw_portale: row.raw_portale,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

module.exports = {
  createCandidato,
  candidatoFromRow,
};

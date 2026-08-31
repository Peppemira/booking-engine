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
    // Anagrafica
    data_nascita: row.data_nascita,
    sesso: row.sesso,
    comune_nascita: row.comune_nascita,
    provincia_nascita: row.provincia_nascita,
    cittadinanza: row.cittadinanza,
    // Residenza
    indirizzo: row.indirizzo,
    cap: row.cap,
    comune: row.comune,
    provincia: row.provincia,
    // Contatti
    telefono: row.telefono,
    email: row.email,
    telefono_1: row.telefono_1,
    email_contatto: row.email_contatto,
    // Patente
    categoria_patente: row.categoria_patente,
    patente_numero: row.patente_numero,
    categoria_posseduta: row.categoria_posseduta,
    categoria_richiesta: row.categoria_richiesta,
    codice_foglio_rosa: row.codice_foglio_rosa,
    scade_il_patente: row.scade_il_patente,
    // Pratiche / CED
    codice_autoscuola: row.codice_autoscuola,
    codice_statino: row.codice_statino,
    codice_statino_portale: row.codice_statino_portale,
    codice_candidato: row.codice_candidato,
    marca_operativa: row.marca_operativa,
    data_iscrizione: row.data_iscrizione,
    // Stato / tipo iscrizione
    stato: row.stato,
    stato_iscrizione: row.stato_iscrizione,
    storico: row.storico,
    tipo_iscrizione: row.tipo_iscrizione,
    tipo_iscrizione_sigla: row.tipo_iscrizione_sigla,
    tipo_iscrizione_label: row.tipo_iscrizione_label,
    // Documento
    tipo_documento: row.tipo_documento,
    numero_documento: row.numero_documento,
    luogo_rilascio_doc: row.luogo_rilascio_doc,
    data_rilascio_doc: row.data_rilascio_doc,
    scade_il_documento: row.scade_il_documento,
    // CQC
    cqc_posseduta: row.cqc_posseduta,
    data_inizio_corso_cqc: row.data_inizio_corso_cqc,
    numero_patente_cqc: row.numero_patente_cqc,
    data_scadenza_cqc: row.data_scadenza_cqc,
    // Misc
    tentativi_quiz: row.tentativi_quiz,
    note: row.note,
    raw_portale: row.raw_portale,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

module.exports = {
  createCandidato,
  candidatoFromRow,
};

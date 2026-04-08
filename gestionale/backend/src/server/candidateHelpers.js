/**
 * Helper condivisi per candidati: payload building, upsert con fallback schema, resolve ID.
 * Estratti da server.js per essere riusabili da controller e route.
 */

const supabase = require("../database/supabase");
const { withTenantFilter, tenantField } = require("./auth");

function buildCandidatePayload(candidate = {}) {
  const candidatePayload = {};
  const fields = [
    "autoscuola_id", "nome", "cognome", "codice_fiscale",
    "categoria_patente", "patente_numero", "telefono", "email",
    "tentativi_quiz", "stato", "storico", "data_nascita",
    "comune_nascita", "provincia_nascita", "codice_autoscuola", "raw_portale",
  ];

  fields.forEach((field) => {
    if (candidate[field] !== undefined && candidate[field] !== null && candidate[field] !== "") {
      candidatePayload[field] = candidate[field];
    }
  });

  return candidatePayload;
}

function getMissingCandidateColumn(error) {
  const message = String(error?.message || "");
  const patterns = [
    /Could not find the '([^']+)' column of 'candidates'/i,
    /column\s+"([^"]+)"\s+of relation\s+"candidates"\s+does not exist/i,
    /column\s+([a-zA-Z0-9_]+)\s+does not exist/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return String(match[1]).trim();
  }

  return "";
}

async function insertCandidateWithFallback(initialPayload = {}) {
  let payload = { ...(initialPayload || {}) };
  const droppedColumns = [];

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data, error } = await supabase
      .from("candidates")
      .insert([payload])
      .select("*")
      .single();

    if (!error) return { data, droppedColumns };

    const missingColumn = getMissingCandidateColumn(error);
    if (!missingColumn || !(missingColumn in payload)) throw error;

    delete payload[missingColumn];
    droppedColumns.push(missingColumn);
  }

  throw new Error("Impossibile salvare candidato: schema database non compatibile");
}

async function updateCandidateWithFallback(initialPayload = {}, req, id) {
  let payload = { ...(initialPayload || {}) };
  const droppedColumns = [];

  for (let attempt = 0; attempt < 10; attempt += 1) {
    let query = supabase.from("candidates").update(payload);
    query = withTenantFilter(query, req);

    const { data, error } = await query.eq("id", id).select("*").single();

    if (!error) return { data, droppedColumns };

    const missingColumn = getMissingCandidateColumn(error);
    if (!missingColumn || !(missingColumn in payload)) throw error;

    delete payload[missingColumn];
    droppedColumns.push(missingColumn);

    if (!Object.keys(payload).length) throw new Error("Nessun campo valido da aggiornare");
  }

  throw new Error("Impossibile aggiornare candidato: schema database non compatibile");
}

async function resolveCandidateId(candidate = {}, req = null) {
  if (candidate.candidate_id) return candidate.candidate_id;

  const codiceFiscale = candidate.codice_fiscale || candidate.codice || null;

  if (codiceFiscale) {
    let existingQuery = supabase
      .from("candidates")
      .select("id")
      .eq("codice_fiscale", codiceFiscale);

    existingQuery = withTenantFilter(existingQuery, req);
    const { data: existingCandidate, error: existingCandidateError } = await existingQuery.maybeSingle();

    if (existingCandidateError) throw existingCandidateError;
    if (existingCandidate?.id) return existingCandidate.id;
  }

  const candidatePayload = buildCandidatePayload({
    ...candidate,
    codice_fiscale: codiceFiscale || candidate.codice_fiscale,
    ...tenantField(req),
  });

  if (!candidatePayload.nome || !candidatePayload.cognome) {
    throw new Error("candidate_id mancante e dati candidato insufficienti per crearlo");
  }

  const { data: createdCandidate, error: createCandidateError } = await supabase
    .from("candidates")
    .insert([candidatePayload])
    .select("id")
    .single();

  if (createCandidateError) throw createCandidateError;

  return createdCandidate.id;
}

module.exports = {
  buildCandidatePayload,
  getMissingCandidateColumn,
  insertCandidateWithFallback,
  updateCandidateWithFallback,
  resolveCandidateId,
};

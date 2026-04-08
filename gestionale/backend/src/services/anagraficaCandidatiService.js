/**
 * AnagraficaCandidatiService - equivalente GeCA anagrafe, ModIscritti, nuovaiscr, dettaglio.
 * CRUD candidati su Supabase (tabella candidates).
 */

const supabase = require("../database/supabase");
const { withTenantFilter, tenantField } = require("../server/auth");
const { createCandidato, candidatoFromRow } = require("../models");

const CANDIDATE_FIELDS = [
  // Identità
  "autoscuola_id",
  "nome",
  "cognome",
  "codice_fiscale",
  "categoria_patente",
  "patente_numero",
  "tentativi_quiz",
  "stato",
  "storico",
  "stato_iscrizione",
  // Anagrafica base
  "sesso",
  "data_nascita",
  "comune_nascita",
  "provincia_nascita",
  "cittadinanza",
  // Residenza
  "indirizzo",
  "cap",
  "comune",
  "provincia",
  // Contatti
  "telefono",
  "email",
  "telefono_1",
  "email_contatto",
  // Documento identità
  "tipo_documento",
  "numero_documento",
  "luogo_rilascio_doc",
  "data_rilascio_doc",
  "scade_il_documento",
  // Patente
  "scade_il_patente",
  "categoria_richiesta",
  "categoria_disponibile",
  "categoria_posseduta",
  "cambio_automatico",
  "validita_patente_mm",
  "validita_patente_aa",
  // Foglio rosa / PPG
  "ppg_data_scadenza",
  "codice_foglio_rosa",
  // Pratiche / CED
  "codice_autoscuola",
  "codice_statino",
  "codice_statino_portale",
  "marca_operativa",
  "data_iscrizione",
  // Portale
  "codice_candidato",
  "turno_prefer",
  "lingua",
  "supporto_audio",
  // Visita medica
  "data_visita_medica",
  "codice_iscrizione_medico",
  "luogo_visita_medica",
  "obbligo_visita_cml",
  "esente_visita_cml",
  "tempo_esteso_teoria",
  // CQC
  "cqc_posseduta",
  "data_inizio_corso_cqc",
  "numero_patente_cqc",
  "data_scadenza_cqc",
  // Patente estera
  "patente_estera_nazione",
  "patente_estera_numero",
  "patente_estera_scadenza",
  // Pagamento / CIA
  "tipo_pagamento",
  "provincia_cia",
  "codice_cia",
  // Prescrizioni
  "prescrizioni_tecniche",
  // Misc
  "note",
  "raw_portale",
  "updated_at",
];

function buildPayload(candidate = {}) {
  const out = {};
  CANDIDATE_FIELDS.forEach((field) => {
    if (candidate[field] !== undefined && candidate[field] !== null && candidate[field] !== "") {
      out[field] = candidate[field];
    }
  });
  return out;
}

function getMissingColumn(error) {
  const msg = String(error?.message || "");
  const patterns = [
    /Could not find the '([^']+)' column of 'candidates'/i,
    /column\s+"([^"]+)"\s+of relation\s+"candidates"\s+does not exist/i,
    /column\s+([a-zA-Z0-9_]+)\s+does not exist/i,
  ];
  for (const p of patterns) {
    const m = msg.match(p);
    if (m?.[1]) return String(m[1]).trim();
  }
  return "";
}

class AnagraficaCandidatiService {
  /**
   * Lista candidati con filtro tenant.
   * @param {object} req - request (per autoscuolaId/tenant)
   * @returns {Promise<{ data: array, error?: object }>}
   */
  async list(req) {
    // Punto 18 — Paginazione: limit/offset opzionali
    const limit  = req?.query?.limit  ? Math.min(parseInt(req.query.limit,  10) || 500, 2000) : null;
    const offset = req?.query?.offset ? Math.max(parseInt(req.query.offset, 10) || 0,   0)    : 0;

    let q = supabase.from("candidates").select("*", { count: "exact" });
    q = withTenantFilter(q, req);

    const archivio = String(req?.query?.archivio || "").toUpperCase();
    if (archivio === "ATTUALE") {
      q = q.or("storico.is.null,storico.eq.false");
    } else if (archivio === "STORICO") {
      q = q.eq("storico", true);
    }
    // ENTRAMBI: nessun filtro aggiuntivo

    q = q.order("created_at", { ascending: false });
    if (limit !== null) {
      q = q.range(offset, offset + limit - 1);
    }

    const { data, error, count } = await q;

    // Fallback: se storico non esiste in schema, filtra in memoria
    if (error && /column.*storico|storico.*does not exist/i.test(String(error.message))) {
      let q2 = supabase.from("candidates").select("*");
      q2 = withTenantFilter(q2, req);
      const { data: d2, error: e2 } = await q2.order("created_at", { ascending: false });
      let rows = d2 || [];
      if (archivio === "ATTUALE") rows = rows.filter((r) => !r.storico);
      else if (archivio === "STORICO") rows = rows.filter((r) => !!r.storico);
      if (limit !== null) rows = rows.slice(offset, offset + limit);
      return { data: rows.map((row) => candidatoFromRow(row) || createCandidato(row)), error: e2 || null, total: rows.length };
    }

    return {
      data: (data || []).map((row) => candidatoFromRow(row) || createCandidato(row)),
      error: error || null,
      total: count ?? (data || []).length,
    };
  }

  /**
   * Ricerca omonimi (GeCA: frmOmoni) – candidati con stessi cognome/nome/data nascita.
   */
  async searchOmonimi({ cognome, nome, dataNascita }, req) {
    if (!cognome && !nome) return { data: [], error: null };

    let q = supabase.from("candidates").select("id,cognome,nome,codice_fiscale,data_nascita,categoria_patente,raw_portale,created_at");
    q = withTenantFilter(q, req);
    if (cognome) q = q.ilike("cognome", cognome.trim());
    if (nome) q = q.ilike("nome", nome.trim());

    const { data, error } = await q.order("cognome");
    if (error) return { data: [], error };

    let rows = data || [];
    if (dataNascita) {
      const dn = String(dataNascita).slice(0, 10);
      rows = rows.filter((r) => {
        const rd = String(r.data_nascita || r.raw_portale?.anagrafica?.data_nascita || "").slice(0, 10);
        return rd === dn;
      });
    }
    return { data: rows.map((row) => candidatoFromRow(row) || createCandidato(row)), error: null };
  }

  /**
   * Candidato per id.
   */
  async getById(id, req) {
    let q = supabase.from("candidates").select("*").eq("id", id);
    q = withTenantFilter(q, req);
    const { data, error } = await q.maybeSingle();
    return {
      data: data ? (candidatoFromRow(data) || createCandidato(data)) : null,
      error: error || null,
    };
  }

  /**
   * Crea candidato (con fallback colonne mancanti).
   */
  async create(payload, req) {
    const base = buildPayload({ ...payload, ...tenantField(req) });
    let p = { ...base };
    const droppedColumns = [];

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const { data, error } = await supabase.from("candidates").insert([p]).select("*").single();
      if (!error) {
        return {
          data: candidatoFromRow(data) || createCandidato(data),
          droppedColumns,
          error: null,
        };
      }
      const missing = getMissingColumn(error);
      if (!missing || !(missing in p)) throw error;
      console.warn(`[anagraficaCandidatiService] Schema mismatch: dropping column '${missing}'`);
      delete p[missing];
      droppedColumns.push(missing);
    }
    throw new Error("Impossibile salvare candidato: schema database non compatibile");
  }

  /**
   * Aggiorna candidato per id.
   */
  async update(id, payload, req) {
    const p = buildPayload(payload);
    if (!Object.keys(p).length) {
      return { data: null, error: new Error("Nessun campo valido da aggiornare") };
    }
    let q = supabase.from("candidates").update(p).eq("id", id);
    q = withTenantFilter(q, req);
    const { data, error } = await q.select("*").single();
    return {
      data: data ? (candidatoFromRow(data) || createCandidato(data)) : null,
      error: error || null,
    };
  }

  /**
   * Elimina candidato per id.
   */
  async delete(id, req) {
    let q = supabase.from("candidates").delete().eq("id", id);
    q = withTenantFilter(q, req);
    const { data, error } = await q.select("id");
    return {
      deleted: Array.isArray(data) && data.length > 0,
      error: error || null,
    };
  }
}

const anagraficaCandidatiService = new AnagraficaCandidatiService();

module.exports = {
  AnagraficaCandidatiService,
  anagraficaCandidatiService,
  buildPayload,
  getMissingColumn,
};

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
  // Tipo iscrizione (sigla GeCA + label) — serve per dispatcher trasmissione
  "tipo_iscrizione_sigla",
  "tipo_iscrizione",
  "tipo_iscrizione_label",
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

    // Helper per costruire la query base riusabile (serve per la paginazione manuale)
    const buildBase = () => {
      let qq = supabase.from("candidates").select("*", { count: "exact" });
      qq = withTenantFilter(qq, req);
      const archivio2 = String(req?.query?.archivio || "").toUpperCase();
      if (archivio2 === "ATTUALE") {
        qq = qq.or("storico.is.null,storico.eq.false");
      } else if (archivio2 === "STORICO") {
        qq = qq.eq("storico", true);
      }
      return qq.order("created_at", { ascending: false });
    };

    let data, error, count;

    if (limit !== null) {
      // Paginazione esplicita: un solo fetch sulla range richiesta
      const q = buildBase().range(offset, offset + limit - 1);
      ({ data, error, count } = await q);
    } else {
      // Nessun limit: loop interno per aggirare il limite default 1000 di PostgREST
      const PAGE = 1000;
      data = [];
      let start = 0;
      while (true) {
        const { data: chunk, error: e, count: c } = await buildBase().range(start, start + PAGE - 1);
        if (e) { error = e; break; }
        if (!chunk || chunk.length === 0) {
          if (count === undefined) count = c;
          break;
        }
        data.push(...chunk);
        if (count === undefined) count = c;
        if (chunk.length < PAGE) break;
        start += PAGE;
        // safety cap
        if (start > 50000) break;
      }
    }

    // Fallback: se storico non esiste in schema, filtra in memoria
    if (error && /column.*storico|storico.*does not exist/i.test(String(error.message))) {
      let q2 = supabase.from("candidates").select("*");
      q2 = withTenantFilter(q2, req);
      const { data: d2, error: e2 } = await q2.order("created_at", { ascending: false });
      let rows = d2 || [];
      const archivioFb = String(req?.query?.archivio || "").toUpperCase();
      if (archivioFb === "ATTUALE") rows = rows.filter((r) => !r.storico);
      else if (archivioFb === "STORICO") rows = rows.filter((r) => !!r.storico);
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
   *
   * Parametri:
   *   - cognome: stringa (prefix match automatico, aggiunge % in coda se mancante)
   *   - nome: stringa (prefix match automatico)
   *   - dataNascita: YYYY-MM-DD (opzionale — filtro esatto)
   *   - exact: boolean (default false). Se true, ilike senza wildcard (comportamento precedente)
   *
   * Ritorna campi estesi usati dalla modale omonimi:
   *   id, cognome, nome, codice_fiscale, data_nascita, telefono,
   *   categoria_patente, categoria_richiesta, codice_autoscuola,
   *   data_iscrizione, stato_iscrizione, raw_portale, created_at
   */
  async searchOmonimi({ cognome, nome, dataNascita, exact = false }, req) {
    if (!cognome && !nome) return { data: [], error: null };

    // Helper: costruisce pattern ilike. Se exact=false aggiunge % in coda (prefix match).
    const wrapPattern = (v) => {
      const t = String(v || "").trim();
      if (!t) return null;
      if (exact) return t;
      return t.includes("%") ? t : `${t}%`;
    };

    const SELECT_FULL =
      "id,cognome,nome,codice_fiscale,data_nascita,telefono," +
      "categoria_patente,categoria_richiesta,codice_autoscuola," +
      "data_iscrizione,stato_iscrizione,raw_portale,created_at";
    const SELECT_MIN =
      "id,cognome,nome,codice_fiscale,data_nascita,categoria_patente,raw_portale,created_at";

    const runQuery = async (selectCols) => {
      let q = supabase.from("candidates").select(selectCols);
      q = withTenantFilter(q, req);
      if (cognome) {
        const p = wrapPattern(cognome);
        if (p) q = q.ilike("cognome", p);
      }
      if (nome) {
        const p = wrapPattern(nome);
        if (p) q = q.ilike("nome", p);
      }
      return await q.order("cognome").limit(500);
    };

    let { data, error } = await runQuery(SELECT_FULL);

    // Fallback: se una delle colonne estese non esiste in schema, riprova con select minimo
    if (error && /column.*does not exist|Could not find/i.test(String(error.message))) {
      const retry = await runQuery(SELECT_MIN);
      data = retry.data;
      error = retry.error;
    }
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

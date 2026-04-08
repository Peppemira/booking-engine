/**
 * SyncService - sincronizzazione portale → Supabase.
 * Usa PortalService (pratiche), parser (HTML → pratiche/candidati), AnagraficaCandidatiService, PratichePatenteService.
 * 1) Recupera pratiche dal portale
 * 2) Estrae candidati
 * 3) Salva/aggiorna candidati (candidates)
 * 4) Salva pratiche (pratiche_patente)
 * 5) Collega candidati alle pratiche (candidato_id)
 */

const supabase = require("../database/supabase");
const { withTenantFilter, tenantField } = require("../server/auth");
const { parsePratichePortalHtml } = require("../parser/pratichePortalParser");
const { anagraficaCandidatiService } = require("./anagraficaCandidatiService");
const { pratichePatenteService } = require("./pratichePatenteService");

const CANDIDATE_FIELDS = [
  // Identità
  "nome",
  "cognome",
  "codice_fiscale",
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
  // Patente
  "categoria_patente",
  "patente_numero",
  "categoria_richiesta",
  // Pratiche
  "marca_operativa",
  "codice_statino",
  "codice_statino_portale",
  "codice_autoscuola",
  "data_iscrizione",
  "stato",
  "stato_iscrizione",
  // Foglio rosa
  "codice_foglio_rosa",
  "ppg_data_scadenza",
  // Documento
  "tipo_documento",
  "numero_documento",
  // Portale
  "codice_candidato",
  "turno_prefer",
  "lingua",
  "supporto_audio",
  "tentativi_quiz",
  // Misc
  "note",
  "raw_portale",
  "autoscuola_id",
];

function buildCandidatePayload(row) {
  const out = {};
  CANDIDATE_FIELDS.forEach((f) => {
    if (row[f] !== undefined && row[f] !== null && row[f] !== "") {
      out[f] = row[f];
    }
  });
  // Garantisci che data_iscrizione sia impostata
  if (!out.data_iscrizione && row.data_emissione_statino) {
    // Converti DD/MM/YYYY → YYYY-MM-DD se necessario
    const d = String(row.data_emissione_statino).trim();
    const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    out.data_iscrizione = m ? `${m[3]}-${m[2]}-${m[1]}` : d;
  }
  // Converti date portale DD/MM/YYYY → YYYY-MM-DD
  ["data_nascita", "ppg_data_scadenza", "data_iscrizione"].forEach((df) => {
    if (out[df]) {
      const dm = String(out[df]).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (dm) out[df] = `${dm[3]}-${dm[2]}-${dm[1]}`;
    }
  });
  return out;
}

class SyncService {
  /**
   * Recupera tutte le pratiche dal portale (HTML) e le restituisce parseate.
   * @param {object} portal - Istanza PortalService con client già loggato
   * @param {object} [query] - Parametri per getPratichePatente (marcaOperativa, action: 'Ricerca', ...)
   * @returns {Promise<{ pratiche: array, candidati: array, html: string }>}
   */
  async fetchPraticheFromPortal(portal, query = {}) {
    const html = await portal.getPratichePatente(query);
    const { pratiche, candidati } = parsePratichePortalHtml(html);
    return { pratiche, candidati, html: html ? html.slice(0, 500) : "" };
  }

  /**
   * Salva o aggiorna candidati su Supabase (upsert per codice_fiscale).
   * @param {object} req - request (tenant)
   * @param {array} candidati - lista { codice_fiscale, cognome, nome, data_nascita, raw_portale, ... }
   * @returns {Promise<{ inserted: number, updated: number, idsByCf: Map, errors: array }>}
   */
  async syncCandidati(req, candidati = []) {
    const idsByCf = new Map();
    let inserted = 0;
    let updated = 0;
    const errors = [];

    for (const c of candidati) {
      const payload = buildCandidatePayload({ ...c, ...tenantField(req) });
      if (!payload.codice_fiscale && !payload.cognome && !payload.nome) continue;

      try {
        let q = supabase.from("candidates").select("id").eq("codice_fiscale", payload.codice_fiscale || "");
        q = withTenantFilter(q, req);
        const { data: existing, error: findError } = await q.maybeSingle();

        if (findError) {
          errors.push({ cf: payload.codice_fiscale, message: findError.message });
          continue;
        }

        if (existing?.id) {
          const { data: updatedRow, error: updError } = await anagraficaCandidatiService.update(existing.id, payload, req);
          if (updError) {
            errors.push({ cf: payload.codice_fiscale, message: updError.message });
            continue;
          }
          updated += 1;
          const key = payload.codice_fiscale || `c_${payload.cognome || ""}_${payload.nome || ""}`;
          idsByCf.set(key, updatedRow?.id ?? existing.id);
          if (payload.codice_fiscale) idsByCf.set(payload.codice_fiscale, updatedRow?.id ?? existing.id);
        } else {
          const { data: created, error: insError } = await anagraficaCandidatiService.create(payload, req);
          if (insError) {
            errors.push({ cf: payload.codice_fiscale, message: insError.message });
            continue;
          }
          inserted += 1;
          const key = payload.codice_fiscale || `c_${payload.cognome || ""}_${payload.nome || ""}`;
          idsByCf.set(key, created?.id);
          if (payload.codice_fiscale) idsByCf.set(payload.codice_fiscale, created?.id);
        }
      } catch (e) {
        errors.push({ cf: payload.codice_fiscale, message: e.message || "Errore" });
      }
    }

    return { inserted, updated, idsByCf, errors };
  }

  /**
   * Salva pratiche su pratiche_patente e le collega ai candidati (candidato_id).
   * @param {object} req - request (tenant)
   * @param {array} pratiche - lista da portale (con codice_fiscale, marca_operativa, ...)
   * @param {Map} idsByCf - mappa codice_fiscale (o chiave alternativa) → id candidato Supabase
   * @returns {Promise<{ inserted: number, updated: number, errors: array }>}
   */
  async syncPratiche(req, pratiche = [], idsByCf = new Map()) {
    let inserted = 0;
    let updated = 0;
    const errors = [];

    for (const p of pratiche) {
      const candidateId = (p.codice_fiscale && idsByCf.get(p.codice_fiscale)) || idsByCf.get(`c_${p.cognome || ""}_${p.nome || ""}`);
      const row = {
        tipo_pratica: p.tipo_pratica || "richiesta_patente",
        stato: p.stato || null,
        id_richiesta_portale: p.id_richiesta_portale || p.marca_operativa || null,
        data_richiesta: p.data_richiesta || null,
        note: p.note || (p.patente ? `patente: ${p.patente}` : null),
        candidato_id: candidateId || null,
        ...tenantField(req),
      };

      try {
        let q = supabase.from("pratiche_patente").select("id").eq("id_richiesta_portale", row.id_richiesta_portale);
        q = withTenantFilter(q, req);
        const { data: existing, error: findError } = await q.maybeSingle();

        if (findError) {
          errors.push({ marca: row.id_richiesta_portale, message: findError.message });
          continue;
        }

        if (existing?.id) {
          let updateQuery = supabase
            .from("pratiche_patente")
            .update({ stato: row.stato, candidato_id: row.candidato_id, note: row.note, updated_at: new Date().toISOString() })
            .eq("id", existing.id);
          updateQuery = withTenantFilter(updateQuery, req);
          const { error: updErr } = await updateQuery;
          if (updErr) {
            errors.push({ marca: row.id_richiesta_portale, message: updErr.message });
            continue;
          }
          updated += 1;
        } else {
          const { error: insError } = await supabase.from("pratiche_patente").insert([row]);
          if (insError) {
            errors.push({ marca: row.id_richiesta_portale, message: insError.message });
            continue;
          }
          inserted += 1;
        }
      } catch (e) {
        errors.push({ marca: row.id_richiesta_portale, message: e.message || "Errore" });
      }
    }

    return { inserted, updated, errors };
  }

  /**
   * Sync solo pratiche: fetch dal portale e ritorna dati parseati (nessun salvataggio DB).
   * @param {object} portal - PortalService con client loggato
   * @param {object} [query]
   */
  async syncPraticheOnly(portal, query = {}) {
    return this.fetchPraticheFromPortal(portal, query);
  }

  /**
   * Sync solo candidati: fetch dal portale, estrae candidati, salva/aggiorna su Supabase.
   * @param {object} portal - PortalService con client loggato
   * @param {object} req
   * @param {object} [query] - per getPratichePatente
   */
  async syncCandidatiOnly(portal, req, query = {}) {
    const { pratiche, candidati } = await this.fetchPraticheFromPortal(portal, query);
    return this.syncCandidati(req, candidati);
  }

  /**
   * Sync completo: fetch pratiche → estrai candidati → salva candidati → salva pratiche → collega.
   * @param {object} portal - PortalService con client loggato
   * @param {object} req
   * @param {object} [query] - per getPratichePatente
   */
  async syncCompleto(portal, req, query = {}) {
    const { pratiche, candidati } = await this.fetchPraticheFromPortal(portal, query);
    const candidatiResult = await this.syncCandidati(req, candidati);
    const idsByCf = candidatiResult.idsByCf;
    const praticheResult = await this.syncPratiche(req, pratiche, idsByCf);
    return {
      pratiche: { count: pratiche.length, ...praticheResult },
      candidati: { count: candidati.length, ...candidatiResult },
    };
  }
}

const syncService = new SyncService();

module.exports = {
  SyncService,
  syncService,
};

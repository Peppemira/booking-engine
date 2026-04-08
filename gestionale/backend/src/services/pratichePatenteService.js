/**
 * PratichePatenteService - equivalente GeCA Trasmiss, visced, richiestaEsame, frmpatenti, gestPatA.
 * Gestione pratiche patente (richieste esami, certificati, trasmissioni portale).
 */

const supabase = require("../database/supabase");
const { withTenantFilter, tenantField } = require("../server/auth");
const { createPraticaPatente } = require("../models");
const { BookingService } = require("./bookingService");

const TABLE_PRATICHE = "pratiche_patente";

/**
 * Se la tabella pratiche_patente non esiste, le operazioni DB falliranno;
 * il servizio espone la logica e può essere usato con tabelle custom.
 */
class PratichePatenteService {
  /**
   * Lista pratiche per tenant (e opzionale candidato_id).
   */
  async list(req, filters = {}) {
    let q = supabase.from(TABLE_PRATICHE).select("*");
    q = withTenantFilter(q, req);
    if (filters.candidato_id) q = q.eq("candidato_id", filters.candidato_id);
    if (filters.tipo_pratica) q = q.eq("tipo_pratica", filters.tipo_pratica);
    if (filters.stato) q = q.eq("stato", filters.stato);
    const { data, error } = await q.order("created_at", { ascending: false });
    return {
      data: (data || []).map((r) => createPraticaPatente(r)),
      error: error || null,
    };
  }

  /**
   * Ottiene una pratica per id.
   */
  async getById(id, req) {
    let q = supabase.from(TABLE_PRATICHE).select("*").eq("id", id);
    q = withTenantFilter(q, req);
    const { data, error } = await q.maybeSingle();
    return {
      data: data ? createPraticaPatente(data) : null,
      error: error || null,
    };
  }

  /**
   * Crea una pratica (stub: salvataggio su tabella pratiche_patente se presente).
   */
  async create(payload, req) {
    const row = {
      ...payload,
      ...tenantField(req),
    };
    const { data, error } = await supabase
      .from(TABLE_PRATICHE)
      .insert([row])
      .select("*")
      .single()
      .catch((e) => ({ data: null, error: e }));
    if (error) {
      return { data: null, error, created: false };
    }
    return {
      data: data ? createPraticaPatente(data) : null,
      error: null,
      created: true,
    };
  }

  /**
   * Aggiorna stato pratica.
   */
  async update(id, payload, req) {
    let q = supabase.from(TABLE_PRATICHE).update(payload).eq("id", id);
    q = withTenantFilter(q, req);
    const { data, error } = await q.select("*").single();
    return {
      data: data ? createPraticaPatente(data) : null,
      error: error || null,
    };
  }

  /**
   * Richiesta prenotazione esame (delega a BookingService/connector portale).
   * @param {object} opts - { client, candidati: CandidatoInfo[], seduta, credenziali portale, ... }
   */
  async richiestaPrenotazioneEsame(opts) {
    const booking = new BookingService(opts.client || null);
    return booking.prenota(opts);
  }
}

const pratichePatenteService = new PratichePatenteService();

module.exports = {
  PratichePatenteService,
  pratichePatenteService,
  TABLE_PRATICHE,
};

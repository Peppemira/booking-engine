/**
 * PagamentiService - equivalente GeCA cassa, pagoPA, satispay, modpagoPA, scontrini.
 * Gestione pagamenti (contanti, pagoPA, satispay, registrazione scontrini).
 */

const supabase = require("../database/supabase");
const { withTenantFilter, tenantField } = require("../server/auth");
const { createPagamento } = require("../models");

const TABLE_PAGAMENTI = "pagamenti";

class PagamentiService {
  /**
   * Lista pagamenti per tenant (e opzionale candidato_id).
   */
  async list(req, filters = {}) {
    // Punto 18 — Paginazione
    const limit  = req?.query?.limit  ? Math.min(parseInt(req.query.limit,  10) || 500, 2000) : null;
    const offset = req?.query?.offset ? Math.max(parseInt(req.query.offset, 10) || 0,   0)    : 0;

    let q = supabase.from(TABLE_PAGAMENTI).select("*", { count: "exact" });
    q = withTenantFilter(q, req);
    if (filters.candidato_id) q = q.eq("candidato_id", filters.candidato_id);
    if (filters.tipo) q = q.eq("tipo", filters.tipo);
    q = q.order("created_at", { ascending: false });
    if (limit !== null) q = q.range(offset, offset + limit - 1);
    const { data, error, count } = await q;
    return {
      data:  (data || []).map((r) => createPagamento(r)),
      error: error || null,
      total: count ?? (data || []).length,
    };
  }

  /**
   * Ottiene un pagamento per id.
   */
  async getById(id, req) {
    let q = supabase.from(TABLE_PAGAMENTI).select("*").eq("id", id);
    q = withTenantFilter(q, req);
    const { data, error } = await q.maybeSingle();
    return {
      data: data ? createPagamento(data) : null,
      error: error || null,
    };
  }

  /**
   * Registra un pagamento (inserimento su tabella pagamenti se presente).
   */
  async registra(payload, req) {
    const row = {
      ...payload,
      ...tenantField(req),
    };
    const { data, error } = await supabase
      .from(TABLE_PAGAMENTI)
      .insert([row])
      .select("*")
      .single()
      .catch((e) => ({ data: null, error: e }));
    if (error) {
      return { data: null, error, created: false };
    }
    return {
      data: data ? createPagamento(data) : null,
      error: null,
      created: true,
    };
  }

  /**
   * Stub: avvio pagamento pagoPA (integrazione esterna).
   */
  async avviaPagoPA(payload) {
    return {
      success: false,
      message: "Integrazione pagoPA non implementata",
      redirectUrl: null,
      idTransazione: null,
    };
  }

  /**
   * Stub: avvio pagamento Satispay (integrazione esterna).
   */
  async avviaSatispay(payload) {
    return {
      success: false,
      message: "Integrazione Satispay non implementata",
      paymentId: null,
    };
  }
}

const pagamentiService = new PagamentiService();

module.exports = {
  PagamentiService,
  pagamentiService,
  TABLE_PAGAMENTI,
};

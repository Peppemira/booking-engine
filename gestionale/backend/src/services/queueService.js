/**
 * Servizio lista di attesa per il Radar Sedute.
 * Usa la tabella waitlist (stato "pending" = in attesa, "prenotato" = prenotato con successo).
 */

const supabase = require("../database/supabase");
const { withTenantFilter, tenantField } = require("../server/auth");

const STATUS_ATTESA = "pending";
const STATUS_PRENOTATO = "prenotato";

/**
 * Restituisce la lista di attesa (waitlist) in stato "pending", ordinata per priorità.
 * @param {object} [req] - request con autoscuolaId per tenant (opzionale)
 * @returns {Promise<array>} righe waitlist con candidates(nome, cognome, codice_fiscale, raw_portale, codice_foglio_rosa)
 */
async function getListaAttesa(req = null) {
  let q = supabase
    .from("waitlist")
    .select("id, candidate_id, status, priority, created_at, candidates(id, nome, cognome, codice_fiscale, data_nascita, codice_foglio_rosa, raw_portale)")
    .eq("status", STATUS_ATTESA)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });
  q = withTenantFilter(q, req);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/**
 * Segna una voce della lista come prenotata (rimuove dalla coda attiva).
 * @param {string} id - id riga waitlist
 * @param {object} [req] - request per tenant
 */
async function segnaPrenotato(id, req = null) {
  let q = supabase.from("waitlist").update({ status: STATUS_PRENOTATO }).eq("id", id);
  q = withTenantFilter(q, req);
  const { error } = await q;
  if (error) throw error;
}

/**
 * Conta le voci in attesa.
 */
async function countInAttesa(req = null) {
  let q = supabase.from("waitlist").select("id", { count: "exact", head: true }).eq("status", STATUS_ATTESA);
  q = withTenantFilter(q, req);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

/**
 * Conta le voci prenotate (eseguite dal radar o manualmente).
 * @param {object} [req] - request per tenant
 * @param {number} [days] - se impostato, conta solo le prenotazioni degli ultimi N giorni (per updated_at)
 */
async function countPrenotati(req = null, days = null) {
  let q = supabase.from("waitlist").select("id", { count: "exact", head: true }).eq("status", STATUS_PRENOTATO);
  if (days != null && days > 0) {
    const since = new Date();
    since.setDate(since.getDate() - Number(days));
    q = q.gte("updated_at", since.toISOString());
  }
  q = withTenantFilter(q, req);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

module.exports = {
  getListaAttesa,
  segnaPrenotato,
  countInAttesa,
  countPrenotati,
  STATUS_ATTESA,
  STATUS_PRENOTATO,
};

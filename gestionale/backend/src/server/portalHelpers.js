/**
 * Helper condivisi: credenziali portale e gestione waitlist.
 * Estratti da server.js per essere riusabili da controller e route.
 */

const supabase = require("../database/supabase");
const { withTenantFilter, tenantField } = require("./auth");

/**
 * Risolve le credenziali portale dal record autoscuola (Supabase) o dalle env vars.
 */
async function resolvePortalCredentials(req) {
  if (req?.autoscuolaId) {
    const { data, error } = await supabase
      .from("autoscuole")
      .select("portal_user,portal_pass,portal_pin")
      .eq("id", req.autoscuolaId)
      .maybeSingle();

    if (error) {
      throw new Error(`Errore lettura credenziali portale: ${error.message}`);
    }

    if (data?.portal_user && data?.portal_pass) {
      return {
        username: data.portal_user,
        password: data.portal_pass,
        pin: data.portal_pin || process.env.PORTAL_PIN || null,
      };
    }
  }

  return {
    username: process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
    password: process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
    pin: process.env.PORTAL_PIN || null,
  };
}

/**
 * Aggiunge (o aggiorna) candidati nella waitlist.
 */
async function addCandidatesToBookingList(candidateIds = [], req = null) {
  const normalizedIds = Array.from(
    new Set((candidateIds || []).map((id) => String(id || "").trim()).filter(Boolean))
  );
  const linked = [];

  for (let index = 0; index < normalizedIds.length; index += 1) {
    const candidateId = normalizedIds[index];
    const priority = index + 1;

    let existingQuery = supabase
      .from("waitlist")
      .select("id")
      .eq("candidate_id", candidateId);

    existingQuery = withTenantFilter(existingQuery, req);
    const { data: existing, error: existingError } = await existingQuery
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existing?.id) {
      const { data: updated, error: updateError } = await supabase
        .from("waitlist")
        .update({ status: "pending", priority, last_error: null, last_attempt_at: null })
        .eq("id", existing.id)
        .select("id,candidate_id,priority,status")
        .single();

      if (updateError) throw updateError;
      linked.push(updated);
      continue;
    }

    const { data: inserted, error: insertError } = await supabase
      .from("waitlist")
      .insert([{ candidate_id: candidateId, status: "pending", priority, ...tenantField(req) }])
      .select("id,candidate_id,priority,status")
      .single();

    if (insertError) throw insertError;
    linked.push(inserted);
  }

  return linked;
}

module.exports = { resolvePortalCredentials, addCandidatesToBookingList };

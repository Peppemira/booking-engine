const supabase = require("../database/supabase");
const { withTenantFilter, tenantField } = require("../server/auth");

/**
 * rows: array di oggetti tipo:
 * {
 *   codice_fiscale: "RSSMRA80A01F205X", // opzionale
 *   cognome: "ROSSI",
 *   nome: "MARIO",
 *   data_iscrizione: "2026-03-10",      // YYYY-MM-DD
 *   categoria_patente: "B",
 *   tipo_esame: "Teoria" | "Guida",     // opzionale, per estensioni future
 * }
 */
async function upsertConseguimenti(rows, req) {
  let insertedPratiche = 0;
  let updatedPratiche = 0;
  const errors = [];

  for (const row of rows) {
    const cf = (row.codice_fiscale || "").trim().toUpperCase();
    const cognome = (row.cognome || "").trim();
    const nome = (row.nome || "").trim();
    const dataIscrizione = (row.data_iscrizione || "").trim();
    const categoriaPatente = (row.categoria_patente || "").trim();
    const tipoPratica = "CONSEGUIMENTO";

    if (!cognome && !nome && !cf) continue;
    if (!dataIscrizione || !categoriaPatente) continue;

    try {
      // 1) Trova o crea candidato
      let candidateId = null;

      if (cf) {
        // La chiave codice_fiscale è globale (unique), quindi NON applichiamo filtro tenant qui
        let q = supabase.from("candidates").select("id").eq("codice_fiscale", cf);
        const { data: existing, error: findErr } = await q.maybeSingle();
        if (findErr) throw findErr;

        if (existing) {
          candidateId = existing.id;
        } else {
          const payload = {
            codice_fiscale: cf,
            cognome,
            nome,
            categoria_patente: categoriaPatente || null,
            storico: false,
            ...tenantField(req),
          };
          const { data: created, error: insErr } = await supabase
            .from("candidates")
            .insert([payload])
            .select("*")
            .single();
          if (insErr) throw insErr;
          candidateId = created.id;
        }
      }

      // se non abbiamo CF, proviamo a matchare per nome+cognome
      if (!candidateId) {
        // Match di cortesia per nome+cognome (anche qui senza filtro tenant per evitare duplicati)
        let q = supabase
          .from("candidates")
          .select("id")
          .eq("cognome", cognome)
          .eq("nome", nome);
        const { data: existingByName, error: findByNameErr } = await q.maybeSingle();
        if (findByNameErr && findByNameErr.code !== "PGRST116") throw findByNameErr;

        if (existingByName) {
          candidateId = existingByName.id;
        } else {
          const payload = {
            cognome,
            nome,
            categoria_patente: categoriaPatente || null,
            storico: false,
            ...tenantField(req),
          };
          const { data: created, error: insErr } = await supabase
            .from("candidates")
            .insert([payload])
            .select("*")
            .single();
          if (insErr) throw insErr;
          candidateId = created.id;
        }
      }

      // 2) Upsert pratica patente (chiave: candidate_id + tipo_pratica + categoria_patente)
      let qPract = supabase
        .from("pratiche_patente")
        .select("id")
        .eq("candidate_id", candidateId)
        .eq("tipo_pratica", tipoPratica)
        .eq("categoria_patente", categoriaPatente);

      const { data: existingPratica, error: findPraticaErr } = await qPract.maybeSingle();
      if (findPraticaErr && findPraticaErr.code !== "PGRST116") throw findPraticaErr;

      const praticaPayload = {
        candidate_id: candidateId,
        tipo_pratica: tipoPratica,
        categoria_patente: categoriaPatente,
        data_iscrizione: dataIscrizione,

        // campi stato/autoscuola/base
        stato_pratica: row.stato_pratica || "in_corso",
        codice_autoscuola: row.codice_autoscuola || null,
        note: row.note || null,

        // nuovi metadati tecnici dello statino
        codice_statino: row.codice_statino || null,
        marca_operativa: row.marca_operativa || null,
        data_emissione_statino: row.data_emissione_statino || null,
        data_scadenza_statino: row.data_scadenza_statino || null,
        // niente autoscuola_id qui: la colonna potrebbe non esistere su pratiche_patente
      };

      if (existingPratica) {
        const { error: updErr } = await supabase
          .from("pratiche_patente")
          .update(praticaPayload)
          .eq("id", existingPratica.id);

        if (updErr) throw updErr;
        updatedPratiche += 1;
      } else {
        const { error: insPrErr } = await supabase
          .from("pratiche_patente")
          .insert([praticaPayload]);
        if (insPrErr) throw insPrErr;
        insertedPratiche += 1;
      }
    } catch (e) {
      errors.push({
        cf,
        nome,
        cognome,
        message: e.message || String(e),
      });
    }
  }

  return { insertedPratiche, updatedPratiche, errors };
}

module.exports = { upsertConseguimenti };


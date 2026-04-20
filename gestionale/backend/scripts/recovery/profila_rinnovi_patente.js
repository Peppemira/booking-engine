// Profilazione READ-ONLY rinnovi PATENTE in rinnovi_portale per GM.
// Speculare al pattern medico (4480 righe già completate).
// Conta dati disponibili per il calcolo: data_visita_medica nel dettaglio,
// data_inserimento, data_nascita, categoria_patente, data_scadenza esistente.

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const GM = "9380513a-99ad-4067-adc7-493af2e083d1";

async function fetchAllRinnoviPatente() {
  const rows = [];
  const PAGE = 1000;
  for (let start = 0; start < 100000; start += PAGE) {
    const { data, error } = await supabase
      .from("rinnovi_portale")
      .select("id, marca_operativa, codice_fiscale, data_nascita, candidato_id, data_scadenza, categoria_patente, data_inserimento, dettaglio")
      .eq("autoscuola_id", GM)
      .eq("tipo_rinnovo", "patente")
      .range(start, start + PAGE - 1)
      .order("id", { ascending: true });
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

(async () => {
  console.log("=== Profilazione rinnovi PATENTE in rinnovi_portale GM ===\n");

  const all = await fetchAllRinnoviPatente();
  console.log(`Totale righe rinnovi_portale tipo='patente': ${all.length}\n`);

  // Analisi campi popolati
  const stats = {
    con_data_scadenza: 0,
    con_data_inserimento: 0,
    con_data_nascita: 0,
    con_categoria_patente: 0,
    con_codice_fiscale: 0,
    con_candidato_id: 0,
    con_dettaglio: 0,
  };
  const dettaglioKeys = new Map(); // key → count
  for (const r of all) {
    if (r.data_scadenza) stats.con_data_scadenza += 1;
    if (r.data_inserimento) stats.con_data_inserimento += 1;
    if (r.data_nascita) stats.con_data_nascita += 1;
    if (r.categoria_patente) stats.con_categoria_patente += 1;
    if (r.codice_fiscale) stats.con_codice_fiscale += 1;
    if (r.candidato_id) stats.con_candidato_id += 1;
    if (r.dettaglio) {
      stats.con_dettaglio += 1;
      for (const k of Object.keys(r.dettaglio || {})) {
        dettaglioKeys.set(k, (dettaglioKeys.get(k) || 0) + 1);
      }
    }
  }

  console.log("Campi top-level (su 2952):");
  for (const [k, v] of Object.entries(stats)) {
    const pct = ((v / all.length) * 100).toFixed(1);
    console.log(`   ${k.padEnd(28)} ${String(v).padStart(5)}  (${pct}%)`);
  }
  console.log();

  console.log("Top 25 chiavi nel JSONB dettaglio:");
  const detKeysSorted = [...dettaglioKeys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  for (const [k, v] of detKeysSorted) {
    console.log(`   ${String(k).padEnd(40)} ${v}`);
  }
  console.log();

  // Quanti hanno data_visita_medica nel dettaglio?
  let conVisitaMedicaInDettaglio = 0;
  let conDataRilascioInDettaglio = 0;
  const possibleDateFields = ["data_visita_medica", "dataVisitaMedica", "data_rilascio_patente", "dataRilascioPatente", "data_rilascio", "dataRilascio", "data_emissione"];
  const fieldFreq = {};
  for (const r of all) {
    const det = r.dettaglio || {};
    if (det.data_visita_medica || det.dataVisitaMedica) conVisitaMedicaInDettaglio += 1;
    for (const f of possibleDateFields) {
      if (det[f]) fieldFreq[f] = (fieldFreq[f] || 0) + 1;
    }
  }
  console.log("Date rilevanti per il calcolo nel dettaglio:");
  for (const f of possibleDateFields) {
    console.log(`   ${f.padEnd(30)} ${fieldFreq[f] || 0}`);
  }
  console.log();

  // Sample dettaglio
  console.log("Sample 3 dettagli completi (per ispezionare i nomi campo reali):");
  for (const r of all.slice(0, 3)) {
    console.log(`\n--- ID ${r.id} ---`);
    console.log(`   marca_operativa: ${r.marca_operativa}`);
    console.log(`   data_inserimento: ${r.data_inserimento}`);
    console.log(`   codice_fiscale: ${r.codice_fiscale}`);
    console.log(`   data_nascita: ${r.data_nascita}`);
    console.log(`   categoria_patente: ${r.categoria_patente}`);
    console.log(`   data_scadenza esistente: ${r.data_scadenza}`);
    console.log(`   dettaglio:`, JSON.stringify(r.dettaglio || {}, null, 2).slice(0, 500));
  }
  console.log();

  console.log("=== Profilazione completata ===");
})().catch((e) => {
  console.error("FATAL:", e?.message || JSON.stringify(e));
  process.exit(1);
});

// Controlla gli ultimi run del sync archivio
require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

(async () => {
  const { data: runs, error } = await supabase
    .from("archivio_sync_log")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(10);
  if (error) {
    console.log("Errore:", error.message);
    return;
  }
  console.log(`Ultimi ${runs?.length || 0} run sync:`);
  for (const r of runs || []) {
    console.log(`\n--- Run ${r.id} (${r.started_at})`);
    console.log(`  stato: ${r.stato || r.status || "?"}`);
    console.log(`  tipo: ${r.tipo_sync || "?"}, trigger: ${r.trigger_source || "?"}`);
    console.log(`  data range: ${r.data_inizio} → ${r.data_fine}`);
    console.log(`  autoscuola_id: ${r.autoscuola_id || "(nessuna)"}`);
    console.log(`  include: esami=${r.include_esami} pat=${r.include_rinnovi_pat} med=${r.include_rinnovi_med} cqc=${r.include_rinnovi_cqc}`);
    console.log(`  candidati: ${r.candidati_trovati || 0} trovati / ${r.candidati_inseriti || 0} inseriti / ${r.candidati_aggiornati || 0} aggiornati`);
    console.log(`  rinnovi: ${r.rinnovi_trovati || 0} trovati / ${r.rinnovi_inseriti || 0} inseriti / ${r.rinnovi_aggiornati || 0} aggiornati`);
    console.log(`  errori: ${r.errori || 0}, ultimo_errore: ${r.ultimo_errore || "–"}`);
    console.log(`  ended: ${r.ended_at || r.completed_at || "(in corso?)"}`);
    console.log(`  duration: ${r.duration_ms ? (r.duration_ms/1000).toFixed(1) + "s" : "?"}`);
  }
})();

// Second-pass link: collega rinnovi_portale.candidato_id ai candidates via CF.
// Fix per il bug della truncation 1000 nel test_materializza_storici.js.

require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const GM = "9380513a-99ad-4067-adc7-493af2e083d1";

async function fetchAllCandidatesCfMap() {
  const map = new Map();
  const PAGE = 1000;
  for (let start = 0; start < 50000; start += PAGE) {
    const { data, error } = await supabase
      .from("candidates")
      .select("id, codice_fiscale")
      .eq("autoscuola_id", GM)
      .not("codice_fiscale", "is", null)
      .range(start, start + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const c of data) {
      const cf = String(c.codice_fiscale || "").trim().toUpperCase();
      if (cf) map.set(cf, c.id);
    }
    if (data.length < PAGE) break;
  }
  return map;
}

async function fetchAllRinnoviOrfaniConCf() {
  const rows = [];
  const PAGE = 1000;
  for (let start = 0; start < 50000; start += PAGE) {
    const { data, error } = await supabase
      .from("rinnovi_portale")
      .select("id, codice_fiscale, candidato_id")
      .eq("autoscuola_id", GM)
      .is("candidato_id", null)
      .not("codice_fiscale", "is", null)
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
  console.log("=== Second-pass link rinnovi → candidates (via CF) ===\n");

  console.log("Carico candidates con CF (con pagination)...");
  const cfToId = await fetchAllCandidatesCfMap();
  console.log(`Candidates totali con CF: ${cfToId.size}`);

  console.log("\nCarico rinnovi orfani (candidato_id NULL)...");
  const orphans = await fetchAllRinnoviOrfaniConCf();
  console.log(`Rinnovi orfani con CF: ${orphans.length}`);

  if (orphans.length === 0) {
    console.log("Nulla da linkare.");
    return;
  }

  // Calcola match
  const updates = [];
  let noMatch = 0;
  for (const r of orphans) {
    const cf = String(r.codice_fiscale || "").trim().toUpperCase();
    const candId = cfToId.get(cf);
    if (!candId) { noMatch += 1; continue; }
    updates.push({ id: r.id, candidato_id: candId });
  }
  console.log(`\nDa aggiornare: ${updates.length}`);
  console.log(`Senza match:   ${noMatch}`);

  // Applica updates in parallelo, batch 100
  const BATCH = 100;
  let done = 0;
  const startTime = Date.now();
  for (let i = 0; i < updates.length; i += BATCH) {
    const slice = updates.slice(i, i + BATCH);
    await Promise.all(slice.map(u =>
      supabase.from("rinnovi_portale").update({ candidato_id: u.candidato_id }).eq("id", u.id)
    ));
    done += slice.length;
    if (i % 500 === 0 || done === updates.length) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = done / Math.max(elapsed, 0.01);
      console.log(`  linked ${done}/${updates.length} (${rate.toFixed(0)}/s)`);
    }
  }

  // Verifica
  const { count: orphans2 } = await supabase
    .from("rinnovi_portale")
    .select("id", { count: "exact", head: true })
    .eq("autoscuola_id", GM)
    .is("candidato_id", null);
  const { count: conCand } = await supabase
    .from("rinnovi_portale")
    .select("id", { count: "exact", head: true })
    .eq("autoscuola_id", GM)
    .not("candidato_id", "is", null);
  console.log(`\n=== Stato finale rinnovi_portale ===`);
  console.log(`Orfani (senza candidato_id): ${orphans2}`);
  console.log(`Linkati (con candidato_id):  ${conCand}`);
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });

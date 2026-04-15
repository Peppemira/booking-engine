// Conta persone uniche (dedup CF) nei rinnovi_portale di Giuseppe Miracolo
// e overlap con candidates esistenti.
require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const GM = "9380513a-99ad-4067-adc7-493af2e083d1";

(async () => {
  // 1) Scarica CF+anagrafica da tutti i rinnovi (con pagination)
  const all = [];
  const PAGE = 1000;
  for (let start = 0; start < 3000; start += PAGE) {
    const { data, error } = await supabase
      .from("rinnovi_portale")
      .select("codice_fiscale, cognome, nome, data_nascita, sesso, comune_nascita, provincia_nascita, cap, comune_residenza, provincia_residenza, indirizzo, patente_posseduta, tipo_rinnovo, data_inserimento")
      .eq("autoscuola_id", GM)
      .range(start, start + PAGE - 1);
    if (error) { console.log("Errore:", error.message); return; }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  console.log(`Rinnovi caricati: ${all.length}`);

  // 2) Dedup per CF
  const byCF = new Map();
  let senzaCF = 0;
  for (const r of all) {
    const cf = (r.codice_fiscale || "").trim().toUpperCase();
    if (!cf) { senzaCF += 1; continue; }
    if (!byCF.has(cf)) byCF.set(cf, r);
  }
  console.log(`Persone uniche (dedup CF): ${byCF.size}`);
  console.log(`Rinnovi senza CF: ${senzaCF}`);

  // 3) Overlap con candidates esistenti (per CF)
  const { data: existing } = await supabase
    .from("candidates")
    .select("codice_fiscale, cognome, nome")
    .eq("autoscuola_id", GM);
  const existingCF = new Set(
    (existing || [])
      .map((c) => String(c.codice_fiscale || "").trim().toUpperCase())
      .filter(Boolean)
  );
  console.log(`Candidati esistenti con CF: ${existingCF.size}`);

  // 4) Quanti nuovi, quanti già in candidates
  let nuovi = 0, giaEsistenti = 0;
  for (const cf of byCF.keys()) {
    if (existingCF.has(cf)) giaEsistenti += 1;
    else nuovi += 1;
  }
  console.log(`Nuovi da creare: ${nuovi}`);
  console.log(`Già in candidates: ${giaEsistenti}`);

  // 5) Sample 3 nuovi
  console.log("\nSample 3 anagrafiche nuove:");
  let c = 0;
  for (const [cf, r] of byCF.entries()) {
    if (existingCF.has(cf)) continue;
    console.log(`  ${r.cognome} ${r.nome} | CF: ${cf} | ${r.comune_residenza || "?"} (${r.provincia_residenza || "?"}) | pat: ${r.patente_posseduta || "?"}`);
    c += 1;
    if (c >= 3) break;
  }
})();

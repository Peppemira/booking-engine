// Quick DB query to see what's in `candidates` and whether patente_numero is populated.
require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

(async () => {
  // 1) Totale candidates
  const { count: totalCount } = await supabase
    .from("candidates")
    .select("id", { count: "exact", head: true });
  console.log(`Totale candidates: ${totalCount}`);

  // 2) Con patente_numero NON NULL
  const { count: withPat } = await supabase
    .from("candidates")
    .select("id", { count: "exact", head: true })
    .not("patente_numero", "is", null);
  console.log(`Candidates con patente_numero NOT NULL: ${withPat}`);

  // 3) Con codice_fiscale NON NULL
  const { count: withCF } = await supabase
    .from("candidates")
    .select("id", { count: "exact", head: true })
    .not("codice_fiscale", "is", null);
  console.log(`Candidates con codice_fiscale NOT NULL: ${withCF}`);

  // 4) Sample di 10 records con tutte le colonne chiave
  const { data: sample, error } = await supabase
    .from("candidates")
    .select("id, cognome, nome, codice_fiscale, patente_numero, categoria_patente, tipo_iscrizione_sigla")
    .limit(10);
  if (error) {
    console.error("Errore:", error.message);
    return;
  }
  console.log("\nSample 10 candidates:");
  for (const c of sample) {
    console.log(
      `  ${c.cognome || "?"} ${c.nome || "?"} | CF: ${c.codice_fiscale || "–"} | patente: ${c.patente_numero || "–"} | cat: ${c.categoria_patente || "–"} | tipo: ${c.tipo_iscrizione_sigla || "–"}`
    );
  }

  // 5) Distribuzione per tipo_iscrizione_sigla
  const { data: byTipo } = await supabase
    .from("candidates")
    .select("tipo_iscrizione_sigla");
  const tipoCounts = {};
  for (const r of byTipo || []) {
    const k = r.tipo_iscrizione_sigla || "(nullo)";
    tipoCounts[k] = (tipoCounts[k] || 0) + 1;
  }
  console.log("\nDistribuzione tipo_iscrizione_sigla:");
  for (const [k, v] of Object.entries(tipoCounts)) {
    console.log(`  ${k}: ${v}`);
  }
})();

// Ispeziona struttura completa dei rinnovi senza CF
require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const GM = "9380513a-99ad-4067-adc7-493af2e083d1";

(async () => {
  // Count
  const { count } = await supabase
    .from("rinnovi_portale")
    .select("id", { count: "exact", head: true })
    .eq("autoscuola_id", GM)
    .is("codice_fiscale", null);
  console.log(`Rinnovi senza CF: ${count}`);

  // Sample 2 full record
  const { data } = await supabase
    .from("rinnovi_portale")
    .select("*")
    .eq("autoscuola_id", GM)
    .is("codice_fiscale", null)
    .limit(2);

  for (const r of data || []) {
    console.log(`\n======= marca: ${r.marca_operativa} =======`);
    console.log(`cognome/nome: '${r.cognome}' / '${r.nome}'`);
    console.log(`codice_fiscale: ${r.codice_fiscale}`);
    console.log(`data_inserimento: ${r.data_inserimento}`);
    console.log(`tipo/stato: ${r.tipo_rinnovo} / ${r.stato_portale}`);
    console.log(`patente_posseduta: ${r.patente_posseduta}`);
    console.log(`\ndettaglio:`, JSON.stringify(r.dettaglio, null, 2));
    console.log(`\nraw_portale:`, JSON.stringify(r.raw_portale, null, 2));
  }

  // Breakdown: quanti sono per stato_portale?
  const stats = {};
  const { data: allNoCf } = await supabase
    .from("rinnovi_portale")
    .select("stato_portale, cognome, nome")
    .eq("autoscuola_id", GM)
    .is("codice_fiscale", null);
  let cognNomeOk = 0, cognNomeBad = 0;
  for (const r of allNoCf || []) {
    stats[r.stato_portale] = (stats[r.stato_portale] || 0) + 1;
    if (r.nome && r.nome.trim() !== "") cognNomeOk += 1;
    else cognNomeBad += 1;
  }
  console.log(`\nBreakdown stato_portale (senza CF):`, stats);
  console.log(`Con nome valido: ${cognNomeOk}`);
  console.log(`Con nome null:   ${cognNomeBad}`);
})();

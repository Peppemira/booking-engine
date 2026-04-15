// Verifica che i 149 rinnovi del test E2E siano effettivamente in rinnovi_portale
require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

(async () => {
  // 1) Totale rinnovi_portale
  const { count: total } = await supabase
    .from("rinnovi_portale")
    .select("id", { count: "exact", head: true });
  console.log(`Totale rinnovi_portale: ${total}`);

  // 2) Sample 3 records con tutte le colonne
  const { data: sample, error } = await supabase
    .from("rinnovi_portale")
    .select("*")
    .limit(3);
  if (error) {
    console.log("Errore:", error.message);
    return;
  }
  console.log("\nSample 3 rinnovi (tutte colonne):");
  for (const r of sample || []) {
    console.log(JSON.stringify(r, null, 2));
    console.log("---");
  }
})();

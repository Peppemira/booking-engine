// Conta tutti i rinnovi_portale per l'autoscuola Giuseppe Miracolo e mostra distribuzione
require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const GM = "9380513a-99ad-4067-adc7-493af2e083d1";

(async () => {
  const { count: total } = await supabase
    .from("rinnovi_portale")
    .select("id", { count: "exact", head: true })
    .eq("autoscuola_id", GM);
  console.log(`Totale rinnovi per Giuseppe Miracolo: ${total}`);

  // Per tipo
  const { data: byTipo } = await supabase
    .from("rinnovi_portale")
    .select("tipo_rinnovo")
    .eq("autoscuola_id", GM);
  const byType = {};
  for (const r of byTipo || []) {
    const k = r.tipo_rinnovo || "(nullo)";
    byType[k] = (byType[k] || 0) + 1;
  }
  console.log("Per tipo_rinnovo:", byType);

  // Per stato_portale
  const { data: byStato } = await supabase
    .from("rinnovi_portale")
    .select("stato_portale")
    .eq("autoscuola_id", GM);
  const byState = {};
  for (const r of byStato || []) {
    const k = r.stato_portale || "(nullo)";
    byState[k] = (byState[k] || 0) + 1;
  }
  console.log("Per stato_portale:", byState);

  // Per anno (dalla data_inserimento)
  const { data: byYear } = await supabase
    .from("rinnovi_portale")
    .select("data_inserimento")
    .eq("autoscuola_id", GM);
  const byY = {};
  for (const r of byYear || []) {
    const y = r.data_inserimento ? String(r.data_inserimento).slice(0, 4) : "(nullo)";
    byY[y] = (byY[y] || 0) + 1;
  }
  console.log("Per anno (data_inserimento):");
  const years = Object.keys(byY).sort();
  for (const y of years) console.log(`  ${y}: ${byY[y]}`);
})();

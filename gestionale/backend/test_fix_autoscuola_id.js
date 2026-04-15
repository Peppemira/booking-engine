// Aggiorna autoscuola_id sui 149 rinnovi del test
require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const AUTOSCUOLA_ID = "9380513a-99ad-4067-adc7-493af2e083d1"; // Giuseppe Miracolo (codice 0674)

(async () => {
  // Conta i rinnovi con autoscuola_id = null PRIMA
  const { count: primaNull } = await supabase
    .from("rinnovi_portale")
    .select("id", { count: "exact", head: true })
    .is("autoscuola_id", null);
  console.log(`Rinnovi con autoscuola_id=NULL prima: ${primaNull}`);

  // Update
  const { data: updated, error } = await supabase
    .from("rinnovi_portale")
    .update({ autoscuola_id: AUTOSCUOLA_ID })
    .is("autoscuola_id", null)
    .select("id");
  if (error) {
    console.log("Errore update:", error.message);
    return;
  }
  console.log(`Aggiornati ${updated?.length || 0} rinnovi a autoscuola_id=${AUTOSCUOLA_ID}`);

  // Conta dopo
  const { count: totale } = await supabase
    .from("rinnovi_portale")
    .select("id", { count: "exact", head: true })
    .eq("autoscuola_id", AUTOSCUOLA_ID);
  console.log(`Rinnovi per autoscuola Giuseppe Miracolo: ${totale}`);

  // Conta per tipo
  const { data: byTipo } = await supabase
    .from("rinnovi_portale")
    .select("tipo_rinnovo")
    .eq("autoscuola_id", AUTOSCUOLA_ID);
  const counts = {};
  for (const r of byTipo || []) {
    const k = r.tipo_rinnovo || "(nullo)";
    counts[k] = (counts[k] || 0) + 1;
  }
  console.log("Distribuzione tipo_rinnovo:", counts);
})();

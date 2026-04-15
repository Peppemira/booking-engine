// Simula la nuova logica del controller /archivio-riepilogo per verificare
// che i count per_tipo siano corretti (non truncati a 1000).
require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const AUTOSCUOLA_ID = "9380513a-99ad-4067-adc7-493af2e083d1"; // Giuseppe Miracolo

(async () => {
  const filterAut = (q) => q.eq("autoscuola_id", AUTOSCUOLA_ID);

  // 1) rinnovi totali
  const { count: rinnoviCount } = await filterAut(
    supabase.from("rinnovi_portale").select("id", { count: "exact", head: true })
  );
  console.log(`rinnovi_totali: ${rinnoviCount}`);

  // 2) count per tipo
  const tipi = ["patente", "medico", "cqc"];
  const perTipo = {};
  await Promise.all(
    tipi.map(async (t) => {
      const { count } = await filterAut(
        supabase
          .from("rinnovi_portale")
          .select("id", { count: "exact", head: true })
          .eq("tipo_rinnovo", t)
      );
      perTipo[t] = count || 0;
    })
  );
  console.log(`rinnovi_per_tipo:`, perTipo);

  // 3) primo + ultimo data_inserimento
  const { data: primoRow } = await filterAut(
    supabase
      .from("rinnovi_portale")
      .select("data_inserimento")
      .not("data_inserimento", "is", null)
      .order("data_inserimento", { ascending: true })
      .limit(1)
  );
  const { data: ultimoRow } = await filterAut(
    supabase
      .from("rinnovi_portale")
      .select("data_inserimento")
      .not("data_inserimento", "is", null)
      .order("data_inserimento", { ascending: false })
      .limit(1)
  );
  console.log(`primo_inserimento:  ${primoRow?.[0]?.data_inserimento || "–"}`);
  console.log(`ultimo_inserimento: ${ultimoRow?.[0]?.data_inserimento || "–"}`);

  // 4) ultimo_sync
  const { data: syncRow } = await filterAut(
    supabase
      .from("rinnovi_portale")
      .select("last_synced_at")
      .not("last_synced_at", "is", null)
      .order("last_synced_at", { ascending: false })
      .limit(1)
  );
  console.log(`ultimo_sync: ${syncRow?.[0]?.last_synced_at || "–"}`);

  // 5) candidati
  const { count: candidatiCount } = await filterAut(
    supabase.from("candidates").select("id", { count: "exact", head: true })
  );
  console.log(`candidati_totali: ${candidatiCount}`);
})();

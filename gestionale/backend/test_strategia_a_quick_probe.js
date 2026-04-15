// Probe veloce: cerca rinnovi medici/CQC per i 30 nuovi storici (random)
// per capire se vale la pena lanciare la Strategia A completa sui 2321 candidati.
//
// Uso: node test_strategia_a_quick_probe.js [--limit=N]

require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const { createClient } = require("@supabase/supabase-js");
const { loginDirectHttp } = require("./src/connector/portalSession");
const { makeHttpClient } = require("./src/connector/portalHttp");
const {
  leggiRinnoviMediciStoriciPerPersone,
  leggiRinnoviCqcStoriciPerPersone,
} = require("./src/connector/portalSync");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const GM = "9380513a-99ad-4067-adc7-493af2e083d1";
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split("=")[1]) : 30;

(async () => {
  console.log(`=== Probe Strategia A su ${LIMIT} persone random ===\n`);

  // Carica candidates con patente per GM (storici + attivi)
  const { data: cands } = await supabase
    .from("candidates")
    .select("codice_fiscale, patente_numero, cognome, nome, storico")
    .eq("autoscuola_id", GM)
    .not("patente_numero", "is", null)
    .limit(LIMIT * 3);  // prendi più del necessario per shuffle

  const all = (cands || [])
    .filter(c => c.codice_fiscale && c.patente_numero)
    .map(c => ({
      codiceFiscale: String(c.codice_fiscale).trim().toUpperCase(),
      cognome: String(c.cognome || "").trim().toUpperCase(),
      patente: String(c.patente_numero).trim().toUpperCase(),
      storico: c.storico,
    }));

  // Shuffle e prendi i primi LIMIT
  const shuffled = all.sort(() => Math.random() - 0.5).slice(0, LIMIT);
  console.log(`Persone selezionate: ${shuffled.length} (storici: ${shuffled.filter(p => p.storico).length})`);
  console.log(`Sample: ${shuffled.slice(0, 3).map(p => `${p.cognome} (${p.patente})`).join(", ")}\n`);

  // Login
  console.log("Login portale...");
  const jar = await loginDirectHttp({
    username: process.env.PORTAL_USER,
    password: process.env.PORTAL_PASS,
    pin:      process.env.PORTAL_PIN,
  });
  const client = makeHttpClient(jar);
  console.log("Login OK\n");

  // ── Test MEDICI ────────────────────────────────────────────────────────────
  console.log("--- Cerco rinnovi MEDICI per le persone ---");
  const startMed = Date.now();
  const rinnoviMed = await leggiRinnoviMediciStoriciPerPersone(client, {
    persone: shuffled,
    withDettaglio: false,
    delayMs: 300,
    onProgress: (p) => {
      if (p?.completate && p.completate % 10 === 0) {
        console.log(`  med [${p.completate}/${p.totale}] raccolti: ${p.raccolti}`);
      }
    },
  });
  const tMed = ((Date.now() - startMed) / 1000).toFixed(1);
  if (rinnoviMed?.servizioNonDisponibile) {
    console.log(`  MEDICI: SERVIZIO NON DISPONIBILE per questa autoscuola`);
  } else {
    console.log(`  MEDICI: trovati ${rinnoviMed.length} rinnovi (in ${tMed}s)`);
    if (rinnoviMed.length > 0) {
      console.log("  Sample:", rinnoviMed.slice(0, 3).map(r => `${r.cognome || "?"} ${r.nome || ""} (${r.marca_operativa})`).join(", "));
    }
  }

  // ── Test CQC ───────────────────────────────────────────────────────────────
  console.log("\n--- Cerco rinnovi CQC per le persone ---");
  const startCqc = Date.now();
  const rinnoviCqc = await leggiRinnoviCqcStoriciPerPersone(client, {
    persone: shuffled,
    withDettaglio: false,
    delayMs: 300,
    onProgress: (p) => {
      if (p?.completate && p.completate % 10 === 0) {
        console.log(`  cqc [${p.completate}/${p.totale}] raccolti: ${p.raccolti}`);
      }
    },
  });
  const tCqc = ((Date.now() - startCqc) / 1000).toFixed(1);
  if (rinnoviCqc?.servizioNonDisponibile) {
    console.log(`  CQC: SERVIZIO NON DISPONIBILE per questa autoscuola`);
  } else {
    console.log(`  CQC: trovati ${rinnoviCqc.length} rinnovi (in ${tCqc}s)`);
    if (rinnoviCqc.length > 0) {
      console.log("  Sample:", rinnoviCqc.slice(0, 3).map(r => `${r.cognome || "?"} ${r.nome || ""} (${r.marca_operativa})`).join(", "));
    }
  }

  // Stima per full run
  console.log(`\n=== Stima full run su 2321 persone ===`);
  const persPerSec = LIMIT / Number(tMed);
  const fullSecMed = 2321 / persPerSec;
  console.log(`  Tempo per medici: ${Math.round(fullSecMed/60)} min`);
  console.log(`  Tempo per CQC:    ${Math.round(fullSecMed/60)} min`);
  console.log(`  Tempo totale:     ${Math.round(2*fullSecMed/60)} min`);
  console.log(`\nProiezione rinnovi attesi:`);
  console.log(`  Medici: ${Math.round(rinnoviMed.length * 2321 / LIMIT)} (estrapolato)`);
  console.log(`  CQC:    ${Math.round(rinnoviCqc.length * 2321 / LIMIT)} (estrapolato)`);
})().catch((err) => {
  console.error("FATAL:", err.message);
  console.error(err.stack);
  process.exit(1);
});

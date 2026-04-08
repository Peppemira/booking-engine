require("dotenv").config({ quiet: true });
const supabase = require("./database/supabase");

const applyChanges = process.argv.includes("--apply");
const batchSize = 500;

function normalizeCode(value) {
  const raw = String(value || "").trim();
  return raw || null;
}

function extractCodeFromRaw(rawPortale) {
  if (!rawPortale || typeof rawPortale !== "object") return null;
  const direct = normalizeCode(rawPortale.codice_autoscuola || rawPortale.autoscuola_codice || rawPortale.codiceAutoscuola);
  if (direct) return direct;

  const anagrafica = rawPortale.anagrafica && typeof rawPortale.anagrafica === "object"
    ? rawPortale.anagrafica
    : null;
  const nested = normalizeCode(anagrafica?.codice_autoscuola || anagrafica?.autoscuola_codice || anagrafica?.codiceAutoscuola);
  if (nested) return nested;

  return null;
}

async function fetchCandidatesPage(from, to) {
  const { data, error } = await supabase
    .from("candidates")
    .select("id,codice_autoscuola,raw_portale")
    .order("id", { ascending: true })
    .range(from, to);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function updateCandidateCode(id, codiceAutoscuola) {
  const { error } = await supabase
    .from("candidates")
    .update({ codice_autoscuola: codiceAutoscuola })
    .eq("id", id);

  if (error) throw error;
}

async function run() {
  console.log("Backfill candidates.codice_autoscuola avviato");
  console.log("Modalità:", applyChanges ? "APPLY" : "DRY-RUN");

  let scanned = 0;
  let candidatesWithMissingCode = 0;
  let candidatesRecoverable = 0;
  let updated = 0;
  let offset = 0;

  while (true) {
    const rows = await fetchCandidatesPage(offset, offset + batchSize - 1);
    if (!rows.length) break;

    for (const row of rows) {
      scanned += 1;
      const existingCode = normalizeCode(row.codice_autoscuola);
      if (existingCode) continue;

      candidatesWithMissingCode += 1;
      const recoveredCode = extractCodeFromRaw(row.raw_portale);
      if (!recoveredCode) continue;

      candidatesRecoverable += 1;
      if (applyChanges) {
        await updateCandidateCode(row.id, recoveredCode);
      }
      updated += 1;
    }

    console.log(`Scansionati: ${scanned} | Mancanti: ${candidatesWithMissingCode} | Recuperabili: ${candidatesRecoverable} | Aggiornati: ${updated}`);
    offset += rows.length;
    if (rows.length < batchSize) break;
  }

  console.log("\n=== RIEPILOGO ===");
  console.log("Totale scansionati:", scanned);
  console.log("Con codice mancante:", candidatesWithMissingCode);
  console.log("Recuperabili da raw_portale:", candidatesRecoverable);
  console.log("Aggiornati:", updated);
  console.log("Modalità:", applyChanges ? "APPLY" : "DRY-RUN");
}

run()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    console.error("Errore backfill codice autoscuola:", error?.message || error);
    process.exitCode = 1;
  });

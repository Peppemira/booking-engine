require("dotenv").config({ quiet: true });
const supabase = require("./database/supabase");

const applyChanges = process.argv.includes("--apply");
const createPlaceholders = process.argv.includes("--create-placeholders");

function safeString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function buildLegacyCodiceFiscale(waitlistId) {
  return `LEGACY${String(waitlistId).padStart(10, "0")}`;
}

async function findCandidateByCodice(codiceFiscale) {
  if (!codiceFiscale) return null;

  const { data, error } = await supabase
    .from("candidates")
    .select("id")
    .eq("codice_fiscale", codiceFiscale)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.id || null;
}

async function findCandidateByName(nome, cognome) {
  if (!nome || !cognome) return { id: null, ambiguous: false };

  const { data, error } = await supabase
    .from("candidates")
    .select("id")
    .eq("nome", nome)
    .eq("cognome", cognome)
    .limit(2);

  if (error) throw error;

  if (!data || data.length === 0) return { id: null, ambiguous: false };
  if (data.length > 1) return { id: null, ambiguous: true };

  return { id: data[0].id, ambiguous: false };
}

async function createCandidateFromWaitlistRow(row) {
  const codiceFiscale = safeString(row.codice_fiscale || row.codice) || buildLegacyCodiceFiscale(row.id);
  const payload = {
    nome: safeString(row.nome),
    cognome: safeString(row.cognome),
    codice_fiscale: codiceFiscale,
    categoria_patente: safeString(row.categoria_patente) || "B",
    tentativi_quiz: 0,
    stato: safeString(row.stato) || "legacy",
    data_nascita: safeString(row.data_nascita),
    comune_nascita: safeString(row.comune_nascita),
    provincia_nascita: safeString(row.provincia_nascita),
  };

  if (!payload.nome || !payload.cognome) {
    return { candidateId: null, reason: "dati anagrafici insufficienti" };
  }

  const { data, error } = await supabase
    .from("candidates")
    .insert([payload])
    .select("id")
    .single();

  if (error) throw error;

  return { candidateId: data.id, reason: "created" };
}

async function createPlaceholderCandidateFromWaitlistRow(row) {
  const legacyCode = buildLegacyCodiceFiscale(row.id);

  const { data: existingCandidate, error: findExistingError } = await supabase
    .from("candidates")
    .select("id")
    .eq("codice_fiscale", legacyCode)
    .maybeSingle();

  if (findExistingError) throw findExistingError;
  if (existingCandidate?.id) return existingCandidate.id;

  const payload = {
    nome: "Legacy",
    cognome: `Waitlist-${row.id}`,
    codice_fiscale: legacyCode,
    categoria_patente: "B",
    tentativi_quiz: 0,
    stato: "legacy",
  };

  const { data, error } = await supabase
    .from("candidates")
    .insert([payload])
    .select("id")
    .single();

  if (error) throw error;

  return data.id;
}

async function setCandidateIdOnWaitlist(waitlistId, candidateId) {
  const { error } = await supabase
    .from("waitlist")
    .update({ candidate_id: candidateId })
    .eq("id", waitlistId);

  if (error) throw error;
}

async function runBackfill() {
  console.log("Backfill waitlist.candidate_id avviato");
  console.log("Modalità:", applyChanges ? "APPLY" : "DRY-RUN");
  console.log("Placeholder:", createPlaceholders ? "ABILITATI" : "DISABILITATI");

  const { data: waitlistRows, error: waitlistError } = await supabase
    .from("waitlist")
    .select("*")
    .is("candidate_id", null)
    .order("created_at", { ascending: true });

  if (waitlistError) {
    console.error("Errore lettura waitlist:", waitlistError.message);
    process.exitCode = 1;
    return;
  }

  if (!waitlistRows || waitlistRows.length === 0) {
    console.log("Nessun record con candidate_id NULL trovato ✅");
    process.exitCode = 0;
    return;
  }

  console.log("Record da processare:", waitlistRows.length);

  let updatedCount = 0;
  let createdCandidateCount = 0;
  let unresolvedCount = 0;
  let ambiguousCount = 0;

  for (const row of waitlistRows) {
    const codice = safeString(row.codice_fiscale || row.codice);
    const nome = safeString(row.nome);
    const cognome = safeString(row.cognome);

    try {
      let candidateId = await findCandidateByCodice(codice);
      let resolution = codice ? "codice_fiscale" : "n/a";

      if (!candidateId) {
        const byName = await findCandidateByName(nome, cognome);
        if (byName.ambiguous) {
          ambiguousCount += 1;
          unresolvedCount += 1;
          console.log(`[SKIP][${row.id}] Match ambiguo per nome/cognome (${nome || "?"} ${cognome || "?"})`);
          continue;
        }

        if (byName.id) {
          candidateId = byName.id;
          resolution = "nome+cognome";
        }
      }

      if (!candidateId) {
        const created = applyChanges
          ? await createCandidateFromWaitlistRow(row)
          : {
              candidateId: safeString(row.nome) && safeString(row.cognome)
                ? `dryrun-created-${row.id}`
                : null,
              reason: safeString(row.nome) && safeString(row.cognome)
                ? "created[dry-run]"
                : "dati anagrafici insufficienti",
            };

        if (!created.candidateId) {
          if (!createPlaceholders) {
            unresolvedCount += 1;
            console.log(`[SKIP][${row.id}] ${created.reason}`);
            continue;
          }

          if (applyChanges) {
            candidateId = await createPlaceholderCandidateFromWaitlistRow(row);
            createdCandidateCount += 1;
            resolution = "placeholder";
          } else {
            candidateId = `dryrun-placeholder-${row.id}`;
            createdCandidateCount += 1;
            resolution = "placeholder[dry-run]";
          }
        } else {
          candidateId = created.candidateId;
          createdCandidateCount += 1;
          resolution = applyChanges ? "created" : "created[dry-run]";
        }
      }

      if (applyChanges) {
        await setCandidateIdOnWaitlist(row.id, candidateId);
      }

      updatedCount += 1;
      console.log(`[OK][${row.id}] candidate_id -> ${candidateId} (${resolution})${applyChanges ? "" : " [dry-run]"}`);
    } catch (err) {
      unresolvedCount += 1;
      console.error(`[ERR][${row.id}]`, err.message || err);
    }
  }

  console.log("\n=== RIEPILOGO ===");
  console.log("Processati:", waitlistRows.length);
  console.log("Aggiornabili:", updatedCount);
  console.log("Nuovi candidati creati:", createdCandidateCount);
  console.log("Ambigui:", ambiguousCount);
  console.log("Non risolti:", unresolvedCount);
  console.log("Modalità:", applyChanges ? "APPLY" : "DRY-RUN");

  process.exitCode = 0;
}

runBackfill();

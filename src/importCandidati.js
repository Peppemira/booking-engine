const fs = require("fs");
const csv = require("csv-parser");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ quiet: true });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

async function importCandidati() {
  const results = [];
  const csvPath = require("path").join(__dirname, "..", "candidati.csv");
  console.log("Cercando CSV a:", csvPath);

  if (!fs.existsSync(csvPath)) {
    console.error("File CSV non trovato:", csvPath);
    process.exit(1);
  }

  const stream = fs.createReadStream(csvPath)
    .pipe(csv())
    .on("data", (data) => results.push(data))
    .on("end", async () => {
      console.log("Candidati trovati nel CSV:", results.length);

      for (const candidato of results) {
        const codiceFiscale = candidato.codice_fiscale || candidato.codice || null;

        let candidateId = null;

        if (codiceFiscale) {
          const { data: existingCandidate, error: existingCandidateError } = await supabase
            .from("candidates")
            .select("id")
            .eq("codice_fiscale", codiceFiscale)
            .maybeSingle();

          if (existingCandidateError) {
            console.error("Errore ricerca candidato per", candidato.nome, candidato.cognome, ":", existingCandidateError);
            continue;
          }

          if (existingCandidate?.id) {
            candidateId = existingCandidate.id;
          }
        }

        if (!candidateId) {
          const candidatePayload = {
            nome: candidato.nome,
            cognome: candidato.cognome,
            codice_fiscale: codiceFiscale,
            categoria_patente: candidato.categoria_patente || candidato.categoria || null,
            stato: candidato.stato || null,
          };

          const { data: createdCandidate, error: createCandidateError } = await supabase
            .from("candidates")
            .insert([candidatePayload])
            .select("id")
            .single();

          if (createCandidateError) {
            console.error("Errore inserimento candidate per", candidato.nome, candidato.cognome, ":", createCandidateError);
            continue;
          }

          candidateId = createdCandidate.id;
        }

        const { error: waitError } = await supabase.from("waitlist").insert([
          {
            candidate_id: candidateId,
            status: "pending",
            priority: 100,
          },
        ]);

        if (waitError) {
          console.error("Errore inserimento waitlist per", candidato.nome, candidato.cognome, ":", waitError);
        } else {
          console.log("Inserito in waitlist:", candidato.nome, candidato.cognome);
        }
      }

      console.log("Import completato.");
      process.exit(0);
    })
    .on("error", (err) => {
      console.error("Errore lettura CSV:", err.message);
      process.exit(1);
    });
}

importCandidati();

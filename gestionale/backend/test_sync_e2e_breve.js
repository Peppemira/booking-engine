// Test end-to-end: chiama syncArchivioStoricoCompleto come farebbe il controller,
// ma con intervallo ridotto (ultimi 6 mesi) per avere feedback rapido.
// Logga tutti gli eventi progress come li vedrebbe il frontend via SSE.
require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });

const { syncArchivioStoricoCompleto } = require("./src/connector/syncArchivioStorico");

(async () => {
  const oggi = new Date();
  const seiMesiFa = new Date(oggi);
  seiMesiFa.setMonth(seiMesiFa.getMonth() - 6);
  const dataInizio = seiMesiFa.toISOString().slice(0, 10);
  const dataFine   = oggi.toISOString().slice(0, 10);

  console.log(`\n=== TEST E2E sync storico completo ===`);
  console.log(`Range: ${dataInizio} → ${dataFine}`);
  console.log(`idAutAg: ${process.env.CODICE_AUTOSCUOLA || "(da env)"}`);
  console.log(`autoscuolaId: forzato a null (no log DB)`);
  console.log(``);

  let numProgressEvents = 0;
  let ultimiRaccolti = {};
  const faseCounters = {};

  try {
    const result = await syncArchivioStoricoCompleto({
      idAutAg: process.env.CODICE_AUTOSCUOLA || "",
      codUfficioMctc: process.env.PORTAL_UFFICIO_MCTC || "",
      autoscuolaId: null, // no log DB per test
      includeEsami: false,   // salto esami (lungo)
      includeRinnoviPat: true,
      includeRinnoviMed: false,
      includeRinnoviCqc: false,
      includeStrategiaA: false,
      dataInizio,
      dataFine,
      windowDays: 30,
      tipoSync: "manuale",
      triggerSource: "test-e2e",
      onProgress: (p) => {
        numProgressEvents += 1;
        const fase = p.fase || "?";
        faseCounters[fase] = (faseCounters[fase] || 0) + 1;
        // Logga solo start/done e ogni 5 progress
        if (fase.endsWith("_start") || fase.endsWith("_done") ||
            fase === "login" || fase === "completed" ||
            (typeof p.raccolti === "number" && (p.raccolti > (ultimiRaccolti[fase] || 0)))) {
          console.log(`[${new Date().toISOString().slice(11, 19)}] ${fase}`, {
            raccolti: p.raccolti,
            totale: p.totale,
            completate: p.completate,
            message: p.message,
            count: p.count,
          });
          if (typeof p.raccolti === "number") ultimiRaccolti[fase] = p.raccolti;
        }
      },
    });

    console.log(`\n=== RISULTATO FINALE ===`);
    console.log(JSON.stringify(result, null, 2));
    console.log(`\nEventi progress totali: ${numProgressEvents}`);
    console.log(`Fasi toccate:`, faseCounters);
  } catch (err) {
    console.error(`\nERRORE:`, err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();

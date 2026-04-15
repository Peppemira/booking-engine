// Test: verifica se la baseline leggiRinnoviStoriciPatente trova davvero rinnovi
// per quest'autoscuola. Se no, significa che l'autoscuola non ha rinnovi nel
// portale (improbabile visto che è attiva) o che il parser/filtro è buggato.
require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });

const { loginDirectHttp } = require("./src/connector/portalSession");
const { makeHttpClient } = require("./src/connector/portalHttp");
const { leggiRinnoviStoriciPatente } = require("./src/connector/portalSync");

(async () => {
  console.log("Login al portale...");
  const jar = await loginDirectHttp({
    username: process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
    password: process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
    pin:      process.env.PORTAL_PIN,
  });
  const client = makeHttpClient(jar);
  console.log("Login OK\n");

  // Test 1: ultimo mese
  console.log("─── Test 1: rinnovi patente ultimi 30gg ───");
  try {
    const oggi = new Date();
    const unMeseFa = new Date(oggi);
    unMeseFa.setDate(unMeseFa.getDate() - 30);
    const di = unMeseFa.toISOString().slice(0, 10);
    const df = oggi.toISOString().slice(0, 10);
    console.log(`Range: ${di} → ${df}`);

    const rows = await leggiRinnoviStoriciPatente(client, {
      dataInizio: di,
      dataFine: df,
      stati: ["A", "D", "S", "R"], // iteriamo i 4 stati noti
      windowDays: 30,
      withDettaglio: true,  // fetch dettaglio per ottenere patente + CF
      onProgress: (p) => {
        if (p && typeof p.raccolti === "number" && p.fase?.includes("dettaglio")) {
          // mostra solo progress dettaglio ogni tanto
        }
      },
    });
    console.log(`\n✅ TROVATI ${rows.length} rinnovi (ultimo mese)`);
    if (rows.length > 0) {
      console.log("Sample primo rinnovo con dettaglio:");
      console.log(JSON.stringify(rows[0], null, 2));
    }
  } catch (e) {
    console.log("ERRORE:", e.message);
  }

  // Test 2 disabilitato per risparmiare tempo (withDettaglio è lento)
})().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});

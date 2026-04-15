/**
 * TEST unitario della nuova funzione leggiRinnoviPerPersona() / leggiRinnoviStoriciPerPersone()
 * esportata da portalSync.js.
 *
 * Verifica che la funzione gestisca:
 *   - lista multi-riga (caso PISTONE: 2 risultati)
 *   - dettaglio singolo (caso ARRIA, BELLINGHERI, ecc: 1 risultato)
 *   - follow automatico patente sostituita (casi con patente vecchia)
 */

require("dotenv").config({ quiet: true });
const { loginDirectHttp } = require("./src/connector/portalSession");
const { makeHttpClient } = require("./src/connector/portalHttp");
const {
  leggiRinnoviPerPersona,
  leggiRinnoviStoriciPerPersone,
} = require("./src/connector/portalSync");

async function main() {
  console.log("━".repeat(70));
  console.log("TEST leggiRinnoviPerPersona / leggiRinnoviStoriciPerPersone");
  console.log("━".repeat(70));
  console.log();

  console.log("1) Login...");
  const jar = await loginDirectHttp({
    username: process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
    password: process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
    pin: process.env.PORTAL_PIN,
  });
  const client = makeHttpClient(jar);
  console.log("   OK\n");

  // Dati noti dai test precedenti (caso PISTONE con 2 risultati)
  const persone = [
    { cognome: "PISTONE", patente: "U1356M550J", note: "2 rinnovi attesi" },
    { cognome: "PISTONE", patente: "U1X921655N", note: "patente vecchia, deve fare follow" },
    { cognome: "ARRIA", patente: "U1358M773U", note: "1 solo rinnovo (dettaglio)" },
    { cognome: "BELLINGHERI", patente: "U1361M613N", note: "1 solo rinnovo (dettaglio)" },
  ];

  console.log("2) Test singoli con leggiRinnoviPerPersona()\n");
  for (const p of persone) {
    process.stdout.write(`   ▸ ${p.cognome} ${p.patente.padEnd(12)} (${p.note}) ... `);
    try {
      const rinnovi = await leggiRinnoviPerPersona(client, {
        cognome: p.cognome,
        patente: p.patente,
      });
      if (rinnovi.length === 0) {
        console.log(`0 risultati`);
      } else {
        console.log(`✓ ${rinnovi.length} rinnovi`);
        for (const r of rinnovi) {
          console.log(`       - ${r.data_inserimento} | ${r.marca_operativa} | ${r.stato_richiesta} | ${r.cognome} ${r.nome}`);
        }
      }
    } catch (err) {
      console.log(`✗ ERROR: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log();

  console.log("3) Test batch con leggiRinnoviStoriciPerPersone() + dettaglio\n");
  const batch = await leggiRinnoviStoriciPerPersone(client, {
    persone: persone.map((p) => ({ cognome: p.cognome, patente: p.patente })),
    withDettaglio: true,
    delayMs: 400,
    onProgress: (p) => {
      console.log(`   [progress] ${p.fase} completate=${p.completate}/${p.totale} raccolti=${p.raccolti}`);
    },
  });

  console.log(`\n   Totale rinnovi raccolti (deduplicati): ${batch.length}`);
  for (const r of batch) {
    console.log(`     • ${r.data_inserimento} ${r.marca_operativa} ${r.cognome} ${r.nome || ""}`);
    if (r.dettaglio) {
      console.log(`       CF=${r.dettaglio.codice_fiscale || "-"} pat_poss=${r.dettaglio.patente_posseduta || "-"} pat_em=${r.dettaglio.patente_emessa || "-"}`);
    }
  }

  console.log();
  console.log("━".repeat(70));
  console.log("FINE TEST");
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  console.error(err.stack);
  process.exit(1);
});

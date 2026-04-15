/**
 * TEST STRATEGIA B — Stampa Elenco Rinnovi (bypass limite 31 giorni)
 * ================================================================
 * Testa l'endpoint ReadGestRinnAgenzia_initStampaRinnAgenzia.action
 * con range di date crescenti per vedere se aggira il limite del portale.
 *
 * Uso: node test_stampa_elenco_rinnovi.js
 */

require("dotenv").config({ quiet: true });
const cheerio = require("cheerio");
const { loginDirectHttp } = require("./src/connector/portalSession");
const { makeHttpClient } = require("./src/connector/portalHttp");

const PORTAL_BASE = "https://www.ilportaledellautomobilista.it";

// Converte "YYYY-MM-DD" -> "DD/MM/YYYY" (formato del portale)
function toPortalDate(isoDate) {
  const [y, m, d] = String(isoDate).split("-");
  return `${d}/${m}/${y}`;
}

// Data N giorni fa in ISO
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Chiama ReadGestRinnAgenzia_initStampaRinnAgenzia.action con un range di date.
 * @returns { html, status, rowCount, errorMessage, is31DayError }
 */
async function testStampaElencoRinnovi(client, { dataInizio, dataFine, codiceStato = "" }) {
  const di = toPortalDate(dataInizio);
  const df = toPortalDate(dataFine);

  // STEP 1: GET del form iniziale (carica il token Struts se presente)
  const initUrl = `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestRinnAgenzia_initStampaRinnAgenzia.action`;
  let tokenName = "";
  let tokenValue = "";
  try {
    const initRes = await client.get(initUrl);
    const $init = cheerio.load(initRes.data || "");
    tokenName = $init('input[name="struts.token.name"]').val() || "";
    if (tokenName) {
      tokenValue = $init(`input[name="${tokenName}"]`).val() || "";
    }
  } catch (err) {
    return {
      status: err?.response?.status || 0,
      rowCount: 0,
      errorMessage: `GET init failed: ${err.message}`,
      is31DayError: false,
    };
  }

  // STEP 2: POST dei parametri di ricerca con le date
  // Provo prima con POST (form submit) poi fallback a GET
  const params = new URLSearchParams();
  if (tokenName && tokenValue) {
    params.set("struts.token.name", tokenName);
    params.set(tokenName, tokenValue);
  }
  params.set("richiestaView.richiestaRinnAgenziaFrom.marcaOperativa", "");
  params.set("richiestaView.richiestaRinnAgenziaFrom.patentePosseduta", "");
  params.set("richiestaView.cognome", "");
  params.set("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.codiceFiscale", "");
  params.set("richiestaView.richiestaRinnAgenziaFrom.codiceStatoRinnAgenzia", codiceStato);
  params.set("richiestaView.richiestaRinnAgenziaFrom.dataInserimento", di);
  params.set("richiestaView.richiestaRinnAgenziaTo.dataInserimento", df);
  params.set("action:ReadGestRinnAgenzia_stampaGestRinnAgenzia", "Stampa");

  const searchUrl = `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestRinnAgenzia_initStampaRinnAgenzia.action`;

  try {
    const res = await client.post(searchUrl, params.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: initUrl,
      },
      maxRedirects: 10,
    });
    return parseRisposta(res);
  } catch (err) {
    return {
      status: err?.response?.status || 0,
      rowCount: 0,
      errorMessage: `POST failed: ${err.message}`,
      is31DayError: false,
    };
  }
}

function parseRisposta(res) {
  const status = res?.status || 0;
  const html = String(res?.data || "");
  const $ = cheerio.load(html);

  // Cerca errori noti
  const errorDiv =
    $(".errorMessage, .errore, .errore-messaggio, #errorMsg").text() ||
    $(".actionError li").text() ||
    "";
  const is31DayError =
    /intervallo massimo|31 giorn/i.test(errorDiv) ||
    /intervallo massimo|31 giorn/i.test(html.slice(0, 5000));

  // Conta righe della tabella risultati
  const tableRows = $("#listTable > tbody tr").length;
  const anyTableRows = $("table tbody tr").length;

  // Se la risposta è un PDF
  const isPdf = html.substring(0, 20).includes("%PDF");
  const contentType = res?.headers?.["content-type"] || "";

  return {
    status,
    rowCount: tableRows || anyTableRows || 0,
    errorMessage: errorDiv.trim().slice(0, 300),
    is31DayError,
    htmlLength: html.length,
    contentType,
    isPdf,
    titlePage: ($("title").text() || "").trim().slice(0, 100),
  };
}

/* ----------------- MAIN ----------------- */

async function main() {
  console.log("━".repeat(70));
  console.log("  TEST STRATEGIA B — Stampa Elenco Rinnovi");
  console.log("━".repeat(70));
  console.log();

  console.log("1) Login al portale...");
  const jar = await loginDirectHttp({
    username: process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
    password: process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
    pin: process.env.PORTAL_PIN,
  });
  const client = makeHttpClient(jar);
  console.log("   ✓ Login OK\n");

  // Test con range di date crescenti
  const tests = [
    { label: "7 giorni",    days: 7   },
    { label: "31 giorni",   days: 31  },
    { label: "60 giorni",   days: 60  },
    { label: "90 giorni",   days: 90  },
    { label: "180 giorni",  days: 180 },
    { label: "365 giorni",  days: 365 },
    { label: "730 giorni",  days: 730 },
    { label: "1825 giorni (5 anni)", days: 1825 },
  ];

  console.log("2) Test endpoint ReadGestRinnAgenzia_initStampaRinnAgenzia.action");
  console.log("   (stato vuoto = tutti)\n");

  const results = [];
  for (const t of tests) {
    const dataInizio = daysAgo(t.days);
    const dataFine   = today();
    process.stdout.write(`   ▸ ${t.label.padEnd(25)} (${dataInizio} → ${dataFine}) ... `);
    try {
      const r = await testStampaElencoRinnovi(client, { dataInizio, dataFine });
      results.push({ ...t, ...r, dataInizio, dataFine });
      if (r.is31DayError) {
        console.log("❌ LIMITE 31 GIORNI");
      } else if (r.status === 200 && !r.errorMessage) {
        console.log(`✓ status=${r.status}, righe=${r.rowCount}, size=${r.htmlLength}B${r.isPdf ? " (PDF)" : ""}`);
      } else if (r.errorMessage) {
        console.log(`⚠ errore: ${r.errorMessage.slice(0, 80)}`);
      } else {
        console.log(`status=${r.status}, size=${r.htmlLength}B`);
      }
    } catch (err) {
      console.log(`✗ exception: ${err.message}`);
      results.push({ ...t, error: err.message, dataInizio, dataFine });
    }
    // piccola pausa tra le chiamate
    await new Promise((r) => setTimeout(r, 800));
  }

  // ──────────────────────────────────────────────────────────────────
  console.log("\n3) Test con codiceStato='S' (Spedite) — solo pratiche concluse\n");
  const testsStato = [
    { label: "90 giorni",   days: 90  },
    { label: "365 giorni",  days: 365 },
    { label: "1825 giorni", days: 1825 },
  ];
  for (const t of testsStato) {
    const dataInizio = daysAgo(t.days);
    const dataFine   = today();
    process.stdout.write(`   ▸ ${t.label.padEnd(15)} stato=S (${dataInizio} → ${dataFine}) ... `);
    try {
      const r = await testStampaElencoRinnovi(client, { dataInizio, dataFine, codiceStato: "S" });
      if (r.is31DayError) {
        console.log("❌ LIMITE 31 GIORNI");
      } else if (r.status === 200) {
        console.log(`✓ status=${r.status}, righe=${r.rowCount}, size=${r.htmlLength}B${r.isPdf ? " (PDF)" : ""}`);
      } else {
        console.log(`status=${r.status}`);
      }
    } catch (err) {
      console.log(`✗ ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  // ──────────────────────────────────────────────────────────────────
  console.log("\n4) Riepilogo\n");
  console.log("   Range           | Status | Righe | Size HTML  | Nota");
  console.log("   " + "─".repeat(70));
  for (const r of results) {
    const range = (r.label || "").padEnd(18);
    const st = String(r.status || "-").padEnd(6);
    const rows = String(r.rowCount || "-").padEnd(5);
    const size = String(r.htmlLength || "-").padEnd(10);
    const nota = r.is31DayError ? "LIMITE 31gg" : (r.errorMessage ? r.errorMessage.slice(0, 30) : (r.isPdf ? "PDF" : "OK"));
    console.log(`   ${range} | ${st} | ${rows} | ${size} | ${nota}`);
  }

  console.log("\n━".repeat(35));
  console.log("VERDETTO STRATEGIA B:");
  const max31 = results.filter((r) => r.is31DayError).length;
  const maxOk = results.filter((r) => !r.is31DayError && r.status === 200);
  if (max31 > 0) {
    const minFail = results.find((r) => r.is31DayError);
    console.log(`❌ Stampa Elenco Rinnovi ha lo stesso limite di 31 giorni`);
    console.log(`   (primo range che fallisce: ${minFail?.label || "?"})`);
  } else if (maxOk.length === results.length) {
    const biggest = maxOk[maxOk.length - 1];
    console.log(`✅ Stampa Elenco Rinnovi NON ha il limite 31 giorni!`);
    console.log(`   Range testato massimo: ${biggest.label} → ${biggest.rowCount} righe`);
  } else {
    console.log(`⚠ Risultato misto — vedi output sopra per dettagli`);
  }
  console.log();
}

main().catch((err) => {
  console.error("ERRORE FATALE:", err.message);
  if (err.response?.data) {
    console.error("Response status:", err.response.status);
    console.error("Response body (primi 500 char):", String(err.response.data).slice(0, 500));
  }
  process.exit(1);
});

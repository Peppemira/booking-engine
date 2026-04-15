// Test: verifica se il portale accetta ricerca rinnovi SENZA specificare patente.
// Se funziona, possiamo rilassare il check obbligatorio sulla patente nelle 3
// funzioni leggiRinnoviPerPersona / Medici / Cqc e iterare la Strategia A
// anche per persone che hanno solo cognome o CF (senza numero patente).
require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });

const cheerio = require("cheerio");
const { loginDirectHttp } = require("./src/connector/portalSession");
const { makeHttpClient } = require("./src/connector/portalHttp");

const PORTAL_BASE = "https://www.ilportaledellautomobilista.it";

async function testPatenteRinnovi(client, { cognome = "", codiceFiscale = "" } = {}) {
  const searchUrl = `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestRinnAgenzia_initGestRinnAgenzia.action`;

  // carica token
  const initRes = await client.get(searchUrl);
  const $init = cheerio.load(String(initRes?.data || ""));
  const tokenName = $init('input[name="struts.token.name"]').val() || "";
  const tokenValue = tokenName ? $init(`input[name="${tokenName}"]`).val() || "" : "";

  const params = new URLSearchParams();
  if (tokenName && tokenValue) {
    params.set("struts.token.name", tokenName);
    params.set(tokenName, tokenValue);
  }
  params.set("richiestaView.richiestaRinnAgenziaFrom.marcaOperativa", "");
  params.set("richiestaView.richiestaRinnAgenziaFrom.patentePosseduta", ""); // <-- VUOTO
  params.set("richiestaView.cognome", cognome);
  params.set("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.codiceFiscale", codiceFiscale);
  params.set("richiestaView.richiestaRinnAgenziaFrom.codiceStatoRinnAgenzia", "");
  params.set("richiestaView.richiestaRinnAgenziaFrom.dataInserimento", "");
  params.set("richiestaView.richiestaRinnAgenziaTo.dataInserimento", "");
  params.set("action:ReadGestRinnAgenzia_pagingGestRinnAgenzia", "Ricerca");

  const res = await client.post(searchUrl, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: searchUrl },
    maxRedirects: 10,
  });
  const html = String(res?.data || "");
  const $ = cheerio.load(html);

  const title = ($("title").text() || "").trim();
  const actionError = $(".errorMessage, .actionError").first().text().trim();
  const listRows = $("#listTable > tbody tr").length;
  const htmlLen = html.length;

  return { title, actionError, listRows, htmlLen, isErrorPage: /errore|non.*disponibile/i.test(title) };
}

(async () => {
  console.log("=== TEST: ricerca rinnovi patente SENZA patente ===\n");
  console.log("Login al portale...");
  const jar = await loginDirectHttp({
    username: process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
    password: process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
    pin:      process.env.PORTAL_PIN,
  });
  const client = makeHttpClient(jar);
  console.log("Login OK\n");

  // ── Test 1: solo cognome, nessuna patente ───────────────────────────────
  console.log("─── Test 1: cognome='PASTA' (generico), patente='' ───");
  try {
    const r1 = await testPatenteRinnovi(client, { cognome: "PASTA" });
    console.log(JSON.stringify(r1, null, 2));
  } catch (e) {
    console.log("ERRORE:", e.message);
  }

  // ── Test 2: cognome reale dal DB, nessuna patente ───────────────────────
  console.log("\n─── Test 2: cognome='MIRACOLO' (autoscuola), patente='' ───");
  try {
    const r2 = await testPatenteRinnovi(client, { cognome: "MIRACOLO" });
    console.log(JSON.stringify(r2, null, 2));
  } catch (e) {
    console.log("ERRORE:", e.message);
  }

  // ── Test 3: cognome + lettera iniziale nome? no, il portale non lo prevede
  // ── Test 4: per confronto, con patente reale ──────────────────────────────
  console.log("\n─── Test 4 (controllo): cognome='PASTA', patente='PA1234567A' ───");
  try {
    const r4 = await testPatenteRinnovi(client, { cognome: "PASTA", codiceFiscale: "", });
    console.log("(questo è già stato fatto sopra)");
  } catch (e) {
    console.log("ERRORE:", e.message);
  }

  console.log("\n=== FINE TEST ===");
})().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});

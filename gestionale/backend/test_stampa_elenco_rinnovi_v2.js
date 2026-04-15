/**
 * TEST V2 — Dump completo delle risposte per capire cosa ritorna davvero
 * l'endpoint ReadGestRinnAgenzia_initStampaRinnAgenzia.action
 */

require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const { loginDirectHttp } = require("./src/connector/portalSession");
const { makeHttpClient } = require("./src/connector/portalHttp");

const PORTAL_BASE = "https://www.ilportaledellautomobilista.it";
const OUT_DIR = path.join(__dirname, "_test_out");
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function toPortalDate(isoDate) {
  const [y, m, d] = String(isoDate).split("-");
  return `${d}/${m}/${y}`;
}
function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10);
}
function today() { return new Date().toISOString().slice(0, 10); }

function analizza(nome, res) {
  const html = String(res?.data || "");
  const status = res?.status || 0;
  fs.writeFileSync(path.join(OUT_DIR, nome + ".html"), html);

  const $ = cheerio.load(html);
  const title = ($("title").text() || "").trim();
  const actionErrors = $(".actionError, .errorMessage, .errori").text().trim();
  const bodyFirstLines = $("body").text().replace(/\s+/g, " ").trim().slice(0, 500);

  // Tutte le tabelle trovate e relativo conteggio righe
  const tables = [];
  $("table").each((i, t) => {
    const $t = $(t);
    const rows = $t.find("tbody tr").length || $t.find("tr").length;
    const id = $t.attr("id") || "";
    const cls = $t.attr("class") || "";
    tables.push(`#${i}: id="${id}" class="${cls}" rows=${rows}`);
  });

  // Form action urls (se presenti)
  const forms = [];
  $("form").each((_, f) => {
    const $f = $(f);
    forms.push({
      name: $f.attr("name") || "",
      action: $f.attr("action") || "",
      method: $f.attr("method") || "",
      inputs: $f.find("input[name], select[name]").map((_, i) => $(i).attr("name")).get().slice(0, 20),
    });
  });

  // Cerca link di stampa
  const printLinks = [];
  $("a[href*='stampa'], a[href*='Stampa'], input[type='submit'], button").each((_, el) => {
    const $el = $(el);
    const val = $el.attr("value") || $el.attr("name") || $el.text().trim();
    const href = $el.attr("href") || $el.attr("action");
    if (val || href) printLinks.push({ val, href });
  });

  return { status, title, actionErrors, bodyFirstLines, tables, forms, printLinks, htmlLen: html.length };
}

async function main() {
  console.log("1) Login...");
  const jar = await loginDirectHttp({
    username: process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
    password: process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
    pin: process.env.PORTAL_PIN,
  });
  const client = makeHttpClient(jar);
  console.log("   OK\n");

  // ──────────────────────────────────────────────────────────
  // TEST 1: GET iniziale del form Stampa Elenco Rinnovi
  // ──────────────────────────────────────────────────────────
  console.log("2) GET /ReadGestRinnAgenzia_initStampaRinnAgenzia.action");
  const initUrl = `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestRinnAgenzia_initStampaRinnAgenzia.action`;
  const initRes = await client.get(initUrl);
  const initInfo = analizza("01_init_stampa_form", initRes);
  console.log("   status:", initInfo.status);
  console.log("   title:", initInfo.title);
  console.log("   htmlLen:", initInfo.htmlLen);
  console.log("   actionErrors:", initInfo.actionErrors || "(nessuno)");
  console.log("   tables:", initInfo.tables);
  console.log("   forms:");
  for (const f of initInfo.forms) {
    console.log(`     • name="${f.name}" action="${f.action}" method="${f.method}"`);
    console.log(`       inputs:`, f.inputs.join(", "));
  }
  console.log("   printLinks:", JSON.stringify(initInfo.printLinks.slice(0, 10), null, 2));
  console.log();

  // ──────────────────────────────────────────────────────────
  // TEST 2: GET con filtro Gestione Rinnovi (senza date) per vedere se arriva tutto
  // ──────────────────────────────────────────────────────────
  console.log("3) GET /ReadGestRinnAgenzia_initGestRinnAgenzia.action (senza date)");
  const gestUrl = `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestRinnAgenzia_initGestRinnAgenzia.action`;
  const gestRes = await client.get(gestUrl);
  const gestInfo = analizza("02_init_gest_form", gestRes);
  console.log("   status:", gestInfo.status);
  console.log("   title:", gestInfo.title);
  console.log("   htmlLen:", gestInfo.htmlLen);
  console.log("   tables:", gestInfo.tables);
  console.log("   forms:");
  for (const f of gestInfo.forms) {
    console.log(`     • name="${f.name}" action="${f.action}" method="${f.method}"`);
  }
  console.log();

  // ──────────────────────────────────────────────────────────
  // TEST 3: Ricerca Gestione Rinnovi CON date 31 giorni (come funziona il sync attuale)
  // ──────────────────────────────────────────────────────────
  console.log("4) Ricerca Gestione Rinnovi con date 31 giorni (baseline)");
  {
    const di = toPortalDate(daysAgo(31));
    const df = toPortalDate(today());
    const searchUrl =
      gestUrl +
      `?struts.token.name=tokenListGestRinnAgenzia` +
      `&richiestaView.richiestaRinnAgenziaFrom.marcaOperativa=` +
      `&richiestaView.richiestaRinnAgenziaFrom.patentePosseduta=` +
      `&richiestaView.cognome=` +
      `&richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.codiceFiscale=` +
      `&richiestaView.richiestaRinnAgenziaFrom.codiceStatoRinnAgenzia=` +
      `&richiestaView.richiestaRinnAgenziaFrom.dataInserimento=${di}` +
      `&richiestaView.richiestaRinnAgenziaTo.dataInserimento=${df}` +
      `&action%3AReadGestRinnAgenzia_pagingGestRinnAgenzia=Ricerca`;
    const res = await client.get(searchUrl);
    const info = analizza("03_gestrinn_31gg", res);
    console.log("   status:", info.status, "htmlLen:", info.htmlLen);
    console.log("   actionErrors:", info.actionErrors || "(nessuno)");
    console.log("   tables:", info.tables);
  }
  console.log();

  // ──────────────────────────────────────────────────────────
  // TEST 4: Stessa ricerca ma 365 giorni → dovrebbe fallire con "limite 31"
  // ──────────────────────────────────────────────────────────
  console.log("5) Ricerca Gestione Rinnovi con date 365 giorni (per trigger errore 31gg)");
  {
    const di = toPortalDate(daysAgo(365));
    const df = toPortalDate(today());
    const searchUrl =
      gestUrl +
      `?struts.token.name=tokenListGestRinnAgenzia` +
      `&richiestaView.richiestaRinnAgenziaFrom.marcaOperativa=` +
      `&richiestaView.richiestaRinnAgenziaFrom.patentePosseduta=` +
      `&richiestaView.cognome=` +
      `&richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.codiceFiscale=` +
      `&richiestaView.richiestaRinnAgenziaFrom.codiceStatoRinnAgenzia=` +
      `&richiestaView.richiestaRinnAgenziaFrom.dataInserimento=${di}` +
      `&richiestaView.richiestaRinnAgenziaTo.dataInserimento=${df}` +
      `&action%3AReadGestRinnAgenzia_pagingGestRinnAgenzia=Ricerca`;
    const res = await client.get(searchUrl);
    const info = analizza("04_gestrinn_365gg", res);
    console.log("   status:", info.status, "htmlLen:", info.htmlLen);
    console.log("   actionErrors:", info.actionErrors || "(nessuno)");
    console.log("   body preview:", info.bodyFirstLines);
    console.log("   tables:", info.tables);
  }
  console.log();

  // ──────────────────────────────────────────────────────────
  // TEST 5: Stampa Elenco Rinnovi con date 365gg via GET (non POST)
  // ──────────────────────────────────────────────────────────
  console.log("6) GET Stampa Elenco Rinnovi 365gg (via query string)");
  {
    const di = toPortalDate(daysAgo(365));
    const df = toPortalDate(today());
    const url =
      initUrl +
      `?richiestaView.richiestaRinnAgenziaFrom.marcaOperativa=` +
      `&richiestaView.richiestaRinnAgenziaFrom.patentePosseduta=` +
      `&richiestaView.cognome=` +
      `&richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.codiceFiscale=` +
      `&richiestaView.richiestaRinnAgenziaFrom.codiceStatoRinnAgenzia=` +
      `&richiestaView.richiestaRinnAgenziaFrom.dataInserimento=${di}` +
      `&richiestaView.richiestaRinnAgenziaTo.dataInserimento=${df}` +
      `&action%3AReadGestRinnAgenzia_stampaGestRinnAgenzia=Stampa`;
    const res = await client.get(url);
    const info = analizza("05_stampa_elenco_365gg_GET", res);
    console.log("   status:", info.status, "htmlLen:", info.htmlLen);
    console.log("   actionErrors:", info.actionErrors || "(nessuno)");
    console.log("   body preview:", info.bodyFirstLines);
    console.log("   content-type:", res.headers?.["content-type"]);
    console.log("   tables:", info.tables);
  }
  console.log();

  console.log("\n✔ Tutti gli HTML salvati in:", OUT_DIR);
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  if (err.response) {
    console.error("HTTP", err.response.status);
    console.error(String(err.response.data || "").slice(0, 500));
  }
  process.exit(1);
});

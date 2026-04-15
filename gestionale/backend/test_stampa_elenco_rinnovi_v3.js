/**
 * TEST V3 — Stampa Elenco Rinnovi con ACTION CORRETTA
 * ====================================================
 * Basato sull'HTML reale del form:
 *   • action: action:ReadStampaElencoRinnAgenzia_stampaElenco
 *   • campi richiesti: SOLO dataInserimento from/to + Struts token
 *
 * Testa range crescenti per verificare se bypassa il limite 31 giorni.
 */

require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const { loginDirectHttp } = require("./src/connector/portalSession");
const { makeHttpClient } = require("./src/connector/portalHttp");

const PORTAL_BASE = "https://www.ilportaledellautomobilista.it";
const INIT_URL = `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestRinnAgenzia_initStampaRinnAgenzia.action`;
const OUT_DIR = path.join(__dirname, "_test_out_v3");
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function toPortalDate(isoDate) {
  const [y, m, d] = String(isoDate).split("-");
  return `${d}/${m}/${y}`;
}
function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10);
}
function today() { return new Date().toISOString().slice(0, 10); }

/**
 * Carica la pagina iniziale e restituisce un token Struts fresco.
 */
async function loadStrutsToken(client) {
  const res = await client.get(INIT_URL, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    },
  });
  const $ = cheerio.load(String(res.data || ""));
  const name = $('input[name="struts.token.name"]').val() || "";
  const value = name ? $(`input[name="${name}"]`).val() || "" : "";
  return { name, value, cookiesSeen: (res.headers?.["set-cookie"] || []).length };
}

/**
 * POST al form Stampa Elenco Rinnovi con le date specifiche.
 */
async function testStampaElencoRinnovi(client, { dataInizioIso, dataFineIso, label }) {
  const di = toPortalDate(dataInizioIso);
  const df = toPortalDate(dataFineIso);

  // 1) Token Struts fresco (spesso è single-use!)
  const { name: tokenName, value: tokenValue } = await loadStrutsToken(client);

  // 2) Build form body — ESATTAMENTE come il form HTML reale
  const params = new URLSearchParams();
  if (tokenName && tokenValue) {
    params.set("struts.token.name", tokenName);
    params.set(tokenName, tokenValue);
  }
  params.set("richiestaView.richiestaRinnAgenziaFrom.dataInserimento", di);
  params.set("richiestaView.richiestaRinnAgenziaTo.dataInserimento", df);
  params.set("action:ReadStampaElencoRinnAgenzia_stampaElenco", "Stampa Elenco");

  // 3) POST
  let res;
  try {
    res = await client.post(INIT_URL, params.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: INIT_URL,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
        "Upgrade-Insecure-Requests": "1",
      },
      maxRedirects: 10,
      responseType: "arraybuffer", // così possiamo rilevare PDF
    });
  } catch (err) {
    return {
      ok: false,
      status: err?.response?.status || 0,
      errorMessage: `POST failed: ${err.message}`,
    };
  }

  // 4) Salva risposta
  const filename = `stampa_${label.replace(/\W+/g, "_")}.bin`;
  const buf = Buffer.from(res.data);
  fs.writeFileSync(path.join(OUT_DIR, filename), buf);

  // 5) Detect content type
  const ct = String(res.headers?.["content-type"] || "");
  const isPdf = buf.slice(0, 5).toString() === "%PDF-";
  const isHtml = ct.includes("text/html") || buf.slice(0, 100).toString().toLowerCase().includes("<html");

  if (isPdf) {
    return {
      ok: true,
      status: res.status,
      contentType: ct,
      isPdf: true,
      sizeBytes: buf.length,
      filename,
    };
  }

  // 6) Parse HTML
  const html = buf.toString("utf8");
  // Rinomina il file .bin in .html se è HTML
  const htmlFile = `stampa_${label.replace(/\W+/g, "_")}.html`;
  fs.writeFileSync(path.join(OUT_DIR, htmlFile), html);
  fs.unlinkSync(path.join(OUT_DIR, filename));

  const $ = cheerio.load(html);
  const title = ($("title").text() || "").trim();
  const actionError =
    $(".actionError li, .actionError, .errorMessage, .errori").first().text().trim() ||
    "";
  const bodyPreview = $("body").text().replace(/\s+/g, " ").trim().slice(0, 300);

  // Cerca righe risultati
  const rowsListTable = $("#listTable > tbody tr").length;
  const rowsAnyTable = $("table tbody tr").length;
  const tables = [];
  $("table").each((i, t) => {
    const $t = $(t);
    const rows = $t.find("tbody tr").length || $t.find("tr").length;
    tables.push({ i, id: $t.attr("id") || "", rows });
  });

  // Detect errori noti
  const is31DayError = /intervallo massimo|31 giorn/i.test(html);
  const isActionError = /\.action\.[A-Za-z]+\.error/i.test(actionError);
  const isMissingField = /necessario popolare|alternativa/i.test(actionError);
  const isEmptyResult = /Nessun.*(elemento|risultat|dato|trovat)/i.test(html);

  return {
    ok: res.status === 200 && !actionError,
    status: res.status,
    contentType: ct,
    isPdf: false,
    sizeBytes: buf.length,
    filename: htmlFile,
    title,
    rowsListTable,
    rowsAnyTable,
    actionError,
    bodyPreview,
    tables: tables.slice(0, 5),
    is31DayError,
    isActionError,
    isMissingField,
    isEmptyResult,
  };
}

/* ----------------- MAIN ----------------- */
async function main() {
  console.log("━".repeat(70));
  console.log("  TEST V3 — Stampa Elenco Rinnovi (ACTION CORRETTA)");
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

  const tests = [
    { label: "7gg",     days: 7    },
    { label: "31gg",    days: 31   },
    { label: "60gg",    days: 60   },
    { label: "90gg",    days: 90   },
    { label: "180gg",   days: 180  },
    { label: "365gg",   days: 365  },
    { label: "730gg",   days: 730  },
    { label: "1825gg",  days: 1825 },
  ];

  const results = [];
  console.log("2) Esecuzione test con action=ReadStampaElencoRinnAgenzia_stampaElenco\n");
  for (const t of tests) {
    const di = daysAgo(t.days);
    const df = today();
    process.stdout.write(`   ▸ ${t.label.padEnd(8)} (${di} → ${df}) ... `);
    try {
      const r = await testStampaElencoRinnovi(client, {
        dataInizioIso: di,
        dataFineIso: df,
        label: t.label,
      });
      results.push({ ...t, ...r });
      if (r.isPdf) {
        console.log(`PDF! size=${r.sizeBytes}B → ${r.filename}`);
      } else if (r.is31DayError) {
        console.log(`LIMITE 31gg → ${r.filename}`);
      } else if (r.isActionError) {
        console.log(`ActionError → ${r.actionError.slice(0, 60)}`);
      } else if (r.isMissingField) {
        console.log(`Missing field → ${r.actionError.slice(0, 60)}`);
      } else if (r.ok) {
        console.log(`OK title="${r.title}" rows=${r.rowsListTable}/${r.rowsAnyTable} size=${r.sizeBytes}B`);
      } else if (r.actionError) {
        console.log(`errore → ${r.actionError.slice(0, 60)}`);
      } else {
        console.log(`status=${r.status} size=${r.sizeBytes}B title="${r.title}"`);
      }
    } catch (err) {
      console.log(`EXCEPTION: ${err.message}`);
      results.push({ ...t, error: err.message });
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log("\n3) Riepilogo");
  console.log("   " + "─".repeat(75));
  console.log("   Range    | Status | Size    | PDF | Rows  | Title / Errore");
  console.log("   " + "─".repeat(75));
  for (const r of results) {
    const range = String(r.label || "").padEnd(8);
    const st = String(r.status || "-").padEnd(6);
    const sz = String(r.sizeBytes || "-").padEnd(7);
    const pdf = r.isPdf ? "Y" : "N";
    const rows = String(r.rowsListTable || r.rowsAnyTable || "-").padEnd(5);
    const note = r.isPdf
      ? "PDF"
      : (r.actionError ? r.actionError.slice(0, 40) : (r.title || "?"));
    console.log(`   ${range} | ${st} | ${sz} | ${pdf}   | ${rows} | ${note}`);
  }

  console.log();
  console.log("✔ Tutti gli output salvati in:", OUT_DIR);
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  if (err.response) {
    console.error("HTTP", err.response.status);
    console.error(String(err.response.data || "").slice(0, 500));
  }
  process.exit(1);
});

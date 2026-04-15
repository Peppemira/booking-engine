/**
 * DRY-RUN end-to-end della Strategia A
 * =====================================
 * 1) Login al portale
 * 2) Raccoglie seed persone:
 *    - Prima prova collectPersoneForStrategiaA (Supabase candidates/rinnovi_portale)
 *    - Se vuota, fa un fallback: ricerca baseline ultimi 30 giorni, estrae CF+patente
 * 3) Chiama leggiRinnoviStoriciPerPersone(persone)
 * 4) Stampa i risultati ma NON upserta sul DB (solo print)
 *
 * Uso:
 *   node test_strategia_a_dryrun.js           → dryrun con max 5 persone
 *   MAX=10 node test_strategia_a_dryrun.js    → custom limite
 */

require("dotenv").config({ quiet: true });
const cheerio = require("cheerio");
const { loginDirectHttp } = require("./src/connector/portalSession");
const { makeHttpClient } = require("./src/connector/portalHttp");
const { leggiRinnoviStoriciPerPersone } = require("./src/connector/portalSync");
const supabase = require("./src/database/supabase");

const PORTAL_BASE = "https://www.ilportaledellautomobilista.it";
const MAX_PERSONE = Number(process.env.MAX || 5);

function normalizeText(t) { return (t || "").replace(/\s+/g, " ").trim(); }
function toPortalDate(iso) {
  const [y, m, d] = String(iso).split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Copia di collectPersoneForStrategiaA (senza accesso al modulo privato)
 */
async function collectPersoneFromDb({ autoscuolaId = null, limit = 0 } = {}) {
  const out = new Map();

  // candidates
  try {
    let q = supabase
      .from("candidates")
      .select("codice_fiscale, patente_numero, cognome, nome")
      .not("patente_numero", "is", null);
    if (autoscuolaId) q = q.eq("autoscuola_id", autoscuolaId);
    const { data, error } = await q;
    if (!error) {
      for (const c of data || []) {
        const cognome = (c.cognome || "").trim().toUpperCase();
        const patente = (c.patente_numero || "").trim().toUpperCase();
        const cf = (c.codice_fiscale || "").trim().toUpperCase();
        if (!patente) continue;
        if (!cognome && !cf) continue;
        const key = cf || `${cognome}|${patente}`;
        if (!out.has(key)) {
          out.set(key, { codiceFiscale: cf, cognome, patente, sorgente: "candidates" });
        }
      }
    }
  } catch (_) {}

  // rinnovi_portale
  try {
    let q = supabase
      .from("rinnovi_portale")
      .select("codice_fiscale, patente_posseduta, cognome, nome")
      .eq("tipo_rinnovo", "patente")
      .not("patente_posseduta", "is", null);
    if (autoscuolaId) q = q.eq("autoscuola_id", autoscuolaId);
    const { data, error } = await q;
    if (!error) {
      for (const r of data || []) {
        const cognome = (r.cognome || "").trim().toUpperCase();
        const patente = (r.patente_posseduta || "").trim().toUpperCase();
        const cf = (r.codice_fiscale || "").trim().toUpperCase();
        if (!patente) continue;
        if (!cognome && !cf) continue;
        const key = cf || `${cognome}|${patente}`;
        if (!out.has(key)) {
          out.set(key, { codiceFiscale: cf, cognome, patente, sorgente: "rinnovi_portale" });
        }
      }
    }
  } catch (_) {}

  const arr = Array.from(out.values());
  return limit > 0 ? arr.slice(0, limit) : arr;
}

/**
 * Fallback: usa il portale per estrarre seed dai rinnovi degli ultimi 30 giorni
 */
async function seedFromPortal(client, limit) {
  const dataInizio = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const dataFine = new Date().toISOString().slice(0, 10);
  const raw = [];

  for (const stato of ["A", "D", "S", "R"]) {
    const url =
      `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestRinnAgenzia_initGestRinnAgenzia.action?` +
      `struts.token.name=tokenListGestRinnAgenzia` +
      `&richiestaView.richiestaRinnAgenziaFrom.marcaOperativa=` +
      `&richiestaView.richiestaRinnAgenziaFrom.patentePosseduta=` +
      `&richiestaView.cognome=` +
      `&richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.codiceFiscale=` +
      `&richiestaView.richiestaRinnAgenziaFrom.codiceStatoRinnAgenzia=${stato}` +
      `&richiestaView.richiestaRinnAgenziaFrom.dataInserimento=${toPortalDate(dataInizio)}` +
      `&richiestaView.richiestaRinnAgenziaTo.dataInserimento=${toPortalDate(dataFine)}` +
      `&action%3AReadGestRinnAgenzia_pagingGestRinnAgenzia=Ricerca`;
    try {
      const res = await client.get(url);
      const $ = cheerio.load(String(res.data || ""));
      $("#listTable > tbody tr").each(function () {
        const $tds = $(this).find("td");
        const marca = $(this).find("td > input").val();
        if (!marca) return;
        raw.push({
          marca_operativa: marca,
          cognome: normalizeText($tds.eq(5).text()),
          nome: normalizeText($tds.eq(6).text()),
        });
      });
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 300));
    if (raw.length >= limit * 3) break; // abbastanza per filtrare
  }

  // Per ciascuno scarica dettaglio → CF + patente
  const out = [];
  for (let i = 0; i < raw.length && out.length < limit; i++) {
    const row = raw[i];
    try {
      const detUrl =
        `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestRinnAgenzia_pagingGestRinnAgenzia.action?` +
        `richiestaView.richiestaRinnAgenziaFrom.marcaOperativa=${encodeURIComponent(row.marca_operativa)}` +
        `&action%3ASelectRichRinnAgenzia_viewElementRichRinnAgenzia=Visualizza`;
      const res = await client.get(detUrl);
      const $ = cheerio.load(String(res.data || ""));
      const fv = (n) => normalizeText($(`[name='${n}']`).val() || $(`[name='${n}']`).text());
      const cf = fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.codiceFiscale");
      const patente = fv("richiestaView.richiestaRinnAgenziaFrom.patente") ||
                      fv("richiestaView.richiestaRinnAgenziaFrom.thePatentePosseduta.numeroPatenteCompleto");
      if (cf && patente) {
        out.push({
          codiceFiscale: cf,
          cognome: row.cognome,
          patente,
          sorgente: "seed_portale",
        });
      }
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 400));
  }
  return out;
}

async function main() {
  console.log("━".repeat(78));
  console.log("  DRY-RUN end-to-end — Strategia A");
  console.log("━".repeat(78));
  console.log();

  console.log("1) Login al portale...");
  const jar = await loginDirectHttp({
    username: process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
    password: process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
    pin: process.env.PORTAL_PIN,
  });
  const client = makeHttpClient(jar);
  console.log("   OK\n");

  // Step 2: raccolta persone
  console.log("2) Raccolta persone — collectPersoneFromDb (Supabase)...");
  let persone = await collectPersoneFromDb({ limit: MAX_PERSONE });
  console.log(`   Trovate ${persone.length} persone dal DB`);

  if (persone.length === 0) {
    console.log("   DB vuoto, fallback: seed dal portale (ultimi 30gg)...");
    persone = await seedFromPortal(client, MAX_PERSONE);
    console.log(`   Seed dal portale: ${persone.length} persone\n`);
  }

  if (persone.length === 0) {
    console.log("   ⚠ Nessuna persona disponibile, dry-run interrotto.");
    return;
  }

  // Mostra lista
  console.log(`\n3) Lista persone da iterare (${persone.length}):`);
  persone.forEach((p, i) => {
    const cfMask = p.codiceFiscale ? p.codiceFiscale.slice(0, 6) + "****" + p.codiceFiscale.slice(-4) : "-";
    console.log(`   ${String(i + 1).padStart(2)}. ${(p.cognome || "").padEnd(15)} | cf=${cfMask} | pat=${p.patente} | ${p.sorgente}`);
  });
  console.log();

  // Step 3: leggiRinnoviStoriciPerPersone
  console.log("4) Chiamata leggiRinnoviStoriciPerPersone(persone)...");
  const started = Date.now();
  const rinnovi = await leggiRinnoviStoriciPerPersone(client, {
    persone,
    withDettaglio: true,
    delayMs: 500,
    onProgress: (p) => {
      if (p.fase === "strategia_a_ricerca_persone") {
        console.log(`   [ricerca] ${p.completate}/${p.totale} persone, raccolti=${p.raccolti}, errori=${p.errori}`);
      } else if (p.fase === "strategia_a_dettaglio") {
        console.log(`   [dettagli] ${p.completate}/${p.totale}`);
      }
    },
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`   Completato in ${elapsed}s\n`);

  // Step 4: report
  console.log("5) Rinnovi raccolti (DEDUPLICATI):", rinnovi.length);
  console.log("   " + "─".repeat(72));

  // Analisi per anno
  const perAnno = new Map();
  for (const r of rinnovi) {
    const data = r.data_inserimento || r.dettaglio?.data_inserimento || "";
    const match = data.match(/(\d{4})$/);
    const anno = match ? match[1] : "???";
    perAnno.set(anno, (perAnno.get(anno) || 0) + 1);
  }
  console.log("   Distribuzione per anno:");
  const anni = Array.from(perAnno.keys()).sort();
  for (const a of anni) {
    console.log(`     ${a}: ${perAnno.get(a)} rinnovi`);
  }
  console.log();

  // Campione primi 15 rinnovi
  console.log("   Primi 15 rinnovi:");
  for (const r of rinnovi.slice(0, 15)) {
    const det = r.dettaglio || {};
    const cf = (det.codice_fiscale || "").slice(0, 10) + (det.codice_fiscale?.length > 10 ? "..." : "");
    console.log(`     • ${(r.data_inserimento || "?").padEnd(10)} ${r.marca_operativa.padEnd(12)} ${(r.cognome || "").padEnd(15)} ${(r.nome || "").padEnd(15)} cf=${cf}`);
  }

  // Statistiche aggregate
  console.log("\n━".repeat(39));
  console.log("RIEPILOGO DRY-RUN");
  console.log("━".repeat(78));
  console.log(`Persone iterate:       ${persone.length}`);
  console.log(`Rinnovi trovati:       ${rinnovi.length}`);
  console.log(`Media per persona:     ${(rinnovi.length / persone.length).toFixed(1)}`);
  console.log(`Durata:                ${elapsed}s`);
  console.log(`Tempo medio:           ${((Date.now() - started) / persone.length / 1000).toFixed(1)}s / persona`);
  console.log(`Anno più vecchio:      ${anni[0] || "—"}`);
  console.log(`Anno più recente:      ${anni[anni.length - 1] || "—"}`);
  console.log();
  console.log("NOTA: questo era un DRY-RUN — i dati NON sono stati salvati su Supabase.");
  console.log();
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  console.error(err.stack);
  process.exit(1);
});

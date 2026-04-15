/**
 * TEST end-to-end Strategia A per rinnovi MEDICI (TT2112) e CQC.
 *
 * Seed: legge prime persone da candidates/rinnovi_portale; se vuoto, fallback al
 * portale cercando rinnovi patente negli ultimi 30gg per estrarre CF+patente
 * (stesso pattern di test_strategia_a_dryrun.js).
 *
 * Uso:
 *   node test_strategia_a_medici_cqc.js           → max 3 persone
 *   MAX=5 node test_strategia_a_medici_cqc.js     → custom
 */

require("dotenv").config({ quiet: true });
const cheerio = require("cheerio");
const { loginDirectHttp } = require("./src/connector/portalSession");
const { makeHttpClient } = require("./src/connector/portalHttp");
const {
  leggiRinnoviMediciStoriciPerPersone,
  leggiRinnoviCqcStoriciPerPersone,
} = require("./src/connector/portalSync");
const supabase = require("./src/database/supabase");

const PORTAL_BASE = "https://www.ilportaledellautomobilista.it";
const MAX_PERSONE = Number(process.env.MAX || 3);

function normalizeText(t) { return (t || "").replace(/\s+/g, " ").trim(); }
function toPortalDate(iso) {
  const [y, m, d] = String(iso).split("-");
  return `${d}/${m}/${y}`;
}

async function collectPersoneFromDb({ limit = 0 } = {}) {
  const out = new Map();

  try {
    const { data, error } = await supabase
      .from("candidates")
      .select("codice_fiscale, patente_numero, cognome, nome")
      .not("patente_numero", "is", null);
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

  try {
    const { data, error } = await supabase
      .from("rinnovi_portale")
      .select("codice_fiscale, patente_posseduta, cognome, nome")
      .eq("tipo_rinnovo", "patente")
      .not("patente_posseduta", "is", null);
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
    if (raw.length >= limit * 3) break;
  }

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
  console.log("  TEST Strategia A — Rinnovi MEDICI (TT2112) e CQC");
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

  // Seed persone
  console.log("2) Raccolta persone...");
  let persone = await collectPersoneFromDb({ limit: MAX_PERSONE });
  if (persone.length === 0) {
    console.log("   DB vuoto, fallback: seed dal portale (ultimi 30gg)...");
    persone = await seedFromPortal(client, MAX_PERSONE);
  }
  console.log(`   Seed: ${persone.length} persone\n`);

  if (persone.length === 0) {
    console.log("   ⚠ Nessuna persona, test interrotto.");
    return;
  }

  persone.forEach((p, i) => {
    const cfMask = p.codiceFiscale ? p.codiceFiscale.slice(0, 6) + "****" + p.codiceFiscale.slice(-4) : "-";
    console.log(`   ${i + 1}. ${(p.cognome || "").padEnd(15)} cf=${cfMask} pat=${p.patente}`);
  });
  console.log();

  // ─── TEST MEDICI ───
  console.log("━".repeat(78));
  console.log("3) Test leggiRinnoviMediciStoriciPerPersone");
  console.log("━".repeat(78));
  let t0 = Date.now();
  let rinnoviMed = [];
  try {
    rinnoviMed = await leggiRinnoviMediciStoriciPerPersone(client, {
      persone,
      withDettaglio: true,
      delayMs: 500,
      onProgress: (p) => {
        console.log(`   [${p.fase}] ${p.completate}/${p.totale}`);
      },
    });
  } catch (err) {
    console.error("   ✗ ERRORE:", err.message);
  }
  const elapsedMed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`   Trovati ${rinnoviMed.length} rinnovi medici in ${elapsedMed}s`);
  if (rinnoviMed.length > 0) {
    console.log("   Primi 5:");
    for (const r of rinnoviMed.slice(0, 5)) {
      const det = r.dettaglio || {};
      console.log(`     • ${(r.data_inserimento || "?").padEnd(10)} ${r.marca_operativa.padEnd(12)} ${(r.cognome || "").padEnd(15)} cf=${det.codice_fiscale || "-"}`);
    }
  }
  console.log();

  // ─── TEST CQC ───
  console.log("━".repeat(78));
  console.log("4) Test leggiRinnoviCqcStoriciPerPersone");
  console.log("━".repeat(78));
  t0 = Date.now();
  let rinnoviCqc = [];
  try {
    rinnoviCqc = await leggiRinnoviCqcStoriciPerPersone(client, {
      persone,
      withDettaglio: true,
      delayMs: 500,
      onProgress: (p) => {
        console.log(`   [${p.fase}] ${p.completate}/${p.totale}`);
      },
    });
  } catch (err) {
    console.error("   ✗ ERRORE:", err.message);
  }
  const elapsedCqc = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`   Trovati ${rinnoviCqc.length} rinnovi CQC in ${elapsedCqc}s`);
  if (rinnoviCqc.length > 0) {
    console.log("   Primi 5:");
    for (const r of rinnoviCqc.slice(0, 5)) {
      const det = r.dettaglio || {};
      console.log(`     • ${(r.data_inserimento || "?").padEnd(10)} ${r.marca_operativa.padEnd(12)} ${(r.cognome || "").padEnd(15)} cf=${det.codice_fiscale || "-"}`);
    }
  }
  console.log();

  // ─── RIEPILOGO ───
  console.log("━".repeat(78));
  console.log("RIEPILOGO");
  console.log("━".repeat(78));
  console.log(`Persone iterate:       ${persone.length}`);
  console.log(`Rinnovi MEDICI:        ${rinnoviMed.length} (${elapsedMed}s)`);
  console.log(`Rinnovi CQC:           ${rinnoviCqc.length} (${elapsedCqc}s)`);
  console.log();
  console.log("NOTA: questo è un TEST di sola lettura. Nessun dato scritto su Supabase.");
  console.log();
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  console.error(err.stack);
  process.exit(1);
});

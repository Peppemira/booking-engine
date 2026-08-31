// Retry per le persone/marche che hanno dato errore nel run principale di Strategia A medici.
// Legge il log file del run principale, estrae i cognomi/marche con errore,
// e rilancia fetch + dettaglio + upsert con retry + backoff esponenziale.
//
// Uso:
//   node scripts/recovery/retry_persone_errore.js --log=PATH [--delay=500] [--max-retry=3]
//
// Dove PATH è il percorso del file di log del run principale (es: il file .output del task background).

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });
const fs = require("fs");
const cheerio = require("cheerio");
const { createClient } = require("@supabase/supabase-js");
const { loginDirectHttp } = require("../../src/connector/portalSession");
const { makeHttpClient } = require("../../src/connector/portalHttp");
const { leggiRinnoviMediciPerPersona } = require("../../src/connector/portalSync");
const { upsertRinnovoPortale } = require("../../src/connector/syncArchivioStorico");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const GM = "9380513a-99ad-4067-adc7-493af2e083d1";
const PORTAL_BASE = process.env.PORTAL_BASE_URL || "https://www.ilportaledellautomobilista.it";

// CLI args
const argLog      = process.argv.find((a) => a.startsWith("--log="));
const argDelay    = process.argv.find((a) => a.startsWith("--delay="));
const argMaxRetry = process.argv.find((a) => a.startsWith("--max-retry="));
const LOG_PATH  = argLog ? argLog.split("=")[1] : null;
const DELAY_MS  = argDelay ? Number(argDelay.split("=")[1]) : 500;
const MAX_RETRY = argMaxRetry ? Number(argMaxRetry.split("=")[1]) : 3;

if (!LOG_PATH) {
  console.error("ERRORE: --log=PATH obbligatorio");
  console.error("Esempio: node test_retry_persone_errore.js --log='C:/path/to/bm8rag6ag.output'");
  process.exit(1);
}

function normalizeText(t) {
  return String(t || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function parseMediciDetail(html) {
  const $ = cheerio.load(html);
  const fv = (name) =>
    normalizeText($(`[name='${name}']`).val() || $(`[name='${name}']`).text());
  return {
    codice_fiscale:      fv("richiestaView.richiestaRinnMedFrom.theAnagrafica.codiceFiscale"),
    cognome_det:         fv("richiestaView.cognome") ||
                         fv("richiestaView.richiestaRinnMedFrom.theAnagrafica.cognome"),
    nome_det:            fv("richiestaView.nome") ||
                         fv("richiestaView.richiestaRinnMedFrom.theAnagrafica.nome"),
    data_nascita:        fv("richiestaView.dataNascita") ||
                         fv("richiestaView.richiestaRinnMedFrom.theAnagrafica.dataNascita"),
    sesso:               fv("richiestaView.richiestaRinnMedFrom.theAnagrafica.sesso"),
    comune_nascita:      fv("richiestaView.richiestaRinnMedFrom.theAnagrafica.theComuneNascita.descrizioneComune"),
    provincia_nascita:   fv("richiestaView.richiestaRinnMedFrom.theAnagrafica.theComuneNascita.theProvinciaNascita.descrizione"),
    comune_residenza:    fv("richiestaView.richiestaRinnMedFrom.theAnagrafica.theComune.descrizioneComune"),
    provincia_residenza: fv("richiestaView.richiestaRinnMedFrom.theAnagrafica.theComune.theProvincia.descrizione"),
    cap:                 fv("richiestaView.richiestaRinnMedFrom.theAnagrafica.cap"),
    indirizzo:           fv("richiestaView.richiestaRinnMedFrom.theAnagrafica.indirizzo"),
    patente_posseduta:   fv("richiestaView.richiestaRinnMedFrom.thePatentePosseduta.numeroPatenteCompleto"),
    data_inserimento:    fv("richiestaView.richiestaRinnMedFrom.dataInserimento"),
    data_visita_medica:  fv("richiestaView.richiestaRinnMedFrom.dataVisitaMedica"),
    numero_certificato:  fv("richiestaView.richiestaRinnMedFrom.numeroCertificato"),
    medico_codice:       fv("richiestaView.richiestaRinnMedFrom.codiceMedico"),
  };
}

function parseLogErrors(logContent) {
  const persone = new Set();
  const detailMarcas = new Set();
  const lines = logContent.split(/\r?\n/);
  for (const line of lines) {
    let m;
    // "  errore [COGNOME]: ..."  (errore nella fetch persona)
    m = line.match(/^\s*errore \[([^\]]+)\]:/);
    if (m) { persone.add(m[1].trim()); continue; }
    // "  det error [MARCA]: ..."  (errore nella fetch dettaglio)
    m = line.match(/^\s*det error \[([^\]]+)\]:/);
    if (m) { detailMarcas.add(m[1].trim()); continue; }
  }
  return { persone: Array.from(persone), detailMarcas: Array.from(detailMarcas) };
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function withRetry(fn, label, max = MAX_RETRY) {
  let lastErr;
  for (let i = 0; i < max; i += 1) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const backoff = 500 * Math.pow(2, i);
      console.log(`    retry ${i + 1}/${max} [${label}] in ${backoff}ms (${e.message?.slice(0, 60)})`);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

async function fetchPersoneByCognomi(cognomi) {
  if (cognomi.length === 0) return [];
  // NOTA: un cognome può avere match multipli (fratelli, omonimi).
  // Li includiamo tutti — l'upsert dedupica per marca_operativa.
  const { data, error } = await supabase
    .from("candidates")
    .select("codice_fiscale, patente_numero, cognome, nome")
    .eq("autoscuola_id", GM)
    .in("cognome", cognomi.map((c) => c.toUpperCase()))
    .not("patente_numero", "is", null);
  if (error) throw error;
  const seen = new Set();
  const out = [];
  for (const c of (data || [])) {
    const cog = String(c.cognome || "").trim().toUpperCase();
    const pat = String(c.patente_numero || "").trim().toUpperCase();
    const cf  = String(c.codice_fiscale || "").trim().toUpperCase();
    const key = cf || `${cog}|${pat}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ codiceFiscale: cf, cognome: cog, patente: pat, nome: String(c.nome || "").trim() });
  }
  return out;
}

(async () => {
  console.log("=== Retry errori Strategia A medici ===");
  console.log(`Log:        ${LOG_PATH}`);
  console.log(`Delay:      ${DELAY_MS}ms`);
  console.log(`Max retry:  ${MAX_RETRY}\n`);

  if (!fs.existsSync(LOG_PATH)) {
    console.error("ERRORE: log non trovato:", LOG_PATH);
    process.exit(1);
  }

  // 1) Estrai errori dal log
  const logContent = fs.readFileSync(LOG_PATH, "utf8");
  const { persone: cognomiErrore, detailMarcas } = parseLogErrors(logContent);
  console.log(`Persone con errore (search):   ${cognomiErrore.length}`);
  if (cognomiErrore.length > 0) console.log(`  ${cognomiErrore.join(", ")}`);
  console.log(`Marche con errore (dettaglio): ${detailMarcas.length}`);
  if (detailMarcas.length > 0) console.log(`  ${detailMarcas.join(", ")}`);
  console.log();

  if (cognomiErrore.length === 0 && detailMarcas.length === 0) {
    console.log("Nessun errore da rilanciare.");
    return;
  }

  // 2) Mappa cognomi → persone reali dal DB
  const persone = cognomiErrore.length > 0 ? await fetchPersoneByCognomi(cognomiErrore) : [];
  console.log(`Persone matchate in candidates: ${persone.length}\n`);

  // 3) Login portale
  console.log("Login portale...");
  const jar = await loginDirectHttp({
    username: process.env.PORTAL_USER,
    password: process.env.PORTAL_PASS,
    pin:      process.env.PORTAL_PIN,
  });
  const client = makeHttpClient(jar);
  console.log("Login OK\n");

  const stats = {
    retry_persone_ok: 0,
    retry_persone_fail: 0,
    retry_detail_ok: 0,
    retry_detail_fail: 0,
    db_inserted: 0,
    db_updated: 0,
    db_unchanged: 0,
    db_error: 0,
  };
  const detailBase = `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestRinnMed_pagingGestRinnMedHd.action`;

  // 4) Retry PERSONE con errore nella search
  console.log(`--- Retry ${persone.length} persone (search + dettaglio) ---`);
  for (let i = 0; i < persone.length; i += 1) {
    const persona = persone[i];
    const label = persona.cognome || persona.codiceFiscale;
    let rinnovi = [];
    try {
      rinnovi = await withRetry(
        () => leggiRinnoviMediciPerPersona(client, {
          codiceFiscale: persona.codiceFiscale || "",
          cognome:       persona.cognome || "",
          patente:       persona.patente,
        }),
        label
      );
      stats.retry_persone_ok += 1;
    } catch (err) {
      stats.retry_persone_fail += 1;
      console.log(`  ✗ [${label}] search failed: ${err.message?.slice(0, 80)}`);
      await sleep(DELAY_MS);
      continue;
    }

    for (const rin of rinnovi) {
      try {
        const detUrl = `${detailBase}?richiestaView.richiestaRinnMedFrom.marcaOperativa=${encodeURIComponent(rin.marca_operativa)}&action%3ASelectRichRinnMed_viewElementRichRinnMed=Visualizza`;
        const detRes = await withRetry(() => client.get(detUrl), rin.marca_operativa);
        const detHtml = typeof detRes === "string" ? detRes : detRes?.data || "";
        const dettaglio = parseMediciDetail(detHtml);

        const payload = {
          marca_operativa: rin.marca_operativa,
          tipo_rinnovo: "medico",
          stato_portale: rin.stato_richiesta || rin.stato || null,
          stato:         rin.stato_richiesta || rin.stato || null,
          cognome: dettaglio.cognome_det || rin.cognome || persona.cognome || null,
          nome:    dettaglio.nome_det || rin.nome || null,
          data_inserimento: rin.data_inserimento || dettaglio.data_inserimento || null,
          patente: dettaglio.patente_posseduta || persona.patente,
          dettaglio,
        };
        const result = await upsertRinnovoPortale(payload, { autoscuolaId: GM });
        if (result?.action === "inserted") stats.db_inserted += 1;
        else if (result?.action === "updated") stats.db_updated += 1;
        else stats.db_unchanged += 1;
        stats.retry_detail_ok += 1;
      } catch (e) {
        stats.retry_detail_fail += 1;
        console.log(`    det FAIL [${rin.marca_operativa}]: ${e.message?.slice(0, 60)}`);
      }
    }
    console.log(`  ✓ [${i + 1}/${persone.length}] [${label}] ${rinnovi.length} rinnovi rielaborati`);
    if (i < persone.length - 1) await sleep(DELAY_MS);
  }

  // 5) Retry MARCHE con errore dettaglio isolato (persona era OK ma la fetch dettaglio ha fallito)
  if (detailMarcas.length > 0) {
    console.log(`\n--- Retry ${detailMarcas.length} dettagli isolati ---`);
    for (let i = 0; i < detailMarcas.length; i += 1) {
      const marca = detailMarcas[i];
      try {
        const detUrl = `${detailBase}?richiestaView.richiestaRinnMedFrom.marcaOperativa=${encodeURIComponent(marca)}&action%3ASelectRichRinnMed_viewElementRichRinnMed=Visualizza`;
        const detRes = await withRetry(() => client.get(detUrl), marca);
        const detHtml = typeof detRes === "string" ? detRes : detRes?.data || "";
        const dettaglio = parseMediciDetail(detHtml);
        if (!dettaglio.codice_fiscale) {
          stats.retry_detail_fail += 1;
          console.log(`  ✗ [${marca}] HTML vuoto / pagina non valida`);
          continue;
        }
        const payload = {
          marca_operativa: marca,
          tipo_rinnovo: "medico",
          stato_portale: null,
          stato: null,
          cognome: dettaglio.cognome_det || null,
          nome:    dettaglio.nome_det || null,
          data_inserimento: dettaglio.data_inserimento || null,
          patente: dettaglio.patente_posseduta || null,
          dettaglio,
        };
        const result = await upsertRinnovoPortale(payload, { autoscuolaId: GM });
        if (result?.action === "inserted") stats.db_inserted += 1;
        else if (result?.action === "updated") stats.db_updated += 1;
        else stats.db_unchanged += 1;
        stats.retry_detail_ok += 1;
        console.log(`  ✓ [${i + 1}/${detailMarcas.length}] [${marca}] OK`);
      } catch (e) {
        stats.retry_detail_fail += 1;
        console.log(`  ✗ [${marca}] ${e.message?.slice(0, 80)}`);
      }
      if (i < detailMarcas.length - 1) await sleep(DELAY_MS);
    }
  }

  console.log(`\n=== Riepilogo retry ===`);
  console.log(`Persone search OK:     ${stats.retry_persone_ok}`);
  console.log(`Persone search fail:   ${stats.retry_persone_fail}`);
  console.log(`Dettagli OK:           ${stats.retry_detail_ok}`);
  console.log(`Dettagli fail:         ${stats.retry_detail_fail}`);
  console.log(`\nDB ops:`);
  console.log(`  Inserted:  ${stats.db_inserted}`);
  console.log(`  Updated:   ${stats.db_updated}`);
  console.log(`  Unchanged: ${stats.db_unchanged}`);
})().catch((err) => {
  console.error("\nFATAL:", err.message);
  console.error(err.stack);
  process.exit(1);
});

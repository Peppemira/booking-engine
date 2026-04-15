// Recupera anagrafica completa (CF + patente + residenza) per tutti i
// rinnovi_portale di Giuseppe Miracolo dove codice_fiscale IS NULL.
//
// Strategia: per ogni record, GET la pagina dettaglio del portale via il
// parametro marca_operativa, parsea con cheerio i campi anagrafici, poi
// richiama upsertRinnovoPortale che riutilizza la stessa logica hash +
// change detection del flusso ufficiale.
//
// Uso: node test_recupero_cf_mancanti.js [--dry-run] [--limit N]

require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const cheerio = require("cheerio");
const { createClient } = require("@supabase/supabase-js");
const { loginDirectHttp } = require("./src/connector/portalSession");
const { makeHttpClient } = require("./src/connector/portalHttp");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const GM = "9380513a-99ad-4067-adc7-493af2e083d1";
const PORTAL_BASE = process.env.PORTAL_BASE_URL || "https://www.ilportaledellautomobilista.it";

// CLI args
const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split("=")[1]) : 0;
const DELAY_MS = Number(process.env.RECUPERO_DELAY_MS || 400);

// Carichiamo upsertRinnovoPortale dopo la creazione del client supabase in modo
// che condivida la stessa istanza (il modulo la crea già al suo interno).
const { upsertRinnovoPortale } = (() => {
  try {
    return require("./src/connector/syncArchivioStorico");
  } catch (e) {
    console.error("Impossibile caricare syncArchivioStorico:", e.message);
    process.exit(1);
  }
})();

function normalizeText(txt) {
  return String(txt || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function parseDetailHtml(html) {
  const $ = cheerio.load(html);
  const fv = (name) =>
    normalizeText($(`[name='${name}']`).val() || $(`[name='${name}']`).text());

  return {
    codice_fiscale:      fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.codiceFiscale"),
    data_nascita:        fv("richiestaView.dataNascita") ||
                         fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.dataNascita"),
    sesso:               fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.sesso"),
    comune_nascita:      fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.theComuneNascita.descrizioneComune"),
    provincia_nascita:   fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.theComuneNascita.theProvinciaNascita.descrizione"),
    comune_residenza:    fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.theComune.descrizioneComune"),
    provincia_residenza: fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.theComune.theProvincia.descrizione"),
    cap:                 fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.cap"),
    indirizzo:           fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.indirizzo"),
    patente_posseduta:   fv("richiestaView.richiestaRinnAgenziaFrom.thePatentePosseduta.numeroPatenteCompleto"),
    patente_emessa:      fv("richiestaView.richiestaRinnAgenziaFrom.patente"),
    data_inserimento:    fv("richiestaView.richiestaRinnAgenziaFrom.dataInserimento"),
    // Cognome e nome sono sotto richiestaView, NON dentro theAnagrafica
    cognome_det:         fv("richiestaView.cognome"),
    nome_det:            fv("richiestaView.nome"),
  };
}

async function fetchAllSenzaCf() {
  const rows = [];
  const PAGE = 1000;
  for (let start = 0; start < 10000; start += PAGE) {
    const { data, error } = await supabase
      .from("rinnovi_portale")
      .select("id, marca_operativa, tipo_rinnovo, stato_portale, stato_descr, cognome, nome, data_inserimento")
      .eq("autoscuola_id", GM)
      .is("codice_fiscale", null)
      .range(start, start + PAGE - 1)
      .order("id", { ascending: true });
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  console.log(`=== Recupero CF mancanti per Giuseppe Miracolo ===`);
  console.log(`DRY_RUN: ${DRY_RUN}`);
  console.log(`LIMIT:   ${LIMIT || "TUTTI"}`);
  console.log(`DELAY:   ${DELAY_MS}ms\n`);

  // 1) Scarica i rinnovi senza CF
  console.log("Carico rinnovi senza CF dal DB...");
  const rinnovi = await fetchAllSenzaCf();
  console.log(`Trovati ${rinnovi.length} rinnovi senza CF\n`);

  const toProcess = LIMIT > 0 ? rinnovi.slice(0, LIMIT) : rinnovi;
  console.log(`Processiamo ${toProcess.length} record\n`);

  if (toProcess.length === 0) {
    console.log("Nulla da fare.");
    return;
  }

  // 2) Login portale
  console.log("Login al portale...");
  const jar = await loginDirectHttp({
    username: process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
    password: process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
    pin:      process.env.PORTAL_PIN,
  });
  const client = makeHttpClient(jar);
  console.log("Login OK\n");

  // 3) Loop fetch dettaglio + upsert
  const detailBase = `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestRinnAgenzia_pagingGestRinnAgenzia.action`;
  const stats = {
    total: toProcess.length,
    ok_cf: 0,        // dettaglio letto, CF recuperato
    ok_no_cf: 0,     // dettaglio letto, CF ancora vuoto (record morto sul portale?)
    errore_http: 0,  // GET fallita
    errore_db: 0,    // upsert fallito
    skipped_no_marca: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
  };

  const startTime = Date.now();
  const errors = [];

  for (let i = 0; i < toProcess.length; i += 1) {
    const rec = toProcess[i];
    const marca = rec.marca_operativa;

    if (!marca) {
      stats.skipped_no_marca += 1;
      continue;
    }

    try {
      const detUrl =
        `${detailBase}?richiestaView.richiestaRinnAgenziaFrom.marcaOperativa=${encodeURIComponent(marca)}` +
        `&action%3ASelectRichRinnAgenzia_viewElementRichRinnAgenzia=Visualizza`;

      const resp = await client.get(detUrl);
      const html = typeof resp === "string" ? resp : resp?.data || "";

      if (!html || html.length < 200) {
        stats.errore_http += 1;
        errors.push({ id: rec.id, marca, errore: "HTML vuoto/troppo corto" });
        continue;
      }

      const dettaglio = parseDetailHtml(html);
      const cfRecuperato = !!dettaglio.codice_fiscale;

      if (cfRecuperato) stats.ok_cf += 1;
      else stats.ok_no_cf += 1;

      if (!DRY_RUN) {
        // Ricostruisco la forma che upsertRinnovoPortale si aspetta
        const rinnovoForUpsert = {
          marca_operativa: marca,
          tipo_rinnovo: rec.tipo_rinnovo || "patente",
          stato_portale: rec.stato_portale,
          stato: rec.stato_descr,
          // preferiamo il cognome/nome dal dettaglio se presenti, altrimenti
          // manteniamo quelli esistenti nel record
          cognome: dettaglio.cognome_det || rec.cognome || null,
          nome:    dettaglio.nome_det    || rec.nome    || null,
          data_inserimento: rec.data_inserimento,
          dettaglio,
        };

        try {
          const result = await upsertRinnovoPortale(rinnovoForUpsert, { autoscuolaId: GM });
          if (result?.action === "inserted") stats.inserted += 1;
          else if (result?.action === "updated") stats.updated += 1;
          else stats.unchanged += 1;
        } catch (dbErr) {
          stats.errore_db += 1;
          errors.push({ id: rec.id, marca, errore: `DB: ${dbErr.message?.slice(0, 120)}` });
        }
      }
    } catch (httpErr) {
      stats.errore_http += 1;
      errors.push({
        id: rec.id,
        marca,
        errore: `HTTP: ${httpErr.message?.slice(0, 120)}`,
      });
    }

    // Progress log
    if ((i + 1) % 10 === 0 || i === toProcess.length - 1) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (i + 1) / elapsed;
      const eta = (toProcess.length - i - 1) / Math.max(rate, 0.01);
      const pct = (((i + 1) / toProcess.length) * 100).toFixed(1);
      console.log(
        `[${i + 1}/${toProcess.length}] ${pct}% ` +
        `| CF+: ${stats.ok_cf} | CF0: ${stats.ok_no_cf} | ERR: ${stats.errore_http + stats.errore_db} ` +
        `| ${rate.toFixed(1)}/s | ETA: ${Math.round(eta)}s`
      );
    }

    // Rate limit
    if (i < toProcess.length - 1) await sleep(DELAY_MS);
  }

  // Riepilogo finale
  const totalTime = (Date.now() - startTime) / 1000;
  console.log(`\n=== Riepilogo ===`);
  console.log(`Tempo totale:        ${Math.round(totalTime)}s (${(totalTime / 60).toFixed(1)} min)`);
  console.log(`Processati:          ${stats.total}`);
  console.log(`CF recuperati:       ${stats.ok_cf}`);
  console.log(`Dettaglio senza CF:  ${stats.ok_no_cf}`);
  console.log(`Errori HTTP:         ${stats.errore_http}`);
  console.log(`Errori DB:           ${stats.errore_db}`);
  console.log(`Skip (no marca):     ${stats.skipped_no_marca}`);
  if (!DRY_RUN) {
    console.log(`\nDB ops:`);
    console.log(`  Inserted:  ${stats.inserted}`);
    console.log(`  Updated:   ${stats.updated}`);
    console.log(`  Unchanged: ${stats.unchanged}`);
  } else {
    console.log(`\n[DRY_RUN] Nessuna scrittura su DB.`);
  }

  if (errors.length > 0) {
    console.log(`\nPrimi 10 errori:`);
    for (const e of errors.slice(0, 10)) {
      console.log(`  id=${e.id} marca=${e.marca}: ${e.errore}`);
    }
    if (errors.length > 10) console.log(`  ... e altri ${errors.length - 10}`);
  }
})().catch((err) => {
  console.error("\nFATAL:", err.message);
  console.error(err.stack);
  process.exit(1);
});

// Strategia A medici FULL — itera tutte le 2321 persone di GM (storici + attivi),
// per ognuna fetcha i rinnovi medici dal portale, fa il dettaglio e salva
// IMMEDIATAMENTE in DB (no batch in memoria — se crasha non perdiamo dati).
//
// Uso: node test_strategia_a_medici_full.js [--limit=N] [--start=N] [--delay=N] [--dry-run]
//
// Resume: usa --start=N per skippare le prime N persone (utile dopo crash).

require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const cheerio = require("cheerio");
const { createClient } = require("@supabase/supabase-js");
const { loginDirectHttp } = require("./src/connector/portalSession");
const { makeHttpClient } = require("./src/connector/portalHttp");
const { leggiRinnoviMediciPerPersona } = require("./src/connector/portalSync");
const { upsertRinnovoPortale } = require("./src/connector/syncArchivioStorico");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const GM = "9380513a-99ad-4067-adc7-493af2e083d1";
const PORTAL_BASE = process.env.PORTAL_BASE_URL || "https://www.ilportaledellautomobilista.it";

// CLI args
const DRY_RUN = process.argv.includes("--dry-run");
const argLimit = process.argv.find((a) => a.startsWith("--limit="));
const argStart = process.argv.find((a) => a.startsWith("--start="));
const argDelay = process.argv.find((a) => a.startsWith("--delay="));
const LIMIT = argLimit ? Number(argLimit.split("=")[1]) : 0;
const START = argStart ? Number(argStart.split("=")[1]) : 0;
const DELAY_MS = argDelay ? Number(argDelay.split("=")[1]) : 250;

function normalizeText(t) {
  return String(t || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

// Estrae dettaglio da pagina rinnovo medico
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

async function fetchAllPersone() {
  // Carica tutti i candidates di GM con patente_numero (sorgente principale)
  const map = new Map();
  const PAGE = 1000;
  for (let s = 0; s < 50000; s += PAGE) {
    const { data, error } = await supabase
      .from("candidates")
      .select("codice_fiscale, patente_numero, cognome, nome")
      .eq("autoscuola_id", GM)
      .not("patente_numero", "is", null)
      .range(s, s + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const c of data) {
      const cf = String(c.codice_fiscale || "").trim().toUpperCase();
      const pat = String(c.patente_numero || "").trim().toUpperCase();
      const cog = String(c.cognome || "").trim().toUpperCase();
      if (!pat) continue;
      if (!cf && !cog) continue;
      const key = cf || `${cog}|${pat}`;
      if (!map.has(key)) {
        map.set(key, { codiceFiscale: cf, cognome: cog, patente: pat });
      }
    }
    if (data.length < PAGE) break;
  }
  return Array.from(map.values());
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  console.log(`=== Strategia A MEDICI full ===`);
  console.log(`DRY_RUN: ${DRY_RUN}`);
  console.log(`START:   ${START}`);
  console.log(`LIMIT:   ${LIMIT || "TUTTE"}`);
  console.log(`DELAY:   ${DELAY_MS}ms\n`);

  console.log("Carico persone...");
  const all = await fetchAllPersone();
  console.log(`Persone totali: ${all.length}`);

  let toProcess = all.slice(START);
  if (LIMIT > 0) toProcess = toProcess.slice(0, LIMIT);
  console.log(`Da processare: ${toProcess.length} (start=${START}, limit=${LIMIT || "TUTTE"})\n`);

  if (toProcess.length === 0) { console.log("Nulla da fare."); return; }

  console.log("Login portale...");
  const jar = await loginDirectHttp({
    username: process.env.PORTAL_USER,
    password: process.env.PORTAL_PASS,
    pin:      process.env.PORTAL_PIN,
  });
  const client = makeHttpClient(jar);
  console.log("Login OK\n");

  const stats = {
    persone_processate: 0,
    persone_skipped: 0,
    persone_errore: 0,
    rinnovi_trovati: 0,
    rinnovi_dettaglio_ok: 0,
    rinnovi_dettaglio_err: 0,
    db_inserted: 0,
    db_updated: 0,
    db_unchanged: 0,
    db_error: 0,
    servizio_non_disponibile: false,
  };

  const startTime = Date.now();
  const detailBase = `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestRinnMed_pagingGestRinnMedHd.action`;

  for (let i = 0; i < toProcess.length; i += 1) {
    const persona = toProcess[i];
    const labelPersona = persona.cognome || persona.codiceFiscale;

    // 1) Ricerca rinnovi medici per persona
    let rinnovi = [];
    try {
      rinnovi = await leggiRinnoviMediciPerPersona(client, {
        codiceFiscale: persona.codiceFiscale || "",
        cognome:       persona.cognome || "",
        patente:       persona.patente,
      });
    } catch (err) {
      if (err.message === "SERVIZIO_NON_DISPONIBILE") {
        console.log(`\n[STOP] Servizio medici non disponibile per questa autoscuola`);
        stats.servizio_non_disponibile = true;
        break;
      }
      stats.persone_errore += 1;
      if (stats.persone_errore <= 5) console.log(`  errore [${labelPersona}]:`, err.message?.slice(0, 100));
    }

    stats.persone_processate += 1;
    stats.rinnovi_trovati += rinnovi.length;

    // 2) Per ogni rinnovo trovato → fetch dettaglio + upsert immediato
    for (const rin of rinnovi) {
      try {
        const detUrl = `${detailBase}?richiestaView.richiestaRinnMedFrom.marcaOperativa=${encodeURIComponent(rin.marca_operativa)}&action%3ASelectRichRinnMed_viewElementRichRinnMed=Visualizza`;
        const detRes = await client.get(detUrl);
        const detHtml = typeof detRes === "string" ? detRes : detRes?.data || "";
        const dettaglio = parseMediciDetail(detHtml);

        if (dettaglio.codice_fiscale) stats.rinnovi_dettaglio_ok += 1;
        else stats.rinnovi_dettaglio_err += 1;

        if (!DRY_RUN) {
          const rinnovoForUpsert = {
            marca_operativa: rin.marca_operativa,
            tipo_rinnovo: "medico",
            stato_portale: rin.stato_richiesta || rin.stato || null,
            stato: rin.stato_richiesta || rin.stato || null,
            cognome: dettaglio.cognome_det || rin.cognome || persona.cognome || null,
            nome:    dettaglio.nome_det || rin.nome || null,
            data_inserimento: rin.data_inserimento || dettaglio.data_inserimento || null,
            patente: dettaglio.patente_posseduta || persona.patente,
            dettaglio,
          };
          try {
            const result = await upsertRinnovoPortale(rinnovoForUpsert, { autoscuolaId: GM });
            if (result?.action === "inserted") stats.db_inserted += 1;
            else if (result?.action === "updated") stats.db_updated += 1;
            else stats.db_unchanged += 1;
          } catch (dbErr) {
            stats.db_error += 1;
            if (stats.db_error <= 5) console.log(`  db error [${rin.marca_operativa}]:`, dbErr.message?.slice(0, 100));
          }
        }
      } catch (detErr) {
        stats.rinnovi_dettaglio_err += 1;
        if (stats.rinnovi_dettaglio_err <= 5) console.log(`  det error [${rin.marca_operativa}]:`, detErr.message?.slice(0, 100));
      }
    }

    // Progress log
    if ((i + 1) % 10 === 0 || i === toProcess.length - 1) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (i + 1) / elapsed;
      const eta = (toProcess.length - i - 1) / Math.max(rate, 0.01);
      const pct = (((i + 1) / toProcess.length) * 100).toFixed(1);
      console.log(
        `[${i + 1}/${toProcess.length}] ${pct}% ` +
        `| trov: ${stats.rinnovi_trovati} | ins: ${stats.db_inserted} upd: ${stats.db_updated} | ERR: ${stats.db_error + stats.rinnovi_dettaglio_err + stats.persone_errore} ` +
        `| ${rate.toFixed(2)} pers/s | ETA: ${Math.round(eta/60)}min`
      );
    }

    if (i < toProcess.length - 1 && DELAY_MS > 0) await sleep(DELAY_MS);
  }

  const totalTime = (Date.now() - startTime) / 1000;
  console.log(`\n=== Riepilogo Strategia A medici ===`);
  console.log(`Tempo totale:        ${Math.round(totalTime)}s (${(totalTime / 60).toFixed(1)} min)`);
  console.log(`Persone processate:  ${stats.persone_processate}`);
  console.log(`Persone skip:        ${stats.persone_skipped}`);
  console.log(`Persone errore:      ${stats.persone_errore}`);
  console.log(`Rinnovi trovati:     ${stats.rinnovi_trovati}`);
  console.log(`Dettaglio OK:        ${stats.rinnovi_dettaglio_ok}`);
  console.log(`Dettaglio errore:    ${stats.rinnovi_dettaglio_err}`);
  console.log(`\nDB ops:`);
  console.log(`  Inserted:  ${stats.db_inserted}`);
  console.log(`  Updated:   ${stats.db_updated}`);
  console.log(`  Unchanged: ${stats.db_unchanged}`);
  console.log(`  Errors:    ${stats.db_error}`);
  if (stats.servizio_non_disponibile) console.log(`\n⚠ SERVIZIO NON DISPONIBILE`);
})().catch((err) => {
  console.error("\nFATAL:", err.message);
  console.error(err.stack);
  process.exit(1);
});

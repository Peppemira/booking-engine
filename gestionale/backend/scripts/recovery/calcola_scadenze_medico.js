// Calcola + materializza data_scadenza sui rinnovi medici di GM.
// Usa scadenzeService.calcolaScadenzaMedico (regole italiane art. 126 CdS).
//
// Uso: node scripts/recovery/calcola_scadenze_medico.js [--dry-run] [--limit=N] [--use-data-inserimento]
//
// Strategia:
//   1. Carica tutti i rinnovi medici di GM (pagination, senza truncation).
//   2. Per ogni rinnovo, estrae data_visita_medica da dettaglio (formato DD/MM/YYYY).
//      Se assente e --use-data-inserimento, fallback su data_inserimento (entry portale).
//   3. Per ogni rinnovo, carica il candidato (se linkato) per ottenere data_nascita + categoria_patente.
//   4. Calcola la scadenza e la aggiorna in rinnovi_portale.data_scadenza.
//
// Note sul fallback --use-data-inserimento:
//   I rinnovi vecchi (pre-2015) spesso non hanno data_visita_medica conservata
//   nel dettaglio del portale. data_inserimento e' la data in cui l'autoscuola
//   ha caricato la pratica sul portale e in pratica e' uguale (o entro pochi giorni)
//   alla data della visita medica. Il fallback e' una stima ragionevole per
//   chiudere il gap dei rinnovi storici, marcata internamente con regola
//   suffisso "_dainserimento" per tracciabilita'.

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });
const { createClient } = require("@supabase/supabase-js");
const { calcolaScadenzaMedico, parseDate } = require("../../src/services/scadenzeService");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const GM = "9380513a-99ad-4067-adc7-493af2e083d1";

const DRY_RUN = process.argv.includes("--dry-run");
const USE_DATA_INSERIMENTO = process.argv.includes("--use-data-inserimento");
const argLimit = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = argLimit ? Number(argLimit.split("=")[1]) : 0;

async function fetchAllMedici() {
  const rows = [];
  const PAGE = 1000;
  for (let start = 0; start < 50000; start += PAGE) {
    const { data, error } = await supabase
      .from("rinnovi_portale")
      .select("id, marca_operativa, codice_fiscale, data_nascita, candidato_id, data_scadenza, categoria_patente, data_inserimento, dettaglio")
      .eq("autoscuola_id", GM)
      .eq("tipo_rinnovo", "medico")
      .range(start, start + PAGE - 1)
      .order("id", { ascending: true });
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

async function fetchCandidatiByIds(ids) {
  if (ids.length === 0) return new Map();
  const map = new Map();
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("candidates")
      .select("id, data_nascita, categoria_patente, codice_fiscale")
      .in("id", slice);
    if (error) throw error;
    for (const c of (data || [])) map.set(c.id, c);
  }
  return map;
}

async function fetchCandidatiByCfs(cfs) {
  if (cfs.length === 0) return new Map();
  const map = new Map();
  const CHUNK = 200;
  for (let i = 0; i < cfs.length; i += CHUNK) {
    const slice = cfs.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("candidates")
      .select("id, data_nascita, categoria_patente, codice_fiscale")
      .eq("autoscuola_id", GM)
      .in("codice_fiscale", slice);
    if (error) throw error;
    for (const c of (data || [])) {
      const cf = String(c.codice_fiscale || "").trim().toUpperCase();
      if (cf) map.set(cf, c);
    }
  }
  return map;
}

(async () => {
  console.log("=== Calcolo scadenze medico per GM ===");
  console.log(`DRY_RUN: ${DRY_RUN}`);
  console.log(`LIMIT:   ${LIMIT || "TUTTI"}\n`);

  console.log("Carico rinnovi medici...");
  let medici = await fetchAllMedici();
  console.log(`Rinnovi medici totali: ${medici.length}`);
  if (LIMIT > 0) medici = medici.slice(0, LIMIT);

  // Carica candidati per ricavare data_nascita + categoria_patente
  const candIds = [...new Set(medici.map((r) => r.candidato_id).filter(Boolean))];
  const cfsSenzaCand = [...new Set(medici.filter((r) => !r.candidato_id && r.codice_fiscale).map((r) => String(r.codice_fiscale).trim().toUpperCase()))];
  console.log(`Candidati da risolvere (per id):  ${candIds.length}`);
  console.log(`Candidati da risolvere (per CF):  ${cfsSenzaCand.length}\n`);

  console.log("Carico anagrafica candidati...");
  const candsById = await fetchCandidatiByIds(candIds);
  const candsByCf = await fetchCandidatiByCfs(cfsSenzaCand);
  console.log(`Candidati risolti (id): ${candsById.size}`);
  console.log(`Candidati risolti (CF): ${candsByCf.size}\n`);

  const stats = {
    totali: medici.length,
    gia_con_scadenza: 0,
    calcolo_ok: 0,
    calcolo_invariato: 0,
    manca_data_visita: 0,
    manca_data_nascita: 0,
    manca_candidato: 0,
    regola_eta_invalida: 0,
    fallback_data_inserimento: 0,
    db_updated: 0,
    db_error: 0,
  };
  const byRegola = {};
  const updates = [];

  for (const r of medici) {
    const det = r.dettaglio || {};
    let dataVisita = det.data_visita_medica || det.dataVisitaMedica || null;
    let usedFallback = false;

    // Fallback: data_inserimento (per i rinnovi vecchi senza data_visita_medica)
    if (!dataVisita && USE_DATA_INSERIMENTO) {
      dataVisita = det.data_inserimento || r.data_inserimento || null;
      if (dataVisita) {
        usedFallback = true;
        stats.fallback_data_inserimento += 1;
      }
    }
    if (!dataVisita) { stats.manca_data_visita += 1; continue; }

    // Ricava data_nascita + categoria dal candidate linkato (o da CF)
    let cand = null;
    if (r.candidato_id && candsById.has(r.candidato_id)) {
      cand = candsById.get(r.candidato_id);
    } else if (r.codice_fiscale) {
      cand = candsByCf.get(String(r.codice_fiscale).trim().toUpperCase());
    }

    // Fallback: data_nascita dal rinnovo stesso (scraping dettaglio → colonna)
    const dataNascita = cand?.data_nascita || r.data_nascita || det.data_nascita || null;
    if (!dataNascita) { stats.manca_data_nascita += 1; continue; }
    if (!cand) { stats.manca_candidato += 1; /* proseguiamo comunque con default B */ }

    const categoria = cand?.categoria_patente || r.categoria_patente || "B";

    const out = calcolaScadenzaMedico({
      dataVisita,
      dataNascita,
      categoria,
    });

    if (!out.dataScadenza) {
      if (out.regolaApplicata === "eta_invalida") stats.regola_eta_invalida += 1;
      else stats.manca_data_visita += 1;
      continue;
    }

    stats.calcolo_ok += 1;
    byRegola[out.regolaApplicata] = (byRegola[out.regolaApplicata] || 0) + 1;

    // Già uguale? salto
    const currentIso = r.data_scadenza ? String(r.data_scadenza).slice(0, 10) : null;
    if (currentIso === out.dataScadenza) {
      stats.calcolo_invariato += 1;
      continue;
    }
    if (currentIso) stats.gia_con_scadenza += 1;

    updates.push({ id: r.id, data_scadenza: out.dataScadenza });
  }

  console.log("=== Analisi preliminare ===");
  console.log(`Totali:                ${stats.totali}`);
  console.log(`Calcolo OK:            ${stats.calcolo_ok}`);
  console.log(`Invariati (già ok):    ${stats.calcolo_invariato}`);
  console.log(`Da aggiornare:         ${updates.length}`);
  console.log(`Già con scadenza (da sovrascrivere): ${stats.gia_con_scadenza}`);
  console.log(`Manca data_visita:     ${stats.manca_data_visita}`);
  console.log(`Manca data_nascita:    ${stats.manca_data_nascita}`);
  console.log(`Manca candidato link:  ${stats.manca_candidato}`);
  console.log(`Età invalida:          ${stats.regola_eta_invalida}`);
  if (USE_DATA_INSERIMENTO) {
    console.log(`Fallback data_inserim: ${stats.fallback_data_inserimento} (stima da data_inserimento portale)`);
  }
  console.log(`\nDistribuzione regole applicate:`);
  for (const [k, v] of Object.entries(byRegola).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }
  console.log();

  if (DRY_RUN) {
    console.log("[DRY RUN] Nessun update eseguito.");
    if (updates.length > 0) {
      console.log(`\nSample di 5 update che sarebbero fatti:`);
      for (const u of updates.slice(0, 5)) console.log(`  ${u.id} → ${u.data_scadenza}`);
    }
    return;
  }

  // Applica updates in batch
  const BATCH = 100;
  let done = 0;
  const startTime = Date.now();
  for (let i = 0; i < updates.length; i += BATCH) {
    const slice = updates.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      slice.map((u) =>
        supabase.from("rinnovi_portale").update({ data_scadenza: u.data_scadenza }).eq("id", u.id)
      )
    );
    for (const res of results) {
      if (res.status === "fulfilled" && !res.value.error) stats.db_updated += 1;
      else stats.db_error += 1;
    }
    done += slice.length;
    if (done % 500 === 0 || done === updates.length) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = done / Math.max(elapsed, 0.01);
      console.log(`  updated ${done}/${updates.length} (${rate.toFixed(0)}/s)`);
    }
  }

  console.log(`\n=== Riepilogo update ===`);
  console.log(`Updated:  ${stats.db_updated}`);
  console.log(`Errors:   ${stats.db_error}`);
})().catch((e) => {
  console.error("FATAL:", e.message);
  console.error(e.stack);
  process.exit(1);
});

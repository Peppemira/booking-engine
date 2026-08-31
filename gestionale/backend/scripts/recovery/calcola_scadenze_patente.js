// Calcola + materializza data_scadenza sui rinnovi PATENTE di GM (rinnovi_portale tipo='patente').
// Usa scadenzeService.calcolaScadenzaMedico (regole italiane art. 126 CdS — la scadenza
// patente per legge coincide con la scadenza visita medica).
//
// Uso: node scripts/recovery/calcola_scadenze_patente.js [--dry-run] [--limit=N]
//
// Strategia (decisioni prodotto confermate 2026-04-17):
//   - DATA RIFERIMENTO = rinnovi_portale.data_inserimento (unica disponibile;
//     coincide con il giorno della visita medica del rinnovo o entro pochi giorni).
//   - CATEGORIA = candidates.categoria_patente se linkato, altrimenti default "B"
//     (categoria leggera, regola 10/5/3/2 anni per età). Il 95%+ dei rinnovi
//     italiani sono cat. B, errore residuo trascurabile per default.
//   - TARGET = rinnovi_portale.data_scadenza (analogo ai 4480 medici già fatti).
//   - SOVRASCRITTURA = no overwrite per default; data_scadenza già popolata viene
//     marcata "calcolo_invariato" e saltata.

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });
const { createClient } = require("@supabase/supabase-js");
const { calcolaScadenzaMedico } = require("../../src/services/scadenzeService");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const GM = "9380513a-99ad-4067-adc7-493af2e083d1";

const DRY_RUN = process.argv.includes("--dry-run");
const argLimit = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = argLimit ? Number(argLimit.split("=")[1]) : 0;

async function fetchAllPatenti() {
  const rows = [];
  const PAGE = 1000;
  for (let start = 0; start < 50000; start += PAGE) {
    const { data, error } = await supabase
      .from("rinnovi_portale")
      .select("id, marca_operativa, codice_fiscale, data_nascita, candidato_id, data_scadenza, categoria_patente, data_inserimento, dettaglio")
      .eq("autoscuola_id", GM)
      .eq("tipo_rinnovo", "patente")
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
  console.log("=== Calcolo scadenze PATENTE per GM ===");
  console.log(`DRY_RUN: ${DRY_RUN}`);
  console.log(`LIMIT:   ${LIMIT || "TUTTI"}\n`);

  console.log("Carico rinnovi patente...");
  let righe = await fetchAllPatenti();
  console.log(`Rinnovi patente totali: ${righe.length}`);
  if (LIMIT > 0) righe = righe.slice(0, LIMIT);

  // Carica candidati per ricavare data_nascita + categoria_patente
  const candIds = [...new Set(righe.map((r) => r.candidato_id).filter(Boolean))];
  const cfsSenzaCand = [...new Set(righe.filter((r) => !r.candidato_id && r.codice_fiscale).map((r) => String(r.codice_fiscale).trim().toUpperCase()))];
  console.log(`Candidati da risolvere (per id):  ${candIds.length}`);
  console.log(`Candidati da risolvere (per CF):  ${cfsSenzaCand.length}\n`);

  console.log("Carico anagrafica candidati...");
  const candsById = await fetchCandidatiByIds(candIds);
  const candsByCf = await fetchCandidatiByCfs(cfsSenzaCand);
  console.log(`Candidati risolti (id): ${candsById.size}`);
  console.log(`Candidati risolti (CF): ${candsByCf.size}\n`);

  const stats = {
    totali: righe.length,
    gia_con_scadenza: 0,
    calcolo_ok: 0,
    calcolo_invariato: 0,
    manca_data_inserimento: 0,
    manca_data_nascita: 0,
    manca_candidato: 0,
    regola_eta_invalida: 0,
    db_updated: 0,
    db_error: 0,
    default_categoria_B_usato: 0,
  };
  const byRegola = {};
  const updates = [];
  const samples_per_regola = {}; // regola → array di sample row

  for (const r of righe) {
    const det = r.dettaglio || {};
    const dataRiferimento = r.data_inserimento || det.data_inserimento || null;

    if (!dataRiferimento) { stats.manca_data_inserimento += 1; continue; }

    // Ricava candidato linkato (id o CF)
    let cand = null;
    if (r.candidato_id && candsById.has(r.candidato_id)) {
      cand = candsById.get(r.candidato_id);
    } else if (r.codice_fiscale) {
      cand = candsByCf.get(String(r.codice_fiscale).trim().toUpperCase());
    }
    if (!cand) stats.manca_candidato += 1;

    // data_nascita: priorità candidate → row → dettaglio
    const dataNascita = cand?.data_nascita || r.data_nascita || det.data_nascita || null;
    if (!dataNascita) { stats.manca_data_nascita += 1; continue; }

    // categoria: candidate.categoria_patente → row.categoria_patente → default "B"
    let categoria = cand?.categoria_patente || r.categoria_patente;
    if (!categoria) {
      categoria = "B";
      stats.default_categoria_B_usato += 1;
    }

    const out = calcolaScadenzaMedico({
      dataVisita: dataRiferimento,
      dataNascita,
      categoria,
    });

    if (!out.dataScadenza) {
      if (out.regolaApplicata === "eta_invalida") stats.regola_eta_invalida += 1;
      else stats.manca_data_inserimento += 1;
      continue;
    }

    stats.calcolo_ok += 1;
    byRegola[out.regolaApplicata] = (byRegola[out.regolaApplicata] || 0) + 1;
    if (!samples_per_regola[out.regolaApplicata]) samples_per_regola[out.regolaApplicata] = [];
    if (samples_per_regola[out.regolaApplicata].length < 3) {
      samples_per_regola[out.regolaApplicata].push({
        id: r.id,
        cf: r.codice_fiscale,
        nato: dataNascita,
        eta: out.eta,
        cat: categoria,
        rif: dataRiferimento,
        nuova_scad: out.dataScadenza,
      });
    }

    // Se già uguale, salta
    const currentIso = r.data_scadenza ? String(r.data_scadenza).slice(0, 10) : null;
    if (currentIso === out.dataScadenza) {
      stats.calcolo_invariato += 1;
      continue;
    }
    if (currentIso) stats.gia_con_scadenza += 1;

    updates.push({ id: r.id, data_scadenza: out.dataScadenza });
  }

  console.log("=== Analisi preliminare ===");
  console.log(`Totali:                                 ${stats.totali}`);
  console.log(`Calcolo OK:                             ${stats.calcolo_ok}`);
  console.log(`Invariati (data_scadenza già corretta): ${stats.calcolo_invariato}`);
  console.log(`Da aggiornare:                          ${updates.length}`);
  console.log(`Già con scadenza (verrà sovrascritta):  ${stats.gia_con_scadenza}`);
  console.log(`Manca data_inserimento:                 ${stats.manca_data_inserimento}`);
  console.log(`Manca data_nascita:                     ${stats.manca_data_nascita}`);
  console.log(`Manca candidato linkato:                ${stats.manca_candidato}`);
  console.log(`Età invalida:                           ${stats.regola_eta_invalida}`);
  console.log(`Default categoria='B' usato:            ${stats.default_categoria_B_usato}`);
  console.log(`\nDistribuzione regole applicate:`);
  for (const [k, v] of Object.entries(byRegola).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(20)} ${v}`);
  }
  console.log();

  console.log("Sample per regola (max 3 per regola):");
  for (const [regola, samples] of Object.entries(samples_per_regola)) {
    console.log(`\n  [${regola}]`);
    for (const s of samples) {
      console.log(`    ID ${String(s.id).slice(0, 8)} | CF ${s.cf} | nato ${s.nato} | eta ${s.eta} | cat ${s.cat} | rif ${s.rif} → scad ${s.nuova_scad}`);
    }
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
  console.error("FATAL:", e?.message || JSON.stringify(e));
  console.error(e?.stack || "(no stack)");
  process.exit(1);
});

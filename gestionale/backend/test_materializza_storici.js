// Materializza i rinnovi_portale come candidates storico=true per Giuseppe Miracolo
//
// Logica:
//   1. Carica tutti i rinnovi di GM con CF valido
//   2. Dedup per CF (tiene il record "migliore": con piu' dati compilati, altrimenti il piu' recente)
//   3. Esclude i CF gia' presenti in candidates (GM only)
//   4. Inserisce i rimanenti come nuovi candidates con storico=true
//   5. Esegue un second-pass: aggiorna rinnovi_portale.candidato_id linkando via CF
//
// Uso: node test_materializza_storici.js [--dry-run] [--limit N]

require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const GM = "9380513a-99ad-4067-adc7-493af2e083d1";

const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split("=")[1]) : 0;

function norm(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  return t === "" || t === "null" ? null : t;
}

// Conta i campi non-null in un rinnovo: usato per sceglere il record "piu' ricco"
function richness(r) {
  let c = 0;
  for (const k of [
    "codice_fiscale", "data_nascita", "sesso", "comune_nascita", "provincia_nascita",
    "comune_residenza", "provincia_residenza", "cap", "indirizzo",
    "patente_posseduta", "categoria_patente",
  ]) {
    if (r[k] && String(r[k]).trim() !== "") c += 1;
  }
  return c;
}

// Estrae categoria dalla patente_posseduta (heuristico)
function guessCategoria(patente) {
  if (!patente) return "B"; // default
  // La patente italiana ha un formato tipo "MX1234567F" (10 char) — non contiene la categoria
  // Lasciamo "B" come default. Se vogliamo essere piu' precisi, dovremmo leggerla dal portale.
  return "B";
}

function buildCodiceStatino(cf) {
  // Unique ma non garantito unique in assoluto. Ok perche' non c'e' constraint unique.
  return `RP-${cf.slice(0, 10)}`;
}

// Normalizza data YYYY-MM-DD o DD/MM/YYYY → YYYY-MM-DD, altrimenti null
function normalizeDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  const mIso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (mIso) return `${mIso[1]}-${mIso[2]}-${mIso[3]}`;
  const mIt = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (mIt) return `${mIt[3]}-${mIt[2]}-${mIt[1]}`;
  return null;
}

async function fetchAllRinnoviConCf() {
  const rows = [];
  const PAGE = 1000;
  for (let start = 0; start < 10000; start += PAGE) {
    const { data, error } = await supabase
      .from("rinnovi_portale")
      .select("id, marca_operativa, tipo_rinnovo, codice_fiscale, cognome, nome, data_nascita, sesso, comune_nascita, provincia_nascita, comune_residenza, provincia_residenza, cap, indirizzo, patente_posseduta, categoria_patente, data_inserimento, candidato_id")
      .eq("autoscuola_id", GM)
      .not("codice_fiscale", "is", null)
      .range(start, start + PAGE - 1)
      .order("id", { ascending: true });
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

async function fetchExistingCandidatesCF() {
  const set = new Set();
  const PAGE = 1000;
  for (let start = 0; start < 20000; start += PAGE) {
    const { data, error } = await supabase
      .from("candidates")
      .select("codice_fiscale, id")
      .eq("autoscuola_id", GM)
      .not("codice_fiscale", "is", null)
      .range(start, start + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const c of data) {
      const cf = String(c.codice_fiscale || "").trim().toUpperCase();
      if (cf) set.add(cf);
    }
    if (data.length < PAGE) break;
  }
  return set;
}

(async () => {
  console.log(`=== Materializza storici per Giuseppe Miracolo ===`);
  console.log(`DRY_RUN: ${DRY_RUN}`);
  console.log(`LIMIT:   ${LIMIT || "TUTTI"}\n`);

  // 1) Carica tutti i rinnovi con CF
  console.log("Carico rinnovi con CF...");
  const rinnovi = await fetchAllRinnoviConCf();
  console.log(`Rinnovi con CF: ${rinnovi.length}`);

  // 2) Dedup per CF (scegli il piu' ricco di dati, a parita' il piu' recente)
  const byCF = new Map();
  for (const r of rinnovi) {
    const cf = String(r.codice_fiscale || "").trim().toUpperCase();
    if (!cf) continue;
    const prev = byCF.get(cf);
    if (!prev) {
      byCF.set(cf, r);
      continue;
    }
    const rPrev = richness(prev);
    const rCur  = richness(r);
    if (rCur > rPrev) {
      byCF.set(cf, r);
    } else if (rCur === rPrev) {
      // parita' di ricchezza → prendi il piu' recente per data_inserimento
      if ((r.data_inserimento || "") > (prev.data_inserimento || "")) byCF.set(cf, r);
    }
  }
  console.log(`Persone uniche (dedup CF): ${byCF.size}`);

  // 3) Carica CF gia' presenti in candidates
  console.log("Carico candidates esistenti...");
  const existingCFs = await fetchExistingCandidatesCF();
  console.log(`Candidates esistenti con CF: ${existingCFs.size}`);

  // 4) Costruisci lista di nuovi da inserire
  const nuovi = [];
  for (const [cf, r] of byCF.entries()) {
    if (existingCFs.has(cf)) continue;
    nuovi.push(r);
  }
  console.log(`Nuovi storici da inserire: ${nuovi.length}\n`);

  const toInsert = LIMIT > 0 ? nuovi.slice(0, LIMIT) : nuovi;
  console.log(`Procedo con ${toInsert.length} insert\n`);

  if (toInsert.length === 0) {
    console.log("Nulla da materializzare.");
    return;
  }

  // 5) Costruisci i payload candidates
  const candidatesPayload = toInsert.map((r) => ({
    autoscuola_id: GM,
    codice_statino: buildCodiceStatino(r.codice_fiscale),
    codice_fiscale: r.codice_fiscale,
    cognome: norm(r.cognome),
    nome: norm(r.nome) || "—",  // obbligatorio? lascio — come placeholder se null
    data_nascita: normalizeDate(r.data_nascita),
    sesso: norm(r.sesso),
    comune_nascita: norm(r.comune_nascita),
    provincia_nascita: norm(r.provincia_nascita),
    comune: norm(r.comune_residenza),
    provincia: norm(r.provincia_residenza),
    cap: norm(r.cap),
    indirizzo: norm(r.indirizzo),
    patente_numero: norm(r.patente_posseduta),
    categoria_patente: norm(r.categoria_patente) || guessCategoria(r.patente_posseduta),
    marca_operativa: norm(r.marca_operativa),
    storico: true,
    stato: "storico",
    stato_iscrizione: "storico",
    data_iscrizione: normalizeDate(r.data_inserimento) || new Date().toISOString().slice(0, 10),
    raw_portale: { fonte: "rinnovi_portale", rinnovo_id: r.id },
  }));

  // 6) Sample preview
  console.log("Sample primi 3 candidati da inserire:");
  for (const c of candidatesPayload.slice(0, 3)) {
    console.log(` ${c.cognome} ${c.nome} | ${c.codice_fiscale} | ${c.comune || "?"} (${c.provincia || "?"}) | pat: ${c.patente_numero || "?"} | nasc: ${c.data_nascita || "?"}`);
  }

  if (DRY_RUN) {
    console.log("\n[DRY_RUN] Nessuna scrittura. Fine.");
    return;
  }

  // 7) Insert in batch
  const BATCH = 200;
  const stats = { inserted: 0, errors: 0 };
  const errorsList = [];

  for (let i = 0; i < candidatesPayload.length; i += BATCH) {
    const slice = candidatesPayload.slice(i, i + BATCH);
    const { data, error } = await supabase.from("candidates").insert(slice).select("id, codice_fiscale");
    if (error) {
      console.log(`[batch ${i}-${i + slice.length}] ERROR:`, error.code, "-", error.message?.slice(0, 150));
      stats.errors += slice.length;
      errorsList.push({ batch: `${i}-${i + slice.length}`, err: error.message });

      // Fallback: insert uno per volta per identificare i problemi specifici
      console.log(`  → fallback insert one by one...`);
      for (const p of slice) {
        const { error: e1 } = await supabase.from("candidates").insert(p);
        if (!e1) stats.inserted += 1;
        else {
          stats.errors += 1;
          if (stats.errors < 10) console.log(`  single ERROR [${p.codice_fiscale}]:`, e1.message?.slice(0, 100));
        }
      }
      stats.errors -= slice.length; // undo the batch count
    } else {
      stats.inserted += (data?.length || slice.length);
    }
    console.log(`[batch ${i}-${i + slice.length}] inserted so far: ${stats.inserted}/${candidatesPayload.length}`);
  }

  console.log(`\n=== Insert done ===`);
  console.log(`Inseriti: ${stats.inserted}`);
  console.log(`Errori:   ${stats.errors}`);

  // 8) Second-pass: link rinnovi_portale.candidato_id via CF
  console.log(`\n=== Second-pass: link rinnovi.candidato_id via CF ===`);
  const { data: allCandGM } = await supabase
    .from("candidates")
    .select("id, codice_fiscale")
    .eq("autoscuola_id", GM)
    .not("codice_fiscale", "is", null);
  const cfToId = new Map();
  for (const c of allCandGM || []) {
    const cf = String(c.codice_fiscale || "").trim().toUpperCase();
    if (cf) cfToId.set(cf, c.id);
  }
  console.log(`Candidates totali con CF dopo insert: ${cfToId.size}`);

  // Per ogni rinnovo senza candidato_id ma con CF, trova il match e UPDATE
  const orphans = rinnovi.filter((r) => !r.candidato_id && r.codice_fiscale);
  console.log(`Rinnovi orfani da linkare: ${orphans.length}`);

  let linked = 0, noMatch = 0;
  // Batch update by id
  const updates = [];
  for (const r of orphans) {
    const cf = String(r.codice_fiscale || "").trim().toUpperCase();
    const candId = cfToId.get(cf);
    if (!candId) { noMatch += 1; continue; }
    updates.push({ id: r.id, candidato_id: candId });
  }

  // Apply updates in chunks
  const UPD_BATCH = 100;
  for (let i = 0; i < updates.length; i += UPD_BATCH) {
    const slice = updates.slice(i, i + UPD_BATCH);
    await Promise.all(slice.map(u =>
      supabase.from("rinnovi_portale").update({ candidato_id: u.candidato_id }).eq("id", u.id)
    ));
    linked += slice.length;
    if ((i / UPD_BATCH) % 5 === 0) console.log(`  linked ${linked}/${updates.length}`);
  }

  console.log(`\nRinnovi linkati: ${linked}`);
  console.log(`Rinnovi senza match: ${noMatch}`);

  // 9) Verifica finale
  const { count: storicoCount } = await supabase
    .from("candidates")
    .select("id", { count: "exact", head: true })
    .eq("autoscuola_id", GM)
    .eq("storico", true);
  const { count: attiviCount } = await supabase
    .from("candidates")
    .select("id", { count: "exact", head: true })
    .eq("autoscuola_id", GM)
    .or("storico.is.null,storico.eq.false");
  console.log(`\n=== Stato finale candidates GM ===`);
  console.log(`Attivi:  ${attiviCount}`);
  console.log(`Storici: ${storicoCount}`);
})().catch((err) => {
  console.error("\nFATAL:", err.message);
  console.error(err.stack);
  process.exit(1);
});

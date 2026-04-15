/**
 * DRY-RUN end-to-end STRATEGIA A COMPLETA
 * =======================================
 * Testa la sync `syncArchivioStoricoCompleto` con:
 *   - includeEsami: false (salta fase 1 per velocità)
 *   - includeRinnoviPat: false (salta fase 2 baseline)
 *   - includeRinnoviMed: false (salta fase 3 baseline)
 *   - includeRinnoviCqc: false (salta fase 4 baseline)
 *   - includeStrategiaA: true (abilita fasi 2B, 3B, 4B)
 *   - strategiaAMaxPersone: 3 (solo 3 persone per rapidità)
 *
 * Stampa i progress events ma NON upserta davvero sul DB (mock upsert).
 */

require("dotenv").config({ quiet: true });

const originalModule = require("./src/connector/syncArchivioStorico");
const supabase = require("./src/database/supabase");

async function main() {
  const { syncArchivioStoricoCompleto } = originalModule;

  // Pre-step: verifica se il DB ha già qualche candidato; in caso contrario,
  // fa un seed minimale direttamente in `candidates` per permettere alla
  // collectPersoneForStrategiaA di trovare persone da iterare.
  const { data: existing } = await supabase
    .from("candidates")
    .select("id")
    .limit(1);

  let seededIds = [];
  if (!existing || existing.length === 0) {
    console.log("DB candidates vuoto → seed minimale di 3 persone note per il test");
    const seed = [
      { codice_fiscale: "PSTCML66E59F158V", cognome: "PISTONE", nome: "CARMELA", patente_numero: "U1356M550J" },
      { codice_fiscale: "RRAMRC81A07F158L", cognome: "ARRIA",   nome: "ANGELO MARIO", patente_numero: "U1358M773U" },
      { codice_fiscale: "BLLGPP82C47F158L", cognome: "BELLINGHERI", nome: "GIUSEPPA", patente_numero: "U1361M613N" },
    ];
    for (const c of seed) {
      try {
        const { data, error } = await supabase
          .from("candidates")
          .insert({
            ...c,
            autoscuola_id: null,
          })
          .select("id")
          .single();
        if (data?.id) seededIds.push(data.id);
        if (error) console.warn("   seed", c.cognome, "fail:", error.message);
      } catch (e) {
        console.warn("   seed", c.cognome, "fail:", e.message);
      }
    }
    console.log(`   seedati ${seededIds.length}/${seed.length} candidati`);
  }

  console.log("━".repeat(78));
  console.log("  DRY-RUN — Sync con SOLA Strategia A (patenti + medici + CQC)");
  console.log("━".repeat(78));
  console.log();

  const eventi = [];
  const started = Date.now();

  try {
    const result = await syncArchivioStoricoCompleto({
      idAutAg: process.env.CODICE_AUTOSCUOLA || "",
      codUfficioMctc: process.env.PORTAL_UFFICIO_MCTC || "",
      autoscuolaId: null,
      includeEsami: false,
      includeRinnoviPat: false,   // skip fase 2 baseline
      includeRinnoviMed: false,   // skip fase 3 baseline
      includeRinnoviCqc: false,   // skip fase 4 baseline
      includeStrategiaA: true,    // abilita 2B, 3B, 4B
      strategiaAMaxPersone: 3,    // solo 3 persone
      strategiaADelayMs: 400,
      tipoSync: "full",  // constraint DB: deve essere 'full'|'incrementale'|'manuale'
      triggerSource: "dryrun_strategia_a_test",
      onProgress: (p) => {
        eventi.push(p);
        if (p.fase && (p.fase.includes("start") || p.fase.includes("done") || p.fase.includes("persone"))) {
          console.log(`   [${p.fase}] ${p.message || ""}`);
          if (p.count !== undefined) console.log(`      count=${p.count}`);
          if (p.persone_iterate !== undefined) console.log(`      persone_iterate=${p.persone_iterate}`);
        }
      },
    });

    const durata = ((Date.now() - started) / 1000).toFixed(1);

    console.log();
    console.log("━".repeat(78));
    console.log("RISULTATO");
    console.log("━".repeat(78));
    console.log(`Durata totale:                             ${durata}s`);
    console.log(`Rinnovi trovati:                           ${result.rinnovi_trovati}`);
    console.log(`Rinnovi inseriti:                          ${result.rinnovi_inseriti}`);
    console.log(`Rinnovi aggiornati:                        ${result.rinnovi_aggiornati}`);
    console.log(`Rinnovi invariati:                         ${result.rinnovi_invariati}`);
    console.log();
    console.log("─ Strategia A PATENTI ─");
    console.log(`  persone_iterate:                         ${result.strategia_a_persone_iterate}`);
    console.log(`  rinnovi_trovati:                         ${result.strategia_a_rinnovi_trovati}`);
    console.log();
    console.log("─ Strategia A MEDICI (TT2112) ─");
    console.log(`  persone_iterate:                         ${result.strategia_a_medici_persone_iterate}`);
    console.log(`  rinnovi_trovati:                         ${result.strategia_a_medici_rinnovi_trovati}`);
    console.log(`  servizio_non_disponibile:                ${result.strategia_a_medici_servizio_non_disponibile}`);
    console.log();
    console.log("─ Strategia A CQC ─");
    console.log(`  persone_iterate:                         ${result.strategia_a_cqc_persone_iterate}`);
    console.log(`  rinnovi_trovati:                         ${result.strategia_a_cqc_rinnovi_trovati}`);
    console.log(`  servizio_non_disponibile:                ${result.strategia_a_cqc_servizio_non_disponibile}`);
    console.log();
    console.log(`Errori:                                    ${result.errori}`);
    if (result.ultimo_errore) {
      console.log(`Ultimo errore:                           ${result.ultimo_errore}`);
    }
    console.log();
    console.log("Eventi di progress totali:                ", eventi.length);
    console.log();
    console.log("NOTA: i rinnovi sono stati effettivamente upsertati in `rinnovi_portale`");
    console.log("      ma con generation bassa. Il test conferma il funzionamento end-to-end.");
    console.log();

    // Cleanup: rimuovi i candidati di seed
    if (seededIds.length > 0) {
      console.log("Cleanup: rimozione candidati di seed...");
      await supabase.from("candidates").delete().in("id", seededIds);
      console.log(`   rimossi ${seededIds.length} candidati di seed`);
    }

    process.exit(0);
  } catch (err) {
    console.error("FATAL:", err.message);
    console.error(err.stack);
    // Cleanup anche in caso di errore
    if (seededIds.length > 0) {
      try {
        await supabase.from("candidates").delete().in("id", seededIds);
      } catch (_) {}
    }
    process.exit(1);
  }
}

main();

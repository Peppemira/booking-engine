/**
 * TEST STRATEGIA A — Ricerca per CF + Patente (bypass limite 31gg)
 * ================================================================
 * Il portale ha detto esplicitamente nel v2 diagnostic:
 *   "Per l'operazione richiesta è necessario popolare in alternativa
 *    o il Protocollo, o la coppia Cognome - Patente o Codice Fiscale-Patente,
 *    o il range di Date e lo Stato"
 *
 * Quindi la ricerca per (CF+Patente) o (Cognome+Patente) SENZA date dovrebbe
 * essere accettata dal portale e non avere il limite 31 giorni.
 *
 * Questo test:
 * 1) Legge dal DB Supabase 3-5 coppie (CF, patente) di candidati reali
 * 2) Per ciascuna fa una ricerca puntuale SENZA date
 * 3) Verifica quanti rinnovi storici ritornano
 */

require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const supabase = require("./src/database/supabase");
const { loginDirectHttp } = require("./src/connector/portalSession");
const { makeHttpClient } = require("./src/connector/portalHttp");

const PORTAL_BASE = "https://www.ilportaledellautomobilista.it";
const SEARCH_URL = `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestRinnAgenzia_initGestRinnAgenzia.action`;
const OUT_DIR = path.join(__dirname, "_test_strategia_a");
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function normalizeText(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

/**
 * Estrae token Struts dalla pagina init
 */
async function loadStrutsToken(client) {
  const res = await client.get(SEARCH_URL);
  const $ = cheerio.load(String(res.data || ""));
  const name = $('input[name="struts.token.name"]').val() || "";
  const value = name ? $(`input[name="${name}"]`).val() || "" : "";
  return { name, value };
}

/**
 * Cerca rinnovi per CF+patente (o Cognome+patente) SENZA filtro data.
 */
async function ricercaRinnoviPerPersona(client, {
  codiceFiscale = "",
  patente = "",
  cognome = "",
  label = "",
}) {
  // Token Struts fresco
  const { name: tokenName, value: tokenValue } = await loadStrutsToken(client);

  // Build form body
  const params = new URLSearchParams();
  if (tokenName && tokenValue) {
    params.set("struts.token.name", tokenName);
    params.set(tokenName, tokenValue);
  }
  params.set("richiestaView.richiestaRinnAgenziaFrom.marcaOperativa", "");
  params.set("richiestaView.richiestaRinnAgenziaFrom.patentePosseduta", patente);
  params.set("richiestaView.cognome", cognome);
  params.set("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.codiceFiscale", codiceFiscale);
  params.set("richiestaView.richiestaRinnAgenziaFrom.codiceStatoRinnAgenzia", "");
  params.set("richiestaView.richiestaRinnAgenziaFrom.dataInserimento", "");
  params.set("richiestaView.richiestaRinnAgenziaTo.dataInserimento", "");
  params.set("action:ReadGestRinnAgenzia_pagingGestRinnAgenzia", "Ricerca");

  let res;
  try {
    res = await client.post(SEARCH_URL, params.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: SEARCH_URL,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      maxRedirects: 10,
    });
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      status: err?.response?.status || 0,
    };
  }

  const html = String(res.data || "");
  const filename = `${label || "test"}.html`.replace(/[^\w.-]/g, "_");
  fs.writeFileSync(path.join(OUT_DIR, filename), html);

  const $ = cheerio.load(html);
  const title = ($("title").text() || "").trim();
  const actionError = $(".errorMessage, .actionError").first().text().trim();

  // Righe della tabella risultati
  // Colonne vere: [radio, Protocollo, EstremoPag, Stato, DataIns, Cognome, Nome]
  const rows = [];
  $("#listTable > tbody tr").each(function () {
    const $tds = $(this).find("td");
    const marca = $(this).find("td > input").val() || normalizeText($tds.eq(0).text());
    if (!marca) return;
    rows.push({
      marca_operativa: marca,
      protocollo:      normalizeText($tds.eq(1).text()),
      estremo_pag:     normalizeText($tds.eq(2).text()),
      stato_richiesta: normalizeText($tds.eq(3).text()),
      data:            normalizeText($tds.eq(4).text()),
      cognome:         normalizeText($tds.eq(5).text()),
      nome:            normalizeText($tds.eq(6).text()),
    });
  });

  const is31DayError = /intervallo massimo|31 giorn/i.test(html);
  const isMissingField = /necessario popolare|alternativa/i.test(actionError);
  const isNoResult = /Nessun.*(elemento|risultat|dato|trovat)/i.test(html);

  return {
    ok: res.status === 200 && !actionError && rows.length >= 0,
    status: res.status,
    htmlLen: html.length,
    title,
    actionError: actionError.slice(0, 150),
    is31DayError,
    isMissingField,
    isNoResult,
    rowCount: rows.length,
    rows: rows.slice(0, 10),
    filename,
  };
}

/* ----------------- MAIN ----------------- */
async function main() {
  console.log("━".repeat(70));
  console.log("  TEST STRATEGIA A — Ricerca per CF/Cognome + Patente");
  console.log("━".repeat(70));
  console.log();

  // 1) Login
  console.log("1) Login...");
  const jar = await loginDirectHttp({
    username: process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
    password: process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
    pin: process.env.PORTAL_PIN,
  });
  const client = makeHttpClient(jar);
  console.log("   OK\n");

  // 2) Recupera dal portale stesso 3-5 rinnovi recenti (ultimi 30 giorni)
  //    per ricavare coppie (CF, Patente) reali da testare.
  console.log("2) Recupero coppie (CF, patente) dai rinnovi degli ultimi 30 giorni...");
  const dataInizio = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const dataFine = new Date().toISOString().slice(0, 10);
  const toPortalDate = (iso) => {
    const [y, m, d] = String(iso).split("-");
    return `${d}/${m}/${y}`;
  };
  // Ricerca SIMPLE con date + stato (baseline che funziona) — itera sugli stati
  // Colonne vere: [radio, Protocollo, EstremoPag, Stato, DataIns, Cognome, Nome]
  const baselineRows = [];
  for (const stato of ["A", "D", "S", "R"]) {
    const baseSearchUrl =
      `${SEARCH_URL}?struts.token.name=tokenListGestRinnAgenzia` +
      `&richiestaView.richiestaRinnAgenziaFrom.marcaOperativa=` +
      `&richiestaView.richiestaRinnAgenziaFrom.patentePosseduta=` +
      `&richiestaView.cognome=` +
      `&richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.codiceFiscale=` +
      `&richiestaView.richiestaRinnAgenziaFrom.codiceStatoRinnAgenzia=${stato}` +
      `&richiestaView.richiestaRinnAgenziaFrom.dataInserimento=${toPortalDate(dataInizio)}` +
      `&richiestaView.richiestaRinnAgenziaTo.dataInserimento=${toPortalDate(dataFine)}` +
      `&action%3AReadGestRinnAgenzia_pagingGestRinnAgenzia=Ricerca`;
    const baseRes = await client.get(baseSearchUrl);
    const html = String(baseRes.data || "");
    fs.writeFileSync(path.join(OUT_DIR, `00_baseline_30gg_${stato}.html`), html);
    const $base = cheerio.load(html);
    $base("#listTable > tbody tr").each(function () {
      const $tds = $base(this).find("td");
      const marca = $base(this).find("td > input").val() || normalizeText($tds.eq(0).text());
      if (!marca) return;
      // Colonne: [radio, Protocollo, EstremoPag, Stato, DataIns, Cognome, Nome]
      baselineRows.push({
        marca_operativa: marca,
        protocollo: normalizeText($tds.eq(1).text()),
        estremo_pag: normalizeText($tds.eq(2).text()),
        stato_richiesta: normalizeText($tds.eq(3).text()),
        data_inserimento: normalizeText($tds.eq(4).text()),
        cognome: normalizeText($tds.eq(5).text()),
        nome: normalizeText($tds.eq(6).text()),
        stato_portale: stato,
      });
    });
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`   Trovati ${baselineRows.length} rinnovi negli ultimi 30 giorni (stati A/D/S/R)`);

  // 2b) Per ogni rinnovo, scarica il dettaglio per ottenere CF e patente (sia vecchia che nuova)
  const valid = [];
  for (let i = 0; i < Math.min(5, baselineRows.length); i++) {
    const row = baselineRows[i];
    try {
      const detUrl = `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestRinnAgenzia_pagingGestRinnAgenzia.action?richiestaView.richiestaRinnAgenziaFrom.marcaOperativa=${encodeURIComponent(row.marca_operativa)}&action%3ASelectRichRinnAgenzia_viewElementRichRinnAgenzia=Visualizza`;
      const detRes = await client.get(detUrl);
      const html = String(detRes.data || "");
      fs.writeFileSync(path.join(OUT_DIR, `00_det_${i}.html`), html);
      const $det = cheerio.load(html);
      const fv = (name) => normalizeText($det(`[name='${name}']`).val() || $det(`[name='${name}']`).text());

      // Possibili nomi dei campi per la patente
      const cf = fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.codiceFiscale");
      const patentePosseduta =
        fv("richiestaView.richiestaRinnAgenziaFrom.thePatentePosseduta.numeroPatenteCompleto") ||
        fv("richiestaView.richiestaRinnAgenziaFrom.patentePosseduta") ||
        "";
      const patenteRilasciata =
        fv("richiestaView.richiestaRinnAgenziaFrom.patente") ||
        fv("richiestaView.richiestaRinnAgenziaFrom.numeroPatente") ||
        "";
      const cognomeDet = fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.cognome") || row.cognome;
      const nomeDet = fv("richiestaView.richiestaRinnAgenziaFrom.theAnagrafica.nome") || row.nome;

      console.log(
        `   [dbg ${i}] CF=${cf ? cf.slice(0, 6) + "****" : "-"} ` +
        `posseduta=${patentePosseduta || "-"} rilasciata=${patenteRilasciata || "-"} ` +
        `cognome=${cognomeDet || "-"}`
      );

      if (cf && (patentePosseduta || patenteRilasciata)) {
        valid.push({
          codice_fiscale: cf,
          patente_posseduta: patentePosseduta,
          patente_rilasciata: patenteRilasciata,
          cognome: cognomeDet,
          nome: nomeDet,
        });
      }
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.log(`   [dbg ${i}] ERROR: ${err.message}`);
    }
  }
  console.log(`   Estratte ${valid.length} coppie (CF, patente) valide per il test\n`);

  if (valid.length === 0) {
    console.log("   ⚠ Nessuna coppia trovata. Test interrotto.");
    return;
  }

  // 3) Test 1: Solo CF (senza patente)
  console.log("3) Test A1: ricerca per SOLO CF (senza patente)");
  for (let i = 0; i < Math.min(2, valid.length); i++) {
    const c = valid[i];
    const cfMasked = c.codice_fiscale.slice(0, 6) + "****" + c.codice_fiscale.slice(-4);
    process.stdout.write(`   ▸ ${cfMasked} (${c.cognome}) ... `);
    const r = await ricercaRinnoviPerPersona(client, {
      codiceFiscale: c.codice_fiscale,
      label: `a1_solo_cf_${i}`,
    });
    if (r.is31DayError) {
      console.log(`❌ LIMITE 31gg`);
    } else if (r.isMissingField) {
      console.log(`⚠ ${r.actionError.slice(0, 50)}`);
    } else if (r.rowCount > 0) {
      console.log(`✓ ${r.rowCount} righe`);
    } else if (r.actionError) {
      console.log(`⚠ ${r.actionError.slice(0, 50)}`);
    } else {
      console.log(`0 righe (title=${r.title})`);
    }
    await new Promise((r) => setTimeout(r, 700));
  }

  console.log();

  // Helper per interpretare il risultato
  const explain = (r) => {
    if (r.is31DayError) return `❌ LIMITE 31gg`;
    if (r.isMissingField) return `⚠ missing: ${r.actionError.slice(0, 40)}`;
    if (r.rowCount > 0) return `✓✓ ${r.rowCount} RIGHE!`;
    // warning sostituzione patente = risposta "buona" ma senza risultati
    const subst = r.actionError.match(/sostituit[ao] dalla patente numero\s+(\S+)/i);
    if (subst) return `↻ patente sostituita → ${subst[1]}`;
    if (r.actionError) return `⚠ ${r.actionError.slice(0, 50)}`;
    return `0 righe (${r.title})`;
  };

  // 4) Test 2a: CF + patente_posseduta
  console.log("4) Test A2a: ricerca per CF + patente_POSSEDUTA (quella pre-rinnovo)");
  for (let i = 0; i < valid.length; i++) {
    const c = valid[i];
    if (!c.patente_posseduta) continue;
    const cfMasked = c.codice_fiscale.slice(0, 6) + "****" + c.codice_fiscale.slice(-4);
    process.stdout.write(`   ▸ ${cfMasked} pat=${c.patente_posseduta} ... `);
    const r = await ricercaRinnoviPerPersona(client, {
      codiceFiscale: c.codice_fiscale,
      patente: c.patente_posseduta,
      label: `a2a_cf_posseduta_${i}`,
    });
    console.log(explain(r));
    if (r.rowCount > 0) {
      for (const row of r.rows.slice(0, 3)) console.log(`       - ${JSON.stringify(row)}`);
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  console.log();

  // 5) Test 2b: CF + patente_rilasciata (quella NUOVA post-rinnovo)
  console.log("5) Test A2b: ricerca per CF + patente_RILASCIATA (quella post-rinnovo)");
  for (let i = 0; i < valid.length; i++) {
    const c = valid[i];
    if (!c.patente_rilasciata) continue;
    const cfMasked = c.codice_fiscale.slice(0, 6) + "****" + c.codice_fiscale.slice(-4);
    process.stdout.write(`   ▸ ${cfMasked} pat=${c.patente_rilasciata} ... `);
    const r = await ricercaRinnoviPerPersona(client, {
      codiceFiscale: c.codice_fiscale,
      patente: c.patente_rilasciata,
      label: `a2b_cf_rilasciata_${i}`,
    });
    console.log(explain(r));
    if (r.rowCount > 0) {
      for (const row of r.rows.slice(0, 5)) console.log(`       - ${JSON.stringify(row)}`);
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  console.log();

  // 6) Test 3: Cognome + patente_rilasciata
  console.log("6) Test A3: ricerca per Cognome + patente_rilasciata");
  for (let i = 0; i < Math.min(3, valid.length); i++) {
    const c = valid[i];
    if (!c.cognome || !c.patente_rilasciata) continue;
    process.stdout.write(`   ▸ ${c.cognome} pat=${c.patente_rilasciata} ... `);
    const r = await ricercaRinnoviPerPersona(client, {
      cognome: c.cognome,
      patente: c.patente_rilasciata,
      label: `a3_cog_pat_${i}`,
    });
    console.log(explain(r));
    if (r.rowCount > 0) {
      for (const row of r.rows.slice(0, 3)) console.log(`       - ${JSON.stringify(row)}`);
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  console.log();

  // 7) Test 4: Cognome + patente_posseduta → dovrebbe dare il "sostituita"
  console.log("7) Test A4: follow-redirect sostituzione patente (cognome+posseduta)");
  for (let i = 0; i < Math.min(2, valid.length); i++) {
    const c = valid[i];
    if (!c.cognome || !c.patente_posseduta) continue;
    process.stdout.write(`   ▸ ${c.cognome} pat=${c.patente_posseduta} ... `);
    const r = await ricercaRinnoviPerPersona(client, {
      cognome: c.cognome,
      patente: c.patente_posseduta,
      label: `a4_cog_posseduta_${i}`,
    });
    console.log(explain(r));
    // Se dice "sostituita da X", estrai X e riprova
    const subst = r.actionError.match(/sostituit[ao] dalla patente numero\s+(\S+)/i);
    if (subst) {
      const nuovaPat = subst[1];
      process.stdout.write(`       follow: pat=${nuovaPat} ... `);
      const r2 = await ricercaRinnoviPerPersona(client, {
        cognome: c.cognome,
        patente: nuovaPat,
        label: `a4_follow_${i}`,
      });
      console.log(explain(r2));
      if (r2.rowCount > 0) {
        for (const row of r2.rows.slice(0, 5)) console.log(`         - ${JSON.stringify(row)}`);
      }
    }
    await new Promise((r) => setTimeout(r, 700));
  }

  console.log();
  console.log("━".repeat(70));
  console.log("VERDETTO STRATEGIA A:");
  console.log("   Se Test A2 o A3 ha ritornato righe > 0:");
  console.log("   → possiamo iterare su candidates/rinnovi e bypassare il limite 31gg");
  console.log();
  console.log("✔ HTML salvati in:", OUT_DIR);
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  console.error(err.stack);
  process.exit(1);
});

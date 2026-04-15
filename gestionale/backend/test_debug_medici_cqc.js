/**
 * Debug: dump delle risposte HTML di rinnovi medici e CQC
 * per capire perché medici ritorna 0 e CQC 500.
 */
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const { loginDirectHttp } = require("./src/connector/portalSession");
const { makeHttpClient } = require("./src/connector/portalHttp");

const PORTAL_BASE = "https://www.ilportaledellautomobilista.it";
const OUT = path.join(__dirname, "_debug_medici_cqc");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

async function main() {
  console.log("Login...");
  const jar = await loginDirectHttp({
    username: process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
    password: process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
    pin: process.env.PORTAL_PIN,
  });
  const client = makeHttpClient(jar);
  console.log("OK\n");

  // ─── 1) GET init page medici ───
  console.log("[1] GET init medici");
  const medInitUrl = `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestRinnMed_initVerStatoPratHDDG.action`;
  const r1 = await client.get(medInitUrl);
  fs.writeFileSync(path.join(OUT, "01_med_init.html"), String(r1.data || ""));
  console.log(`    saved 01_med_init.html (${String(r1.data || "").length} bytes)`);

  // Extract token and form action
  const $1 = cheerio.load(String(r1.data || ""));
  const medToken = {
    name: $1('input[name="struts.token.name"]').val() || "",
    value: "",
  };
  if (medToken.name) medToken.value = $1(`input[name="${medToken.name}"]`).val() || "";
  console.log(`    token: ${medToken.name}=${medToken.value.slice(0, 20)}...`);

  // Inspect form fields
  console.log("    form fields:");
  $1("form").first().find("input, select").each(function () {
    const n = $1(this).attr("name");
    if (n && n.toLowerCase().includes("rinnmed") || n?.toLowerCase().includes("cognome")) {
      console.log(`       ${n}`);
    }
  });
  // List all forms + their action attribute
  $1("form").each(function (i) {
    console.log(`    form[${i}] action=${$1(this).attr("action")} method=${$1(this).attr("method")}`);
  });

  // ─── 2) POST ricerca medici PISTONE ───
  console.log("\n[2] POST ricerca medici PISTONE U1356M550J");
  const params1 = new URLSearchParams();
  if (medToken.name && medToken.value) {
    params1.set("struts.token.name", medToken.name);
    params1.set(medToken.name, medToken.value);
  }
  params1.set("richiestaView.richiestaRinnMedFrom.marcaOperativa", "");
  params1.set("richiestaView.richiestaRinnMedFrom.theAnagrafica.codiceFiscale", "");
  params1.set("richiestaView.richiestaRinnMedFrom.patentePosseduta", "U1356M550J");
  params1.set("richiestaView.cognome", "PISTONE");
  params1.set("richiestaView.richiestaRinnMedFrom.codiceStatoRinnMed", "");
  params1.set("richiestaView.richiestaRinnMedFrom.dataInserimento", "");
  params1.set("richiestaView.richiestaRinnMedTo.dataInserimento", "");
  params1.set("action:ReadGestRinnMed_pagingGestRinnMedHd", "Ricerca");

  try {
    const r2 = await client.post(medInitUrl, params1.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: medInitUrl },
      maxRedirects: 10,
    });
    fs.writeFileSync(path.join(OUT, "02_med_pistone.html"), String(r2.data || ""));
    const $2 = cheerio.load(String(r2.data || ""));
    console.log(`    saved 02_med_pistone.html (${String(r2.data || "").length} bytes)`);
    console.log(`    title=${($2("title").text() || "").trim()}`);
    const err = $2(".errorMessage, .actionError").first().text().trim();
    console.log(`    errorMessage=${err || "(none)"}`);
    const rows = $2("#listTable > tbody tr").length;
    console.log(`    #listTable rows=${rows}`);
  } catch (err) {
    console.error(`    FAIL: ${err.message}`);
    if (err.response) {
      fs.writeFileSync(path.join(OUT, "02_med_pistone_ERROR.html"), String(err.response.data || ""));
      console.log(`    status ${err.response.status}, saved response`);
    }
  }

  // ─── 3) GET init page CQC ───
  console.log("\n[3] GET init CQC");
  const cqcInitUrl = `${PORTAL_BASE}/RichiestaPatenti/richiestaCQC/ReadRichPatCqc_initRichPatCqc.action`;
  try {
    const r3 = await client.get(cqcInitUrl);
    fs.writeFileSync(path.join(OUT, "03_cqc_init.html"), String(r3.data || ""));
    console.log(`    saved 03_cqc_init.html (${String(r3.data || "").length} bytes)`);
    const $3 = cheerio.load(String(r3.data || ""));
    console.log(`    title=${($3("title").text() || "").trim()}`);
    // Inspect form action
    $3("form").each(function (i) {
      console.log(`    form[${i}] action=${$3(this).attr("action")} method=${$3(this).attr("method")}`);
    });
    // List CQC-related input names
    console.log("    CQC form fields:");
    $3("form").first().find("input, select").each(function () {
      const n = $3(this).attr("name");
      if (n && (n.toLowerCase().includes("cqc") || n.toLowerCase().includes("cognome") || n.toLowerCase().includes("patente"))) {
        console.log(`       ${n}`);
      }
    });
  } catch (err) {
    console.error(`    FAIL: ${err.message}`);
    if (err.response) {
      fs.writeFileSync(path.join(OUT, "03_cqc_init_ERROR.html"), String(err.response.data || ""));
    }
  }

  // ─── 4) POST ricerca CQC PISTONE ───
  console.log("\n[4] POST ricerca CQC PISTONE U1356M550J");
  try {
    const r4init = await client.get(cqcInitUrl);
    const $4init = cheerio.load(String(r4init.data || ""));
    const cqcToken = {
      name: $4init('input[name="struts.token.name"]').val() || "",
      value: "",
    };
    if (cqcToken.name) cqcToken.value = $4init(`input[name="${cqcToken.name}"]`).val() || "";
    console.log(`    token: ${cqcToken.name}=${cqcToken.value.slice(0, 20)}...`);

    const params2 = new URLSearchParams();
    if (cqcToken.name && cqcToken.value) {
      params2.set("struts.token.name", cqcToken.name);
      params2.set(cqcToken.name, cqcToken.value);
    }
    params2.set("richiestaCQCView.richiestaCQCFrom.marcaOperativa", "");
    params2.set("richiestaCQCView.richiestaCQCFrom.theAnagrafica.codiceFiscale", "");
    params2.set("richiestaCQCView.richiestaCQCFrom.patenteItalianaPosseduta", "U1356M550J");
    params2.set("richiestaCQCView.cognome", "PISTONE");
    params2.set("richiestaCQCView.richiestaCQCFrom.theTipoStatoRichiesta.codice", "");
    params2.set("richiestaCQCView.richiestaCQCFrom.dataInserimento", "");
    params2.set("richiestaCQCView.richiestaCQCTo.dataInserimento", "");
    params2.set("action:ReadRichPatCqc_pagingRichPatCqc", "Ricerca");

    const r4 = await client.post(cqcInitUrl, params2.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: cqcInitUrl },
      maxRedirects: 10,
    });
    fs.writeFileSync(path.join(OUT, "04_cqc_pistone.html"), String(r4.data || ""));
    const $4 = cheerio.load(String(r4.data || ""));
    console.log(`    saved 04_cqc_pistone.html (${String(r4.data || "").length} bytes)`);
    console.log(`    title=${($4("title").text() || "").trim()}`);
    const err = $4(".errorMessage, .actionError").first().text().trim();
    console.log(`    errorMessage=${err || "(none)"}`);
    const rows = $4("#listTable > tbody tr").length;
    console.log(`    #listTable rows=${rows}`);
  } catch (err) {
    console.error(`    FAIL: ${err.message}`);
    if (err.response) {
      fs.writeFileSync(path.join(OUT, "04_cqc_pistone_ERROR.html"), String(err.response.data || ""));
      console.log(`    status ${err.response.status}, saved response`);
    }
  }

  // ─── 5) POST ricerca medici con solo patente (no cognome) ───
  console.log("\n[5] POST ricerca medici con dataInserimento 30gg PISTONE");
  try {
    const params3 = new URLSearchParams();
    if (medToken.name && medToken.value) {
      params3.set("struts.token.name", medToken.name);
      params3.set(medToken.name, medToken.value);
    }
    const today = new Date();
    const d30 = new Date(Date.now() - 30 * 86400000);
    const fmt = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    params3.set("richiestaView.richiestaRinnMedFrom.marcaOperativa", "");
    params3.set("richiestaView.richiestaRinnMedFrom.theAnagrafica.codiceFiscale", "");
    params3.set("richiestaView.richiestaRinnMedFrom.patentePosseduta", "");
    params3.set("richiestaView.cognome", "");
    params3.set("richiestaView.richiestaRinnMedFrom.codiceStatoRinnMed", "A");
    params3.set("richiestaView.richiestaRinnMedFrom.dataInserimento", fmt(d30));
    params3.set("richiestaView.richiestaRinnMedTo.dataInserimento", fmt(today));
    params3.set("action:ReadGestRinnMed_pagingGestRinnMedHd", "Ricerca");
    const r5 = await client.post(medInitUrl, params3.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: medInitUrl },
      maxRedirects: 10,
    });
    fs.writeFileSync(path.join(OUT, "05_med_baseline_30gg.html"), String(r5.data || ""));
    const $5 = cheerio.load(String(r5.data || ""));
    const rows5 = $5("#listTable > tbody tr").length;
    console.log(`    baseline 30gg rows=${rows5}`);
    // Sample first row cognome/patente to use as seed
    if (rows5 > 0) {
      $5("#listTable > tbody tr").slice(0, 3).each(function () {
        const tds = $5(this).find("td");
        console.log(`       row: ${tds.map(function () { return $5(this).text().trim(); }).get().join(" | ")}`);
      });
    }
  } catch (err) {
    console.error(`    FAIL: ${err.message}`);
  }
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  console.error(err.stack);
  process.exit(1);
});

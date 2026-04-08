/**
 * moduliController.js
 * Generazione PDF moduli ufficiali (TT2112, comunicazioni, foglio rosa, verbale).
 * Usa Puppeteer per rendere HTML → PDF.
 */

"use strict";

const puppeteer = require("puppeteer");

// ── Utility ──────────────────────────────────────────────────────────────────

function formatData(v) {
  if (!v) return "___________";
  const s = String(v).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return new Date(s + "T00:00:00Z").toLocaleDateString("it-IT");
  }
  return String(v);
}

function val(v, fallback = "___________") {
  if (v === null || v === undefined || String(v).trim() === "") return fallback;
  return String(v);
}

// ── Template TT2112 ──────────────────────────────────────────────────────────

function htmlTT2112(d) {
  const autoscuola = d.autoscuola || {};
  const candidato  = d.candidato  || {};
  const richiesta  = d.richiesta  || {};

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Times New Roman", serif; font-size: 10pt; color: #000;
         padding: 18mm 15mm 15mm 15mm; width: 210mm; }
  h1 { font-size: 12pt; text-align: center; text-transform: uppercase; margin-bottom: 2mm; }
  h2 { font-size: 10pt; text-align: center; margin-bottom: 5mm; }
  .subtitle { font-size: 9pt; text-align: center; margin-bottom: 6mm; color: #333; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 5mm; }
  td, th { border: 1px solid #000; padding: 2mm 3mm; vertical-align: top; }
  th { background: #e8e8e8; font-weight: bold; text-align: left; width: 38%; font-size: 9pt; }
  td { font-size: 9.5pt; }
  .section-title { background: #c8c8c8; font-weight: bold; text-align: center;
                   font-size: 10pt; padding: 2mm; margin: 4mm 0 2mm 0;
                   border: 1px solid #000; }
  .nota { font-size: 8pt; margin-top: 4mm; color: #555; }
  .firma-box { border: 1px solid #000; height: 18mm; margin-top: 3mm; }
  .grid2 td:first-child { width: 38%; }
  .footer { font-size: 8pt; text-align: center; margin-top: 8mm; border-top: 1px solid #000;
            padding-top: 3mm; color: #555; }
  .badge { display: inline-block; border: 2px solid #000; padding: 0 3mm;
           font-size: 13pt; font-weight: bold; min-width: 18mm; text-align: center; }
</style>
</head>
<body>

<h1>Ministero delle Infrastrutture e dei Trasporti</h1>
<h2>MODELLO TT 2112 — PRENOTAZIONE ESAME DI GUIDA</h2>
<div class="subtitle">
  Motorizz. Civile — Ufficio Prov. di ${val(autoscuola.ufficio_mctc || richiesta.ufficio_operativo, "ME")} &nbsp;|&nbsp;
  Data: ${formatData(richiesta.data_richiesta || new Date().toISOString().slice(0,10))}
</div>

<!-- SEZIONE A: AUTOSCUOLA -->
<div class="section-title">SEZIONE A — AUTOSCUOLA</div>
<table class="grid2">
  <tr><th>Denominazione autoscuola</th><td>${val(autoscuola.nome)}</td></tr>
  <tr><th>Codice autoscuola (CIA)</th><td>${val(autoscuola.codice_autoscuola || autoscuola.codice_cia)}</td></tr>
  <tr><th>Marca operativa</th><td>${val(richiesta.marca_operativa || autoscuola.marca_operativa)}</td></tr>
  <tr><th>Cod. Esaminatore</th><td>${val(autoscuola.codice_esaminatore || richiesta.codice_operatore)}</td></tr>
  <tr><th>Ufficio M.C.T.C.</th><td>${val(autoscuola.ufficio_mctc || richiesta.ufficio_operativo)}</td></tr>
</table>

<!-- SEZIONE B: CANDIDATO -->
<div class="section-title">SEZIONE B — DATI CANDIDATO</div>
<table class="grid2">
  <tr><th>Cognome</th><td>${val(candidato.cognome)}</td></tr>
  <tr><th>Nome</th><td>${val(candidato.nome)}</td></tr>
  <tr><th>Codice Fiscale</th><td>${val(candidato.codice_fiscale)}</td></tr>
  <tr><th>Data di nascita</th><td>${formatData(candidato.data_nascita)}</td></tr>
  <tr><th>Luogo di nascita</th><td>${val(candidato.comune_nascita)}${candidato.provincia_nascita ? " (" + candidato.provincia_nascita + ")" : ""}</td></tr>
  <tr><th>Sesso</th><td>${val(candidato.sesso)}</td></tr>
  <tr><th>Residenza</th><td>${val(candidato.indirizzo)}${candidato.cap ? " — " + candidato.cap : ""}</td></tr>
  <tr><th>Telefono</th><td>${val(candidato.telefono || candidato.telefono_1, "–")}</td></tr>
  <tr><th>Tipo documento</th><td>${val(candidato.tipo_documento, "–")}</td></tr>
  <tr><th>N° documento</th><td>${val(candidato.numero_documento, "–")}</td></tr>
</table>

<!-- SEZIONE C: ESAME -->
<div class="section-title">SEZIONE C — DATI ESAME</div>
<table class="grid2">
  <tr>
    <th>Categoria richiesta</th>
    <td><span class="badge">${val(richiesta.categoria_richiesta || candidato.categoria_patente, "B")}</span></td>
  </tr>
  <tr><th>Categoria disponibile</th><td>${val(richiesta.categoria_disponibile || candidato.categoria_disponibile, "–")}</td></tr>
  <tr><th>Patente posseduta n°</th><td>${val(candidato.patente_numero, "–")}</td></tr>
  <tr><th>Cambio automatico</th><td>${richiesta.cambio_automatico || candidato.cambio_automatico ? "SÌ" : "NO"}</td></tr>
  <tr><th>Tipo pagamento</th><td>${val(richiesta.tipo_pagamento || candidato.tipo_pagamento, "–")}</td></tr>
  <tr><th>Codice pagamento</th><td>${val(richiesta.codice_pagamento, "–")}</td></tr>
  <tr><th>Protocollo richiesta</th><td>${val(richiesta.protocollo_richiesta || richiesta.id_richiesta_portale, "–")}</td></tr>
  <tr><th>Validità patente</th><td>${val(richiesta.validita_aa, "10")} anni / ${val(richiesta.validita_mm, "0")} mesi</td></tr>
</table>

<!-- SEZIONE D: VISITA MEDICA -->
<div class="section-title">SEZIONE D — VISITA MEDICA</div>
<table class="grid2">
  <tr><th>Data visita medica</th><td>${formatData(richiesta.data_visita_medica || candidato.data_visita_medica)}</td></tr>
  <tr><th>Cod. iscrizione albo medici</th><td>${val(richiesta.codice_medico || candidato.codice_iscrizione_medico, "–")}</td></tr>
  <tr><th>Luogo visita</th><td>${val(richiesta.luogo_visita_medica || candidato.luogo_visita_medica, "–")}</td></tr>
  <tr><th>Esente visita CML</th><td>${richiesta.esente_visita_cml || candidato.esente_visita_cml ? "SÌ" : "NO"}</td></tr>
  <tr><th>Tempo esteso teoria</th><td>${richiesta.tempo_esteso_teoria || candidato.tempo_esteso_teoria ? "SÌ" : "NO"}</td></tr>
</table>

<!-- FIRME -->
<div class="section-title">FIRME</div>
<table>
  <tr>
    <td style="width:50%">
      <div style="font-size:9pt; margin-bottom:2mm">Firma del responsabile autoscuola:</div>
      <div class="firma-box"></div>
    </td>
    <td style="width:50%">
      <div style="font-size:9pt; margin-bottom:2mm">Firma del candidato:</div>
      <div class="firma-box"></div>
    </td>
  </tr>
</table>

<div class="nota">
  * Il presente modulo è generato automaticamente dal gestionale BLUEFOX S.R.L. — Cod. 0674 — Ufficio ME.<br>
  * Ai sensi del D.Lgs. 30 aprile 1992 n. 285 (Codice della Strada) e s.m.i.
</div>

<div class="footer">
  Gestionale BLUEFOX S.R.L. — Cod. Autoscuola: ${val(autoscuola.codice_autoscuola, "0674")} —
  Stampato il: ${new Date().toLocaleDateString("it-IT")}
</div>

</body>
</html>`;
}

// ── Template Comunicazione Candidato ────────────────────────────────────────

function htmlComunicazione(d) {
  const autoscuola = d.autoscuola || {};
  const candidato  = d.candidato  || {};
  const testo      = d.testo || "";
  const oggetto    = d.oggetto || "Comunicazione";

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11pt; color: #000;
         padding: 20mm 20mm 20mm 25mm; width: 210mm; }
  .intestazione { border-bottom: 2px solid #000; padding-bottom: 4mm; margin-bottom: 8mm; }
  .autoscuola-nome { font-size: 15pt; font-weight: bold; }
  .autoscuola-info { font-size: 9pt; color: #555; margin-top: 1mm; }
  .destinatario { margin-bottom: 10mm; }
  .oggetto { font-weight: bold; margin-bottom: 8mm; }
  .corpo { line-height: 1.7; margin-bottom: 12mm; white-space: pre-line; }
  .firma-area { margin-top: 15mm; }
  .data-luogo { margin-bottom: 10mm; font-size: 10pt; color: #555; }
</style>
</head>
<body>

<div class="intestazione">
  <div class="autoscuola-nome">${val(autoscuola.nome, "AUTOSCUOLA")}</div>
  <div class="autoscuola-info">
    Cod. ${val(autoscuola.codice_autoscuola, "0674")} —
    Ufficio MCTC: ${val(autoscuola.ufficio_mctc, "ME")}
    ${autoscuola.email ? " — " + autoscuola.email : ""}
    ${autoscuola.telefono ? " — Tel. " + autoscuola.telefono : ""}
  </div>
</div>

<div class="destinatario">
  <strong>${val(candidato.cognome)} ${val(candidato.nome)}</strong><br>
  ${val(candidato.indirizzo, "")}${candidato.cap ? " — " + candidato.cap : ""}<br>
  C.F.: ${val(candidato.codice_fiscale, "–")}
</div>

<div class="data-luogo">
  Messina, ${new Date().toLocaleDateString("it-IT")}
</div>

<div class="oggetto">Oggetto: ${oggetto}</div>

<div class="corpo">${testo || "Si prega di presentarsi presso la segreteria dell'autoscuola per informazioni relative alla Sua pratica di esame."}</div>

<div class="firma-area">
  <p>Cordiali saluti,</p>
  <br><br>
  <p><strong>${val(autoscuola.nome, "AUTOSCUOLA")}</strong></p>
  <p style="font-size:9pt;color:#555;margin-top:2mm">Cod. ${val(autoscuola.codice_autoscuola, "0674")}</p>
</div>

</body>
</html>`;
}

// ── Template Riepilogo Candidato ─────────────────────────────────────────────

function htmlRiepilogoCandidato(d) {
  const autoscuola = d.autoscuola || {};
  const candidato  = d.candidato  || {};

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 10pt; color: #000;
         padding: 15mm; width: 210mm; }
  h1 { font-size: 13pt; margin-bottom: 2mm; color: #1a1a6e; }
  h2 { font-size: 10pt; color: #444; font-weight: normal; margin-bottom: 6mm; }
  .section { margin-bottom: 6mm; }
  .section-title { background: #1a1a6e; color: #fff; padding: 1.5mm 3mm;
                   font-size: 9pt; font-weight: bold; margin-bottom: 2mm; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1.5mm 3mm; border-bottom: 1px solid #e0e0e0; font-size: 9.5pt; }
  td:first-child { color: #666; width: 40%; }
  td:last-child { font-weight: 500; }
  .footer { font-size: 8pt; text-align: right; margin-top: 8mm; color: #888;
            border-top: 1px solid #ccc; padding-top: 2mm; }
  .cat-badge { display:inline-block; background:#1a1a6e; color:#fff;
               border-radius:3px; padding:0.5mm 3mm; font-weight:bold; font-size:12pt; }
</style>
</head>
<body>

<h1>Scheda Riepilogativa Candidato</h1>
<h2>${val(autoscuola.nome, "AUTOSCUOLA")} — Cod. ${val(autoscuola.codice_autoscuola, "0674")}</h2>

<div class="section">
  <div class="section-title">ANAGRAFICA</div>
  <table>
    <tr><td>Cognome e Nome</td><td>${val(candidato.cognome)} ${val(candidato.nome)}</td></tr>
    <tr><td>Codice Fiscale</td><td>${val(candidato.codice_fiscale)}</td></tr>
    <tr><td>Data di nascita</td><td>${formatData(candidato.data_nascita)}</td></tr>
    <tr><td>Luogo di nascita</td><td>${val(candidato.comune_nascita)}${candidato.provincia_nascita ? " (" + candidato.provincia_nascita + ")" : ""}</td></tr>
    <tr><td>Sesso</td><td>${val(candidato.sesso, "–")}</td></tr>
    <tr><td>Residenza</td><td>${val(candidato.indirizzo, "–")}${candidato.cap ? " — " + candidato.cap : ""}</td></tr>
    <tr><td>Telefono</td><td>${val(candidato.telefono || candidato.telefono_1, "–")}</td></tr>
    <tr><td>Email</td><td>${val(candidato.email || candidato.email_contatto, "–")}</td></tr>
  </table>
</div>

<div class="section">
  <div class="section-title">PATENTE E PRATICA</div>
  <table>
    <tr><td>Categoria richiesta</td>
        <td><span class="cat-badge">${val(candidato.categoria_patente || candidato.categoria_richiesta, "B")}</span></td></tr>
    <tr><td>N° Patente posseduta</td><td>${val(candidato.patente_numero, "–")}</td></tr>
    <tr><td>Foglio Rosa</td><td>${val(candidato.codice_foglio_rosa, "–")}</td></tr>
    <tr><td>Marca Operativa</td><td>${val(candidato.marca_operativa, "–")}</td></tr>
    <tr><td>Data iscrizione</td><td>${formatData(candidato.data_iscrizione)}</td></tr>
    <tr><td>Stato pratica</td><td>${val(candidato.stato, "–")}</td></tr>
    <tr><td>Cambio automatico</td><td>${candidato.cambio_automatico ? "SÌ" : "NO"}</td></tr>
    <tr><td>Scadenza patente</td><td>${formatData(candidato.scade_il_patente)}</td></tr>
  </table>
</div>

<div class="section">
  <div class="section-title">DOCUMENTO DI IDENTITÀ</div>
  <table>
    <tr><td>Tipo documento</td><td>${val(candidato.tipo_documento, "–")}</td></tr>
    <tr><td>Numero documento</td><td>${val(candidato.numero_documento, "–")}</td></tr>
    <tr><td>Data rilascio</td><td>${formatData(candidato.data_rilascio_doc)}</td></tr>
    <tr><td>Scadenza documento</td><td>${formatData(candidato.scade_il_documento)}</td></tr>
    <tr><td>Luogo rilascio</td><td>${val(candidato.luogo_rilascio_doc, "–")}</td></tr>
  </table>
</div>

<div class="footer">
  Generato il ${new Date().toLocaleDateString("it-IT")} ore ${new Date().toLocaleTimeString("it-IT")} —
  Gestionale BLUEFOX S.R.L. Cod. 0674 — Ufficio ME
</div>

</body>
</html>`;
}

// ── Genera PDF ───────────────────────────────────────────────────────────────

async function generaPdf(html) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0mm", bottom: "0mm", left: "0mm", right: "0mm" },
    });
    return pdf;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ── Controller handlers ──────────────────────────────────────────────────────

/**
 * POST /api/moduli/genera
 * Body: { tipo: "TT2112"|"COMUNICAZIONE"|"RIEPILOGO", candidato, autoscuola, richiesta?, testo?, oggetto? }
 * Restituisce il PDF come application/pdf
 */
async function genera(req, res) {
  try {
    const { tipo, candidato = {}, autoscuola = {}, richiesta = {}, testo, oggetto } = req.body || {};

    if (!tipo) return res.status(400).json({ error: "Campo 'tipo' obbligatorio" });

    let html;
    let nomeFile;

    const cf = (candidato.codice_fiscale || "").replace(/\s/g, "").substring(0, 8) || "CAND";
    const oggi = new Date().toISOString().slice(0, 10).replace(/-/g, "");

    switch (tipo.toUpperCase()) {
      case "TT2112":
        html = htmlTT2112({ candidato, autoscuola, richiesta });
        nomeFile = `TT2112_${cf}_${oggi}.pdf`;
        break;
      case "COMUNICAZIONE":
        html = htmlComunicazione({ candidato, autoscuola, testo, oggetto });
        nomeFile = `Comunicazione_${cf}_${oggi}.pdf`;
        break;
      case "RIEPILOGO":
        html = htmlRiepilogoCandidato({ candidato, autoscuola });
        nomeFile = `Riepilogo_${cf}_${oggi}.pdf`;
        break;
      default:
        return res.status(400).json({ error: `Tipo modulo '${tipo}' non supportato` });
    }

    const pdfBuffer = await generaPdf(html);

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nomeFile}"`,
      "Content-Length": pdfBuffer.length,
    });
    res.send(pdfBuffer);

  } catch (err) {
    console.error("[moduli] Errore generazione PDF:", err);
    res.status(500).json({ error: err.message || "Errore generazione PDF" });
  }
}

/**
 * POST /api/moduli/anteprima-html
 * Stesso body di /genera — restituisce l'HTML grezzo (per debug/anteprima in iframe)
 */
function anteprimaHtml(req, res) {
  try {
    const { tipo, candidato = {}, autoscuola = {}, richiesta = {}, testo, oggetto } = req.body || {};
    if (!tipo) return res.status(400).json({ error: "Campo 'tipo' obbligatorio" });

    let html;
    switch (tipo.toUpperCase()) {
      case "TT2112":
        html = htmlTT2112({ candidato, autoscuola, richiesta });
        break;
      case "COMUNICAZIONE":
        html = htmlComunicazione({ candidato, autoscuola, testo, oggetto });
        break;
      case "RIEPILOGO":
        html = htmlRiepilogoCandidato({ candidato, autoscuola });
        break;
      default:
        return res.status(400).json({ error: `Tipo modulo '${tipo}' non supportato` });
    }

    res.set("Content-Type", "text/html");
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { genera, anteprimaHtml };

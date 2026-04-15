/**
 * genericTableParser.js — Parser HTML generico per tabelle risultati del Portale
 * dell'Automobilista.
 *
 * Estrae la PRIMA tabella "risultati" presente nella pagina (cioe' una tabella
 * con >=3 colonne di intestazione e >=1 riga di dati) e la restituisce come
 * { intestazioni: string[], righe: string[][], count: number, message: string }.
 *
 * Questo parser e' volutamente schema-agnostic: funziona con TUTTI i tab del
 * portale (SQI, SGOS, SQA, SCQC, SCQCA, VAC, VSC, VAQ, VSQ, VSR, VAR, VSRCQC,
 * VARCQC) e anche con altre pagine list del portale in futuro.
 */

const cheerio = require("cheerio");

/**
 * Trova la "migliore" tabella risultati nell'HTML di una pagina portale.
 * Ordine di preferenza:
 *   1. #listTable
 *   2. table.table, table[id*='list'], table[id*='List']
 *   3. qualsiasi table con >=3 celle di intestazione
 */
function findResultsTable($) {
  let table = $("#listTable").first();
  if (table.length) return table;

  table = $("table.table, table[id*='list'], table[id*='List']").first();
  if (table.length) return table;

  let best = null;
  $("table").each((_, tbl) => {
    const headerCount = $(tbl).find("thead th, thead td").length;
    if (headerCount >= 3 && !best) best = $(tbl);
  });
  if (best) return best;

  return $();
}

/**
 * Estrae intestazioni (thead) e righe (tbody tr > td) da un elemento tabella.
 */
function extractHeadersAndRows($, table) {
  const intestazioni = [];
  const righe = [];

  if (!table || !table.length) {
    return { intestazioni, righe };
  }

  table.find("thead tr").first().find("th, td").each((_, th) => {
    intestazioni.push($(th).text().replace(/\s+/g, " ").trim());
  });

  // Fallback: se non c'e' thead, usa la prima tr come header
  if (!intestazioni.length) {
    const firstTr = table.find("tr").first();
    firstTr.find("th, td").each((_, th) => {
      intestazioni.push($(th).text().replace(/\s+/g, " ").trim());
    });
  }

  // Righe dati
  const bodyRows = table.find("tbody tr");
  const rowNodes = bodyRows.length
    ? bodyRows
    : table.find("tr").slice(intestazioni.length ? 1 : 0);

  rowNodes.each((_, tr) => {
    const cells = [];
    $(tr).find("td").each((__, td) => {
      cells.push($(td).text().replace(/\s+/g, " ").trim());
    });
    // Ignora righe vuote o con solo 1-2 celle (probabilmente paging/header)
    if (cells.length >= 2 && cells.some((c) => c.length > 0)) {
      righe.push(cells);
    }
  });

  return { intestazioni, righe };
}

/**
 * Cerca un eventuale messaggio di errore / "nessun risultato" nella pagina.
 */
function extractPageMessage($) {
  const selectors = [
    "#messaggioRicerca",
    ".errorMessage",
    ".errors",
    ".errore",
    ".alert-danger",
    ".alert-error",
    ".alert",
    "#messaggiInfo",
    ".infoMessage",
  ];
  for (const sel of selectors) {
    const text = $(sel).first().text().trim();
    if (text) return text.replace(/\s+/g, " ").slice(0, 300);
  }
  // Fallback: cerca "elementi trovati" o "nessun"
  const bodyText = $("body").text();
  const match = bodyText.match(/(\d+)\s*elementi\s*trovati/i);
  if (match) return `${match[1]} elementi trovati`;
  if (/nessun\s+(risultato|elemento|dato)/i.test(bodyText)) return "Nessun risultato trovato";
  return "";
}

/**
 * Parser generico principale.
 * @param {string} html - HTML della pagina risultati del portale
 * @returns {object} { intestazioni, righe, count, message, pageTitle }
 */
function parseGenericTable(html) {
  if (!html) return { intestazioni: [], righe: [], count: 0, message: "HTML vuoto", pageTitle: "" };

  const $ = cheerio.load(html);
  const table = findResultsTable($);
  const { intestazioni, righe } = extractHeadersAndRows($, table);
  const message = (!righe.length ? extractPageMessage($) : "") || "";
  const pageTitle = ($("title").first().text() || "").replace(/\s+/g, " ").trim();

  return {
    intestazioni,
    righe,
    count: righe.length,
    message,
    pageTitle,
  };
}

/**
 * Parser che accetta HTML e ritorna JSON strutturato con oggetti nominati per colonna.
 * Utile quando le intestazioni sono note (es: tab type SQI -> colonne sessione).
 *
 * @param {string} html
 * @returns {object} { intestazioni, righe, rowsAsObjects, count, message }
 */
function parseGenericTableWithObjects(html) {
  const base = parseGenericTable(html);
  const rowsAsObjects = base.righe.map((row) => {
    const obj = {};
    base.intestazioni.forEach((header, idx) => {
      const key = header
        .toLowerCase()
        .replace(/[^\w\s]/g, "")
        .replace(/\s+/g, "_")
        .replace(/^_+|_+$/g, "") || `col_${idx}`;
      obj[key] = row[idx] || "";
    });
    return obj;
  });
  return { ...base, rowsAsObjects };
}

module.exports = {
  parseGenericTable,
  parseGenericTableWithObjects,
  findResultsTable,
  extractHeadersAndRows,
};

/**
 * Parser HTML pagina Richiesta Patenti (getPratichePatente).
 * Estrae pratiche e candidati dalla risposta del portale.
 */

const cheerio = require("cheerio");

const NORMALIZE_HEADERS = {
  protocollo: ["protocollo", "marca", "marca operativa", "id"],
  cognome: ["cognome"],
  nome: ["nome"],
  "codice fiscale": ["codice fiscale", "cf", "codicefiscale"],
  "data nascita": ["data nascita", "data di nascita", "datanascita"],
  stato: ["stato", "stato pratica"],
  patente: ["patente", "n. patente"],
  tipo: ["tipo", "tipo pratica"],
};

function normalizeHeader(text) {
  const t = String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
  for (const [key, aliases] of Object.entries(NORMALIZE_HEADERS)) {
    if (aliases.some((a) => t.includes(a) || t === a)) return key;
  }
  return t || null;
}

function parseDate(val) {
  if (!val || typeof val !== "string") return null;
  const s = val.trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Estrae pratiche e candidati dall'HTML della pagina Richiesta Patenti.
 * @param {string} html - HTML restituito da getPratichePatente
 * @returns {{ pratiche: array, candidati: array }}
 */
function parsePratichePortalHtml(html) {
  const pratiche = [];
  const candidatiByCf = new Map();

  if (!html || typeof html !== "string") return { pratiche, candidati: [] };

  const $ = cheerio.load(html);

  // Tabella risultati: cerca table con thead/tbody o prima riga come header
  $("table").each((_, table) => {
    const $table = $(table);
    const $rows = $table.find("tr");
    if ($rows.length < 2) return;

    const headerCells = $rows.first().find("th, td");
    const headers = headerCells.map((__, cell) => normalizeHeader($(cell).text())).get();

    for (let i = 1; i < $rows.length; i++) {
      const cells = $rows.eq(i).find("td");
      const row = {};
      cells.each((j, cell) => {
        const key = headers[j] || `col${j}`;
        row[key] = $(cell).text().trim();
      });

      // Link o input con marca operativa / selectRowId
      const link = $rows.eq(i).find('a[href*="marcaOperativa"], a[href*="selectRowId"], a[href*="richiesta"]').attr("href") || "";
      const matchMarca = link.match(/marcaOperativa=([^&\s"']+)/i) || link.match(/selectRowId=([^&\s"']+)/i);
      const marcaOperativa = (matchMarca && matchMarca[1]) ? decodeURIComponent(matchMarca[1]) : (row.protocollo || row.marca || "");

      const cf = (row["codice fiscale"] || row.cf || "").trim().toUpperCase();
      const cognome = (row.cognome || "").trim();
      const nome = (row.nome || "").trim();
      const dataNascita = parseDate(row["data nascita"] || row.datanascita);
      const stato = (row.stato || "").trim();
      const patente = (row.patente || "").trim();
      const tipo = (row.tipo || "").trim();

      if (marcaOperativa || cf || cognome || nome) {
        pratiche.push({
          id_richiesta_portale: marcaOperativa || null,
          marca_operativa: marcaOperativa,
          codice_fiscale: cf || null,
          cognome: cognome || null,
          nome: nome || null,
          data_nascita: dataNascita,
          stato: stato || null,
          patente: patente || null,
          tipo_pratica: tipo || "richiesta_patente",
        });
      }

      if (cf || cognome || nome) {
        const key = cf || `nocf_${cognome}_${nome}_${i}`;
        if (!candidatiByCf.has(key)) {
          candidatiByCf.set(key, {
            codice_fiscale: cf || null,
            cognome: cognome || null,
            nome: nome || null,
            data_nascita: dataNascita,
            raw_portale: { dalla_pratica: true, marca_operativa: marcaOperativa },
          });
        }
      }
    }
  });

  // Form hidden inputs: nomi tipo richiestaView.richiestaFrom.*
  $('input[name*="richiestaView"], input[name*="richiestaFrom"]').each((__, el) => {
    const name = $(el).attr("name") || "";
    const val = $(el).attr("value") || "";
    if (!val) return;
    if (name.includes("marcaOperativa") || name.includes("selectRowId")) {
      const già = pratiche.some((p) => p.marca_operativa === val);
      if (!già) pratiche.push({ id_richiesta_portale: val, marca_operativa: val, tipo_pratica: "richiesta_patente" });
    }
  });

  const candidati = Array.from(candidatiByCf.values()).filter((c) => c.codice_fiscale || c.cognome || c.nome);

  return { pratiche, candidati };
}

module.exports = {
  parsePratichePortalHtml,
  normalizeHeader,
  parseDate,
};

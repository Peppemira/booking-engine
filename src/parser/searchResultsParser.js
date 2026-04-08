const cheerio = require("cheerio");

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseSearchResults(html) {
  const $ = cheerio.load(html || "");
  const results = [];

  $("table").each((_, table) => {
    const headers = [];

    $(table)
      .find("thead th")
      .each((__, th) => headers.push(normalize($(th).text())));

    if (!headers.length) {
      $(table)
        .find("tr")
        .first()
        .find("th")
        .each((__, th) => headers.push(normalize($(th).text())));
    }

    const idxCognome = headers.findIndex((h) => h.includes("cognome"));
    const idxNome = headers.findIndex((h) => h.includes("nome"));
    const idxPatente = headers.findIndex(
      (h) => h.includes("patente") || h.includes("numero patente")
    );

    $(table)
      .find("tbody tr")
      .each((__, row) => {
        const tds = $(row).find("td");
        if (!tds.length) return;

        const cells = tds
          .map((___, td) => String($(td).text() || "").trim())
          .get();

        const cognome = idxCognome >= 0 ? cells[idxCognome] || "" : cells[0] || "";
        const nome = idxNome >= 0 ? cells[idxNome] || "" : cells[1] || "";
        const numeroPatente = idxPatente >= 0 ? cells[idxPatente] || "" : cells[2] || "";

        if (!numeroPatente) return;

        results.push({
          cognome,
          nome,
          numeroPatente,
        });
      });
  });

  return results;
}

module.exports = { parseSearchResults };

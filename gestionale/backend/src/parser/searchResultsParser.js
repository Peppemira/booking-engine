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

  function statusFromText(value = "") {
    const text = normalize(value);
    if (!text) return "attivo";
    if (
      /idone|promoss|superat|abilitat|conseguit|esame superato|passat/.test(text)
    ) {
      return "passato";
    }
    if (/(attiv|in corso|da prenotare|da completare|non idone|respint|bocciat)/.test(text)) {
      return "attivo";
    }
    return "attivo";
  }

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
    const idxStato = headers.findIndex(
      (h) => h.includes("stato") || h.includes("esito") || h.includes("status")
    );

    if (idxPatente < 0) return;

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
        const numeroPatente = cells[idxPatente] || "";
        const statoRaw = idxStato >= 0 ? cells[idxStato] || "" : "";
        const rowText = cells.join(" ").trim();

        if (!numeroPatente) return;

        const columns = {};
        headers.forEach((header, index) => {
          if (!header) return;
          columns[header] = cells[index] || "";
        });

        results.push({
          cognome,
          nome,
          numeroPatente,
          stato: statusFromText(statoRaw || rowText),
          statoRaw: statoRaw || null,
          rowText,
          columns,
        });
      });
  });

  return results;
}

module.exports = { parseSearchResults };

const cheerio = require("cheerio");

function parseSessioni(html) {
  const $ = cheerio.load(html || "");
  const sessioni = [];

  $("form").each((_, form) => {
    const action = ($(form).attr("action") || "").trim();
    const actionLower = action.toLowerCase();

    if (actionLower.includes("dispatcherentry_executedispatch")) {
      return;
    }

    if (actionLower.includes("read_initaction")) {
      return;
    }

    if (!actionLower.includes("/prenotazione/")) {
      return;
    }

    if (!actionLower.includes("prenota") && !actionLower.includes("seleziona")) {
      return;
    }

    const hiddenFields = {};
    $(form)
      .find('input[type="hidden"]')
      .each((__, input) => {
        const name = $(input).attr("name");
        const value = $(input).attr("value") || "";
        if (name) hiddenFields[name] = value;
      });

    const sessionId =
      $(form).find('input[name*="session"]').val() ||
      $(form).find('input[name*="Session"]').val() ||
      $(form).find('input[type="hidden"]').first().val() ||
      "";

    const row = $(form).closest("tr");
    const cells = row.find("td");
    const data = cells.eq(0).text().trim();
    const posti = cells.eq(2).text().trim();

    if (sessionId && !String(sessionId).includes("Advices")) {
      sessioni.push({
        sessionId,
        data,
        posti,
        action,
        hiddenFields,
      });
    }
  });

  return sessioni;
}

function parseSessioniReadOnly(html) {
  const $ = cheerio.load(html || "");
  const rows = [];

  function normalizeHeader(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\./g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getCell(cells, index) {
    if (index === undefined || index === null || index < 0) return "";
    return cells[index] || "";
  }

  $("table").each((_, table) => {
    const headers = $(table)
      .find("th")
      .map((__, th) => normalizeHeader($(th).text()))
      .get();

    if (!headers.length) {
      return;
    }

    const hasStandardLayout = headers.some((h) => h.includes("data esame")) && headers.some((h) => h.includes("posti"));
    const hasCompactLayout = headers.some((h) => h.includes("autosc")) && headers.some((h) => h.includes("tipo esame"));

    if (!hasStandardLayout && !hasCompactLayout) {
      return;
    }

    const idx = {
      data: headers.findIndex((h) => h.includes("data esame")),
      stato: headers.findIndex((h) => h === "stato"),
      dataLimitePrenotazione: headers.findIndex((h) => h.includes("data limite")),
      tipoEsame: headers.findIndex((h) => h.includes("tipo esame")),
      amPm: headers.findIndex((h) => h.includes("am pm")),
      aula: headers.findIndex((h) => h === "aula"),
      turni: headers.findIndex((h) => h.includes("turni")),
      totalePosti: headers.findIndex((h) => h.includes("totale posti")),
      postiLiberi: headers.findIndex((h) => h.includes("posti liberi")),
      postiAutoscuola: headers.findIndex((h) => h.includes("posti autos")),
      propriePrenotazioni: headers.findIndex((h) => h.includes("propri prenot")),
      autoscuola: headers.findIndex((h) => h.includes("autosc")),
      dataIpotetica: headers.findIndex((h) => h.includes("data ipotetica")),
    };

    const dataRows = $(table).find("tbody tr");
    const rowNodes = dataRows.length
      ? dataRows
      : $(table)
          .find("tr")
          .filter((__, tr) => $(tr).find("td").length > 0);

    rowNodes.each((__, tr) => {
        const cells = $(tr)
          .find("td")
          .map((___, td) => $(td).text().replace(/\s+/g, " ").trim())
          .get();

        if (!cells.length) {
          return;
        }

        const dataEsame = getCell(cells, idx.data >= 0 ? idx.data : idx.dataIpotetica);
        if (!dataEsame) return;

        rows.push({
          data: dataEsame,
          stato: getCell(cells, idx.stato),
          dataLimitePrenotazione: getCell(cells, idx.dataLimitePrenotazione),
          tipoEsame: getCell(cells, idx.tipoEsame),
          amPm: getCell(cells, idx.amPm),
          aula: getCell(cells, idx.aula),
          turni: getCell(cells, idx.turni),
          totalePosti: getCell(cells, idx.totalePosti),
          postiLiberi: getCell(cells, idx.postiLiberi),
          postiAutoscuola: getCell(cells, idx.postiAutoscuola),
          propriePrenotazioni: getCell(cells, idx.propriePrenotazioni),
          autoscuola: getCell(cells, idx.autoscuola),
          dataIpotetica: getCell(cells, idx.dataIpotetica),
          sessionId: "",
          posti: getCell(cells, idx.postiLiberi) || getCell(cells, idx.totalePosti) || "",
        });
        });
  });

  return rows;
}

module.exports = { parseSessioni, parseSessioniReadOnly };

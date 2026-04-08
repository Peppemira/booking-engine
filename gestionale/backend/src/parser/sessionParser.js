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

  function findHeaderIndex(headers, predicates) {
    const checks = Array.isArray(predicates) ? predicates : [predicates];
    for (const predicate of checks) {
      const idx = headers.findIndex((header) => predicate(header));
      if (idx >= 0) return idx;
    }
    return -1;
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
    const hasAbbrevLayout = headers.some((h) => h.includes("data ses")) && headers.some((h) => h.includes("limite pren")) && headers.some((h) => h.includes("cand poss"));

    if (!hasStandardLayout && !hasCompactLayout && !hasAbbrevLayout) {
      return;
    }

    const idx = {
      data: findHeaderIndex(headers, [
        (h) => h.includes("data esame"),
        (h) => h.includes("data ses"),
      ]),
      stato: findHeaderIndex(headers, (h) => h === "stato"),
      dataLimitePrenotazione: findHeaderIndex(headers, [
        (h) => h.includes("data limite"),
        (h) => h.includes("limite pren"),
      ]),
      tipoEsame: findHeaderIndex(headers, [
        (h) => h === "esame",
        (h) => h.includes("tipo esame"),
      ]),
      amPm: findHeaderIndex(headers, [
        (h) => h.includes("am pm"),
        (h) => h === "fo",
        (h) => h === "f o",
      ]),
      aula: findHeaderIndex(headers, (h) => h === "aula"),
      turni: findHeaderIndex(headers, (h) => h.includes("turni")),
      totalePosti: findHeaderIndex(headers, [
        (h) => h.includes("totale posti"),
        (h) => h.includes("cand poss"),
      ]),
      postiLiberi: findHeaderIndex(headers, (h) => h.includes("posti liberi")),
      postiAutoscuola: findHeaderIndex(headers, [
        (h) => h.includes("posti autos"),
        (h) => h.includes("cand poss aut"),
      ]),
      postiOccupati: findHeaderIndex(headers, [
        (h) => h.includes("posti occupati"),
        (h) => h.includes("cand pren"),
      ]),
      propriePrenotazioni: findHeaderIndex(headers, [
        (h) => h.includes("propri prenot"),
        (h) => h.includes("cand pren aut"),
      ]),
      autoscuola: findHeaderIndex(headers, [
        (h) => h.includes("autosc"),
        (h) => h.includes("desc localita"),
      ]),
      codLocalita: findHeaderIndex(headers, [
        (h) => h.includes("cod localita"),
        (h) => h.includes("cod. localita"),
        (h) => h.includes("codice localita"),
      ]),
      localita: findHeaderIndex(headers, [
        (h) => h.includes("localita"),
        (h) => h.includes("descrizione localita"),
      ]),
      orario: findHeaderIndex(headers, [
        (h) => h.includes("orario"),
        (h) => h.includes("fascia oraria"),
      ]),
      tipo: findHeaderIndex(headers, [
        (h) => h === "tipo",
        (h) => h.includes("tipo prova"),
      ]),
      dataIpotetica: findHeaderIndex(headers, (h) => h.includes("data ipotetica")),
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
          postiOccupati: getCell(cells, idx.postiOccupati),
          propriePrenotazioni: getCell(cells, idx.propriePrenotazioni),
          autoscuola: getCell(cells, idx.autoscuola),
          codLocalita: getCell(cells, idx.codLocalita),
          localita: getCell(cells, idx.localita),
          orario: getCell(cells, idx.orario),
          tipo: getCell(cells, idx.tipo),
          dataIpotetica: getCell(cells, idx.dataIpotetica),
          sessionId: "",
          posti: getCell(cells, idx.postiLiberi) || "",
        });
        });
  });

  return rows;
}

module.exports = { parseSessioni, parseSessioniReadOnly };

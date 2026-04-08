const cheerio = require("cheerio");

function normalizeHeader(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function extractCodiceFiscaleFromRowText(text) {
  const normalized = String(text || "").toUpperCase();
  const match = normalized.match(/[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]/);
  return match ? match[0] : "";
}

function splitCombinedSurnameName(value) {
  const raw = String(value || "").replace(/\s+/g, " ").trim();
  if (!raw) return { cognome: "", nome: "" };

  const chunks = raw.split(" ").filter(Boolean);
  if (chunks.length < 2) {
    return { cognome: raw, nome: "" };
  }

  const half = Math.ceil(chunks.length / 2);
  return {
    cognome: chunks.slice(0, half).join(" "),
    nome: chunks.slice(half).join(" "),
  };
}

function parsePortalCandidates(html) {
  const $ = cheerio.load(html || "");
  const candidates = [];

  function getCell(cells, index) {
    if (index === undefined || index === null || index < 0) return "";
    return cells[index] || "";
  }

  $("table").each((_, table) => {
    const headers = [];
    $(table)
      .find("thead th")
      .each((__, th) => headers.push(normalizeHeader($(th).text())));

    if (!headers.length) {
      $(table)
        .find("tr")
        .first()
        .find("th")
        .each((__, th) => headers.push(normalizeHeader($(th).text())));
    }

    const hasNameColumns = headers.some((header) => header.includes("cognome"));

    if (!hasNameColumns) return;

    const idxNome = headers.findIndex((header) => header.includes("nome"));
    const idxCognome = headers.findIndex((header) => header.includes("cognome"));
    const idxCodice = headers.findIndex(
      (header) => header.includes("codice fiscale") || header === "codice"
    );
    const idxCodiceCand = headers.findIndex((header) => header.includes("codice cand"));
    const idxTurnoPrefer = headers.findIndex((header) => header.includes("turno prefer"));
    const idxLingua = headers.findIndex((header) => header.includes("lingua"));
    const idxSuppAudio = headers.findIndex((header) => header.includes("supp audio"));

    $(table)
      .find("tbody tr")
      .each((__, tr) => {
        const cells = $(tr)
          .find("td")
          .map((___, td) => $(td).text().trim())
          .get();

        if (!cells.length) return;

        let nome = getCell(cells, idxNome);
        let cognome = getCell(cells, idxCognome);

        if (!cognome && !nome) return;

        if (!nome && cognome) {
          const split = splitCombinedSurnameName(cognome);
          cognome = split.cognome || cognome;
          nome = split.nome || "";
        }

        const codiceCand = getCell(cells, idxCodiceCand);
        const turnoPrefer = getCell(cells, idxTurnoPrefer);
        const lingua = getCell(cells, idxLingua);
        const supportoAudio = getCell(cells, idxSuppAudio);

        let codiceFiscale = getCell(cells, idxCodice);
        if (!codiceFiscale) {
          codiceFiscale = extractCodiceFiscaleFromRowText(cells.join(" "));
        }

        candidates.push({
          nome: nome || null,
          cognome,
          nominativo: [cognome, nome].filter(Boolean).join(" "),
          codice_fiscale: codiceFiscale || null,
          codice_candidato: codiceCand || null,
          turno_prefer: turnoPrefer || null,
          lingua: lingua || null,
          supporto_audio: supportoAudio || null,
          stato: "attivo",
          categoria_patente: "B",
          tentativi_quiz: 0,
        });
      });
  });

  return candidates;
}

module.exports = { parsePortalCandidates };

/**
 * Test suite per services/scadenzeService.js (node:test).
 * Eseguire con:
 *   node --test tests/scadenzeService.test.js
 *
 * Copre regole art. 126 CdS (categorie leggere + pesanti) con casi di confine
 * (compleanno sulla visita, anno bisestile, età invalida, formato DD/MM/YYYY vs ISO).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  calcolaScadenzaMedico,
  etaAllaData,
  addAnni,
  parseDate,
  toISODate,
  normalizzaCategoria,
  isCategoriaPesante,
  CATEGORIE_PESANTI,
} = require("../src/services/scadenzeService");

// =========================================================================
// parseDate
// =========================================================================
describe("parseDate", () => {
  it("accetta formato ISO YYYY-MM-DD", () => {
    const d = parseDate("2026-04-16");
    assert.equal(d.getUTCFullYear(), 2026);
    assert.equal(d.getUTCMonth(), 3); // 0-indexed → aprile
    assert.equal(d.getUTCDate(), 16);
  });

  it("accetta formato italiano DD/MM/YYYY", () => {
    const d = parseDate("16/04/2026");
    assert.equal(d.getUTCFullYear(), 2026);
    assert.equal(d.getUTCMonth(), 3);
    assert.equal(d.getUTCDate(), 16);
  });

  it("accetta formato DD-MM-YYYY", () => {
    const d = parseDate("16-04-2026");
    assert.equal(d.getUTCFullYear(), 2026);
    assert.equal(d.getUTCDate(), 16);
  });

  it("accetta oggetti Date in input", () => {
    const src = new Date(Date.UTC(2026, 3, 16));
    const d = parseDate(src);
    assert.equal(d.getUTCDate(), 16);
  });

  it("ritorna null per input vuoto o invalido", () => {
    assert.equal(parseDate(""), null);
    assert.equal(parseDate(null), null);
    assert.equal(parseDate(undefined), null);
    assert.equal(parseDate("non-una-data"), null);
  });
});

// =========================================================================
// etaAllaData
// =========================================================================
describe("etaAllaData", () => {
  it("calcola età standard tra due date", () => {
    assert.equal(etaAllaData("01/01/1980", "01/01/2026"), 46);
  });

  it("sottrae 1 se il compleanno è successivo alla data riferimento", () => {
    // Nato 15 dicembre → al 1 gennaio ha ancora l'età dell'anno precedente
    assert.equal(etaAllaData("15/12/1980", "01/01/2026"), 45);
  });

  it("lo stesso giorno del compleanno viene contato come anno compiuto", () => {
    assert.equal(etaAllaData("16/04/1980", "16/04/2026"), 46);
  });

  it("il giorno prima del compleanno conta come età - 1", () => {
    assert.equal(etaAllaData("16/04/1980", "15/04/2026"), 45);
  });

  it("ritorna null se le date sono invalide", () => {
    assert.equal(etaAllaData(null, "16/04/2026"), null);
    assert.equal(etaAllaData("16/04/1980", null), null);
    assert.equal(etaAllaData("non-una-data", "16/04/2026"), null);
  });
});

// =========================================================================
// addAnni
// =========================================================================
describe("addAnni", () => {
  it("aggiunge anni normalmente", () => {
    const d = addAnni(parseDate("15/04/2026"), 10);
    assert.equal(toISODate(d), "2036-04-15");
  });

  it("gestisce correttamente il 29 febbraio", () => {
    // 29/02/2024 + 5 anni → 28/02/2029 (non 01/03/2029)
    const d = addAnni(parseDate("29/02/2024"), 5);
    assert.equal(toISODate(d), "2029-02-28");
  });

  it("mantiene 29 febbraio se l'anno destinazione è bisestile", () => {
    // 29/02/2024 + 4 anni → 29/02/2028 (2028 è bisestile)
    const d = addAnni(parseDate("29/02/2024"), 4);
    assert.equal(toISODate(d), "2028-02-29");
  });

  it("ritorna null se la data è invalida", () => {
    assert.equal(addAnni(null, 5), null);
    assert.equal(addAnni(parseDate("non-valida"), 5), null);
  });
});

// =========================================================================
// normalizzaCategoria / isCategoriaPesante
// =========================================================================
describe("normalizzaCategoria", () => {
  it("uppercasea e trimma", () => {
    assert.equal(normalizzaCategoria(" b "), "B");
    assert.equal(normalizzaCategoria("c1e"), "C1E");
  });

  it("prende la prima categoria se ci sono separatori", () => {
    assert.equal(normalizzaCategoria("B/BE"), "B");
    assert.equal(normalizzaCategoria("A1,A2"), "A1");
    assert.equal(normalizzaCategoria("C D"), "C");
  });

  it("ritorna null per input vuoto", () => {
    assert.equal(normalizzaCategoria(""), null);
    assert.equal(normalizzaCategoria(null), null);
    assert.equal(normalizzaCategoria(undefined), null);
  });
});

describe("isCategoriaPesante", () => {
  it("identifica le categorie C/D e derivate come pesanti", () => {
    for (const c of ["C", "C1", "CE", "C1E", "D", "D1", "DE", "D1E"]) {
      assert.equal(isCategoriaPesante(c), true, `${c} dovrebbe essere pesante`);
    }
  });

  it("identifica le leggere correttamente", () => {
    for (const c of ["A", "A1", "A2", "AM", "B", "BE"]) {
      assert.equal(isCategoriaPesante(c), false, `${c} NON dovrebbe essere pesante`);
    }
  });

  it("gestisce multi-categoria prendendo la prima", () => {
    assert.equal(isCategoriaPesante("B/C"), false); // prende B
    assert.equal(isCategoriaPesante("CE/B"), true); // prende CE
  });

  it("copre l'insieme completo CATEGORIE_PESANTI", () => {
    assert.equal(CATEGORIE_PESANTI.size, 8);
  });
});

// =========================================================================
// calcolaScadenzaMedico — regole art. 126 CdS
// =========================================================================
describe("calcolaScadenzaMedico — categorie leggere (A/B)", () => {
  it("età < 50 → 10 anni", () => {
    const out = calcolaScadenzaMedico({
      dataVisita: "15/04/2026",
      dataNascita: "01/01/1980",
      categoria: "B",
    });
    assert.equal(out.regolaApplicata, "leggera_<50");
    assert.equal(out.durataAnni, 10);
    assert.equal(out.dataScadenza, "2036-04-15");
  });

  it("età 50-69 → 5 anni", () => {
    const out = calcolaScadenzaMedico({
      dataVisita: "15/04/2026",
      dataNascita: "01/01/1970",
      categoria: "B",
    });
    assert.equal(out.regolaApplicata, "leggera_50-70");
    assert.equal(out.durataAnni, 5);
    assert.equal(out.dataScadenza, "2031-04-15");
  });

  it("età 70-79 → 3 anni", () => {
    const out = calcolaScadenzaMedico({
      dataVisita: "15/04/2026",
      dataNascita: "01/01/1950",
      categoria: "B",
    });
    assert.equal(out.regolaApplicata, "leggera_70-80");
    assert.equal(out.durataAnni, 3);
    assert.equal(out.dataScadenza, "2029-04-15");
  });

  it("età ≥ 80 → 2 anni", () => {
    const out = calcolaScadenzaMedico({
      dataVisita: "15/04/2026",
      dataNascita: "01/01/1940",
      categoria: "B",
    });
    assert.equal(out.regolaApplicata, "leggera_>=80");
    assert.equal(out.durataAnni, 2);
    assert.equal(out.dataScadenza, "2028-04-15");
  });

  it("default categoria=B se non specificata", () => {
    const out = calcolaScadenzaMedico({
      dataVisita: "15/04/2026",
      dataNascita: "01/01/1980",
    });
    assert.equal(out.regolaApplicata, "leggera_<50");
    assert.equal(out.durataAnni, 10);
  });
});

describe("calcolaScadenzaMedico — categorie pesanti (C/D)", () => {
  it("età < 65 → 5 anni", () => {
    const out = calcolaScadenzaMedico({
      dataVisita: "15/04/2026",
      dataNascita: "01/01/1980",
      categoria: "C",
    });
    assert.equal(out.regolaApplicata, "pesante_<65");
    assert.equal(out.durataAnni, 5);
    assert.equal(out.dataScadenza, "2031-04-15");
  });

  it("età ≥ 65 → 2 anni", () => {
    const out = calcolaScadenzaMedico({
      dataVisita: "15/04/2026",
      dataNascita: "01/01/1955",
      categoria: "CE",
    });
    assert.equal(out.regolaApplicata, "pesante_>=65");
    assert.equal(out.durataAnni, 2);
    assert.equal(out.dataScadenza, "2028-04-15");
  });

  it("funziona con multi-categoria prendendo la prima (C/CE)", () => {
    const out = calcolaScadenzaMedico({
      dataVisita: "15/04/2026",
      dataNascita: "01/01/1980",
      categoria: "C/CE",
    });
    assert.equal(out.regolaApplicata, "pesante_<65");
    assert.equal(out.durataAnni, 5);
  });
});

describe("calcolaScadenzaMedico — edge cases", () => {
  it("ritorna null se manca data visita", () => {
    const out = calcolaScadenzaMedico({
      dataVisita: null,
      dataNascita: "01/01/1980",
    });
    assert.equal(out.dataScadenza, null);
    assert.equal(out.regolaApplicata, null);
  });

  it("ritorna null se manca data nascita", () => {
    const out = calcolaScadenzaMedico({
      dataVisita: "15/04/2026",
      dataNascita: null,
    });
    assert.equal(out.dataScadenza, null);
    assert.equal(out.regolaApplicata, null);
  });

  it("marca regola eta_invalida se l'età è negativa", () => {
    const out = calcolaScadenzaMedico({
      dataVisita: "15/04/1970",
      dataNascita: "01/01/1980", // nato DOPO la visita
      categoria: "B",
    });
    assert.equal(out.dataScadenza, null);
    assert.equal(out.regolaApplicata, "eta_invalida");
  });

  it("marca regola eta_invalida se l'età è > 120", () => {
    const out = calcolaScadenzaMedico({
      dataVisita: "15/04/2026",
      dataNascita: "01/01/1800",
      categoria: "B",
    });
    assert.equal(out.dataScadenza, null);
    assert.equal(out.regolaApplicata, "eta_invalida");
  });

  it("gestisce correttamente una visita sul 29 febbraio (leap year)", () => {
    // Nato 01/01/1980, visita 29/02/2024, età 44 → regola leggera_<50 → 10 anni
    // → scadenza 28/02/2034 (2034 non è bisestile)
    const out = calcolaScadenzaMedico({
      dataVisita: "29/02/2024",
      dataNascita: "01/01/1980",
      categoria: "B",
    });
    assert.equal(out.regolaApplicata, "leggera_<50");
    assert.equal(out.durataAnni, 10);
    assert.equal(out.dataScadenza, "2034-02-28");
  });

  it("gestisce correttamente una visita sul 29 febbraio + durata che cade in anno bisestile", () => {
    // Nato 01/01/1980, visita 29/02/2024, età 44 → 10 anni
    // Ma se fosse 4 anni (ipotetico), scadrebbe 29/02/2028 che È bisestile
    const d = addAnni(parseDate("29/02/2024"), 4);
    assert.equal(toISODate(d), "2028-02-29");
  });

  it("applica la regola più restrittiva al limite esatto (50 anni)", () => {
    // Nato 15/04/1976, visita 15/04/2026 → età esattamente 50 → leggera_50-70
    const out = calcolaScadenzaMedico({
      dataVisita: "15/04/2026",
      dataNascita: "15/04/1976",
      categoria: "B",
    });
    assert.equal(out.regolaApplicata, "leggera_50-70");
    assert.equal(out.durataAnni, 5);
  });

  it("applica la regola più restrittiva al limite esatto (70 anni)", () => {
    const out = calcolaScadenzaMedico({
      dataVisita: "15/04/2026",
      dataNascita: "15/04/1956",
      categoria: "B",
    });
    assert.equal(out.regolaApplicata, "leggera_70-80");
    assert.equal(out.durataAnni, 3);
  });

  it("applica la regola più restrittiva al limite esatto (80 anni)", () => {
    const out = calcolaScadenzaMedico({
      dataVisita: "15/04/2026",
      dataNascita: "15/04/1946",
      categoria: "B",
    });
    assert.equal(out.regolaApplicata, "leggera_>=80");
    assert.equal(out.durataAnni, 2);
  });

  it("applica la regola più restrittiva al limite esatto (65 anni, pesante)", () => {
    const out = calcolaScadenzaMedico({
      dataVisita: "15/04/2026",
      dataNascita: "15/04/1961",
      categoria: "CE",
    });
    assert.equal(out.regolaApplicata, "pesante_>=65");
    assert.equal(out.durataAnni, 2);
  });

  it("il giorno prima del compleanno usa la regola dell'età precedente", () => {
    // Nato 16/04/1976, visita 15/04/2026 → 49 anni → leggera_<50 → 10 anni
    const out = calcolaScadenzaMedico({
      dataVisita: "15/04/2026",
      dataNascita: "16/04/1976",
      categoria: "B",
    });
    assert.equal(out.regolaApplicata, "leggera_<50");
    assert.equal(out.durataAnni, 10);
  });
});

describe("calcolaScadenzaMedico — compatibilità formato input", () => {
  it("accetta date in formato ISO per entrambe le input", () => {
    const out = calcolaScadenzaMedico({
      dataVisita: "2026-04-15",
      dataNascita: "1980-01-01",
      categoria: "B",
    });
    assert.equal(out.dataScadenza, "2036-04-15");
  });

  it("accetta mix formato IT + ISO", () => {
    const out = calcolaScadenzaMedico({
      dataVisita: "15/04/2026",
      dataNascita: "1980-01-01",
      categoria: "B",
    });
    assert.equal(out.dataScadenza, "2036-04-15");
  });

  it("accetta oggetti Date come input", () => {
    const out = calcolaScadenzaMedico({
      dataVisita: new Date(Date.UTC(2026, 3, 15)),
      dataNascita: new Date(Date.UTC(1980, 0, 1)),
      categoria: "B",
    });
    assert.equal(out.dataScadenza, "2036-04-15");
  });
});

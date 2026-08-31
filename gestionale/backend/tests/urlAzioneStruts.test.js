const test = require("node:test");
const assert = require("node:assert");

// Valori FINTI: il modulo pretende le variabili Supabase al caricamento, ma qui
// si prova solo una funzione pura — nessuna connessione viene mai aperta.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://esempio.test";
process.env.SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || "chiave-finta-per-i-test";

const { urlDellAzione } = require("../src/connector/syncArchivioCompleto");

// La ricerca va spedita all'AZIONE, non alla pagina che disegna la maschera:
// spedendo all'init il Portale ri-disegna il modulo vuoto invece di cercare
// (spec §5.12). L'indirizzo si ricava dal nome del bottone Struts.
test("urlDellAzione: dal nome del bottone all'indirizzo della submit", () => {
  const init = "https://www.ilportaledellautomobilista.it/RichiestaPatenti/richiestaEsame/Read_initAction.action?pageStatus=SEARCH";
  assert.strictEqual(
    urlDellAzione("action:Read_paging", init),
    "https://www.ilportaledellautomobilista.it/RichiestaPatenti/richiestaEsame/Read_paging.action");
});

test("urlDellAzione: il prefisso action: è facoltativo", () => {
  const init = "https://esempio.test/area/maschera/Read_initAction.action";
  assert.strictEqual(urlDellAzione("Read_paging", init),
    "https://esempio.test/area/maschera/Read_paging.action");
});

test("urlDellAzione: senza nome o senza init non inventa nulla", () => {
  const init = "https://esempio.test/area/maschera/Read_initAction.action";
  assert.strictEqual(urlDellAzione("", init), null);
  assert.strictEqual(urlDellAzione(null, init), null);
  assert.strictEqual(urlDellAzione("action:Read_paging", ""), null);
  assert.strictEqual(urlDellAzione("action:Read_paging", "non-un-url"), null);
});

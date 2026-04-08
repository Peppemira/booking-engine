const cheerio = require("cheerio");
const { makeHttpClient } = require("./portalHttp");
const { getOrLoginJar } = require("./portalSession");

/**
 * Replica la chiamata HTTP di GeCA alla "Situazione Candidati"
 * e restituisce righe normalizzate per upsertConseguimenti.
 */
async function readSituazioneCandidatiHttp(options = {}) {
  const jar = await getOrLoginJar();
  const client = makeHttpClient(jar);

  // Filtri opzionali: se vuoti NON vengono inviati, per lasciare "Tutti" come in GeCA
  const tipoConseguimento = (options.tipoConseguimento || "").trim(); // es. "C"
  const tipoProva = (options.tipoProva || "").trim(); // es. "Q"
  // Stato candidati: "A" = da prenotare/attivi, "P" = prenotati, ecc.
  const statoCandidati = (options.statoCandidati || "").trim();

  const codUfficio = process.env.PORTAL_UFFICIO_MCTC || "";
  const codiceAutoscuola =
    process.env.CODICE_AUTOSCUOLA ||
    process.env.ARCHIVIO_CODICE_AUTOSCUOLA ||
    "";

  const baseUrl =
    "https://www.ilportaledellautomobilista.it/prenotazione/richiestaEmissioneDocumentoAbilitazioneEP/Read_initActionSituazioneCandidati.action";

  const params = new URLSearchParams();
  // Tipo sessione "C" (Conseguimento) come in GeCA
  params.set(
    "richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.indicatoreTipoSessione",
    "C",
  );
  if (tipoConseguimento) {
    params.set(
      "richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.indicatoreConseguimentoEsame",
      tipoConseguimento,
    );
  }
  if (codUfficio) {
    params.set(
      "richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.theDisponibilitaEsaminatoreEP.codUfficioMCTC",
      codUfficio,
    );
  }
  if (codiceAutoscuola) {
    params.set(
      "richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.theRichiestaEmissioneDocumentoAbilitazioneEP.codiceIdentificativoAutoscuolaAgenzia",
      codiceAutoscuola,
    );
  }
  if (statoCandidati) {
    params.set(
      "richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.indicatoreStatoCandidati",
      statoCandidati,
    );
  }
  // Lasciamo dataFrom/dataTo vuote (tutte le date) come in GeCA se non sono specificate
  params.set(
    "richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.dataFrom",
    options.dataFrom || "",
  );
  params.set(
    "richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.dataTo",
    options.dataTo || "",
  );
  params.set(
    "richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.indicatoreStatoRichiesta",
    "A",
  );
  if (tipoProva) {
    params.set(
      "richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean.indicatoreTipoProvaEsameDaPrenotare",
      tipoProva,
    );
  }
  params.set(
    "action:ReadSituazioneCandidati_pagingSituazioneCandidati",
    "Ricerca",
  );

  const url = `${baseUrl}?${params.toString()}`;
  const { data: html } = await client.get(url);

  const $ = cheerio.load(html || "");
  const rows = [];

  $("table tbody tr").each((_, tr) => {
    const cells = $(tr)
      .find("td")
      .map((i, td) => $(td).text().trim())
      .get();
    if (!cells.length) return;

    // Tabella "Situazione Candidati" (dettaglio) con colonne:
    // 0: Marca Operativa
    // 1: Cognome
    // 2: Nome
    // 3: Codice Statino
    // 4: Data Emissione Statino
    // 5: Scadenza
    // 6: Abilitazione Richiesta (categoria patente)
    // 7: Tipo Esame

    const marcaOperativa = cells[0] || "";
    const cognome = cells[1] || "";
    const nome = cells[2] || "";
    const codiceStatino = cells[3] || "";
    const dataEmissione = cells[4] || "";
    const dataScadenza = cells[5] || "";
    const categoria = cells[6] || "";
    const tipoEsame = cells[7] || "";

    if (!cognome && !nome && !codiceStatino) return;

    rows.push({
      // nessun codice fiscale nella tabella di dettaglio: verrà fatto match su cognome+nome
      codice_fiscale: undefined,
      cognome,
      nome,
      categoria_patente: categoria || "",
      // usiamo la data di emissione statino come data_iscrizione pratica
      data_iscrizione: dataEmissione,
      // metadati aggiuntivi per pratiche_patente
      codice_statino: codiceStatino || null,
      marca_operativa: marcaOperativa || null,
      data_emissione_statino: dataEmissione || null,
      data_scadenza_statino: dataScadenza || null,
      tipo_esame: tipoEsame || null,
    });
  });

  return { rows };
}

module.exports = { readSituazioneCandidatiHttp };


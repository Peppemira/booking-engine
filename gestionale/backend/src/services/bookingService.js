/**
 * BookingService - equivalente a GeCA PrenotatoreService + flussi booking.
 * Prenotazione esami (quiz/guida), cerca/modifica/elimina/sostituisci candidato.
 * Chiamate HTTP verso Portale dell'Automobilista (axios).
 */

const cheerio = require("cheerio");
const {
  prenotaSessione,
  cercaCandidatoInDettaglio,
  confermaNuovoCandidato,
  modificaCandidatoPrenotazione,
  eliminaCandidatoPrenotazione,
  sostituisciCandidatoPrenotazione,
} = require("../connector/booking");

const PORTAL_BASE = "https://www.ilportaledellautomobilista.it";
const URL_SELECT_LISTA_CANDIDATI = `${PORTAL_BASE}/prenotazione/disponibilitaSessioneEsameEP/Select_listCandidati.action`;
const URL_NUOVO_CANDIDATO = `${PORTAL_BASE}/prenotazione/disponibilitaSessioneEsameEP/SelectCandidato_viewNewCandidato.action`;

/**
 * Esito prenotazione (equivalente a GeCA EsitoPrenotazione).
 * @typedef {Object} EsitoPrenotazione
 * @property {number} index
 * @property {boolean} successo
 * @property {string} messaggio
 * @property {string} [turnoEffettivo]
 * @property {string} [cognome]
 * @property {string} [foglioRosa]
 * @property {string} [dataEsame]
 */

/**
 * Info candidato per prenotazione (equivalente a GeCA CandidatoInfo).
 * @typedef {Object} CandidatoInfo
 * @property {string} codiceFoglioRosa
 * @property {string} nome
 * @property {number} [turno]
 * @property {string} [tipoEsame] - QUIZ | ...
 * @property {string} [indicatoreTipoSessione]
 * @property {string} codiceSeduta
 * @property {string} [lingua]
 * @property {string} [audio]
 */

class BookingService {
  /**
   * @param {object} client - Axios client con cookie jar (portale loggato)
   */
  constructor(client) {
    this._client = client;
  }

  /**
   * Apre il dettaglio seduta (step necessario prima di azioni candidato).
   * @param {string} [referer] - URL referer
   * @param {object} [options] - { trace }
   * @returns {Promise<string>} HTML dettaglio
   */
  async apriDettaglioSeduta(referer, options = {}) {
    return prenotaSessione(this._client, referer, options);
  }

  /**
   * Cerca candidato nel form dettaglio (Select_listCandidati).
   * @param {string} detailHtml - HTML pagina dettaglio
   * @param {object} [options] - { codiceFoglioRosa, cognome, trace }
   * @returns {Promise<{ html: string, action?: string, payload?: object }>}
   */
  async cercaCandidato(detailHtml, options = {}) {
    return cercaCandidatoInDettaglio(this._client, detailHtml, options);
  }

  /**
   * Conferma nuovo candidato in seduta (SelectCandidato_viewNewCandidato / CreateSIP).
   * @param {string} detailHtml - HTML dettaglio
   * @param {CandidatoInfo} candidato
   * @param {object} [extraFields]
   * @returns {Promise<string>} HTML response
   */
  async confermaNuovoCandidato(detailHtml, candidato, extraFields = {}) {
    return confermaNuovoCandidato(this._client, detailHtml, candidato, extraFields);
  }

  /**
   * Modifica candidato già prenotato (SelectCandidato_editElementCandidato).
   * @param {string} detailHtml
   * @param {CandidatoInfo} candidato
   * @param {object} [extraFields]
   * @returns {Promise<string>}
   */
  async modificaCandidato(detailHtml, candidato, extraFields = {}) {
    return modificaCandidatoPrenotazione(this._client, detailHtml, candidato, extraFields);
  }

  /**
   * Elimina candidato da prenotazione (SelectCandidato_viewDeletingElementCandidato).
   * @param {string} detailHtml
   * @param {object} options - campi per identificare il candidato (es. progressivoTurno)
   * @returns {Promise<string>}
   */
  async eliminaCandidato(detailHtml, options = {}) {
    return eliminaCandidatoPrenotazione(this._client, detailHtml, options);
  }

  /**
   * Sostituisci candidato (SelectCandidato_viewSostituisciCandidato).
   * @param {string} detailHtml
   * @param {CandidatoInfo} candidatoNuovo
   * @param {object} [extraFields]
   * @returns {Promise<string>}
   */
  async sostituisciCandidato(detailHtml, candidatoNuovo, extraFields = {}) {
    return sostituisciCandidatoPrenotazione(this._client, detailHtml, candidatoNuovo, extraFields);
  }

  /**
   * Orchestrazione prenotazione (stub: flusso completo è in server.js POST /api/portal/prenotazione-candidato).
   * Con client valido può aprire dettaglio seduta e procedere con conferma candidati.
   * @param {object} opts - { candidati, seduta, client, credenziali, ... }
   * @returns {Promise<{ success: boolean, message?: string, esiti?: array }>}
   */
  async prenota(opts = {}) {
    const client = opts.client || this._client;
    if (!client) {
      return {
        success: false,
        message: "Client portale non disponibile. Usare POST /api/portal/prenotazione-candidato per il flusso completo.",
        esiti: [],
      };
    }
    try {
      const referer = opts.referer || opts.seduta?.referer;
      const detailHtml = await this.apriDettaglioSeduta(referer, opts);
      const esiti = [];
      const candidati = Array.isArray(opts.candidati) ? opts.candidati : [];
      for (let i = 0; i < candidati.length; i++) {
        const c = candidati[i];
        try {
          const esito = await this.prenotaEsameAsync(client, { ...c, index: i });
          esiti.push(esito);
        } catch (e) {
          esiti.push({
            index: i,
            successo: false,
            messaggio: e.message || "Errore",
            turnoEffettivo: "",
            cognome: "",
            foglioRosa: "",
            dataEsame: "",
          });
        }
      }
      return { success: esiti.every((e) => e.successo), esiti };
    } catch (e) {
      return {
        success: false,
        message: e.message || "Errore prenotazione",
        esiti: [],
      };
    }
  }

  /**
   * Prenotazione esame singolo candidato (equivalente GeCA PrenotatoreService.PrenotaAsync).
   * Usa axios: POST application/x-www-form-urlencoded a Select_listCandidati (QUIZ) o SelectCandidato_viewNewCandidato (guida).
   * @param {object} client - Axios instance con cookie jar (portale loggato)
   * @param {object} c - CandidatoInfo: index, codiceFoglioRosa, nome, turno, tipoEsame, indicatoreTipoSessione, codiceSeduta, lingua, audio
   * @returns {Promise<EsitoPrenotazione>} { index, successo, messaggio, turnoEffettivo, cognome, foglioRosa, dataEsame }
   */
  async prenotaEsameAsync(client, c) {
    const index = c.index ?? 0;
    const safeLeft = (s, n) => (s == null || s === "" ? "" : String(s).length <= n ? String(s) : String(s).slice(0, n));
    const list = [
      "pageStatus=NEW",
      `disponibilitaSessioneEsameEPView.disponibilitaSessioneEsameEPFrom.selectRowId=${c.codiceSeduta || c.selectRowId || ""}`,
      `disponibilitaSessioneEsameEPView.indicatoreTipoSessione=${c.indicatoreTipoSessione || ""}`,
      "disponibilitaSessioneEsameEPView.visualizzaCaptcha=false",
      `disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.theRichiestaEmissioneDocumentoAbilitazioneEP.codiceFoglioRosa=${c.codiceFoglioRosa || ""}`,
      `disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.theRichiestaEmissioneDocumentoAbilitazioneEP.thePersonaFisica.descrizioneCognomePersonaFisica=${safeLeft(c.nome, 2)}`,
    ];
    let requestUri;
    if (String(c.tipoEsame || "").toUpperCase() === "QUIZ") {
      requestUri = URL_SELECT_LISTA_CANDIDATI;
      list.push(`disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.codiceLinguaPrenotazioneCandidato=${c.lingua || ""}`);
      list.push(`disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.supportoAudio=${c.audio || ""}`);
      list.push(`disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.turnoEsaminatore=${c.turno ?? 0}`);
      list.push("action:CreateSIP_saveNewElementCandidato=Conferma");
    } else {
      requestUri = URL_NUOVO_CANDIDATO;
      list.push(`disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.turnoEsaminatore=${c.turno ?? 0}`);
      list.push("disponibilitaSessioneEsameEPView.prenotazioneCandidatoEP.codiceTipoPagamento=P");
      list.push("action:CreateSGOS_saveNewElementCandidato=Conferma");
    }
    const body = list.join("&");
    const response = await client.post(requestUri, body, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      maxRedirects: 5,
      validateStatus: () => true,
    });
    const html = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
    const $ = cheerio.load(html);
    const innerText = $("body").text() || "";

    if (innerText.includes("dalle 08:00 alle 21:00")) {
      return { index, successo: false, messaggio: "Servizio disponibile 08:00–21:00", turnoEffettivo: "", cognome: "", foglioRosa: "", dataEsame: "" };
    }
    if (innerText.includes("non è momentaneamente disponibile")) {
      return { index, successo: false, messaggio: "Servizio temporaneamente non disponibile", turnoEffettivo: "", cognome: "", foglioRosa: "", dataEsame: "" };
    }
    if ($("#login-user").length || $("#LoginFom_button_value_login").length || $(".img_accedi").length) {
      return { index, successo: false, messaggio: "login", turnoEffettivo: "", cognome: "", foglioRosa: "", dataEsame: "" };
    }

    const descCognome = $("#DisponibilitaSessioneEsameEP_disponibilitaSessioneEsameEPView_prenotazioneCandidatoEP_theRichiestaEmissioneDocumentoAbilitazioneEP_thePersonaFisica_descrizioneCognomePersonaFisica").attr("value") || "";
    const codFoglioRosa = $("#DisponibilitaSessioneEsameEP_disponibilitaSessioneEsameEPView_prenotazioneCandidatoEP_theRichiestaEmissioneDocumentoAbilitazioneEP_codiceFoglioRosa").attr("value") || "";
    const progressivoTurno = $("#DisponibilitaSessioneEsameEP_disponibilitaSessioneEsameEPView_prenotazioneCandidatoEP_progressivoTurnoPrenotazioneEsame").attr("value") || "";
    const dataDisponibilta = $("#dataDisponibiltaEsaminatore").attr("value") || "";
    const msgNode = $(".messaggio, .messaggi").first();
    const errNode = $(".errore-desc, .errori").first();

    if (progressivoTurno || msgNode.length) {
      const messaggio = msgNode.length ? msgNode.text().trim() : "Prenotato con successo";
      return {
        index,
        successo: true,
        messaggio: messaggio || "Prenotato con successo",
        turnoEffettivo: progressivoTurno,
        cognome: descCognome,
        foglioRosa: codFoglioRosa,
        dataEsame: dataDisponibilta,
      };
    }
    if (errNode.length) {
      return { index, successo: false, messaggio: errNode.text().trim(), turnoEffettivo: "", cognome: "", foglioRosa: "", dataEsame: "" };
    }
    return { index, successo: false, messaggio: "Risposta non riconosciuta", turnoEffettivo: "", cognome: "", foglioRosa: "", dataEsame: "" };
  }
}

module.exports = {
  BookingService,
  URL_SELECT_LISTA_CANDIDATI,
  URL_NUOVO_CANDIDATO,
};

/**
 * PortalService - equivalente a GeCA modConnPort.
 * Login SSO, validazione PIN, GET/POST, recupero saldo punti, recupero pratiche.
 * Tutte le chiamate HTTP verso il Portale dell'Automobilista (axios via connector).
 */

const {
  createClient,
  loginPortale,
  autentiPin,
  inviaGetRequest,
  inviaPostRequest,
  recuperaSaldoPunti,
  PORTAL_BASE,
} = require("../connector/portalConnector");

/** Endpoint Portale dell'Automobilista (da GeCA modConnPort, connessioneportalenew, menuonline, NAVIGATOREnew) */
const PORTAL_ENDPOINTS = {
  /** Login SSO */
  LOGIN: `${PORTAL_BASE}/SSO/SSOLogin/Login_initAction.action`,
  /** Validazione PIN e redirect */
  PIN_DISPATCH: `${PORTAL_BASE}/SSO/SSOLogin/DispatcherEntry_executeDispatch.action`,
  /** Interrogazione punti patente (GET: cf + numero patente in path) */
  PUNTI_PATENTE: `${PORTAL_BASE}/interrogazionipuntipatente/api/v1/puntipatente`,
  /** Pratiche / Richiesta Patenti - init e ricerca */
  RICHIESTA_PATENTI_INIT: `${PORTAL_BASE}/RichiestaPatenti/richiesta/Read_initAction.action`,
  /** Pratiche - paging/ricerca */
  RICHIESTA_PATENTI_PAGING: `${PORTAL_BASE}/RichiestaPatenti/richiesta/Read_paging.action`,
  /** Sessioni esame - quiz interne */
  SESSIONI_QUIZ_INTERNE: `${PORTAL_BASE}/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action`,
  /** Sessioni guide orali */
  SESSIONI_GUIDE_ORALI: `${PORTAL_BASE}/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniGuideOrali.action`,
  /** Prenotazione - cerca candidato in lista (Select_listCandidati) */
  PRENOTAZIONE_SELECT_LISTA: `${PORTAL_BASE}/prenotazione/disponibilitaSessioneEsameEP/Select_listCandidati.action`,
  /** Prenotazione - conferma nuovo candidato (CreateSIP quiz / CreateSGOS guida) */
  PRENOTAZIONE_NUOVO_CANDIDATO: `${PORTAL_BASE}/prenotazione/disponibilitaSessioneEsameEP/SelectCandidato_viewNewCandidato.action`,
  /** Homepage professionista (redirect dopo login) */
  HOMEPAGE_PROFESSIONISTA: `${PORTAL_BASE}/web/portale-automobilista/homepage-professionista`,
  /** Logout */
  LOGOUT: `${PORTAL_BASE}/c/portal/logout`,
};

class PortalService {
  constructor(options = {}) {
    this._client = options.client || null;
    this._jar = options.jar || null;
  }

  /** Crea e tiene un client con cookie jar */
  getClient() {
    if (!this._client) {
      this._client = createClient(this._jar);
    }
    return this._client;
  }

  /** Imposta un client esistente (es. da sessione) */
  setClient(client) {
    this._client = client;
    return this;
  }

  /**
   * Login al portale (SSO).
   * @param {string} username
   * @param {string} password
   * @returns {Promise<string>} HTML response
   */
  async login(username, password) {
    const client = this.getClient();
    return loginPortale(client, username, password);
  }

  /**
   * Validazione PIN e redirect.
   * @param {string} pin
   * @param {string} [gotoLink] - es. https://www.ilportaledellautomobilista.it/prenotazione
   * @returns {Promise<string>} HTML response
   */
  async validatePin(pin, gotoLink = `${PORTAL_BASE}/prenotazione`) {
    const client = this.getClient();
    return autentiPin(client, pin, gotoLink);
  }

  /**
   * GET request verso il portale.
   * @param {string} url - URL completo
   * @param {string} [label] - Etichetta per messaggi di errore
   * @returns {Promise<string>} Response body
   */
  async get(url, label = "Pagina") {
    const client = this.getClient();
    return inviaGetRequest(client, url, label);
  }

  /**
   * Recupera HTML pagina sessioni esame disponibili (quiz interne) per il Radar Sedute.
   * @returns {Promise<string>} HTML della pagina sessioni
   */
  async getSessioniDisponibili() {
    const url = `${PORTAL_ENDPOINTS.SESSIONI_QUIZ_INTERNE}?pageStatus=SEARCH`;
    return this.get(url, "Sessioni disponibili");
  }

  /**
   * POST form urlencoded.
   * @param {string} url - URL completo
   * @param {string[]} contentList - Lista "key=value"
   * @returns {Promise<string>} Response body
   */
  async post(url, contentList) {
    const client = this.getClient();
    return inviaPostRequest(client, url, contentList);
  }

  /**
   * Recupera saldo punti patente (API interrogazionipuntipatente).
   * @param {string} url - URL completo API punti (cf/npat)
   * @param {string} [username] - Per retry login
   * @param {string} [password] - Per retry login
   * @returns {Promise<string>} JSON string o ""
   */
  async recuperaSaldoPunti(url, username, password) {
    const client = this.getClient();
    return recuperaSaldoPunti(client, url, username, password);
  }

  /**
   * Recupero punti patente per codice fiscale e numero patente (equivalente modConnPort.recuperasaldopunti).
   * @param {object} options
   * @param {string} options.codiceFiscale - Codice fiscale
   * @param {string} options.numeroPatente - Numero patente
   * @param {string} [options.username] - Username portale (per retry login)
   * @param {string} [options.password] - Password portale
   * @returns {Promise<string>} JSON string risposta API (es. {"esito":true,"punti":20,...}) o ""
   */
  async getPuntiPatente(options = {}) {
    const { codiceFiscale, numeroPatente, username, password } = options;
    if (!codiceFiscale || !numeroPatente) {
      throw new Error("codiceFiscale e numeroPatente sono obbligatori");
    }
    const cf = encodeURIComponent(String(codiceFiscale).trim());
    const npat = encodeURIComponent(String(numeroPatente).trim());
    const url = `${PORTAL_ENDPOINTS.PUNTI_PATENTE}/cf/${cf}/${npat}`;
    return this.recuperaSaldoPunti(url, username, password);
  }

  /**
   * Recupero pratiche (Richiesta Patenti) - GET Read_initAction o con parametri di ricerca.
   * Equivalente a connessioneportalenew InviaGetRequest su RichiestaPatenti/richiesta/Read_initAction.action.
   * @param {object} [query] - Parametri query (marcaOperativa, patente, codiceFiscale, cognome, nome, dataNascita, ...)
   * @param {string} [query.marcaOperativa]
   * @param {string} [query.patente]
   * @param {string} [query.codiceFiscale]
   * @param {string} [query.cognome]
   * @param {string} [query.nome]
   * @param {string} [query.dataNascita]
   * @param {string} [query.action] - es. "Read_paging=Ricerca"
   * @returns {Promise<string>} HTML della pagina pratiche
   */
  async getPratichePatente(query = {}) {
    const client = this.getClient();
    const params = new URLSearchParams();
    params.set("richiestaView.richiestaFrom.marcaOperativa", query.marcaOperativa ?? "");
    params.set("richiestaView.richiestaFrom.patente", query.patente ?? "");
    params.set("richiestaView.richiestaFrom.theAnagrafica.codiceFiscale", query.codiceFiscale ?? "");
    params.set("richiestaView.cognome", query.cognome ?? "");
    params.set("richiestaView.nome", query.nome ?? "");
    params.set("richiestaView.dataNascita", query.dataNascita ?? "");
    params.set("richiestaView.richiestaFrom.theAnagrafica.theComuneNascita.theProvinciaNascita.selectRowId", query.provincia ?? "");
    params.set("richiestaView.richiestaFrom.theAnagrafica.theComuneNascita.selectRowId", query.comune ?? "");
    params.set("richiestaView.richiestaFrom.theAnagrafica.theStatoEstero.selectRowId", query.statoEstero ?? "");
    if (query.action) params.set("action:Read_paging", query.action === "Ricerca" ? "Ricerca" : query.action);
    const qs = params.toString();
    const url = qs
      ? `${PORTAL_ENDPOINTS.RICHIESTA_PATENTI_INIT}?${qs}`
      : PORTAL_ENDPOINTS.RICHIESTA_PATENTI_INIT;
    return inviaGetRequest(client, url, "Gestione Richiesta Patenti");
  }
}

module.exports = {
  PortalService,
  PORTAL_BASE,
  PORTAL_ENDPOINTS,
  createClient,
  loginPortale,
  autentiPin,
  inviaGetRequest,
  inviaPostRequest,
  recuperaSaldoPunti,
};

/**
 * Servizi equivalenti a GeCAFuture (reserse/GeCAFuture/GeCA).
 *
 * Mappatura principale:
 * - modConnPort        → PortalService, portalConnector
 * - PrenotatoreService → BookingService, connector/booking
 * - GecaWebFileApi     → FileApiService, lib/gecaWebFileApi
 * - recuperasaldopunti → PuntiPatenteService, connector/puntiPatente
 * - SendDocComm        → SendDocCommService, connector/sendDocComm
 * - JsonPost           → JsonApiService, lib/jsonApiClient
 * - verifyGeca.asmx    → LicenseService
 * - Execptions         → exceptions.js
 * - CandidatoInfo      → models/candidatoInfo
 * - EsitoPrenotazione  → models/esitoPrenotazione
 */

const { PortalService, PORTAL_BASE, PORTAL_ENDPOINTS, createClient, loginPortale, autentiPin, inviaGetRequest, inviaPostRequest, recuperaSaldoPunti } = require("./portalService");
const { BookingService, URL_SELECT_LISTA_CANDIDATI, URL_NUOVO_CANDIDATO } = require("./bookingService");
const { FileApiService, initGecaWebFileApi, getGecaWebFileApi, GecaWebFileApi } = require("./fileApiService");
const { PuntiPatenteService, getPuntiPatente, PUNTI_API_PATH } = require("./puntiPatenteService");
const { SendDocCommService, sendDCAsync, DEFAULT_BASE } = require("./sendDocCommService");
const SDC_DEFAULT_BASE = DEFAULT_BASE;
const { JsonApiService, JsonApiClient } = require("./jsonApiService");
const { LicenseService, verifyGeca, DEFAULT_VERIFY_URL } = require("./licenseService");
const {
  GecaException,
  SatispayException,
  ActivationTokenNotFoundException,
  ActivationTokenAlreadyPairedException,
  InvalidRsaKeyException,
  PortalException,
  LicenseException,
} = require("./exceptions");
const { createCandidatoInfo, createEsitoPrenotazione } = require("./models");
const { AnagraficaCandidatiService, anagraficaCandidatiService } = require("./anagraficaCandidatiService");
const { PratichePatenteService, pratichePatenteService } = require("./pratichePatenteService");
const { DocumentiService, documentiService } = require("./documentiService");
const { PagamentiService, pagamentiService } = require("./pagamentiService");
const { SyncService, syncService } = require("./syncService");
const { getListaAttesa, segnaPrenotato, countInAttesa, countPrenotati, STATUS_ATTESA, STATUS_PRENOTATO } = require("./queueService");
const { checkSedute, seduteConPosti } = require("./radarService");
const { autoBook, getRadarCredentials } = require("./autoBookingService");
const { startScheduler, stopScheduler } = require("./scheduler");

module.exports = {
  // Servizi
  PortalService,
  BookingService,
  FileApiService,
  PuntiPatenteService,
  SendDocCommService,
  JsonApiService,
  LicenseService,
  AnagraficaCandidatiService,
  anagraficaCandidatiService,
  PratichePatenteService,
  pratichePatenteService,
  DocumentiService,
  documentiService,
  PagamentiService,
  pagamentiService,
  SyncService,
  syncService,

  // Radar Sedute / lista attesa / auto-booking
  getListaAttesa,
  segnaPrenotato,
  countInAttesa,
  countPrenotati,
  STATUS_ATTESA,
  STATUS_PRENOTATO,
  checkSedute,
  seduteConPosti,
  autoBook,
  getRadarCredentials,
  startScheduler,
  stopScheduler,

  // Funzioni/helper portale
  PORTAL_BASE,
  PORTAL_ENDPOINTS,
  createClient,
  loginPortale,
  autentiPin,
  inviaGetRequest,
  inviaPostRequest,
  recuperaSaldoPunti,

  // File API
  initGecaWebFileApi,
  getGecaWebFileApi,
  GecaWebFileApi,

  // Punti patente
  getPuntiPatente,
  PUNTI_API_PATH,

  // Prenotazione esame (URL Portale)
  URL_SELECT_LISTA_CANDIDATI,
  URL_NUOVO_CANDIDATO,

  // SDC
  sendDCAsync,
  SDC_DEFAULT_BASE,

  // Licenza
  verifyGeca,
  DEFAULT_VERIFY_URL,

  // Eccezioni
  GecaException,
  SatispayException,
  ActivationTokenNotFoundException,
  ActivationTokenAlreadyPairedException,
  InvalidRsaKeyException,
  PortalException,
  LicenseException,

  // Modelli
  createCandidatoInfo,
  createEsitoPrenotazione,
  JsonApiClient,
};

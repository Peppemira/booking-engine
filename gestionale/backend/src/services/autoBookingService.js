/**
 * Prenotazione automatica Radar: quando il radar trova posti, prenota i candidati in lista d'attesa.
 * Usa radarService (sedute), queueService (lista attesa), bookingService (prenotaEsameAsync).
 */

const supabase = require("../database/supabase");
const { createClient, loginPortale, autentiPin } = require("../connector/portalConnector");
const { PortalService, PORTAL_BASE } = require("./portalService");
const { BookingService } = require("./bookingService");
const radarService = require("./radarService");
const queueService = require("./queueService");

const INDICATORE_QUIZ = "SQI";

/**
 * Risolve credenziali portale per il radar (una autoscuola con portal_user/portal_pass o env).
 * @returns {Promise<{ autoscuolaId: string|null, username: string, password: string, pin: string|null }>}
 */
async function getRadarCredentials() {
  const { data } = await supabase
    .from("autoscuole")
    .select("id, portal_user, portal_pass, portal_pin")
    .not("portal_user", "is", null)
    .not("portal_pass", "is", null)
    .limit(1)
    .maybeSingle();

  if (data?.portal_user && data?.portal_pass) {
    return {
      autoscuolaId: data.id,
      username: data.portal_user,
      password: data.portal_pass,
      pin: data.portal_pin || process.env.PORTAL_PIN || null,
    };
  }
  const username = process.env.PORTAL_USER || process.env.PORTAL_USERNAME;
  const password = process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD;
  if (!username || !password) return null;
  return {
    autoscuolaId: process.env.AUTOSCUOLA_ID || null,
    username,
    password,
    pin: process.env.PORTAL_PIN || null,
  };
}

/**
 * Costruisce un contesto "req" per tenant (getListaAttesa, segnaPrenotato).
 */
function reqContext(autoscuolaId) {
  return autoscuolaId ? { autoscuolaId } : {};
}

/**
 * Esegue un ciclo di auto-prenotazione: controlla sedute, prenota il primo candidato in lista che riesce.
 * @returns {Promise<{ ok: boolean, prenotati: number, seduteDisponibili: number, inCoda: number, message?: string }>}
 */
async function autoBook() {
  const creds = await getRadarCredentials();
  if (!creds) {
    return { ok: false, prenotati: 0, seduteDisponibili: 0, inCoda: 0, message: "Credenziali portale non configurate" };
  }

  const client = createClient();
  try {
    await loginPortale(client, creds.username, creds.password);
    if (creds.pin) {
      await autentiPin(client, creds.pin, `${PORTAL_BASE}/prenotazione`);
    }
  } catch (e) {
    return { ok: false, prenotati: 0, seduteDisponibili: 0, inCoda: 0, message: `Login portale fallito: ${e.message}` };
  }

  const portal = new PortalService();
  portal.setClient(client);

  let html;
  try {
    html = await portal.getSessioniDisponibili();
  } catch (e) {
    return { ok: false, prenotati: 0, seduteDisponibili: 0, inCoda: 0, message: `Lettura sessioni fallita: ${e.message}` };
  }

  const sedute = await radarService.checkSedute(html);
  const conPosti = radarService.seduteConPosti(sedute);
  const req = reqContext(creds.autoscuolaId);

  let lista;
  try {
    lista = await queueService.getListaAttesa(req);
  } catch (e) {
    return { ok: false, prenotati: 0, seduteDisponibili: conPosti.length, inCoda: 0, message: `Lista attesa: ${e.message}` };
  }

  if (conPosti.length === 0 || lista.length === 0) {
    return {
      ok: true,
      prenotati: 0,
      seduteDisponibili: conPosti.length,
      inCoda: lista.length,
    };
  }

  const booking = new BookingService(client);
  const seduta = conPosti[0];
  let prenotati = 0;

  for (let i = 0; i < lista.length; i++) {
    const row = lista[i];
    const cand = row.candidates || {};
    const codiceFoglioRosa = cand.codice_foglio_rosa || row.codice_foglio_rosa || "";
    const cognome = cand.cognome || "";
    const nome = cand.nome || "";
    const raw = cand.raw_portale || {};
    const candidatoInfo = {
      index: i,
      codiceFoglioRosa,
      nome: cognome || nome,
      turno: 0,
      tipoEsame: "QUIZ",
      indicatoreTipoSessione: INDICATORE_QUIZ,
      codiceSeduta: seduta.selectRowId || seduta.sessionId,
      lingua: raw.codice_lingua || raw.lingua || "IT",
      audio: raw.supporto_audio || raw.audio || "N",
    };

    try {
      const esito = await booking.prenotaEsameAsync(client, candidatoInfo);
      if (esito && esito.successo) {
        await queueService.segnaPrenotato(row.id, req);
        prenotati += 1;
        if (process.env.NODE_ENV !== "test") {
          console.log("[Radar] Prenotato:", row.candidate_id, candidatoInfo.codiceFoglioRosa || cognome);
        }
        break;
      }
    } catch (e) {
      if (process.env.NODE_ENV !== "test") {
        console.warn("[Radar] Errore prenotazione candidato", row.candidate_id, e.message);
      }
    }
  }

  return {
    ok: true,
    prenotati,
    seduteDisponibili: conPosti.length,
    inCoda: lista.length,
  };
}

module.exports = {
  autoBook,
  getRadarCredentials,
};

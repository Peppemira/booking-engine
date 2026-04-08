/**
 * Controller dashboard Radar Sedute: sedute disponibili, posti liberi, coda, prenotazioni eseguite.
 */

const { createClient, loginPortale, autentiPin } = require("../connector/portalConnector");
const { PortalService, PORTAL_BASE } = require("../services/portalService");
const radarService = require("../services/radarService");
const queueService = require("../services/queueService");
const { getRadarCredentials } = require("../services/autoBookingService");

function reqContext(autoscuolaId) {
  return autoscuolaId ? { autoscuolaId } : {};
}

const { createClient: createSupabaseClient } = require("@supabase/supabase-js")

const supabase = createSupabaseClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
)
/**
 * GET /api/radar/dashboard - dati per la dashboard (sedute, posti, coda, prenotazioni eseguite).
 */
async function getDashboard(req, res) {
  try {
    const creds = await getRadarCredentials();
    const reqCtx = reqContext(creds?.autoscuolaId || req?.autoscuolaId);

    let sedute = [];
    let seduteConPosti = [];
    let totalePostiLiberi = 0;
    let inCoda = 0;
    let prenotazioniEseguite = 0;
    let prenotazioniEseguiteOggi = 0;
    let radarOk = false;
    let message = null;

    inCoda = await queueService.countInAttesa(reqCtx);
    prenotazioniEseguite = await queueService.countPrenotati(reqCtx);
    prenotazioniEseguiteOggi = await queueService.countPrenotati(reqCtx, 1);

    if (creds) {
      const client = createClient();
      try {
        await loginPortale(client, creds.username, creds.password);
        if (creds.pin) await autentiPin(client, creds.pin, `${PORTAL_BASE}/prenotazione`);
        const portal = new PortalService();
        portal.setClient(client);
        const html = await portal.getSessioniDisponibili();
        sedute = await radarService.checkSedute(html);
        seduteConPosti = radarService.seduteConPosti(sedute);
        totalePostiLiberi = seduteConPosti.reduce((acc, s) => acc + (s.posti || 0), 0);
        radarOk = true;
      } catch (e) {
        message = e.message || "Portale non raggiungibile";
      }
    } else {
      message = "Credenziali portale non configurate";
    }

    const radarAttivo = String(process.env.RADAR_AUTO_START || "false").toLowerCase() === "true";

    res.json({
      success: true,
      seduteDisponibili: seduteConPosti.length,
      sedute,
      seduteConPosti,
      totalePostiLiberi,
      inCoda,
      prenotazioniEseguite,
      prenotazioniEseguiteOggi,
      radarOk,
      radarAttivo,
      message,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || "Errore dashboard radar" });
  }
}

module.exports = {
  getDashboard,
};

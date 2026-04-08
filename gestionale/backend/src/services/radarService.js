/**
 * Radar Sedute - controllo continuo disponibilità sessioni esame sul portale.
 * Usa portalService.getSessioniDisponibili() e sessionParser per estrarre sedute con posti.
 */

const cheerio = require("cheerio");
const { parseSessioni } = require("../parser/sessionParser");

/**
 * Controlla le sedute disponibili sul portale (HTML) e restituisce lista con data, posti, sessionId, action, hiddenFields.
 * @param {string} html - HTML restituito da portalService.getSessioniDisponibili()
 * @returns {Promise<array>} sedute: { data, posti, sessionId, action, hiddenFields } con posti parsato come numero
 */
async function checkSedute(html) {
  if (!html || typeof html !== "string") return [];

  const sessioni = parseSessioni(html);
  const sedute = sessioni.map((s) => {
    const h = s.hiddenFields || {};
    const selectRowId =
      h["disponibilitaSessioneEsameEPView.disponibilitaSessioneEsameEPFrom.selectRowId"] ||
      h["disponibilitaSessioneEsameEPFrom.selectRowId"] ||
      s.sessionId ||
      "";
    return {
      data: s.data,
      posti: parseInt(String(s.posti || "0").replace(/\D/g, ""), 10) || 0,
      sessionId: s.sessionId,
      selectRowId,
      action: s.action,
      hiddenFields: h,
    };
  });

  return sedute;
}

/**
 * Restituisce solo le sedute con almeno un posto disponibile.
 */
function seduteConPosti(sedute) {
  return (sedute || []).filter((s) => s.posti > 0);
}

module.exports = {
  checkSedute,
  seduteConPosti,
};

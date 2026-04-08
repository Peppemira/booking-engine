/**
 * Controller REST per documenti / SDC (GeCA stampepdf, SendDocComm).
 */

const { documentiService } = require("../services");

async function inviaDC(req, res) {
  try {
    const dcPayload = req.body || {};
    if (!dcPayload.datiTrasmissione || !dcPayload.identificativiFiscali) {
      return res.status(400).json({ error: "datiTrasmissione e identificativiFiscali obbligatori" });
    }
    const result = await documentiService.inviaDocumentoAccompagnamento(dcPayload, {
      baseUrl: req.body?.baseUrl,
      timeout: req.body?.timeout,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore invio documento accompagnamento" });
  }
}

async function parseEsiti(req, res) {
  try {
    const body = req.body || {};
    const { esiti, errori } = documentiService.parseEsitiResponse(body);
    res.json({ esiti, errori });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore parsing esiti" });
  }
}

module.exports = {
  inviaDC,
  parseEsiti,
};

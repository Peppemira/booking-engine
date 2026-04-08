/**
 * LicenseService - equivalente a GeCA verifyGeca.asmx (modulo / licenza / frmmenu).
 * Verifica licenza verso wsGeCAFuture/verifyGeca.asmx.
 */

const axios = require("axios");

const DEFAULT_VERIFY_URL =
  process.env.GECA_LICENSE_VERIFY_URL ||
  "http://www.aeffesoft.it/GeCAFuture/active/wsGeCAFuture/verifyGeca.asmx";

/**
 * Chiamata SOAP verifyGeca (stub: effettua richiesta e restituisce esito da risposta).
 * @param {object} options - { url, payloadXml, seriale, ... }
 * @returns {Promise<{ valid: boolean, message?: string }>}
 */
async function verifyGeca(options = {}) {
  const url = options.url || DEFAULT_VERIFY_URL;
  const payload =
    options.payloadXml ||
    buildVerifyPayload(options.seriale || options.codiceSeriale || "");

  try {
    const response = await axios.post(url, payload, {
      headers: {
        "Content-Type": "text/xml; charset=UTF-8",
        SOAPAction: '"http://tempuri.org/Verify"',
      },
      timeout: 10000,
      validateStatus: () => true,
    });

    const body = typeof response.data === "string" ? response.data : "";
    const valid =
      response.status === 200 &&
      !body.toLowerCase().includes("false") &&
      (body.includes("true") || body.includes("Valid") || !body.includes("error"));
    return {
      valid,
      message: valid ? undefined : (body.slice(0, 500) || `HTTP ${response.status}`),
    };
  } catch (err) {
    return {
      valid: false,
      message: err.message || "Errore verifica licenza",
    };
  }
}

function buildVerifyPayload(seriale) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <Verify xmlns="http://tempuri.org/">
      <seriale>${String(seriale).replace(/[<>&"']/g, "")}</seriale>
    </Verify>
  </soap:Body>
</soap:Envelope>`;
}

class LicenseService {
  constructor(options = {}) {
    this._verifyUrl = options.verifyUrl || DEFAULT_VERIFY_URL;
  }

  /**
   * Verifica licenza per codice seriale.
   * @param {string} [seriale] - Codice seriale (opzionale se in options)
   * @returns {Promise<{ valid: boolean, message?: string }>}
   */
  async verify(seriale) {
    return verifyGeca({
      url: this._verifyUrl,
      seriale: seriale != null ? seriale : "",
    });
  }
}

module.exports = {
  LicenseService,
  verifyGeca,
  DEFAULT_VERIFY_URL,
};

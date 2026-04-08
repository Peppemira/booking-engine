const { extractConfirmationRequest } = require("../parser/bookingStepParser");

async function prenotaSessione(client, sessione) {
  const baseUrl = "https://www.ilportaledellautomobilista.it";
  const action = sessione?.action || "";
  const url = action.startsWith("http") ? action : `${baseUrl}${action}`;

  const formData = new URLSearchParams();
  const hiddenFields = sessione?.hiddenFields || {};

  Object.entries(hiddenFields).forEach(([name, value]) => {
    formData.append(name, value == null ? "" : String(value));
  });

  if (sessione?.sessionId && !formData.has("sessionId")) {
    formData.append("sessionId", sessione.sessionId);
  }

  const res = await client.post(url, formData, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer:
        "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH",
    },
  });

  return res.data;
}

async function confermaPrenotazione(client, step2Html) {
  const request = extractConfirmationRequest(step2Html);

  if (!request || !request.url) {
    throw new Error("Form di conferma non trovato in step2.html");
  }

  const res = await client.post(request.url, request.payload, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer:
        "https://www.ilportaledellautomobilista.it/prenotazione/disponibilitaSessioneEsameEP/Read_initActionSessioniQuizInterne.action?pageStatus=SEARCH",
    },
  });

  return res.data;
}

module.exports = { prenotaSessione, confermaPrenotazione };

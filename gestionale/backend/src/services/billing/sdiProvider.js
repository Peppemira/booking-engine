/**
 * Emissione della fattura elettronica (SDI) per le commissioni della piattaforma.
 *
 * Provider selezionato con SDI_PROVIDER:
 *  - "manuale" (default): nessuna chiamata esterna. La fattura resta "da_emettere"
 *    e compare nel pannello amministratore per l'emissione a mano.
 *  - "fattureincloud": API v2 di Fatture in Cloud (crea la fattura e la invia allo SDI).
 *
 * Interfaccia comune: emettiFattura(dati) -> { stato, numero, providerId, pdfUrl, errore }
 *   stato: "inviata" | "da_emettere" | "errore"
 *
 * NB: prima di andare in produzione verificare il formato con la sandbox del provider
 * e con il commercialista (codice IVA, natura, modalità di pagamento).
 */

const axios = require("axios");

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

/** Converte i dati interni nel payload Fatture in Cloud (issued_documents). */
function buildFattureInCloudPayload(dati, env = process.env) {
  const cliente = dati.cliente || {};
  const oggi = new Date().toISOString().slice(0, 10);
  const descrizione = `Commissioni servizio piattaforma – ${dati.numeroPagopa} PagoPA gestiti` +
    (dati.periodoInizio && dati.periodoFine ? ` (dal ${dati.periodoInizio} al ${dati.periodoFine})` : "");

  return {
    data: {
      type: "invoice",
      date: oggi,
      entity: {
        name: cliente.ragioneSociale || cliente.nome,
        vat_number: cliente.partitaIva || undefined,
        tax_code: cliente.codiceFiscale || cliente.partitaIva || undefined,
        address_street: cliente.indirizzo || undefined,
        address_postal_code: cliente.cap || undefined,
        address_city: cliente.comune || undefined,
        address_province: cliente.provincia || undefined,
        country: "Italia",
        certified_email: cliente.pec || undefined,
        ei_code: cliente.codiceSdi || (cliente.pec ? "0000000" : undefined),
      },
      items_list: [
        {
          name: "Commissione PagoPA piattaforma",
          description: descrizione,
          qty: Number(dati.numeroPagopa || 0),
          net_price: round2(dati.tariffaUnitaria),
          vat: { id: Number(env.FIC_VAT_ID || 0) },
        },
      ],
      payments_list: [
        {
          amount: round2(dati.totale),
          due_date: oggi,
          status: dati.pagata ? "paid" : "not_paid",
          paid_date: dati.pagata ? oggi : undefined,
        },
      ],
      e_invoice: true,
      ei_data: { payment_method: String(env.FIC_PAYMENT_METHOD || "MP08") },
    },
  };
}

async function emettiFattureInCloud(dati, env = process.env, http = axios) {
  const token = String(env.FIC_ACCESS_TOKEN || "").trim();
  const companyId = String(env.FIC_COMPANY_ID || "").trim();
  if (!token || !companyId) {
    return { stato: "errore", errore: "FIC_ACCESS_TOKEN o FIC_COMPANY_ID mancanti" };
  }
  const base = `https://api-v2.fattureincloud.it/c/${companyId}`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  try {
    const created = await http.post(`${base}/issued_documents`, buildFattureInCloudPayload(dati, env), { headers });
    const doc = created?.data?.data || {};
    await http.post(`${base}/issued_documents/${doc.id}/e_invoice/send`, { data: {} }, { headers });
    return {
      stato: "inviata",
      numero: doc.number != null ? `${doc.number}${doc.numeration || ""}` : null,
      providerId: doc.id != null ? String(doc.id) : null,
      pdfUrl: doc.url || null,
    };
  } catch (e) {
    const msg = e?.response?.data?.error?.message || e?.response?.data?.message || e.message;
    return { stato: "errore", errore: String(msg).slice(0, 500) };
  }
}

async function emettiFattura(dati, { env = process.env, http = axios } = {}) {
  const provider = String(env.SDI_PROVIDER || "manuale").trim().toLowerCase();
  if (provider === "fattureincloud") return emettiFattureInCloud(dati, env, http);
  return { stato: "da_emettere", errore: null };
}

module.exports = { emettiFattura, buildFattureInCloudPayload };

/**
 * scadenzeService — calcolo scadenze rinnovi medici secondo normativa italiana.
 *
 * Fonte: Codice della Strada art. 126 (durata validità patente in funzione di
 * categoria + età alla data della visita medica).
 *
 * Categorie LEGGERE (A, B, BE, AM, A1, A2):
 *   - età < 50  → 10 anni
 *   - 50 ≤ età < 70 → 5 anni
 *   - 70 ≤ età < 80 → 3 anni
 *   - età ≥ 80 → 2 anni
 *
 * Categorie PESANTI (C, C1, CE, C1E, D, D1, DE, D1E):
 *   - età < 65 → 5 anni
 *   - età ≥ 65 → 2 anni
 *
 * CQC (quando pertinente): 5 anni sempre.
 *
 * Note:
 *   - L'età è calcolata alla DATA DELLA VISITA MEDICA (non alla data corrente).
 *   - Se la data di visita o la data di nascita mancano, il calcolo torna null.
 *   - Le date italiane DD/MM/YYYY vengono normalizzate internamente.
 */

const CATEGORIE_PESANTI = new Set([
  "C", "C1", "CE", "C1E",
  "D", "D1", "DE", "D1E",
]);

/**
 * Parsa una data in qualsiasi formato italiano o ISO e ritorna un Date.
 * Ritorna null se non parsabile.
 */
function parseDate(input) {
  if (!input) return null;
  if (input instanceof Date) return isNaN(input) ? null : input;
  const s = String(input).trim();
  if (!s) return null;

  // ISO: YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return isNaN(d) ? null : d;
  }
  // IT: DD/MM/YYYY
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
    return isNaN(d) ? null : d;
  }
  // IT: DD-MM-YYYY
  m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
    return isNaN(d) ? null : d;
  }
  // Fallback
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

/**
 * Ritorna la data in formato ISO YYYY-MM-DD (solo parte data).
 */
function toISODate(d) {
  if (!(d instanceof Date) || isNaN(d)) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const g = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${g}`;
}

/**
 * Età (anni completi) alla data di riferimento.
 */
function etaAllaData(dataNascita, dataRiferimento) {
  const n = parseDate(dataNascita);
  const r = parseDate(dataRiferimento);
  if (!n || !r) return null;
  let eta = r.getUTCFullYear() - n.getUTCFullYear();
  const mDelta = r.getUTCMonth() - n.getUTCMonth();
  if (mDelta < 0 || (mDelta === 0 && r.getUTCDate() < n.getUTCDate())) eta -= 1;
  return eta;
}

/**
 * Aggiunge N anni a una data, gestendo correttamente il 29 febbraio.
 */
function addAnni(d, anni) {
  if (!(d instanceof Date) || isNaN(d)) return null;
  const y = d.getUTCFullYear() + anni;
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const result = new Date(Date.UTC(y, m, day));
  // Gestione overflow (es: 29/02/2024 + 5 anni → 01/03/2029, vogliamo 28/02/2029)
  if (result.getUTCMonth() !== m) {
    return new Date(Date.UTC(y, m + 1, 0)); // ultimo giorno del mese precedente
  }
  return result;
}

/**
 * Normalizza categoria patente per il lookup (uppercase, trim, solo prima categoria).
 * Es: "B/BE" → "B", "c1e" → "C1E", null → null.
 */
function normalizzaCategoria(categoria) {
  if (!categoria) return null;
  const s = String(categoria).trim().toUpperCase();
  if (!s) return null;
  // Prendi la prima categoria se ci sono separatori
  const prima = s.split(/[,/\s]/)[0];
  return prima || null;
}

/**
 * Determina se una categoria è "pesante" (C/D e derivate).
 */
function isCategoriaPesante(categoria) {
  const c = normalizzaCategoria(categoria);
  return c ? CATEGORIE_PESANTI.has(c) : false;
}

/**
 * Calcola la scadenza del rinnovo medico.
 *
 * @param {Object} params
 * @param {string|Date} params.dataVisita  - Data della visita medica
 * @param {string|Date} params.dataNascita - Data di nascita del titolare
 * @param {string}      [params.categoria] - Categoria patente (default: "B" per leggera)
 * @returns {{ dataScadenza: string|null, durataAnni: number|null, eta: number|null, regolaApplicata: string|null }}
 */
function calcolaScadenzaMedico({ dataVisita, dataNascita, categoria = "B" }) {
  const visita = parseDate(dataVisita);
  const nascita = parseDate(dataNascita);
  if (!visita || !nascita) {
    return { dataScadenza: null, durataAnni: null, eta: null, regolaApplicata: null };
  }

  const eta = etaAllaData(nascita, visita);
  if (eta === null || eta < 0 || eta > 120) {
    return { dataScadenza: null, durataAnni: null, eta, regolaApplicata: "eta_invalida" };
  }

  const pesante = isCategoriaPesante(categoria);
  let durataAnni;
  let regola;

  if (pesante) {
    if (eta < 65) { durataAnni = 5; regola = "pesante_<65"; }
    else          { durataAnni = 2; regola = "pesante_>=65"; }
  } else {
    if (eta < 50)      { durataAnni = 10; regola = "leggera_<50"; }
    else if (eta < 70) { durataAnni = 5;  regola = "leggera_50-70"; }
    else if (eta < 80) { durataAnni = 3;  regola = "leggera_70-80"; }
    else               { durataAnni = 2;  regola = "leggera_>=80"; }
  }

  const scadenza = addAnni(visita, durataAnni);
  return {
    dataScadenza: toISODate(scadenza),
    durataAnni,
    eta,
    regolaApplicata: regola,
  };
}

module.exports = {
  calcolaScadenzaMedico,
  etaAllaData,
  addAnni,
  parseDate,
  toISODate,
  normalizzaCategoria,
  isCategoriaPesante,
  CATEGORIE_PESANTI,
};

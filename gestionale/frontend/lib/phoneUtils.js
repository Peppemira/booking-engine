/**
 * Normalizza un numero di telefono italiano a formato canonico (solo cifre, prefisso 39).
 *
 * Esempi:
 *   "+39 333 1234567"      → "393331234567"
 *   "00 39 333 1234567"    → "393331234567"
 *   "333 1234567"          → "393331234567"   (mobile italiano senza prefisso)
 *   "0941 123456"          → "0941123456"     (fisso italiano senza prefisso → no prepend)
 *   "abc"                  → null
 *   ""                     → null
 *
 * @param {string} raw — input grezzo da utente
 * @returns {string|null} formato canonico (10-15 cifre) o null se invalido
 */
export function cleanPhone(raw) {
  let s = String(raw || "").replace(/[\s\-\.\(\)]/g, "");
  if (!s) return null;
  if (s.startsWith("+")) s = s.slice(1);
  else if (s.startsWith("00")) s = s.slice(2);
  else if (/^3\d{8,9}$/.test(s)) s = "39" + s; // mobile IT bare
  return /^\d{10,15}$/.test(s) ? s : null;
}

/**
 * Validatore email base (regex semplice non-RFC ma sufficiente per UX).
 */
export function isValidEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

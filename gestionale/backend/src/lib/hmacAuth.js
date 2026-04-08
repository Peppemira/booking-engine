/**
 * HMAC authentication for GeCA-style file API (equivalent to GeCA HmacAuth).
 * Computes request signature: method, path, db, timestamp, nonce → HMAC-SHA256 → Base64.
 */

const crypto = require("crypto");

/**
 * Compute HMAC signature for a request.
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} path - Path only (e.g. /gecaWeb/files/key)
 * @param {string} db - Database/tenant identifier
 * @param {number} tsUnixSeconds - Unix timestamp in seconds
 * @param {string} nonce - Unique nonce (e.g. GUID without dashes)
 * @param {string} secretNewKey - Secret key
 * @param {string} secretSalt - Salt
 * @returns {string} Base64-encoded HMAC-SHA256 signature
 */
function computeHmacSignature(method, path, db, tsUnixSeconds, nonce, secretNewKey, secretSalt) {
  if (!method || !String(method).trim()) throw new Error("method required");
  if (!path || !String(path).trim()) throw new Error("path required");
  if (!db || !String(db).trim()) throw new Error("db required");
  if (!nonce || !String(nonce).trim()) throw new Error("nonce required");
  if (secretNewKey == null || secretNewKey === "") throw new Error("secretNewKey required");
  if (secretSalt == null || secretSalt === "") throw new Error("secretSalt required");

  const methodUpper = String(method).trim().toUpperCase();
  let pathNorm = String(path).trim();
  if (!pathNorm.startsWith("/")) pathNorm = "/" + pathNorm;
  const tsStr = String(tsUnixSeconds);

  const payload = [methodUpper, pathNorm, db, tsStr, nonce].join("\n");

  const keyMaterial = secretNewKey + ":" + secretSalt;
  const keyHash = crypto.createHash("sha256").update(keyMaterial, "utf8").digest();
  const sig = crypto.createHmac("sha256", keyHash).update(payload, "utf8").digest("base64");

  return sig;
}

/**
 * @returns {number} Current Unix time in seconds (UTC)
 */
function getUnixTimeSeconds() {
  return Math.floor(Date.now() / 1000);
}

/**
 * @returns {string} New nonce (32-char hex, GUID-like without dashes)
 */
function newNonce() {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Build path for file API: basePrefix + encoded key segments.
 * @param {string} basePrefix - e.g. "/gecaWeb/files"
 * @param {string} key - File key (may contain slashes; segments are encoded)
 * @returns {string} Full path (e.g. /gecaWeb/files/segment1/segment2)
 */
function buildPathOnly(basePrefix, key) {
  if (!basePrefix || !String(basePrefix).trim()) throw new Error("basePrefix required");
  if (!key || !String(key).trim()) throw new Error("key required");

  let keyNorm = String(key)
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  while (keyNorm.includes("//")) keyNorm = keyNorm.replace(/\/\//g, "/");
  if (!keyNorm.length) throw new Error("Key vuota dopo normalizzazione.");

  const segments = keyNorm.split("/");
  const encoded = segments.map((seg) => {
    if (!seg || !seg.trim()) throw new Error("Key contiene segmenti vuoti.");
    if (seg === "." || seg === "..") throw new Error("Key contiene segmenti non consentiti (.) o (..).");
    if (/[\x00-\x1f]/.test(seg)) throw new Error("Key contiene caratteri di controllo.");
    return encodeURIComponent(seg);
  });

  let prefix = String(basePrefix).trim();
  if (!prefix.startsWith("/")) prefix = "/" + prefix;
  prefix = prefix.replace(/\/+$/, "");
  return prefix + "/" + encoded.join("/");
}

module.exports = {
  computeHmacSignature,
  getUnixTimeSeconds,
  newNonce,
  buildPathOnly,
};

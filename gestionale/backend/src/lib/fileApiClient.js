/**
 * Signed file API client (equivalent to GeCA ApiFileClient).
 * Uses HMAC auth for download, upload, delete, presigned URL.
 */

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { computeHmacSignature, getUnixTimeSeconds, newNonce, buildPathOnly } = require("./hmacAuth");

const FILES_PREFIX = "/gecaWeb/files";
const FILES_URL_PREFIX = "/gecaWeb/files-url/";

function createSignedRequestConfig(method, baseUrl, pathOnly, db, secretNewKey, secretSalt) {
  const ts = getUnixTimeSeconds();
  const nonce = newNonce();
  let pathNorm = String(pathOnly).trim();
  if (!pathNorm.startsWith("/")) pathNorm = "/" + pathNorm;
  const sig = computeHmacSignature(method, pathNorm, db, ts, nonce, secretNewKey, secretSalt);
  const url = (baseUrl.replace(/\/+$/, "") + pathNorm);

  return {
    url,
    method,
    headers: {
      "x-db": db,
      "x-ts": String(ts),
      "x-nonce": nonce,
      "x-sig": sig,
    },
  };
}

/**
 * Download file to local path.
 * @param {object} client - Axios instance (or axios)
 * @param {string} baseUrl - API base URL
 * @param {string} key - File key
 * @param {string} db - DB/tenant
 * @param {string} secretNewKey
 * @param {string} secretSalt
 * @param {string} saveFilePath - Local path to write
 */
async function downloadFileAsync(client, baseUrl, key, db, secretNewKey, secretSalt, saveFilePath) {
  if (!saveFilePath || !String(saveFilePath).trim()) throw new Error("saveFilePath required");
  const pathOnly = buildPathOnly(FILES_PREFIX, key);
  const config = createSignedRequestConfig("GET", baseUrl, pathOnly, db, secretNewKey, secretSalt);
  config.responseType = "stream";

  const req = client.request ? client.request.bind(client) : axios;
  const resp = await req(config);
  if (resp.status !== 200 && !resp.data) {
    const text = resp.data && typeof resp.data.read === "function" ? await streamToString(resp.data) : String(resp.data);
    throw new Error(`Download fallito: ${resp.status} ${resp.statusText} - ${text}`);
  }

  const writer = fs.createWriteStream(saveFilePath);
  await new Promise((resolve, reject) => {
    resp.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
    resp.data.on("error", reject);
  });
}

function streamToString(stream) {
  const chunks = [];
  return new Promise((resolve, reject) => {
    stream.on("data", (ch) => chunks.push(ch));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

/**
 * Get presigned URL for a file key.
 * @returns {Promise<{ ok: boolean, key?: string, url?: string, expiresIn?: number, error?: string }>}
 */
async function getPresignedUrlAsync(client, baseUrl, key, db, secretNewKey, secretSalt) {
  const pathOnly = buildPathOnly(FILES_URL_PREFIX, key);
  const config = createSignedRequestConfig("GET", baseUrl, pathOnly, db, secretNewKey, secretSalt);

  const req = client.request ? client.request.bind(client) : axios;
  const resp = await req(config);
  const text = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
  if (resp.status !== 200) {
    throw new Error(`Presign fallito: ${resp.status} ${resp.statusText} - ${text}`);
  }
  const body = typeof resp.data === "object" ? resp.data : JSON.parse(text);
  if (!body) throw new Error("Risposta presign non valida (JSON vuoto).");
  return body;
}

/**
 * Delete file by key.
 */
async function deleteFileAsync(client, baseUrl, key, db, secretNewKey, secretSalt) {
  const pathOnly = buildPathOnly(FILES_PREFIX, key);
  const config = createSignedRequestConfig("DELETE", baseUrl, pathOnly, db, secretNewKey, secretSalt);

  const req = client.request ? client.request.bind(client) : axios;
  const resp = await req(config);
  if (resp.status < 200 || resp.status >= 300) {
    const text = resp.data != null ? (typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data)) : "";
    throw new Error(`Delete fallito: ${resp.status} ${resp.statusText} - ${text}`);
  }
}

/**
 * Upload file. Uses multipart/form-data with field name "file".
 * Requires form-data package for stream upload or passes buffer.
 */
async function uploadFileAsync(client, baseUrl, key, db, secretNewKey, secretSalt, localFilePath, mimeType) {
  if (!localFilePath || !String(localFilePath).trim()) throw new Error("localFilePath required");
  if (!fs.existsSync(localFilePath)) throw new Error(`File non trovato: ${localFilePath}`);
  if (!mimeType || !String(mimeType).trim()) throw new Error("mimeType required");

  const pathOnly = buildPathOnly(FILES_PREFIX, key);
  const config = createSignedRequestConfig("POST", baseUrl, pathOnly, db, secretNewKey, secretSalt);

  let FormData;
  try {
    FormData = require("form-data");
  } catch {
    throw new Error("form-data package required for uploadFileAsync. Run: npm install form-data");
  }

  const form = new FormData();
  const fileName = path.basename(localFilePath);
  form.append("file", fs.createReadStream(localFilePath), {
    filename: fileName,
    contentType: mimeType,
  });
  config.data = form;
  config.headers = { ...config.headers, ...form.getHeaders() };

  const req = client.request ? client.request.bind(client) : axios;
  const resp = await req(config);
  const text = resp.data != null ? (typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data)) : "";
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`Upload fallito: ${resp.status} ${resp.statusText} - ${text}`);
  }
  return text;
}

module.exports = {
  createSignedRequestConfig,
  downloadFileAsync,
  getPresignedUrlAsync,
  deleteFileAsync,
  uploadFileAsync,
  FILES_PREFIX,
  FILES_URL_PREFIX,
};

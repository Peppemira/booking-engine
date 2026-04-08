/**
 * GeCA-style file API wrapper (equivalent to GeCA GecaWebFileApi / GecaWebServices).
 * Init with baseUrl, db, secretNewKey, secretSalt; then download, upload, delete, presign.
 */

const axios = require("axios");
const {
  downloadFileAsync,
  getPresignedUrlAsync,
  deleteFileAsync,
  uploadFileAsync,
} = require("./fileApiClient");

const DEFAULT_TIMEOUT_MS = 60000;

class GecaWebFileApi {
  /**
   * @param {object} httpClient - Axios instance (optional; default created with timeout)
   * @param {string} baseUrl - Base URL of the file API
   * @param {string} db - Database/tenant identifier
   * @param {string} secretNewKey - Secret key for HMAC
   * @param {string} secretSalt - Salt for HMAC
   */
  constructor(httpClient, baseUrl, db, secretNewKey, secretSalt) {
    this._http = httpClient || axios.create({ timeout: DEFAULT_TIMEOUT_MS });
    this._baseUrl = baseUrl;
    this._db = db;
    this._secretNewKey = secretNewKey;
    this._secretSalt = secretSalt;
  }

  async downloadAsync(key, savePath) {
    return downloadFileAsync(
      this._http,
      this._baseUrl,
      key,
      this._db,
      this._secretNewKey,
      this._secretSalt,
      savePath
    );
  }

  async deleteAsync(key) {
    return deleteFileAsync(
      this._http,
      this._baseUrl,
      key,
      this._db,
      this._secretNewKey,
      this._secretSalt
    );
  }

  async presignAsync(key) {
    return getPresignedUrlAsync(
      this._http,
      this._baseUrl,
      key,
      this._db,
      this._secretNewKey,
      this._secretSalt
    );
  }

  async uploadAsync(key, localFilePath, mimeType) {
    return uploadFileAsync(
      this._http,
      this._baseUrl,
      key,
      this._db,
      this._secretNewKey,
      this._secretSalt,
      localFilePath,
      mimeType
    );
  }
}

let _fileApiInstance = null;

/**
 * Init global GeCA file API (equivalent to GecaWebServices.Init).
 * @param {string} baseUrl
 * @param {string} db
 * @param {string} secretNewKey
 * @param {string} secretSalt
 * @param {object} [httpClient] - Optional axios instance
 */
function init(baseUrl, db, secretNewKey, secretSalt, httpClient) {
  _fileApiInstance = new GecaWebFileApi(httpClient, baseUrl, db, secretNewKey, secretSalt);
}

/**
 * Get the singleton file API. Throws if not initialized.
 * @returns {GecaWebFileApi}
 */
function getFileApi() {
  if (!_fileApiInstance) {
    throw new Error("GecaWebServices non inizializzato. Chiama init() dopo il login.");
  }
  return _fileApiInstance;
}

module.exports = {
  GecaWebFileApi,
  init,
  getFileApi,
};

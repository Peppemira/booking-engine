/**
 * FileApiService - equivalente a GeCA GecaWebFileApi / GecaWebServices.
 * Download, upload, delete, presigned URL con autenticazione HMAC.
 */

const { init, getFileApi, GecaWebFileApi } = require("../lib/gecaWebFileApi");

class FileApiService {
  /**
   * @param {object} [options] - { baseUrl, db, secretNewKey, secretSalt, httpClient }
   */
  constructor(options = {}) {
    this._baseUrl = options.baseUrl || process.env.GECA_FILE_BASE_URL || "";
    this._db = options.db || process.env.GECA_DB || "";
    this._secretNewKey = options.secretNewKey || process.env.GECA_SECRET_KEY || "";
    this._secretSalt = options.secretSalt || process.env.GECA_SECRET_SALT || "";
    this._httpClient = options.httpClient || null;
    this._instance = null;
  }

  /**
   * Inizializza il singleton globale (equivalente a GecaWebServices.Init).
   */
  init() {
    init(this._baseUrl, this._db, this._secretNewKey, this._secretSalt, this._httpClient);
    this._instance = getFileApi();
    return this._instance;
  }

  /**
   * Restituisce l'istanza file API (inizializza se config presente).
   * @returns {import("../lib/gecaWebFileApi").GecaWebFileApi}
   */
  getApi() {
    if (this._instance) return this._instance;
    if (this._baseUrl && this._db) {
      this.init();
      return this._instance;
    }
    try {
      return getFileApi();
    } catch (e) {
      throw new Error("FileApiService non inizializzato. Chiama init() o passa baseUrl/db/secretNewKey/secretSalt al costruttore.");
    }
  }

  async download(key, savePath) {
    const api = this.getApi();
    return api.downloadAsync(key, savePath);
  }

  async upload(key, localFilePath, mimeType) {
    const api = this.getApi();
    return api.uploadAsync(key, localFilePath, mimeType);
  }

  async delete(key) {
    const api = this.getApi();
    return api.deleteAsync(key);
  }

  async presign(key) {
    const api = this.getApi();
    return api.presignAsync(key);
  }
}

module.exports = {
  FileApiService,
  initGecaWebFileApi: init,
  getGecaWebFileApi: getFileApi,
  GecaWebFileApi,
};

/**
 * JsonApiService - equivalente a GeCA JsonPost.
 * Client generico per API JSON (POST/GET).
 */

const { JsonApiClient } = require("../lib/jsonApiClient");

class JsonApiService {
  /**
   * @param {string} [baseUrl] - Base URL per le richieste
   */
  constructor(baseUrl = "") {
    this._client = new JsonApiClient(baseUrl);
  }

  /**
   * POST body JSON.
   * @param {string} pathOrUrl - Path o URL completo
   * @param {object} data - Oggetto da inviare come JSON
   * @param {string} [method='POST']
   * @returns {Promise<object|string>}
   */
  async postData(pathOrUrl, data, method = "POST") {
    return this._client.postData(pathOrUrl, data, method);
  }

  /**
   * GET con eventuale query string.
   * @param {string} pathOrUrl
   * @param {string} [queryString] - es. "apiKey=xxx"
   * @returns {Promise<object|string>}
   */
  async get(pathOrUrl, queryString = "") {
    return this._client.get(pathOrUrl, queryString);
  }

  /** Restituisce il client sottostante per uso avanzato */
  getClient() {
    return this._client;
  }
}

module.exports = {
  JsonApiService,
  JsonApiClient,
};

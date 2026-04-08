/**
 * Generic JSON API client (equivalent to GeCA JsonPost).
 * POST/GET with JSON body or query params.
 */

const axios = require("axios");

class JsonApiClient {
  /**
   * @param {string} [baseUrl] - Base URL for requests (optional if you pass full URLs to methods)
   */
  constructor(baseUrl = "") {
    this.baseUrl = String(baseUrl || "").replace(/\/+$/, "");
  }

  /**
   * POST JSON body and return parsed response (or raw text).
   * @param {string} pathOrUrl - Path (appended to baseUrl) or full URL
   * @param {object|Record<string,string>} data - Object to send as JSON
   * @param {string} [method='POST'] - HTTP method
   * @returns {Promise<string|object>} Response body (parsed as JSON if possible)
   */
  async postData(pathOrUrl, data, method = "POST") {
    const url = this._resolveUrl(pathOrUrl);
    try {
      const response = await axios({
        method,
        url,
        data,
        headers: { "Content-Type": "application/json" },
        timeout: 30000,
        validateStatus: () => true,
      });
      const text = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
      }
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } catch (err) {
      const message = err.response
        ? `HTTP ${err.response.status}: ${String(err.response.data || err.message).slice(0, 500)}`
        : err.message;
      throw new Error(`Errore durante l'invio della richiesta: ${message}`);
    }
  }

  /**
   * GET request; optional query string or apiKey.
   * @param {string} pathOrUrl - Path or full URL
   * @param {string} [queryString] - e.g. "apiKey=xxx" or "?key=val"
   * @returns {Promise<string|object>}
   */
  async get(pathOrUrl, queryString = "") {
    let url = this._resolveUrl(pathOrUrl);
    if (queryString) {
      url += url.includes("?") ? "&" : "?";
      url += queryString.replace(/^\?/, "");
    }
    try {
      const response = await axios.get(url, { timeout: 30000, validateStatus: () => true });
      const text = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
      }
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } catch (err) {
      const message = err.response
        ? `HTTP ${err.response.status}: ${String(err.response.data || err.message).slice(0, 500)}`
        : err.message;
      throw new Error(`Errore durante la richiesta: ${message}`);
    }
  }

  _resolveUrl(pathOrUrl) {
    const s = String(pathOrUrl || "").trim();
    if (s.startsWith("http://") || s.startsWith("https://")) return s;
    const base = this.baseUrl || "";
    return base ? `${base}/${s.replace(/^\//, "")}` : s;
  }
}

module.exports = { JsonApiClient };

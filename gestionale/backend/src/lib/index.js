/**
 * Lib modules (equivalents to GeCA web/API utilities).
 * - hmacAuth: HMAC signature for file API
 * - fileApiClient: signed download/upload/delete/presign
 * - gecaWebFileApi: GecaWebFileApi + init/getFileApi
 * - jsonApiClient: generic JSON API client (JsonPost)
 */

const hmacAuth = require("./hmacAuth");
const fileApiClient = require("./fileApiClient");
const gecaWebFileApi = require("./gecaWebFileApi");
const { JsonApiClient } = require("./jsonApiClient");

module.exports = {
  ...hmacAuth,
  ...fileApiClient,
  initGecaWebFileApi: gecaWebFileApi.init,
  getGecaWebFileApi: gecaWebFileApi.getFileApi,
  GecaWebFileApi: gecaWebFileApi.GecaWebFileApi,
  JsonApiClient,
};

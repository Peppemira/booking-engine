// mediaApi.js
// API per media (foto/firma)
const { callEndpoint, portalMap } = require('./portalApiClient');

function getMedia(payload) {
  const endpoint = portalMap.endpoints.media;
  return callEndpoint(endpoint, payload);
}

module.exports = { getMedia };

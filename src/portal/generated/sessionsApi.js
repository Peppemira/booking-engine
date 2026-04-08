// sessionsApi.js
// API per sessioni
const { callEndpoint, portalMap } = require('./portalApiClient');

function getSessions(payload) {
  const endpoint = portalMap.endpoints.sessions;
  return callEndpoint(endpoint, payload);
}

module.exports = { getSessions };

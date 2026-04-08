// candidatesApi.js
// API per candidati
const { callEndpoint, portalMap } = require('./portalApiClient');

function getCandidates(payload) {
  const endpoint = portalMap.endpoints.candidates;
  return callEndpoint(endpoint, payload);
}

module.exports = { getCandidates };

// examsApi.js
// API per esami
const { callEndpoint, portalMap } = require('./portalApiClient');

function getExams(payload) {
  const endpoint = portalMap.endpoints.exams;
  return callEndpoint(endpoint, payload);
}

module.exports = { getExams };

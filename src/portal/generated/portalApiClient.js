// portalApiClient.js
// Generatore automatico client API portale
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

const portalMap = fs.readJsonSync(path.join(__dirname, '../../..', 'portalDump', 'portalMap.json'));

function callEndpoint(endpoint, payload) {
  return axios.post(endpoint, payload);
}

module.exports = { callEndpoint, portalMap };

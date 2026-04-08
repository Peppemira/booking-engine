// portalSyncJob.js
// Job automatico per sincronizzazione portale
const { syncCandidates } = require('./syncCandidates');
const { syncSessions } = require('./syncSessions');
const { syncResults } = require('./syncResults');

async function runPortalSyncJob() {
  await Promise.all([
    syncCandidates(),
    syncSessions(),
    syncResults()
  ]);
}

module.exports = { runPortalSyncJob };

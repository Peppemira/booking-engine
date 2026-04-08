// portalRecorder.js
// Registra sequenze di richieste e risposte
const fs = require('fs-extra');
const path = require('path');

function recordWorkflow(workflow) {
  const dumpDir = path.join(__dirname, '../../..', 'portalDump', 'workflow');
  fs.outputFileSync(path.join(dumpDir, `${Date.now()}_workflow.json`), JSON.stringify(workflow, null, 2));
}

module.exports = { recordWorkflow };

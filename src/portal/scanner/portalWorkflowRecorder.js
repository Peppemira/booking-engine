// portalWorkflowRecorder.js
// Records workflow of API calls

const fs = require('fs-extra');
const path = require('path');

module.exports = async function portalWorkflowRecorder(dumpRoot) {
  console.log('Saving workflow...');
  await fs.ensureDir(path.join(dumpRoot, 'workflow'));

  // Read API request files
  const apiFiles = await fs.readdir(path.join(dumpRoot, 'api'));
  const workflow = [];
  for (const file of apiFiles) {
    try {
      const req = await fs.readJson(path.join(dumpRoot, 'api', file));
      workflow.push({
        url: req.url,
        method: req.method,
        payload: req.payload
      });
    } catch (err) {
      console.error('Error reading API file:', file, err);
    }
  }
  await fs.writeJson(path.join(dumpRoot, 'workflow', 'workflow.json'), workflow, { spaces: 2 });
};

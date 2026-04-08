// portalRequestRecorder.js
// Intercepts and records all HTTP requests

const fs = require('fs-extra');
const path = require('path');

module.exports = async function portalRequestRecorder(page, dumpRoot) {
  console.log('Recording API requests...');
  await fs.ensureDir(path.join(dumpRoot, 'api'));

  page.on('request', async (request) => {
    try {
      const data = {
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        payload: request.postData() || null
      };
      const fileName = `${Date.now()}_${request.method()}_${encodeURIComponent(request.url())}.json`;
      await fs.writeJson(path.join(dumpRoot, 'api', fileName), data, { spaces: 2 });
      console.log(`Recording API: ${request.method()} ${request.url()}`);
    } catch (err) {
      console.error('Error recording request:', err);
    }
  });
};

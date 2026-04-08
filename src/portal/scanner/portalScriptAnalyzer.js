// portalScriptAnalyzer.js
// Analyzes JS scripts in portal pages

const fs = require('fs-extra');
const path = require('path');
const cheerio = require('cheerio');
const axios = require('axios');

module.exports = async function portalScriptAnalyzer(pages, dumpRoot) {
  console.log('Analyzing scripts...');
  await fs.ensureDir(path.join(dumpRoot, 'scripts'));

  const endpoints = [];

  for (const page of pages) {
    try {
      const html = await fs.readFile(path.join(dumpRoot, 'pages', page.fileName), 'utf8');
      const $ = cheerio.load(html);
      const scripts = [];
      $('script[src]').each((_, script) => {
        const src = $(script).attr('src');
        scripts.push(src);
      });
      for (const src of scripts) {
        try {
          const res = await axios.get(src);
          const code = res.data;
          const found = code.match(/\/[A-Za-z_]+\.action/g);
          if (found) {
            endpoints.push(...found);
          }
          const fileName = `${page.fileName.replace('.html', '')}_${encodeURIComponent(src)}.js`;
          await fs.writeFile(path.join(dumpRoot, 'scripts', fileName), code);
          console.log(`Analyzing script: ${src}`);
        } catch (err) {
          console.error('Error downloading script:', src, err);
        }
      }
    } catch (err) {
      console.error('Error analyzing scripts:', page.url, err);
    }
  }
  // Save endpoints
  await fs.writeJson(path.join(dumpRoot, 'scripts', 'endpoints.json'), endpoints, { spaces: 2 });
};

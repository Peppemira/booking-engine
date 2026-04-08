// portalScriptScanner.js
// Scarica e analizza script JS del portale
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs-extra');
const path = require('path');

async function scanScripts(html) {
  const $ = cheerio.load(html);
  const scripts = [];
  $('script[src]').each((_, el) => {
    const src = $(el).attr('src');
    scripts.push(src);
  });
  // Scarica e salva script
  for (const src of scripts) {
    try {
      const res = await axios.get(src);
      await fs.outputFile(path.join(__dirname, '../../..', 'portalDump', 'scripts', path.basename(src)), res.data);
    } catch {}
  }
  // Cerca endpoint .action
  // TODO: implementa ricerca automatica endpoint
}

module.exports = { scanScripts };

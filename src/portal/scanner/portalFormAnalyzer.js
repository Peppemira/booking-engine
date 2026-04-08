// portalFormAnalyzer.js
// Analyzes HTML forms in portal pages

const fs = require('fs-extra');
const path = require('path');
const cheerio = require('cheerio');

module.exports = async function portalFormAnalyzer(pages, dumpRoot) {
  console.log('Analyzing forms...');
  await fs.ensureDir(path.join(dumpRoot, 'forms'));

  for (const page of pages) {
    try {
      const html = await fs.readFile(path.join(dumpRoot, 'pages', page.fileName), 'utf8');
      const $ = cheerio.load(html);
      const forms = [];
      $('form').each((_, form) => {
        const action = $(form).attr('action') || '';
        const method = $(form).attr('method') || 'GET';
        const inputs = [];
        $(form).find('input, select').each((_, el) => {
          inputs.push({
            tag: el.tagName,
            name: $(el).attr('name'),
            type: $(el).attr('type') || '',
            value: $(el).attr('value') || '',
            options: el.tagName === 'select' ? $(el).find('option').map((i, opt) => $(opt).attr('value')).get() : []
          });
        });
        forms.push({ action, method, inputs });
      });
      const fileName = `${page.fileName.replace('.html', '')}_forms.json`;
      await fs.writeJson(path.join(dumpRoot, 'forms', fileName), forms, { spaces: 2 });
      console.log(`Analyzing forms in: ${page.url}`);
    } catch (err) {
      console.error('Error analyzing forms:', page.url, err);
    }
  }
};

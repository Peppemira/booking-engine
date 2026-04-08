// portalAnalyzer.js
// Analizza pagine, form, endpoint e workflow
const cheerio = require('cheerio');
const fs = require('fs-extra');
const path = require('path');

function analyzePage(html) {
  const $ = cheerio.load(html);
  const forms = [];
  $('form').each((_, el) => {
    const action = $(el).attr('action');
    const method = $(el).attr('method') || 'GET';
    const inputs = [];
    $(el).find('input,select,textarea').each((_, input) => {
      inputs.push({
        name: $(input).attr('name'),
        type: $(input).attr('type') || input.tagName,
        value: $(input).val() || ''
      });
    });
    forms.push({ action, method, inputs });
  });
  return forms;
}

function saveForms(forms) {
  const dumpDir = path.join(__dirname, '../../..', 'portalDump', 'forms');
  fs.outputFileSync(path.join(dumpDir, `${Date.now()}_forms.json`), JSON.stringify(forms, null, 2));
}

module.exports = { analyzePage, saveForms };

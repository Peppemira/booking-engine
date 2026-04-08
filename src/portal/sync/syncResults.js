// syncResults.js
// Sincronizza risultati esami con Supabase
const { getExams } = require('../generated/examsApi');
const supabase = require('../../database/supabase');

async function syncResults() {
  const results = await getExams({});
  for (const result of results.data) {
    await supabase.from('results').upsert(result);
  }
}

module.exports = { syncResults };

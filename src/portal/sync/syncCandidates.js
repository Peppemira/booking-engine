// syncCandidates.js
// Sincronizza candidati con Supabase
const { getCandidates } = require('../generated/candidatesApi');
const supabase = require('../../database/supabase');

async function syncCandidates() {
  const candidates = await getCandidates({});
  for (const candidate of candidates.data) {
    await supabase.from('candidates').upsert(candidate);
  }
}

module.exports = { syncCandidates };

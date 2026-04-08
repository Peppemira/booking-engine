// syncSessions.js
// Sincronizza sessioni con Supabase
const { getSessions } = require('../generated/sessionsApi');
const supabase = require('../../database/supabase');

async function syncSessions() {
  const sessions = await getSessions({});
  for (const session of sessions.data) {
    await supabase.from('sessions').upsert(session);
  }
}

module.exports = { syncSessions };

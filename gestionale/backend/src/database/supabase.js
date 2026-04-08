require("dotenv").config({ quiet: true });
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Variabili Supabase mancanti nel file .env");
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
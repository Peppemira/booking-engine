require("dotenv").config({ quiet: true });
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

async function checkDB() {
  console.log("Verificando database...");
  
  const { data, error } = await supabase.from("waitlist").select("*");
  
  if (error) {
    console.error("Errore Supabase:", error);
  } else {
    console.log("Candidati trovati:", data.length);
    console.log(JSON.stringify(data, null, 2));
  }
  
  process.exit();
}

checkDB();

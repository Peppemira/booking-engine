require("dotenv").config({ quiet: true });

const { supabase } = require("./database/supabase");

async function test() {
  try {
    console.log("Test connessione Supabase...");

    const { data, error } = await supabase
      .from("candidates")
      .select("*")
      .limit(1);

    if (error) {
      console.error("Errore Supabase:", error.message);
    } else {
      console.log("Connessione OK ✅");
      console.log("Risultato:", data);
    }

  } catch (err) {
    console.error("Errore generale:", err.message);
  }
}

test();
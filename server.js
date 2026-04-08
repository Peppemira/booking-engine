require('dotenv').config()

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
)

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Questo è un server minimo. Per login/registrazione/radar completo usa il backend:
// cd gestionale/backend && npm start  (porta 3000)
app.post("/api/auth/register", (req, res) => {
  res.status(503).json({
    success: false,
    error: "Backend completo non attivo. In un terminale: cd gestionale/backend && npm start (porta 3000), poi riprova.",
  });
});
app.post("/api/auth/login", (req, res) => {
  res.status(503).json({
    success: false,
    error: "Backend completo non attivo. In un terminale: cd gestionale/backend && npm start (porta 3000), poi riprova.",
  });
});

app.get("/", (req, res) => {
  res.json({
    status: "booking-engine running",
    message: "Backend gestionale autoscuola attivo"
  });
});

app.get("/api", (req, res) => {
  res.json({
    api: "working"
  });
});

const PORT = 4000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
app.get("/api/radar/dashboard", async (req, res) => {

    try {
  
      const { data: queue } = await supabase
        .from("waitlist")
        .select("*")
  
      const { data: pren } = await supabase
        .from("prenotazioni")
        .select("*")
  
      res.json({
        seduteDisponibili: 0,
        postiLiberi: 0,
        inCoda: queue ? queue.length : 0,
        prenotazioniOggi: pren ? pren.length : 0
      })
  
    } catch (err) {
  
      res.status(500).json({
        error: err.message
      })
  
    }
  
  })
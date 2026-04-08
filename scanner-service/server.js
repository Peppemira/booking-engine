const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5001;
const SCANS_DIR = path.join(__dirname, "scans");

if (!fs.existsSync(SCANS_DIR)) {
  fs.mkdirSync(SCANS_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: "20mb" }));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, SCANS_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname) || ".bin"}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) return cb(null, true);
    cb(new Error("Solo file immagine consentiti"));
  },
});

/** Health check: il gestionale verifica se il servizio scanner è attivo */
app.get("/ping", (req, res) => {
  res.json({ status: "scanner service online" });
});

/**
 * Acquisizione immagine (foto o firma).
 * Il client invia il file; il servizio lo salva e restituisce dataUrl per anteprima immediata.
 * Flusso GeCA: Scanner → acquisizione → anteprima → salva nel gestionale.
 */
app.post("/scan", upload.single("image"), (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "Nessun file ricevuto" });
  }
  let dataUrl = null;
  try {
    const buf = fs.readFileSync(file.path);
    const base64 = buf.toString("base64");
    const mime = file.mimetype || "image/jpeg";
    dataUrl = `data:${mime};base64,${base64}`;
  } catch (err) {
    return res.status(500).json({ error: "Errore lettura file", message: err.message });
  }
  res.json({
    status: "ok",
    file: file.filename,
    path: file.path,
    dataUrl,
  });
});

/** Opzionale: recupero immagine per ID (per uso futuro) */
app.get("/scans/:filename", (req, res) => {
  const filePath = path.join(SCANS_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: "Errore upload", message: err.message });
  }
  res.status(500).json({ error: err.message || "Errore server" });
});

app.listen(PORT, () => {
  console.log(`Scanner service attivo su http://localhost:${PORT}`);
});

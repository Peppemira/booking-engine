#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  BLUEFOX S.R.L. — Gestionale Autoscuola — Launcher Linux/macOS
# ─────────────────────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
ENV_FILE="$BACKEND_DIR/.env"

# ─── Colori ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo ""
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║   BLUEFOX S.R.L. — Gestionale Autoscuola ║"
echo "  ╚═══════════════════════════════════════════╝"
echo ""

# ─── Verifica .env ────────────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  echo -e "${RED}[ERRORE] File .env non trovato: $ENV_FILE${NC}"
  echo "  Crea il file con le credenziali portale prima di avviare."
  exit 1
fi

# Controlla se PORTAL_USERNAME è impostato
PORTAL_USER=$(grep -E "^PORTAL_USERNAME=" "$ENV_FILE" | cut -d= -f2 | tr -d '[:space:]')
if [ -z "$PORTAL_USER" ]; then
  echo -e "${YELLOW}[AVVISO] PORTAL_USERNAME non configurato nel .env${NC}"
  echo "  Il portale non sarà accessibile finché non inserisci le credenziali."
  echo "  Modifica: $ENV_FILE"
  echo ""
fi

# ─── Verifica Node.js ─────────────────────────────────────────────────────────
if ! command -v node &> /dev/null; then
  echo -e "${RED}[ERRORE] Node.js non trovato. Scaricalo da https://nodejs.org${NC}"
  exit 1
fi
echo -e "${GREEN}[OK] Node.js $(node --version) trovato${NC}"

# ─── Installa dipendenze se mancanti ──────────────────────────────────────────
if [ ! -d "$BACKEND_DIR/node_modules" ]; then
  echo "[INFO] Installazione dipendenze backend..."
  (cd "$BACKEND_DIR" && npm install)
fi

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "[INFO] Installazione dipendenze frontend..."
  (cd "$FRONTEND_DIR" && npm install)
fi

# ─── Funzione cleanup (Ctrl+C) ────────────────────────────────────────────────
cleanup() {
  echo ""
  echo "  Arresto gestionale..."
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  echo "  Server fermati. Arrivederci!"
  exit 0
}
trap cleanup SIGINT SIGTERM

# ─── Avvia backend ────────────────────────────────────────────────────────────
echo ""
echo "  Avvio Backend  → http://localhost:3000"
cd "$BACKEND_DIR"
node src/server.js &
BACKEND_PID=$!

sleep 2

# ─── Avvia frontend ──────────────────────────────────────────────────────────
echo "  Avvio Frontend → http://localhost:3001"
cd "$FRONTEND_DIR"
npm run dev &
FRONTEND_PID=$!

sleep 3

# ─── Apri browser (cross-platform) ───────────────────────────────────────────
URL="http://localhost:3001"
if command -v xdg-open &> /dev/null; then
  xdg-open "$URL" &>/dev/null &
elif command -v open &> /dev/null; then
  open "$URL"
fi

echo ""
echo -e "${GREEN}  ✓ Gestionale avviato!${NC}"
echo "  ─────────────────────────────────────────"
echo "  Backend:  http://localhost:3000"
echo "  Frontend: http://localhost:3001"
echo "  ─────────────────────────────────────────"
echo "  Premi Ctrl+C per fermare i server"
echo ""

# ─── Attendi ─────────────────────────────────────────────────────────────────
wait "$BACKEND_PID" "$FRONTEND_PID"

#!/usr/bin/env python3
"""
GECA Intel - Server tutto-in-uno.
Sostituisce completamente AVVIA_AGENT_V2.bat (niente mitmproxy, niente proxy di sistema).

Fa 3 cose in parallelo:
  1. Serve il dashboard su http://localhost:8090  (legge C:\\analisi-geca\\)
  2. Proxy HTTP/HTTPS su porta 8888              (cattura chiamate GeCA → Portale)
  3. Scrive i dati in tempo reale nei file JSON  (letti dalla dashboard)

NON tocca il proxy di sistema Windows.
NON installa certificati.
NON richiede dipendenze esterne.
"""
import socket
import threading
import json
import os
import select
import sys
from datetime import datetime
from urllib.parse import urlparse
from http.server import HTTPServer, SimpleHTTPRequestHandler
import logging

# ── Configurazione ─────────────────────────────────────────────────────────
GECA_BASE   = r"C:\analisi-geca"
GECA_DIR    = os.path.join(GECA_BASE, "catture", "geca")
PORTALE_DIR = os.path.join(GECA_BASE, "catture", "portale")
TUTTO_DIR   = os.path.join(GECA_BASE, "catture", "tutto")

DASHBOARD_PORT = 8090
PROXY_PORT     = 8888

TARGET_KEYWORDS = ["automobilista", "motorizzazione", "mit.gov", "portale"]

# ── Stato globale ──────────────────────────────────────────────────────────
endpoints    = {}
total_calls  = 0
_lock        = threading.Lock()

for d in [GECA_DIR, PORTALE_DIR, TUTTO_DIR]:
    os.makedirs(d, exist_ok=True)


# ══════════════════════════════════════════════════════════════════════════
#  PARTE 1 — Dashboard HTTP server (porta 8090)
# ══════════════════════════════════════════════════════════════════════════

class QuietHandler(SimpleHTTPRequestHandler):
    """Serve i file di C:\\analisi-geca\\ in modo silenzioso."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=GECA_BASE, **kwargs)

    def log_message(self, fmt, *args):
        pass  # nessun log su console

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def start_dashboard():
    try:
        srv = HTTPServer(("", DASHBOARD_PORT), QuietHandler)
        print(f"  ✅  Dashboard:  http://localhost:{DASHBOARD_PORT}/dashboard.html")
        srv.serve_forever()
    except OSError as e:
        print(f"  ⚠️  Dashboard già attivo su :{DASHBOARD_PORT} (va bene lo stesso)")


# ══════════════════════════════════════════════════════════════════════════
#  PARTE 2 — Proxy HTTP/HTTPS (porta 8888)
# ══════════════════════════════════════════════════════════════════════════

def is_target(host: str) -> bool:
    h = host.lower()
    return any(k in h for k in TARGET_KEYWORDS)


def save_json():
    try:
        ep_text = json.dumps(endpoints, indent=2, ensure_ascii=False)
        for d in [GECA_DIR, PORTALE_DIR]:
            with open(os.path.join(d, "endpoint_map.json"), "w", encoding="utf-8") as f:
                f.write(ep_text)
        stats = {
            "geca":    {"chiamate": total_calls, "tipo": "HTTP/HTTPS"},
            "portale": {"chiamate": total_calls},
        }
        with open(os.path.join(TUTTO_DIR, "stats.json"), "w", encoding="utf-8") as f:
            json.dump(stats, f, indent=2, ensure_ascii=False)
    except Exception as ex:
        pass


def record(method, host, path, proto="HTTP"):
    global total_calls
    with _lock:
        key = f"{method} {path}"
        if key not in endpoints:
            endpoints[key] = {"method": method, "host": host, "path": path,
                              "calls": 0, "proto": proto, "esempi": []}
        endpoints[key]["calls"] += 1
        total_calls += 1
        ts = datetime.now().strftime("%H:%M:%S")
        print(f"  [{ts}] 📡 #{total_calls:03d}  {proto:5s}  {method:7s}  {host}{path}")
        save_json()


def relay(src, dst):
    try:
        while True:
            r, _, _ = select.select([src], [], [], 30)
            if not r:
                break
            d = src.recv(8192)
            if not d:
                break
            dst.sendall(d)
    except Exception:
        pass


def handle_connect(conn, target):
    """Tunnel HTTPS — vediamo host:porta, traffico cifrato inoltrato."""
    parts = target.rsplit(":", 1)
    host  = parts[0]
    port  = int(parts[1]) if len(parts) > 1 else 443

    if is_target(host):
        record("CONNECT", host, f"/  [HTTPS:{port}]", "HTTPS")

    conn.sendall(b"HTTP/1.1 200 Connection established\r\n\r\n")

    try:
        remote = socket.create_connection((host, port), timeout=15)
        t1 = threading.Thread(target=relay, args=(conn, remote),  daemon=True)
        t2 = threading.Thread(target=relay, args=(remote, conn),  daemon=True)
        t1.start(); t2.start()
        t1.join();  t2.join()
    except Exception:
        pass
    finally:
        try: conn.close()
        except: pass


def handle_http(conn, raw):
    """HTTP in chiaro — vediamo URL completo."""
    try:
        line0  = raw.split(b"\r\n")[0].decode("utf-8", errors="replace")
        parts  = line0.split()
        if len(parts) < 2:
            return
        method, url = parts[0], parts[1]
        parsed = urlparse(url)
        host   = parsed.hostname or ""
        port   = parsed.port or 80
        path   = parsed.path or "/"

        if is_target(host):
            record(method, host, path, "HTTP")

        remote = socket.create_connection((host, port), timeout=15)
        remote.sendall(raw)
        while True:
            r, _, _ = select.select([remote], [], [], 15)
            if not r: break
            chunk = remote.recv(8192)
            if not chunk: break
            conn.sendall(chunk)
        remote.close()
    except Exception:
        pass
    finally:
        try: conn.close()
        except: pass


def handle_client(conn):
    try:
        conn.settimeout(15)
        raw = conn.recv(8192)
        if not raw:
            return
        line0 = raw.split(b"\r\n")[0]
        if line0.startswith(b"CONNECT"):
            parts  = line0.split()
            target = parts[1].decode("utf-8", errors="replace") if len(parts) > 1 else ""
            handle_connect(conn, target)
        else:
            handle_http(conn, raw)
    except Exception:
        try: conn.close()
        except: pass


def start_proxy():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        srv.bind(("127.0.0.1", PROXY_PORT))
    except OSError:
        print(f"\n  ❌  ERRORE: porta {PROXY_PORT} già occupata.")
        print( "      → Chiudi Fiddler o altri proxy prima di avviare.")
        print( "      → Oppure riavvia il PC.")
        input("\n  Premi INVIO per uscire...")
        sys.exit(1)

    srv.listen(200)
    print(f"  ✅  Proxy:      127.0.0.1:{PROXY_PORT}  (solo GeCA, NON sistema)")
    print(f"  ✅  Output:     {GECA_DIR}")

    while True:
        try:
            conn, _ = srv.accept()
            threading.Thread(target=handle_client, args=(conn,), daemon=True).start()
        except Exception:
            pass


# ══════════════════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════════════════

def main():
    print("""
 ╔══════════════════════════════════════════════════════╗
 ║   GECA Intel — Server Tutto-in-Uno                  ║
 ║   Dashboard :8090  +  Proxy :8888                   ║
 ║   NON tocca il proxy di sistema — internet libero   ║
 ╚══════════════════════════════════════════════════════╝
""")

    # Avvia dashboard in thread separato
    t_dash = threading.Thread(target=start_dashboard, daemon=True)
    t_dash.start()

    print()
    print("  PRIMA DI AVVIARE GECA:")
    print("  1. Usa 'Configura Proxy' nel pannello (una volta sola)")
    print("  2. Apri GeCA → usa il Portale normalmente")
    print("  3. Il browser/Edge continua a funzionare normalmente")
    print()
    print("  Premi CTRL+C per fermare tutto.")
    print()
    print("  ─────────────────────────────────────────────────────")

    # Avvia proxy (blocca qui)
    start_proxy()


if __name__ == "__main__":
    main()

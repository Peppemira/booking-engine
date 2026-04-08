#!/usr/bin/env python3
"""
GECA Intel - Proxy HTTP/HTTPS autonomo porta 8888.
Zero dipendenze esterne — solo Python standard.
Intercetta chiamate GeCA verso il Portale dell'Automobilista.

Uso:
  python geca_proxy_server.py
  (oppure doppio click su AVVIA_PROXY_AUTONOMO.bat)

Requisiti:
  - GeCA configurato con proxy 127.0.0.1:8888  (usa "Configura Proxy" nel pannello HTA)
  - Fiddler CHIUSO (usa la stessa porta 8888)
  - Questo script in esecuzione PRIMA di aprire GeCA
"""
import socket
import threading
import json
import os
import select
from datetime import datetime
from urllib.parse import urlparse

# ── Percorsi output (letti dalla dashboard su localhost:8090) ──────────────
GECA_DIR    = r"C:\analisi-geca\catture\geca"
PORTALE_DIR = r"C:\analisi-geca\catture\portale"
TUTTO_DIR   = r"C:\analisi-geca\catture\tutto"

# Keyword per filtrare solo le chiamate verso il Portale/motorizzazione
TARGET_KEYWORDS = ["automobilista", "motorizzazione", "mit.gov", "portale"]

# ── Stato globale ──────────────────────────────────────────────────────────
endpoints: dict = {}
total_calls: int = 0
_lock = threading.Lock()

# ── Inizializza cartelle ───────────────────────────────────────────────────
for d in [GECA_DIR, PORTALE_DIR, TUTTO_DIR]:
    os.makedirs(d, exist_ok=True)


def is_target(host: str) -> bool:
    h = host.lower()
    return any(k in h for k in TARGET_KEYWORDS)


def record_call(method: str, host: str, path: str, proto: str = "HTTP") -> None:
    global total_calls
    with _lock:
        key = f"{method} {path}"
        if key not in endpoints:
            endpoints[key] = {
                "method": method,
                "host":   host,
                "path":   path,
                "calls":  0,
                "proto":  proto,
                "esempi": [],
            }
        endpoints[key]["calls"] += 1
        total_calls += 1
        ts = datetime.now().strftime("%H:%M:%S")
        print(f"  [{ts}] ✅ #{total_calls:03d}  {proto:5s}  {method:7s}  {host}{path}")
        _save_json()


def _save_json() -> None:
    """Scrive endpoint_map.json e stats.json nei percorsi letti dalla dashboard."""
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
        print(f"  [save error] {ex}")


def _relay(src: socket.socket, dst: socket.socket) -> None:
    """Copia dati da src a dst finché la connessione è aperta."""
    try:
        while True:
            ready, _, _ = select.select([src], [], [], 30)
            if not ready:
                break
            data = src.recv(8192)
            if not data:
                break
            dst.sendall(data)
    except Exception:
        pass


def handle_connect(conn: socket.socket, target: str) -> None:
    """Gestisce tunnel HTTPS (CONNECT). Vediamo host:porta, non il path cifrato."""
    parts = target.rsplit(":", 1)
    host = parts[0]
    port = int(parts[1]) if len(parts) > 1 else 443

    if is_target(host):
        record_call("CONNECT", host, f"/  [HTTPS tunnel porta {port}]", "HTTPS")

    conn.sendall(b"HTTP/1.1 200 Connection established\r\nProxy-agent: GecaIntel/1.0\r\n\r\n")

    try:
        remote = socket.create_connection((host, port), timeout=15)
        t1 = threading.Thread(target=_relay, args=(conn, remote),   daemon=True)
        t2 = threading.Thread(target=_relay, args=(remote, conn),   daemon=True)
        t1.start()
        t2.start()
        t1.join()
        t2.join()
    except Exception as ex:
        print(f"  [tunnel] {host}:{port} → {ex}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


def handle_http(conn: socket.socket, raw: bytes) -> None:
    """Gestisce richiesta HTTP in chiaro. Vediamo method + URL completo."""
    try:
        line0 = raw.split(b"\r\n")[0].decode("utf-8", errors="replace")
        parts = line0.split()
        if len(parts) < 2:
            return
        method, url = parts[0], parts[1]

        parsed = urlparse(url)
        host = parsed.hostname or ""
        port = parsed.port or 80
        path = parsed.path or "/"

        if is_target(host):
            record_call(method, host, path, "HTTP")

        remote = socket.create_connection((host, port), timeout=15)
        remote.sendall(raw)
        while True:
            ready, _, _ = select.select([remote], [], [], 15)
            if not ready:
                break
            chunk = remote.recv(8192)
            if not chunk:
                break
            conn.sendall(chunk)
        remote.close()
    except Exception as ex:
        pass
    finally:
        try:
            conn.close()
        except Exception:
            pass


def handle_client(conn: socket.socket) -> None:
    try:
        conn.settimeout(15)
        raw = conn.recv(8192)
        if not raw:
            return

        line0 = raw.split(b"\r\n")[0]
        if line0.startswith(b"CONNECT"):
            parts = line0.split()
            target = parts[1].decode("utf-8", errors="replace") if len(parts) > 1 else ""
            handle_connect(conn, target)
        else:
            handle_http(conn, raw)
    except Exception:
        try:
            conn.close()
        except Exception:
            pass


def main() -> None:
    PORT = 8888

    banner = f"""
 ╔═══════════════════════════════════════════════════╗
 ║   GECA Intel — Proxy Autonomo  (porta {PORT})     ║
 ║   Zero dipendenze • nessun certificato richiesto  ║
 ╠═══════════════════════════════════════════════════╣
 ║  Output:  C:\\analisi-geca\\catture\\geca\\          ║
 ║  Dashboard: http://localhost:8090/dashboard.html  ║
 ╚═══════════════════════════════════════════════════╝

 PRIMA DI AVVIARE assicurati che:
   1. Fiddler sia CHIUSO (usa la stessa porta {PORT})
   2. GeCA sia configurato con proxy 127.0.0.1:{PORT}
      → usa il pulsante "Configura Proxy" nel pannello HTA
   3. Avvia GeCA DOPO questo proxy

 In attesa di connessioni...  (CTRL+C per fermare)
 ───────────────────────────────────────────────────
"""
    print(banner)

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

    try:
        srv.bind(("127.0.0.1", PORT))
    except OSError:
        print(f"❌  ERRORE: porta {PORT} già occupata!")
        print(f"   → Chiudi Fiddler prima di avviare questo proxy.")
        print(f"   → Oppure riavvia il PC se il problema persiste.")
        input("\n   Premi INVIO per uscire...")
        return

    srv.listen(200)
    print(f" ✅  Proxy attivo su 127.0.0.1:{PORT}\n")

    try:
        while True:
            conn, _ = srv.accept()
            threading.Thread(target=handle_client, args=(conn,), daemon=True).start()
    except KeyboardInterrupt:
        print("\n\n Proxy fermato.")
    finally:
        srv.close()


if __name__ == "__main__":
    main()

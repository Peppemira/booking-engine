#!/usr/bin/env python3
"""
Analizza le sessioni HTTP di GeCA salvate da Fiddler (.saz o .txt)
ed estrae: endpoint chiamati, parametri POST, pattern URL, ecc.

Uso:
  python geca_parse_fiddler.py                → analizza tutti i .saz/.txt in geca-export\
  python geca_parse_fiddler.py file.saz       → analizza un file specifico
"""

import json
import os
import re
import sys
import zipfile
import datetime

EXPORT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "geca-export")
PORTALE_HOST = "www.ilportaledellautomobilista.it"
PORTALE_HOST2 = "ilportaledellautomobilista.it"


def parse_saz(saz_path):
    """Legge un file .saz (ZIP con sessioni Fiddler) ed estrae le sessioni HTTP."""
    sessions = []
    try:
        with zipfile.ZipFile(saz_path, "r") as z:
            entries = sorted(z.namelist())
            req_files = [e for e in entries if e.endswith("_c.txt")]  # request
            for req_file in req_files:
                try:
                    num = req_file.split("/")[-1].replace("_c.txt", "")
                    resp_file = req_file.replace("_c.txt", "_s.txt")

                    req_data = z.read(req_file).decode("utf-8", errors="replace")
                    resp_data = z.read(resp_file).decode("utf-8", errors="replace") if resp_file in entries else ""

                    session = parse_http_text(req_data, resp_data, num)
                    if session:
                        sessions.append(session)
                except Exception:
                    continue
    except Exception as e:
        print(f"  ⚠ Errore lettura SAZ: {e}")
    return sessions


def parse_txt_export(txt_path):
    """Legge un export testuale di Fiddler."""
    sessions = []
    try:
        with open(txt_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()

        # Fiddler "All Sessions" text export: split per sessione
        blocks = re.split(r"\n={5,}\n", content)
        for i, block in enumerate(blocks):
            session = parse_http_block(block, str(i))
            if session:
                sessions.append(session)
    except Exception as e:
        print(f"  ⚠ Errore lettura TXT: {e}")
    return sessions


def parse_http_text(req_text, resp_text, session_id=""):
    """Parsa testo HTTP raw di una singola sessione."""
    lines = req_text.splitlines()
    if not lines:
        return None

    # Prima linea: METHOD URL HTTP/version
    first = lines[0].strip()
    m = re.match(r"^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\S+)\s+HTTP", first, re.I)
    if not m:
        return None

    method = m.group(1).upper()
    url = m.group(2)

    # Host header
    host = ""
    for line in lines[1:20]:
        hm = re.match(r"^Host:\s*(.+)", line, re.I)
        if hm:
            host = hm.group(1).strip()
            break

    full_url = f"https://{host}{url}" if host and not url.startswith("http") else url

    # Body POST
    body = ""
    if "\r\n\r\n" in req_text:
        body = req_text.split("\r\n\r\n", 1)[1]
    elif "\n\n" in req_text:
        body = req_text.split("\n\n", 1)[1]

    # Status risposta
    status = ""
    if resp_text:
        sm = re.match(r"HTTP/[\d.]+\s+(\d+)", resp_text)
        if sm:
            status = sm.group(1)

    # Body risposta (prime 2000 char)
    resp_body = ""
    if resp_text:
        if "\r\n\r\n" in resp_text:
            resp_body = resp_text.split("\r\n\r\n", 1)[1][:2000]
        elif "\n\n" in resp_text:
            resp_body = resp_text.split("\n\n", 1)[1][:2000]

    return {
        "id": session_id,
        "method": method,
        "url": full_url,
        "host": host,
        "path": url,
        "status": status,
        "body": body[:500] if body else "",
        "response_preview": resp_body[:1000] if resp_body else "",
    }


def parse_http_block(block, session_id):
    """Parsa un blocco testuale di sessione da export Fiddler."""
    lines = block.strip().splitlines()
    for line in lines[:5]:
        m = re.match(r"^(GET|POST|PUT|DELETE|PATCH)\s+(https?://\S+)", line, re.I)
        if m:
            return {
                "id": session_id,
                "method": m.group(1).upper(),
                "url": m.group(2),
                "host": re.match(r"https?://([^/]+)", m.group(2)).group(1) if re.match(r"https?://([^/]+)", m.group(2)) else "",
                "path": re.sub(r"https?://[^/]+", "", m.group(2)),
                "status": "",
                "body": "",
                "response_preview": "",
            }
    return None


def is_portale_or_geca(session):
    """Filtra sessioni del Portale dell'Automobilista e chiamate GeCA."""
    host = session.get("host", "").lower()
    url = session.get("url", "").lower()
    return (
        PORTALE_HOST in host or
        PORTALE_HOST2 in host or
        "automobilista" in host or
        "motorizzazione" in host or
        "mit.gov" in host or
        "ced" in url
    )


def extract_params(body):
    """Estrae parametri da body application/x-www-form-urlencoded."""
    if not body:
        return {}
    params = {}
    try:
        from urllib.parse import parse_qs, unquote_plus
        for k, vs in parse_qs(body).items():
            params[k] = vs[0] if len(vs) == 1 else vs
    except Exception:
        pass
    return params


def analyze_sessions(sessions):
    """Analizza le sessioni e costruisce la mappa endpoint."""
    endpoint_map = {}
    portale_sessions = [s for s in sessions if is_portale_or_geca(s)]

    for s in portale_sessions:
        path = s.get("path", "").split("?")[0]  # senza query string
        key = f"{s['method']} {path}"

        if key not in endpoint_map:
            endpoint_map[key] = {
                "method": s["method"],
                "host": s["host"],
                "path": path,
                "full_url": s["url"],
                "calls": 0,
                "statuses": [],
                "params_examples": [],
                "response_previews": [],
            }

        ep = endpoint_map[key]
        ep["calls"] += 1
        if s["status"] and s["status"] not in ep["statuses"]:
            ep["statuses"].append(s["status"])
        if s["body"] and len(ep["params_examples"]) < 3:
            params = extract_params(s["body"])
            if params:
                ep["params_examples"].append(params)
        if s["response_preview"] and len(ep["response_previews"]) < 2:
            ep["response_previews"].append(s["response_preview"][:500])

    return endpoint_map, portale_sessions


def main():
    args = sys.argv[1:]

    # Trova i file da analizzare
    if args:
        files = [a for a in args if os.path.isfile(a)]
    else:
        os.makedirs(EXPORT_DIR, exist_ok=True)
        files = []
        for fname in os.listdir(EXPORT_DIR):
            if fname.lower().endswith((".saz", ".txt")) and not fname.startswith("_"):
                files.append(os.path.join(EXPORT_DIR, fname))

    if not files:
        print("⚠  Nessun file .saz o .txt trovato in:", EXPORT_DIR)
        print()
        print("COME ESPORTARE DA FIDDLER:")
        print("  1. Usa GeCA + vai sul Portale dell'Automobilista")
        print("  2. In Fiddler: File > Save > All Sessions")
        print(f"  3. Salva il .saz in: {EXPORT_DIR}")
        print("  4. Riesegui questo script")
        return

    all_sessions = []
    for fpath in files:
        print(f"\n📂 Analisi: {os.path.basename(fpath)}")
        if fpath.lower().endswith(".saz"):
            sessions = parse_saz(fpath)
        else:
            sessions = parse_txt_export(fpath)
        print(f"   Sessioni totali: {len(sessions)}")
        all_sessions.extend(sessions)

    if not all_sessions:
        print("⚠  Nessuna sessione HTTP trovata.")
        return

    endpoint_map, portale_sessions = analyze_sessions(all_sessions)

    print(f"\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print(f"  Sessioni totali analizzate:  {len(all_sessions)}")
    print(f"  Sessioni Portale/GeCA:       {len(portale_sessions)}")
    print(f"  Endpoint unici trovati:      {len(endpoint_map)}")
    print(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

    if not endpoint_map:
        print("\n⚠  Nessuna chiamata al Portale dell'Automobilista trovata.")
        print("Assicurati di aver usato GeCA mentre Fiddler era aperto.")
        return

    print("\n📡 ENDPOINT TROVATI:\n")
    for key, ep in sorted(endpoint_map.items()):
        print(f"  {ep['method']:6s} {ep['path']}")
        print(f"         Chiamate: {ep['calls']}  Status: {', '.join(ep['statuses']) or '?'}")
        if ep["params_examples"]:
            params = list(ep["params_examples"][0].keys())[:8]
            print(f"         Parametri: {', '.join(params)}")
        print()

    # Salva risultati
    out_path = os.path.join(EXPORT_DIR, "_http_endpoints.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({
            "analyzed_at": datetime.datetime.now().isoformat(),
            "total_sessions": len(all_sessions),
            "portale_sessions": len(portale_sessions),
            "endpoints": endpoint_map,
        }, f, indent=2, ensure_ascii=False)
    print(f"✅ Risultati salvati in: {out_path}")

    # Copia anche nel formato GECA Intel
    geca_intel_path = os.path.join(EXPORT_DIR, "..", "..", "..", "..", "analisi-geca", "catture", "geca", "endpoint_map.json") if False else None
    # (path dipende da dove e' installato GECA Intel — salviamo solo nel formato standard)
    portale_map_path = os.path.join(EXPORT_DIR, "_portale_endpoint_map.json")
    portale_map = {
        ep["path"]: {
            "method": ep["method"],
            "host": ep["host"],
            "path": ep["path"],
            "call_count": ep["calls"],
            "esempi": ep["params_examples"][:2],
        }
        for ep in endpoint_map.values()
    }
    with open(portale_map_path, "w", encoding="utf-8") as f:
        json.dump(portale_map, f, indent=2, ensure_ascii=False)
    print(f"✅ Mappa portale salvata in: {portale_map_path}")


if __name__ == "__main__":
    main()

"""
GECA Intel - addon mitmproxy per catturare chiamate GeCA → Portale Automobilista.
Uso: mitmdump -p 8888 -s geca_mitm_addon.py --ssl-insecure

Scrive i risultati in:
  C:\analisi-geca\catture\geca\endpoint_map.json
  C:\analisi-geca\catture\tutto\stats.json
"""
import json
import os
from mitmproxy import http

GECA_DIR   = r"C:\analisi-geca\catture\geca"
TUTTO_DIR  = r"C:\analisi-geca\catture\tutto"
PORTALE_KEYWORDS = ["automobilista", "motorizzazione", "mit.gov", "ilportale"]

os.makedirs(GECA_DIR,  exist_ok=True)
os.makedirs(TUTTO_DIR, exist_ok=True)

endpoints: dict = {}
call_count: int = 0


def _is_portale(host: str) -> bool:
    h = host.lower()
    return any(k in h for k in PORTALE_KEYWORDS)


def _save():
    ep_path    = os.path.join(GECA_DIR,  "endpoint_map.json")
    stats_path = os.path.join(TUTTO_DIR, "stats.json")
    with open(ep_path, "w", encoding="utf-8") as f:
        json.dump(endpoints, f, indent=2, ensure_ascii=False)
    stats = {
        "geca":    {"chiamate": call_count, "tipo": "HTTP"},
        "portale": {"chiamate": call_count},
    }
    with open(stats_path, "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2, ensure_ascii=False)


def response(flow: http.HTTPFlow) -> None:
    global call_count
    if not _is_portale(flow.request.host):
        return

    call_count += 1
    method = flow.request.method.upper()
    path   = flow.request.path.split("?")[0]
    key    = f"{method} {path}"

    if key not in endpoints:
        endpoints[key] = {
            "method":  method,
            "host":    flow.request.host,
            "path":    path,
            "calls":   0,
            "esempi":  [],
            "status":  [],
        }
    endpoints[key]["calls"] += 1
    sc = flow.response.status_code if flow.response else 0
    if sc not in endpoints[key]["status"]:
        endpoints[key]["status"].append(sc)

    print(f"[GECA Intel] #{call_count}  {method} {flow.request.host}{path}  → {sc}")
    _save()

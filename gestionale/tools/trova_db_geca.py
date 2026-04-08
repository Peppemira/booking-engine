#!/usr/bin/env python3
"""
Discovery del database usato da GeCAFuture.
Cerca MySQL, SQLite, Access (.mdb), XAMPP, WAMP e file dati nelle cartelle GeCA.
Esegui mentre GeCA è APERTO per risultati più precisi.
"""
import os, sys, glob, subprocess, json, winreg, socket, struct
from pathlib import Path
import datetime

GECA_DIRS = [
    r"C:\AFSoft\GeCAFuture",
    r"C:\AFSoft\GECA",
    r"C:\Program Files (x86)\AFSoft",
    r"C:\Program Files\AFSoft",
    r"C:\GeCA",
    r"C:\GecaFuture",
]

MYSQL_SERVICE_NAMES = [
    "MySQL", "MySQL57", "MySQL80", "MySQL56", "MySQL55",
    "MySQL5.7", "MySQL8.0", "MySQLAFSoft", "MySQLGECA",
    "WAMPMYSQLD64", "wampmysqld64", "xampp_mysql",
    "MariaDB", "MariaDB10",
]

XAMPP_DIRS = [r"C:\xampp", r"C:\wamp", r"C:\wamp64", r"C:\laragon"]

results = {
    "timestamp": datetime.datetime.now().isoformat(),
    "geca_dir": None,
    "database_type": None,
    "mysql_services": [],
    "sqlite_files": [],
    "access_files": [],
    "mysql_data_dirs": [],
    "config_parsed": {},
    "open_ports": [],
    "xampp_found": None,
    "recommendation": "",
}


def check_port(port):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.5)
        r = s.connect_ex(("127.0.0.1", port))
        s.close()
        return r == 0
    except:
        return False


def read_ini(path):
    out = {}
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            section = ""
            for line in f:
                line = line.strip()
                if line.startswith("[") and line.endswith("]"):
                    section = line[1:-1]
                    out[section] = {}
                elif "=" in line and section:
                    k, _, v = line.partition("=")
                    out[section][k.strip()] = v.strip()
    except:
        pass
    return out


def find_services():
    found = []
    try:
        result = subprocess.run(
            ["sc", "query", "type=", "all", "state=", "all"],
            capture_output=True, text=True, timeout=10
        )
        lines = result.stdout.splitlines()
        current = {}
        for line in lines:
            if line.startswith("SERVICE_NAME:"):
                if current:
                    found.append(current)
                current = {"name": line.split(":", 1)[1].strip(), "state": ""}
            elif "STATE" in line and current:
                current["state"] = line.strip()
        if current:
            found.append(current)
    except:
        pass
    return found


print("━" * 55)
print("  GeCA Database Discovery")
print("━" * 55)

# 1. Trova cartella GeCA
print("\n[1] Cartella GeCA...")
for d in GECA_DIRS:
    if os.path.isdir(d):
        results["geca_dir"] = d
        print(f"  ✅ Trovata: {d}")
        break
if not results["geca_dir"]:
    print("  ⚠  Non trovata nei percorsi standard")

# 2. Leggi configDB.ini
if results["geca_dir"]:
    cfg_path = os.path.join(results["geca_dir"], "configDB.ini")
    if os.path.isfile(cfg_path):
        cfg = read_ini(cfg_path)
        results["config_parsed"] = cfg
        print(f"\n[2] configDB.ini:")
        for section, vals in cfg.items():
            for k, v in vals.items():
                print(f"  [{section}] {k} = {v}")

# 3. Cerca file database nella cartella GeCA e sottocartelle
if results["geca_dir"]:
    print(f"\n[3] File database in {results['geca_dir']}...")
    for root, dirs, files in os.walk(results["geca_dir"]):
        # Nascondi alcune cartelle pesanti
        dirs[:] = [d for d in dirs if d.lower() not in {"bin", "lib", "include", "share", "docs", "help"}]
        for f in files:
            fp = os.path.join(root, f)
            fl = f.lower()
            size = 0
            try:
                size = os.path.getsize(fp)
            except:
                pass
            if fl.endswith(".db") or fl.endswith(".sqlite") or fl.endswith(".sqlite3"):
                results["sqlite_files"].append({"path": fp, "size_kb": size // 1024})
                print(f"  🗄  SQLite: {fp}  ({size//1024} KB)")
            elif fl.endswith(".mdb") or fl.endswith(".accdb"):
                results["access_files"].append({"path": fp, "size_kb": size // 1024})
                print(f"  🗄  Access: {fp}  ({size//1024} KB)")
            elif fl == "ibdata1" or fl.endswith(".ibd") or fl.endswith(".frm"):
                parent = os.path.dirname(fp)
                if parent not in results["mysql_data_dirs"]:
                    results["mysql_data_dirs"].append(parent)
                    print(f"  🗄  MySQL data dir: {parent}")

# 4. Cerca MySQL data nelle posizioni standard
print(f"\n[4] Cartelle dati MySQL standard...")
mysql_data_paths = [
    r"C:\ProgramData\MySQL",
    r"C:\MySQL\data",
    r"C:\Program Files\MySQL",
    r"C:\Program Files (x86)\MySQL",
    r"C:\xampp\mysql\data",
    r"C:\wamp64\bin\mysql",
    r"C:\AFSoft\GeCAFuture\mysql",
    r"C:\AFSoft\GeCAFuture\data",
    r"C:\AFSoft\mysql",
]
for p in mysql_data_paths:
    if os.path.isdir(p):
        results["mysql_data_dirs"].append(p)
        print(f"  ✅ {p}")

# 5. Cerca XAMPP / WAMP
print(f"\n[5] XAMPP / WAMP...")
for d in XAMPP_DIRS:
    if os.path.isdir(d):
        results["xampp_found"] = d
        print(f"  ✅ Trovato: {d}")
        break
if not results["xampp_found"]:
    print("  ✗ Non trovato")

# 6. Verifica porte aperte
print(f"\n[6] Porte database attive...")
ports_to_check = {
    3306: "MySQL/MariaDB",
    3307: "MySQL alternativo",
    5432: "PostgreSQL",
    1433: "SQL Server",
    1521: "Oracle",
    27017: "MongoDB",
}
for port, name in ports_to_check.items():
    if check_port(port):
        results["open_ports"].append({"port": port, "service": name})
        print(f"  ✅ PORTA {port} APERTA → {name}")
    else:
        print(f"  ✗  {port} ({name}) — chiusa")

# 7. Servizi Windows MySQL
print(f"\n[7] Servizi Windows (MySQL/MariaDB)...")
all_services = find_services()
mysql_svcs = [s for s in all_services if any(
    n.lower() in s["name"].lower() for n in ["mysql", "mariadb", "wamp", "xampp"]
)]
if mysql_svcs:
    for s in mysql_svcs:
        results["mysql_services"].append(s)
        print(f"  ✅ {s['name']}  —  {s['state']}")
else:
    print("  ✗ Nessun servizio MySQL/MariaDB trovato")

# 8. Cerca nel Registro di sistema
print(f"\n[8] Registro Windows (chiavi MySQL/AfSoft)...")
reg_paths = [
    (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\AFSoft"),
    (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\AFSoft"),
    (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\MySQL AB"),
    (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\MySQL AB"),
    (winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Services\MySQL"),
]
for hive, path in reg_paths:
    try:
        key = winreg.OpenKey(hive, path)
        print(f"  ✅ HKLM\\{path}")
        try:
            i = 0
            while True:
                name, val, _ = winreg.EnumValue(key, i)
                print(f"       {name} = {str(val)[:80]}")
                i += 1
        except:
            pass
        # Cerca sottochiavi
        try:
            j = 0
            while True:
                sub = winreg.EnumKey(key, j)
                print(f"       \\{sub}")
                j += 1
        except:
            pass
        winreg.CloseKey(key)
    except:
        pass

# 9. Valutazione finale
print(f"\n{'━'*55}")
print("  RISULTATO:")
print(f"{'━'*55}")

if results["open_ports"] and any(p["port"] == 3306 for p in results["open_ports"]):
    results["database_type"] = "MySQL su porta 3306"
    results["recommendation"] = "MySQL è attivo su localhost:3306. Esegui: python geca_mysql_reader.py --export"
    print(f"  ✅ MySQL ATTIVO su porta 3306!")
    print(f"  → Esegui: python geca_mysql_reader.py --export")
elif results["sqlite_files"]:
    results["database_type"] = "SQLite"
    results["recommendation"] = f"Trovati file SQLite: {results['sqlite_files']}"
    print(f"  ✅ Database SQLite trovato!")
    for sf in results["sqlite_files"]:
        print(f"     {sf['path']}  ({sf['size_kb']} KB)")
    print(f"  → Esegui: python leggi_sqlite_geca.py")
elif results["access_files"]:
    results["database_type"] = "Microsoft Access"
    print(f"  ✅ Database Access trovato!")
    for af in results["access_files"]:
        print(f"     {af['path']}  ({af['size_kb']} KB)")
elif results["mysql_data_dirs"]:
    results["database_type"] = "MySQL (data dir trovata, server non avviato)"
    results["recommendation"] = f"MySQL installato ma non avviato. Avvia GecaFuture.exe poi riesegui."
    print(f"  ⚠  MySQL installato ma server non avviato.")
    print(f"     Apri GecaFuture.exe → aspetta 5 secondi → riesegui questo script")
elif results["mysql_services"]:
    results["database_type"] = "MySQL (servizio trovato)"
    stopped = [s for s in results["mysql_services"] if "STOPPED" in s.get("state","")]
    if stopped:
        print(f"  ⚠  Servizio MySQL trovato ma ARRESTATO: {stopped[0]['name']}")
        print(f"     Avvialo con: net start {stopped[0]['name']}")
else:
    print(f"  ❓ Database non identificato.")
    print(f"     Apri GecaFuture.exe e riesegui questo script.")
    print(f"     Oppure copia il contenuto di questo output e mandamelo.")

# Salva report
out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "geca-export")
os.makedirs(out_dir, exist_ok=True)
report_path = os.path.join(out_dir, "_db_discovery.json")
with open(report_path, "w", encoding="utf-8") as f:
    json.dump(results, f, indent=2, ensure_ascii=False)
print(f"\n  Report salvato in: {report_path}")
print(f"{'━'*55}")

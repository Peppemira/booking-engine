#!/usr/bin/env python3
"""
Cerca il database principale di GeCA (candidati, pratiche, pagamenti)
in tutte le posizioni possibili su Windows.
"""
import os, sys, json, datetime, subprocess

# Tutti i percorsi dove GeCA potrebbe tenere il DB principale
USERNAME = os.environ.get("USERNAME", "bluef")
SEARCH_DIRS = [
    r"C:\AFSoft",
    r"C:\Program Files (x86)\AFSoft",
    r"C:\Program Files\AFSoft",
    rf"C:\Users\{USERNAME}\AppData\Local\AFSoft",
    rf"C:\Users\{USERNAME}\AppData\Roaming\AFSoft",
    r"C:\ProgramData\AFSoft",
    rf"C:\Users\{USERNAME}\Documents\AFSoft",
    rf"C:\Users\{USERNAME}\Documents\GeCA",
    rf"C:\Users\{USERNAME}\Desktop",
    r"C:\GeCA",
    r"C:\GecaFuture",
    r"C:\Autoscuola",
    r"D:\AFSoft",
    r"D:\GeCA",
]

# Nomi file che indicano il DB principale di GeCA
MAIN_DB_NAMES = {
    "archivio", "archivi", "candidati", "candidato", "allievi",
    "iscritti", "anag", "anagrafica", "autoscuola", "geca",
    "gecafuture", "dati", "principale", "master", "database",
    "pratiche", "pagamenti", "gestionale",
}

EXTENSIONS = (".mdb", ".accdb", ".sqlite", ".sqlite3", ".db", ".sdf")

found_files = []
found_dirs  = []

def is_main_db(filename):
    name = os.path.splitext(filename)[0].lower()
    return any(kw in name for kw in MAIN_DB_NAMES)

print("━" * 55)
print("  Ricerca database principale GeCA")
print("━" * 55)
print(f"  Utente: {USERNAME}")
print()

for search_dir in SEARCH_DIRS:
    if not os.path.isdir(search_dir):
        continue
    print(f"  🔍 {search_dir}")
    for root, dirs, files in os.walk(search_dir):
        # Salta cartelle troppo generiche per velocizzare
        dirs[:] = [d for d in dirs if d.lower() not in {
            "windows", "system32", "syswow64", "program files",
            "node_modules", ".git", "__pycache__", "temp", "tmp",
            "cache", "log", "logs", "backup",  # mantieni "backup" per trovare .mdb backup
        }]
        for f in files:
            if not any(f.lower().endswith(ext) for ext in EXTENSIONS):
                continue
            fp   = os.path.join(root, f)
            size = 0
            try:
                size = os.path.getsize(fp)
            except:
                continue
            # Ignora file < 10KB (troppo piccoli per essere il DB principale)
            if size < 10240:
                continue
            entry = {
                "path":    fp,
                "name":    f,
                "size_kb": size // 1024,
                "is_main": is_main_db(f),
            }
            found_files.append(entry)
            if root not in found_dirs:
                found_dirs.append(root)

# Ordina: prima i file con nome "principale", poi per dimensione
found_files.sort(key=lambda x: (not x["is_main"], -x["size_kb"]))

print()
if not found_files:
    print("  ❌ Nessun database trovato.")
    print()
    print("  Possibili cause:")
    print("  1. GeCA non è installato nel percorso standard")
    print("  2. Il database è su una rete condivisa (LAN)")
    print("  3. GeCA usa un formato proprietario non standard")
    print()
    print("  → Apri GecaFuture.exe, vai su Configurazione > Database")
    print("    e vedi il percorso del database impostato.")
else:
    print(f"  Trovati {len(found_files)} file database:\n")
    for f in found_files:
        marker = "⭐" if f["is_main"] else "  "
        print(f"  {marker} {f['size_kb']:>6} KB  {f['name']:30s}  {f['path']}")

    print()
    main_dbs = [f for f in found_files if f["is_main"]]
    if main_dbs:
        print("  ✅ DATABASE PRINCIPALE IDENTIFICATO:")
        for db in main_dbs[:3]:
            print(f"     {db['path']}  ({db['size_kb']} KB)")
        print()
        print("  → Aggiorna GECA_DATA_DIR in geca_access_reader.py con il percorso")
        print("    della cartella contenente questi file, poi riesegui --export")
    else:
        print("  ⚠  File trovati ma nessuno con nome riconoscibile come DB principale.")
        print("  → Verifica manualmente i file più grandi nell'elenco sopra.")

# Salva risultati
out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "geca-export")
os.makedirs(out_dir, exist_ok=True)
report = {
    "searched_at": datetime.datetime.now().isoformat(),
    "username": USERNAME,
    "dirs_searched": SEARCH_DIRS,
    "files_found": found_files,
}
rpath = os.path.join(out_dir, "_db_search.json")
with open(rpath, "w", encoding="utf-8") as fp:
    json.dump(report, fp, indent=2, ensure_ascii=False)
print(f"\n  Report: {rpath}")
print("━" * 55)

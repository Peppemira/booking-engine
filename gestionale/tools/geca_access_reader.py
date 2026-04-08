#!/usr/bin/env python3
"""
GECA Access Reader
Legge i database Microsoft Access (.mdb) di GeCAFuture ed esporta in JSON.

Uso:
  python geca_access_reader.py            → schema + conteggi di tutti i .mdb
  python geca_access_reader.py --export   → esporta tutte le tabelle in JSON
  python geca_access_reader.py --schema   → solo struttura (senza dati)

Richiede: pip install pyodbc
Se il driver Access non è installato, lo script guida l'installazione.
"""

import os, sys, json, glob, datetime, traceback

GECA_DATA_DIR  = r"C:\AFSoft\GeCAFuture\data"
GECA_ROOT_DIR  = r"C:\AFSoft\GeCAFuture"
OUTPUT_DIR     = os.path.join(os.path.dirname(os.path.abspath(__file__)), "geca-export")

# Tabelle di interesse in GeCA (nomi comuni nei DB Access delle autoscuole)
IMPORTANT_TABLES = {
    # Candidati / anagrafica
    "archivio", "candidati", "candidato", "iscritti", "allievi", "anag",
    "anagrafica", "archivcan", "archiviocandidati",
    # Pratiche
    "pratiche", "pratica", "richieste", "domande",
    # Pagamenti
    "pagamenti", "pagamento", "incassi", "versamenti", "riscossioni",
    # Presenze / guide
    "presenze", "guide", "guida", "lezioni",
    # Esami
    "esami", "esame", "prenotazioni", "sedute",
    # Config / lookup
    "autoscuola", "config", "configurazione", "parametri",
    "categorie", "tipi",
}

def serialize(obj):
    if isinstance(obj, (datetime.date, datetime.datetime)):
        return obj.isoformat()
    if isinstance(obj, datetime.timedelta):
        return str(obj)
    if isinstance(obj, bytes):
        try:
            return obj.decode("latin-1")
        except:
            return obj.hex()
    if isinstance(obj, bool):
        return obj
    return str(obj)


def ensure_pyodbc():
    try:
        import pyodbc
        return pyodbc
    except ImportError:
        print("  Installazione pyodbc...")
        os.system(f'"{sys.executable}" -m pip install pyodbc --quiet')
        try:
            import pyodbc
            return pyodbc
        except ImportError:
            print("  ❌ pyodbc non installabile. Prova: pip install pyodbc")
            sys.exit(1)


def get_access_driver(pyodbc):
    """Trova il driver ODBC per Access installato."""
    drivers = pyodbc.drivers()
    for d in drivers:
        if "access" in d.lower():
            return d
    return None


def open_mdb(pyodbc, driver, mdb_path):
    conn_str = (
        f"DRIVER={{{driver}}};"
        f"DBQ={mdb_path};"
        "ExtendedAnsiSQL=1;"
    )
    return pyodbc.connect(conn_str, autocommit=True)


def get_tables(conn):
    cursor = conn.cursor()
    tables = []
    for row in cursor.tables(tableType="TABLE"):
        name = row.table_name
        if not name.startswith("MSys"):  # escludi tabelle di sistema
            tables.append(name)
    return sorted(tables)


def describe_table(conn, table):
    cursor = conn.cursor()
    cols = []
    try:
        for row in cursor.columns(table=table):
            cols.append({
                "field":    row.column_name,
                "type":     row.type_name,
                "size":     row.column_size,
                "nullable": row.nullable == 1,
            })
    except Exception as e:
        print(f"    ⚠ Errore schema {table}: {e}")
    return cols


def count_rows(conn, table):
    try:
        cursor = conn.cursor()
        cursor.execute(f"SELECT COUNT(*) FROM [{table}]")
        return cursor.fetchone()[0]
    except:
        return 0


def read_table(conn, table, limit=3000):
    cursor = conn.cursor()
    rows = []
    try:
        cursor.execute(f"SELECT TOP {limit} * FROM [{table}]")
        columns = [d[0] for d in cursor.description]
        for row in cursor.fetchall():
            rows.append(dict(zip(columns, row)))
    except Exception as e:
        print(f"    ⚠ Errore lettura {table}: {e}")
    return rows


def find_mdb_files():
    """Trova tutti i file .mdb nella cartella GeCA."""
    files = []
    for search_dir in [GECA_DATA_DIR, GECA_ROOT_DIR]:
        if not os.path.isdir(search_dir):
            continue
        for root, dirs, fnames in os.walk(search_dir):
            # Salta cartelle di sistema
            dirs[:] = [d for d in dirs if d.lower() not in {"bin", "lib", "help", "docs"}]
            for f in fnames:
                if f.lower().endswith((".mdb", ".accdb")):
                    full = os.path.join(root, f)
                    size = os.path.getsize(full) if os.path.isfile(full) else 0
                    files.append({"path": full, "name": f, "size_kb": size // 1024})
    # Ordina per dimensione decrescente (i più grandi sono i più importanti)
    return sorted(files, key=lambda x: x["size_kb"], reverse=True)


def main():
    args = sys.argv[1:]
    do_export = "--export" in args
    do_schema = "--schema" in args

    print("━" * 55)
    print("  GeCA Access Database Reader")
    print("━" * 55)

    pyodbc = ensure_pyodbc()

    # Trova driver Access
    driver = get_access_driver(pyodbc)
    if not driver:
        print("\n❌ Driver ODBC per Microsoft Access non trovato.")
        print()
        print("  Soluzione — scarica e installa (gratis, 2 min):")
        print("  https://www.microsoft.com/en-us/download/details.aspx?id=54920")
        print("  → 'Microsoft Access Database Engine 2016 Redistributable'")
        print("  → Scarica AccessDatabaseEngine_X64.exe e installalo")
        print()
        print("  Poi riesegui questo script.")
        sys.exit(1)

    print(f"\n✅ Driver Access trovato: {driver}")

    # Trova file .mdb
    mdb_files = find_mdb_files()
    if not mdb_files:
        print(f"\n❌ Nessun file .mdb trovato in {GECA_DATA_DIR}")
        sys.exit(1)

    print(f"\n📂 File database trovati ({len(mdb_files)}):")
    for f in mdb_files:
        print(f"  {'⭐' if f['size_kb'] > 500 else '  '} {f['name']:30s}  {f['size_kb']:>6} KB   {f['path']}")

    if do_export:
        os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Leggi ogni file .mdb
    all_schema = {}
    grand_summary = {}

    for mdb_info in mdb_files:
        mdb_path = mdb_info["path"]
        mdb_name = os.path.splitext(mdb_info["name"])[0]

        print(f"\n{'─'*55}")
        print(f"  📄 {mdb_info['name']}  ({mdb_info['size_kb']} KB)")
        print(f"{'─'*55}")

        try:
            conn = open_mdb(pyodbc, driver, mdb_path)
        except Exception as e:
            print(f"  ❌ Impossibile aprire: {e}")
            continue

        try:
            tables = get_tables(conn)
            print(f"  Tabelle: {len(tables)}")

            file_schema = {}
            file_counts = {}

            for table in tables:
                cols  = describe_table(conn, table)
                count = count_rows(conn, table)
                file_schema[table] = cols
                file_counts[table] = count
                is_imp = table.lower() in IMPORTANT_TABLES
                marker = "⭐" if is_imp else "  "
                print(f"  {marker} {table:30s}  {count:>6} righe  ({len(cols)} colonne)")

            all_schema[mdb_name] = {"schema": file_schema, "counts": file_counts}

            if not do_schema:
                # Stampa struttura delle tabelle importanti
                for table in tables:
                    if table.lower() not in IMPORTANT_TABLES:
                        continue
                    cols  = file_schema.get(table, [])
                    count = file_counts.get(table, 0)
                    if not cols:
                        continue
                    print(f"\n  ┌─ {table}  ({count} righe)")
                    for col in cols[:30]:
                        nn = "" if col["nullable"] else " NOT NULL"
                        print(f"  │  {col['field']:25s}  {col['type']:15s}{nn}")
                    if len(cols) > 30:
                        print(f"  │  ... +{len(cols)-30} altre colonne")
                    print(f"  └{'─'*50}")

            if do_export:
                # Esporta tutte le tabelle del file
                db_out = {}
                for table in tables:
                    rows = read_table(conn, table)
                    if not rows:
                        continue
                    fname = f"{mdb_name}__{table}.json"
                    fpath = os.path.join(OUTPUT_DIR, fname)
                    data  = {
                        "source_file": mdb_info["path"],
                        "table": table,
                        "count": len(rows),
                        "exported_at": datetime.datetime.now().isoformat(),
                        "schema": file_schema.get(table, []),
                        "rows": rows,
                    }
                    with open(fpath, "w", encoding="utf-8") as f:
                        json.dump(data, f, indent=2, default=serialize, ensure_ascii=False)
                    marker = "⭐" if table.lower() in IMPORTANT_TABLES else "  "
                    print(f"  {marker} ✅ {table:30s}  {len(rows)} righe  → {fname}")
                    db_out[table] = len(rows)
                grand_summary[mdb_name] = db_out

        except Exception as e:
            print(f"  ❌ Errore: {e}")
            traceback.print_exc()
        finally:
            try:
                conn.close()
            except:
                pass

    # Salva schema globale
    if do_export:
        schema_path = os.path.join(OUTPUT_DIR, "_geca_schema.json")
        with open(schema_path, "w", encoding="utf-8") as f:
            json.dump({
                "exported_at": datetime.datetime.now().isoformat(),
                "geca_dir": GECA_ROOT_DIR,
                "databases": all_schema,
            }, f, indent=2, default=serialize, ensure_ascii=False)

        summary_path = os.path.join(OUTPUT_DIR, "_geca_summary.json")
        total_rows = sum(
            count
            for db_tables in grand_summary.values()
            for count in db_tables.values()
        )
        with open(summary_path, "w", encoding="utf-8") as f:
            json.dump({
                "exported_at": datetime.datetime.now().isoformat(),
                "databases": grand_summary,
                "total_rows": total_rows,
            }, f, indent=2, default=serialize, ensure_ascii=False)

        print(f"\n{'━'*55}")
        print(f"  ✅ Esportazione completata!")
        print(f"  Righe totali esportate: {total_rows}")
        print(f"  Cartella output: {OUTPUT_DIR}")
        print(f"{'━'*55}")
    else:
        print(f"\n{'━'*55}")
        print(f"  Per esportare tutto: python geca_access_reader.py --export")
        print(f"{'━'*55}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
GECA MySQL Reader
Legge direttamente il database MySQL locale di GeCAFuture ed esporta in JSON.

Uso:
  python geca_mysql_reader.py            → schema + conteggi
  python geca_mysql_reader.py --export   → esporta tutte le tabelle
  python geca_mysql_reader.py --schema   → solo struttura tabelle
"""

import json
import os
import sys
import datetime

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "geca-export")

# ── PASSWORD DA PROVARE ────────────────────────────────────────────
CREDENTIALS = [
    {"host": "127.0.0.1", "port": 3306, "user": "root",   "password": ""},
    {"host": "127.0.0.1", "port": 3306, "user": "root",   "password": "root"},
    {"host": "127.0.0.1", "port": 3306, "user": "root",   "password": "afsoft"},
    {"host": "127.0.0.1", "port": 3306, "user": "root",   "password": "geca"},
    {"host": "127.0.0.1", "port": 3306, "user": "root",   "password": "gecafuture"},
    {"host": "127.0.0.1", "port": 3306, "user": "root",   "password": "mysql"},
    {"host": "127.0.0.1", "port": 3306, "user": "root",   "password": "password"},
    {"host": "127.0.0.1", "port": 3306, "user": "geca",   "password": "geca"},
    {"host": "127.0.0.1", "port": 3306, "user": "afsoft", "password": "afsoft"},
    {"host": "localhost",  "port": 3306, "user": "root",   "password": ""},
    {"host": "localhost",  "port": 3306, "user": "root",   "password": "root"},
]

# Tabelle di interesse per GeCA
GECA_TABLES = [
    "candidati", "candidato", "allievi", "iscritti",
    "pratiche", "pratica", "pratiche_patente", "richieste",
    "pagamenti", "pagamento", "incassi", "versamenti",
    "presenze", "corso_presenze", "frequenze",
    "guide", "guida", "sessioni_guida", "lezioni_guida",
    "esami", "esame", "prenotazioni", "sedute",
    "documenti", "allegati",
    "autoscuola", "config", "configurazione", "impostazioni",
    "users", "utenti", "operatori",
    "categorie", "tipi_pratica",
]

# Database da escludere (di sistema)
SYSTEM_DBS = {"information_schema", "performance_schema", "mysql", "sys"}


def serialize(obj):
    """Serializza tipi Python non JSON-native."""
    if isinstance(obj, (datetime.date, datetime.datetime)):
        return obj.isoformat()
    if isinstance(obj, datetime.timedelta):
        return str(obj)
    if isinstance(obj, bytes):
        try:
            return obj.decode("utf-8")
        except Exception:
            return obj.hex()
    return str(obj)


def find_connection():
    try:
        import mysql.connector
    except ImportError:
        print("  Installazione mysql-connector-python...")
        os.system(f"{sys.executable} -m pip install mysql-connector-python --quiet")
        import mysql.connector

    for cred in CREDENTIALS:
        try:
            conn = mysql.connector.connect(
                host=cred["host"],
                port=cred["port"],
                user=cred["user"],
                password=cred["password"],
                connection_timeout=3,
                autocommit=True,
            )
            conn.ping()
            print(f"\n✅ Connessione MySQL riuscita!")
            print(f"   Host: {cred['host']}:{cred['port']}")
            print(f"   User: {cred['user']}")
            print(f"   Password: {'(vuota)' if not cred['password'] else '***'}")
            return conn, cred
        except Exception:
            pass

    return None, None


def get_databases(cursor):
    cursor.execute("SHOW DATABASES")
    return [row[0] for row in cursor.fetchall() if row[0] not in SYSTEM_DBS]


def get_tables(cursor, db):
    cursor.execute(f"USE `{db}`")
    cursor.execute("SHOW TABLES")
    return [row[0] for row in cursor.fetchall()]


def describe_table(cursor, table):
    try:
        cursor.execute(f"DESCRIBE `{table}`")
        cols = []
        for row in cursor.fetchall():
            cols.append({
                "field":   row[0],
                "type":    row[1],
                "null":    row[2],
                "key":     row[3],
                "default": row[4],
                "extra":   row[5],
            })
        return cols
    except Exception as e:
        return []


def count_rows(cursor, table):
    try:
        cursor.execute(f"SELECT COUNT(*) FROM `{table}`")
        return cursor.fetchone()[0]
    except Exception:
        return 0


def read_table(cursor, table, limit=2000):
    try:
        cursor.execute(f"SELECT * FROM `{table}` LIMIT {limit}")
        columns = [d[0] for d in cursor.description]
        rows = []
        for row in cursor.fetchall():
            rows.append(dict(zip(columns, row)))
        return rows
    except Exception as e:
        print(f"  ⚠ Errore lettura {table}: {e}")
        return []


def find_geca_database(cursor, databases):
    """Trova il database di GeCA tra quelli disponibili."""
    keywords = ["geca", "afsoft", "autoscuola", "driving", "scuola"]

    # Prima cerca per nome
    for db in databases:
        for kw in keywords:
            if kw in db.lower():
                return db

    # Poi cerca per presenza di tabelle candidate
    candidate_tables = {"candidati", "allievi", "candidato", "iscritti", "pratiche"}
    for db in databases:
        try:
            tables = get_tables(cursor, db)
            if candidate_tables & {t.lower() for t in tables}:
                return db
        except Exception:
            continue

    # Fallback: primo DB non di sistema
    return databases[0] if databases else None


def main():
    args = sys.argv[1:]
    do_export = "--export" in args
    do_schema = "--schema" in args

    print("━" * 50)
    print("  GECA MySQL Reader")
    print("━" * 50)
    print("Ricerca connessione MySQL locale...")

    conn, cred = find_connection()
    if not conn:
        print("\n❌ Nessuna connessione MySQL trovata.")
        print("\nSoluzioni:")
        print("  1. Verifica che GeCA sia aperto (avvia GecaFuture.exe)")
        print("  2. Verifica che MySQL sia in esecuzione (Servizi Windows > MySQL)")
        print("  3. Se conosci la password MySQL, aggiungila alla lista CREDENTIALS in questo script")
        sys.exit(1)

    cursor = conn.cursor()

    # Lista database
    databases = get_databases(cursor)
    print(f"\n📂 Database trovati: {', '.join(databases)}")

    geca_db = find_geca_database(cursor, databases)
    if not geca_db:
        print("❌ Database GeCA non identificato.")
        sys.exit(1)

    print(f"\n🎯 Database GeCA: \"{geca_db}\"")
    tables = get_tables(cursor, geca_db)
    print(f"\n📋 Tabelle trovate ({len(tables)}):")

    schema_all = {}
    counts_all = {}

    for table in sorted(tables):
        is_target = table.lower() in GECA_TABLES
        cols = describe_table(cursor, table)
        count = count_rows(cursor, table)
        schema_all[table] = cols
        counts_all[table] = count
        marker = "⭐" if is_target else "  "
        print(f"  {marker} {table:30s} → {count:>6} righe  ({len(cols)} colonne)")

    # Stampa schema tabelle importanti
    if not do_export or do_schema:
        print("\n🔍 Struttura tabelle principali:")
        for table in tables:
            if table.lower() not in GECA_TABLES:
                continue
            cols = schema_all.get(table, [])
            if not cols:
                continue
            count = counts_all.get(table, 0)
            print(f"\n  ┌─ {table} ({count} righe)")
            for col in cols[:25]:
                pk  = " [PK]" if col["key"] == "PRI" else ""
                nn  = " NOT NULL" if col["null"] == "NO" else ""
                print(f"  │  {col['field']:25s} {col['type']:20s}{pk}{nn}")
            if len(cols) > 25:
                print(f"  │  ... +{len(cols)-25} altre colonne")
            print(f"  └{'─'*50}")

    # Export JSON
    if do_export:
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        print(f"\n💾 Esportazione in: {OUTPUT_DIR}")

        exported = {}
        # Schema
        schema_path = os.path.join(OUTPUT_DIR, "_schema.json")
        with open(schema_path, "w", encoding="utf-8") as f:
            json.dump({
                "database": geca_db,
                "exported_at": datetime.datetime.now().isoformat(),
                "credentials": {"host": cred["host"], "user": cred["user"]},
                "tables": schema_all,
                "counts": counts_all,
            }, f, indent=2, default=serialize, ensure_ascii=False)
        print(f"  ✅ Schema → _schema.json")

        # Dati tabella per tabella
        for table in tables:
            limit = 5000 if table.lower() in GECA_TABLES else 500
            rows = read_table(cursor, table, limit=limit)
            if not rows:
                continue
            fname = f"{table}.json"
            fpath = os.path.join(OUTPUT_DIR, fname)
            with open(fpath, "w", encoding="utf-8") as f:
                json.dump({
                    "table": table,
                    "database": geca_db,
                    "count": len(rows),
                    "exported_at": datetime.datetime.now().isoformat(),
                    "rows": rows,
                }, f, indent=2, default=serialize, ensure_ascii=False)
            exported[table] = len(rows)
            marker = "⭐" if table.lower() in GECA_TABLES else "  "
            print(f"  {marker} {table:30s} → {len(rows)} righe → {fname}")

        # Summary
        summary = {
            "database": geca_db,
            "exported_at": datetime.datetime.now().isoformat(),
            "host": cred["host"],
            "user": cred["user"],
            "tables_exported": exported,
            "total_rows": sum(exported.values()),
        }
        with open(os.path.join(OUTPUT_DIR, "_summary.json"), "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2, default=serialize, ensure_ascii=False)

        print(f"\n✅ Esportazione completata!")
        print(f"   Tabelle: {len(exported)}")
        print(f"   Righe totali: {sum(exported.values())}")
        print(f"   Cartella: {OUTPUT_DIR}")

    cursor.close()
    conn.close()


if __name__ == "__main__":
    main()

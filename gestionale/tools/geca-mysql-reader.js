/**
 * GECA MySQL Reader
 * Legge direttamente il database MySQL locale di GeCAFuture
 * e lo esporta in JSON per analisi / import su Supabase.
 *
 * USAGE:
 *   node geca-mysql-reader.js              → prova credenziali standard, lista tabelle
 *   node geca-mysql-reader.js --export     → esporta tutte le tabelle in JSON
 *   node geca-mysql-reader.js --candidati  → mostra solo tabella candidati
 *
 * INSTALLA DIPENDENZE (una volta sola):
 *   npm install mysql2
 */

const mysql = require("mysql2/promise");
const fs    = require("fs");
const path  = require("path");

// ── CREDENZIALI DA PROVARE ────────────────────────────────────────
const CREDENTIALS_TO_TRY = [
  { host: "127.0.0.1", port: 3306, user: "root", password: "",           database: null },
  { host: "127.0.0.1", port: 3306, user: "root", password: "root",       database: null },
  { host: "127.0.0.1", port: 3306, user: "root", password: "afsoft",     database: null },
  { host: "127.0.0.1", port: 3306, user: "root", password: "geca",       database: null },
  { host: "127.0.0.1", port: 3306, user: "root", password: "gecafuture", database: null },
  { host: "127.0.0.1", port: 3306, user: "geca", password: "geca",       database: null },
  { host: "127.0.0.1", port: 3306, user: "geca", password: "root",       database: null },
  { host: "localhost",  port: 3306, user: "root", password: "",           database: null },
];

// ── TABELLE GECA INTERESSANTI ──────────────────────────────────────
// Queste tabelle sono quelle che GeCA usa tipicamente per candidati, pratiche, ecc.
// Vengono lette se trovate. Il vero nome potrebbe variare — verifichiamo con SHOW TABLES.
const TARGET_TABLES = [
  "candidati", "candidato", "allievi", "iscritti",
  "pratiche", "pratica", "pratiche_patente",
  "pagamenti", "pagamento", "incassi",
  "presenze", "presenza", "corso_presenze",
  "guide", "guida", "sessioni_guida",
  "esami", "esame", "prenotazioni",
  "users", "autoscuola", "config", "configurazione",
];

const OUTPUT_DIR = path.join(__dirname, "geca-export");

async function findConnection() {
  for (const cred of CREDENTIALS_TO_TRY) {
    try {
      const conn = await mysql.createConnection({ ...cred, connectTimeout: 3000 });
      await conn.query("SELECT 1");
      console.log(`\n✅ Connessione riuscita! User: ${cred.user} / Password: "${cred.password}"`);
      return conn;
    } catch (e) {
      // Prova prossima combinazione
    }
  }
  return null;
}

async function listDatabases(conn) {
  const [rows] = await conn.query("SHOW DATABASES");
  return rows.map((r) => Object.values(r)[0]);
}

async function listTables(conn, db) {
  await conn.query(`USE \`${db}\``);
  const [rows] = await conn.query("SHOW TABLES");
  return rows.map((r) => Object.values(r)[0]);
}

async function describeTable(conn, table) {
  try {
    const [rows] = await conn.query(`DESCRIBE \`${table}\``);
    return rows;
  } catch { return []; }
}

async function readTable(conn, table, limit = 500) {
  try {
    const [rows] = await conn.query(`SELECT * FROM \`${table}\` LIMIT ?`, [limit]);
    return rows;
  } catch (e) {
    console.warn(`  ⚠ Impossibile leggere ${table}: ${e.message}`);
    return [];
  }
}

async function main() {
  const args = process.argv.slice(2);
  const doExport = args.includes("--export");
  const doCandidati = args.includes("--candidati");

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  GECA MySQL Reader — analisi diretta DB");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Ricerca connessione MySQL locale...");

  const conn = await findConnection();
  if (!conn) {
    console.error("\n❌ Nessuna connessione trovata.");
    console.error("Prova a:\n  1. Aprire MySQL Workbench\n  2. Trovare la password root\n  3. Aggiungerla a CREDENTIALS_TO_TRY in questo script");
    process.exit(1);
  }

  // Lista database disponibili
  const dbs = await listDatabases(conn);
  console.log("\n📂 Database trovati:", dbs.join(", "));

  // Trova il database di GeCA (probabile nome)
  const gecaKeywords = ["geca", "afsoft", "autoscuola", "driving"];
  let gecaDb = dbs.find((d) => gecaKeywords.some((kw) => d.toLowerCase().includes(kw)));
  if (!gecaDb) {
    // Prova a listare tutte le tabelle di ogni DB per trovare quello con candidati
    for (const db of dbs) {
      if (["information_schema", "performance_schema", "mysql", "sys"].includes(db)) continue;
      const tables = await listTables(conn, db);
      const hasCandidate = tables.some((t) =>
        ["candidati", "allievi", "candidato", "iscritti"].includes(t.toLowerCase())
      );
      if (hasCandidate) {
        gecaDb = db;
        break;
      }
    }
  }
  if (!gecaDb) gecaDb = dbs.find((d) => !["information_schema", "performance_schema", "mysql", "sys"].includes(d));

  if (!gecaDb) {
    console.error("❌ Database GeCA non trovato.");
    process.exit(1);
  }

  console.log(`\n🎯 Database GeCA rilevato: "${gecaDb}"`);

  const tables = await listTables(conn, gecaDb);
  console.log(`\n📋 Tabelle (${tables.length}):`);
  tables.forEach((t) => {
    const isTarget = TARGET_TABLES.includes(t.toLowerCase());
    console.log(`  ${isTarget ? "⭐" : " "} ${t}`);
  });

  // Schema completo delle tabelle target
  console.log("\n🔍 Schema tabelle importanti:");
  for (const table of tables) {
    if (!TARGET_TABLES.includes(table.toLowerCase())) continue;
    const cols = await describeTable(conn, table);
    if (!cols.length) continue;
    console.log(`\n  ${table} (${cols.length} colonne):`);
    cols.slice(0, 20).forEach((c) => {
      console.log(`    - ${c.Field} [${c.Type}]${c.Key === "PRI" ? " PK" : ""}${c.Null === "NO" ? " NOT NULL" : ""}`);
    });
    const [countRows] = await conn.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    console.log(`    → ${countRows[0].n} righe nel DB`);
  }

  // Se richiesto --candidati, mostra un campione
  if (doCandidati) {
    const candidatiTable = tables.find((t) =>
      ["candidati", "allievi", "candidato", "iscritti"].includes(t.toLowerCase())
    );
    if (candidatiTable) {
      console.log(`\n👥 Campione ${candidatiTable} (prime 10 righe):`);
      const rows = await readTable(conn, candidatiTable, 10);
      rows.forEach((r, i) => console.log(`  [${i + 1}]`, JSON.stringify(r).slice(0, 200)));
    }
  }

  // Se richiesto --export, esporta tutte le tabelle target
  if (doExport) {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`\n💾 Esportazione in: ${OUTPUT_DIR}`);

    const exportedTables = {};
    for (const table of tables) {
      // Esporta sia le tabelle target che tutte le altre (max 1000 righe)
      const limit = TARGET_TABLES.includes(table.toLowerCase()) ? 5000 : 200;
      const rows = await readTable(conn, table, limit);
      if (!rows.length) continue;

      const outPath = path.join(OUTPUT_DIR, `${gecaDb}_${table}.json`);
      fs.writeFileSync(outPath, JSON.stringify({ table, database: gecaDb, count: rows.length, rows }, null, 2));
      console.log(`  ✅ ${table}: ${rows.length} righe → ${path.basename(outPath)}`);
      exportedTables[table] = rows.length;
    }

    // File summary
    const summaryPath = path.join(OUTPUT_DIR, "_summary.json");
    fs.writeFileSync(summaryPath, JSON.stringify({
      database: gecaDb,
      exported_at: new Date().toISOString(),
      tables: exportedTables,
      total_tables: Object.keys(exportedTables).length,
    }, null, 2));
    console.log(`\n📊 Summary salvato: ${summaryPath}`);
    console.log(`\n✅ Esportazione completa! Apri la cartella: ${OUTPUT_DIR}`);
  }

  await conn.end();
}

main().catch((err) => {
  console.error("\n❌ Errore:", err.message);
  process.exit(1);
});

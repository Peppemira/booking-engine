require("dotenv").config({ quiet: true });

const supabase = require("./database/supabase");
const { importMassivo } = require("./connector/importByPatente");
const { addImportHistory } = require("./server/importHistory");

function parseArgs(argv = []) {
  const options = {
    statusFilter: String(process.env.ARCHIVIO_STATO_FILTRO || "tutti").trim().toLowerCase(),
    only: String(process.env.ARCHIVIO_SYNC_ONLY || "").trim().toLowerCase(),
    codiceOverride: String(process.env.ARCHIVIO_CODICE_AUTOSCUOLA || "").trim(),
    dryRun: String(process.env.ARCHIVIO_SYNC_DRY_RUN || "false").toLowerCase() === "true",
  };

  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [rawKey, ...rest] = arg.slice(2).split("=");
    const key = String(rawKey || "").trim().toLowerCase();
    const value = rest.join("=").trim();

    if (key === "status" && value) options.statusFilter = value.toLowerCase();
    if (key === "only" && value) options.only = value.toLowerCase();
    if (key === "codice" && value) options.codiceOverride = value;
    if (key === "dry-run") options.dryRun = value ? value.toLowerCase() === "true" : true;
  }

  if (!["tutti", "attivi", "passati"].includes(options.statusFilter)) {
    throw new Error(`Filtro stato non valido: ${options.statusFilter}. Usa: tutti | attivi | passati`);
  }

  return options;
}

function resolveAutoscuolaCode(row = {}) {
  const direct = String(row.codice_autoscuola || row.codiceAutoscuola || row.codice_scuola || row.codice || "").trim();
  return direct || "";
}

function rowMatchesFilter(row, only) {
  if (!only) return true;
  const values = [row.id, row.nome, row.email, resolveAutoscuolaCode(row)]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  return values.some((value) => value.includes(only));
}

async function loadAutoscuole() {
  const { data, error } = await supabase
    .from("autoscuole")
    .select("*");

  if (error) {
    throw new Error(`Errore lettura autoscuole: ${error.message}`);
  }

  return Array.isArray(data) ? data : [];
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const autoscuole = await loadAutoscuole();

  const candidates = autoscuole.filter((row) => rowMatchesFilter(row, options.only));
  const withConfig = candidates.filter((row) => {
    const resolvedCode = resolveAutoscuolaCode(row) || (candidates.length === 1 ? options.codiceOverride : "");
    const hasCode = String(resolvedCode || "").trim().length > 0;
    const hasPortalUser = String(row.portal_user || "").trim().length > 0;
    const hasPortalPass = String(row.portal_pass || "").trim().length > 0;
    return hasCode && hasPortalUser && hasPortalPass;
  });
  const skipped = candidates.length - withConfig.length;

  const summary = {
    scanned: autoscuole.length,
    selected: candidates.length,
    runnable: withConfig.length,
    skipped,
    statusFilter: options.statusFilter,
    dryRun: options.dryRun,
    ok: 0,
    failed: 0,
    parsed: 0,
    selectedRows: 0,
    imported: 0,
    errors: [],
  };

  console.log(
    `[sync-archivio] Avvio: autoscuole=${summary.scanned}, selezionate=${summary.selected}, eseguibili=${summary.runnable}, skipped=${summary.skipped}, stato=${summary.statusFilter}, dryRun=${summary.dryRun}`
  );

  if (!withConfig.length) {
    console.log("[sync-archivio] Nessuna autoscuola eseguibile (mancano codice_autoscuola/portal_user/portal_pass)");
    return summary;
  }

  for (const row of withConfig) {
    const label = `${row.nome || row.email || row.id} (${row.codice_autoscuola})`;
    const codiceAutoscuola = resolveAutoscuolaCode(row) || (candidates.length === 1 ? options.codiceOverride : "");
    const labelWithCode = `${row.nome || row.email || row.id} (${codiceAutoscuola || "CODICE_MANCANTE"})`;

    if (options.dryRun) {
      console.log(`[sync-archivio] DRY RUN - skip import: ${labelWithCode}`);
      continue;
    }

    try {
      const result = await importMassivo({
        codiceAutoscuola,
        statoFiltro: options.statusFilter,
        autoSelectForBooking: false,
        autoscuolaId: row.id,
        portalCredentials: {
          username: row.portal_user,
          password: row.portal_pass,
          pin: row.portal_pin || process.env.PORTAL_PIN || null,
        },
      });

      summary.ok += 1;
      summary.parsed += Number(result.parsed || 0);
      summary.selectedRows += Number(result.selected || 0);
      summary.imported += Array.isArray(result.imported) ? result.imported.length : Number(result.imported || 0);

      const errorCount = Array.isArray(result.errors) ? result.errors.length : 0;

      await addImportHistory({
        type: "import-archivio-cron",
        status: "ok",
        criteria: {
          autoscuolaId: row.id,
          codiceAutoscuola,
          statoFiltro: options.statusFilter,
        },
        parsed: result.parsed,
        selected: result.selected,
        imported: Array.isArray(result.imported) ? result.imported.length : 0,
        errors: errorCount,
        message: `Sync archivio completato per ${row.nome || row.email || row.id}`,
      });

      console.log(
        `[sync-archivio] OK ${labelWithCode} -> parsed=${result.parsed}, selected=${result.selected}, imported=${Array.isArray(result.imported) ? result.imported.length : 0}, errors=${errorCount}`
      );
    } catch (error) {
      summary.failed += 1;
      const message = error?.message || String(error);
      summary.errors.push({
        autoscuolaId: row.id,
        codiceAutoscuola,
        message,
      });

      await addImportHistory({
        type: "import-archivio-cron",
        status: "error",
        criteria: {
          autoscuolaId: row.id,
          codiceAutoscuola,
          statoFiltro: options.statusFilter,
        },
        errors: 1,
        message,
      });

      console.error(`[sync-archivio] KO ${labelWithCode} -> ${message}`);
    }
  }

  return summary;
}

run()
  .then((summary) => {
    console.log(`[sync-archivio] Fine: ${JSON.stringify(summary)}`);
    if (!summary.dryRun && summary.failed > 0) {
      process.exitCode = 1;
    }
  })
  .catch((error) => {
    console.error(`[sync-archivio] Errore fatale: ${error?.message || String(error)}`);
    process.exit(1);
  });

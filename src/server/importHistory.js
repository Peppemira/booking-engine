const fs = require("fs/promises");
const path = require("path");

const filePath = path.join(__dirname, "..", "..", "data", "import-history.json");
const MAX_ITEMS = 200;

async function ensureFile() {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify([], null, 2), "utf-8");
  }
}

async function getImportHistory(limit = 50) {
  await ensureFile();
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.slice(0, Math.max(1, Number(limit) || 50));
  } catch {
    return [];
  }
}

async function addImportHistory(entry = {}) {
  await ensureFile();
  const current = await getImportHistory(MAX_ITEMS);
  const nextEntry = {
    id: `${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    at: new Date().toISOString(),
    type: String(entry.type || "import"),
    status: String(entry.status || "ok"),
    criteria: entry.criteria || null,
    parsed: Number.isFinite(Number(entry.parsed)) ? Number(entry.parsed) : null,
    imported: Number.isFinite(Number(entry.imported)) ? Number(entry.imported) : null,
    linked: Number.isFinite(Number(entry.linked)) ? Number(entry.linked) : null,
    errors: Number.isFinite(Number(entry.errors)) ? Number(entry.errors) : 0,
    message: entry.message || null,
  };

  const updated = [nextEntry, ...current].slice(0, MAX_ITEMS);
  await fs.writeFile(filePath, JSON.stringify(updated, null, 2), "utf-8");
  return nextEntry;
}

module.exports = {
  getImportHistory,
  addImportHistory,
};

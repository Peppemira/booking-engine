const fs = require("fs/promises");
const path = require("path");

const statusFilePath = path.join(__dirname, "..", "..", "data", "engine-status.json");

const DEFAULT_STATUS = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastUpdatedAt: null,
  lastResult: "idle",
  lastMessage: "In attesa",
  lastCandidateId: null,
  trigger: "system",
  pid: null,
};

async function ensureStatusFile() {
  const dirPath = path.dirname(statusFilePath);
  await fs.mkdir(dirPath, { recursive: true });

  try {
    await fs.access(statusFilePath);
  } catch {
    await fs.writeFile(statusFilePath, JSON.stringify(DEFAULT_STATUS, null, 2), "utf-8");
  }
}

async function getEngineStatus() {
  await ensureStatusFile();

  try {
    const raw = await fs.readFile(statusFilePath, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_STATUS, ...parsed };
  } catch {
    return { ...DEFAULT_STATUS };
  }
}

async function saveEngineStatus(partial) {
  const current = await getEngineStatus();
  const nowIso = new Date().toISOString();
  const next = {
    ...current,
    lastUpdatedAt: nowIso,
    ...(partial || {}),
  };

  await fs.writeFile(statusFilePath, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

module.exports = {
  getEngineStatus,
  saveEngineStatus,
};

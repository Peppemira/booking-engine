const fs = require("fs/promises");
const path = require("path");

const settingsFilePath = path.join(__dirname, "..", "..", "data", "search-settings.json");

const DEFAULT_SETTINGS = {
  enabled: true,
  timezone: "Europe/Rome",
  days: [1, 2, 3, 4, 5, 6, 0],
  startTime: "08:00",
  endTime: "21:00",
};

function normalizeTime(value, fallback) {
  if (typeof value !== "string") return fallback;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;

  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return fallback;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return fallback;

  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function normalizeDays(days) {
  if (!Array.isArray(days)) return [...DEFAULT_SETTINGS.days];
  const normalized = [...new Set(days.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  return normalized.length ? normalized : [...DEFAULT_SETTINGS.days];
}

function sanitizeSettings(input = {}) {
  return {
    enabled: input.enabled === undefined ? DEFAULT_SETTINGS.enabled : Boolean(input.enabled),
    timezone:
      typeof input.timezone === "string" && input.timezone.trim().length
        ? input.timezone.trim()
        : DEFAULT_SETTINGS.timezone,
    days: normalizeDays(input.days),
    startTime: normalizeTime(input.startTime, DEFAULT_SETTINGS.startTime),
    endTime: normalizeTime(input.endTime, DEFAULT_SETTINGS.endTime),
  };
}

async function ensureSettingsFile() {
  const dirPath = path.dirname(settingsFilePath);
  await fs.mkdir(dirPath, { recursive: true });

  try {
    await fs.access(settingsFilePath);
  } catch {
    await fs.writeFile(settingsFilePath, JSON.stringify(DEFAULT_SETTINGS, null, 2), "utf-8");
  }
}

async function getSearchSettings() {
  await ensureSettingsFile();

  try {
    const raw = await fs.readFile(settingsFilePath, "utf-8");
    const parsed = JSON.parse(raw);
    return sanitizeSettings(parsed);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSearchSettings(settingsInput) {
  const safe = sanitizeSettings(settingsInput);
  await ensureSettingsFile();
  await fs.writeFile(settingsFilePath, JSON.stringify(safe, null, 2), "utf-8");
  return safe;
}

function getRomeCurrentSlot(timezone) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone || DEFAULT_SETTINGS.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date());
  const weekdayPart = parts.find((p) => p.type === "weekday")?.value || "Mon";
  const hour = parts.find((p) => p.type === "hour")?.value || "00";
  const minute = parts.find((p) => p.type === "minute")?.value || "00";

  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    day: weekdayMap[weekdayPart] ?? 1,
    time: `${hour}:${minute}`,
  };
}

function isWithinSearchWindow(settings) {
  const safe = sanitizeSettings(settings);
  if (!safe.enabled) return false;

  const slot = getRomeCurrentSlot(safe.timezone);
  if (!safe.days.includes(slot.day)) return false;

  return slot.time >= safe.startTime && slot.time <= safe.endTime;
}

function formatSlotLabel(day, time) {
  const labels = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
  return `${labels[day] || "?"} ${time}`;
}

function getNextSearchWindow(settings) {
  const safe = sanitizeSettings(settings);
  const slot = getRomeCurrentSlot(safe.timezone);

  if (!safe.enabled) {
    return {
      allowedNow: false,
      currentSlot: slot,
      currentSlotLabel: formatSlotLabel(slot.day, slot.time),
      nextWindow: null,
      nextWindowLabel: "Ricerca disabilitata",
    };
  }

  const allowedNow = safe.days.includes(slot.day) && slot.time >= safe.startTime && slot.time <= safe.endTime;
  if (allowedNow) {
    return {
      allowedNow: true,
      currentSlot: slot,
      currentSlotLabel: formatSlotLabel(slot.day, slot.time),
      nextWindow: { day: slot.day, time: slot.time },
      nextWindowLabel: "Attiva ora",
    };
  }

  for (let offset = 0; offset <= 7; offset += 1) {
    const day = (slot.day + offset) % 7;
    if (!safe.days.includes(day)) {
      continue;
    }

    if (offset === 0 && slot.time > safe.endTime) {
      continue;
    }

    if (offset === 0 && slot.time < safe.startTime) {
      return {
        allowedNow: false,
        currentSlot: slot,
        currentSlotLabel: formatSlotLabel(slot.day, slot.time),
        nextWindow: { day, time: safe.startTime },
        nextWindowLabel: formatSlotLabel(day, safe.startTime),
      };
    }

    if (offset > 0) {
      return {
        allowedNow: false,
        currentSlot: slot,
        currentSlotLabel: formatSlotLabel(slot.day, slot.time),
        nextWindow: { day, time: safe.startTime },
        nextWindowLabel: formatSlotLabel(day, safe.startTime),
      };
    }
  }

  return {
    allowedNow: false,
    currentSlot: slot,
    currentSlotLabel: formatSlotLabel(slot.day, slot.time),
    nextWindow: null,
    nextWindowLabel: "Nessuna finestra valida configurata",
  };
}

module.exports = {
  DEFAULT_SETTINGS,
  getSearchSettings,
  saveSearchSettings,
  isWithinSearchWindow,
  getNextSearchWindow,
};

const fs = require("fs");
const path = require("path");

function parseEnv(content) {
  const map = new Map();
  String(content || "")
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) return;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      map.set(key, value);
    });
  return map;
}

function exists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function checkRequired(envMap, keys) {
  const missing = [];
  for (const key of keys) {
    const value = envMap.get(key);
    if (!value || value === "" || value.includes("YOUR_") || value.includes("change-me")) {
      missing.push(key);
    }
  }
  return missing;
}

function main() {
  const root = process.cwd();
  const backendDir = path.join(root, "backend");
  const frontendDir = path.join(root, "frontend");

  const requiredFiles = [
    path.join(backendDir, "railway.json"),
    path.join(frontendDir, "railway.json"),
    path.join(backendDir, "sql", "2026-02-25_multi_autoscuola_auth.sql"),
    path.join(root, "DEPLOY_RAILWAY.md"),
  ];

  const backendEnvPath = path.join(backendDir, ".env");
  const backendEnvExamplePath = path.join(backendDir, ".env.railway.example");
  const frontendEnvExamplePath = path.join(frontendDir, ".env.railway.example");

  console.log("\n=== Railway Deploy Readiness ===\n");

  let hasError = false;

  for (const filePath of requiredFiles) {
    const ok = exists(filePath);
    console.log(`${ok ? "✅" : "❌"} ${path.relative(root, filePath)}`);
    if (!ok) hasError = true;
  }

  console.log("");

  if (!exists(backendEnvPath)) {
    console.log("❌ backend/.env mancante (crea da backend/.env.railway.example)");
    hasError = true;
  } else {
    const env = parseEnv(fs.readFileSync(backendEnvPath, "utf-8"));
    const missing = checkRequired(env, [
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE",
      "JWT_SECRET",
      "AUTH_REQUIRED",
      "MULTI_AUTOSCUOLA",
      "ENGINE_AUTO_START",
      "PORTAL_USERNAME",
      "PORTAL_PASSWORD",
      "PORTAL_PIN",
    ]);

    if (missing.length) {
      console.log(`❌ backend/.env variabili mancanti o placeholder: ${missing.join(", ")}`);
      hasError = true;
    } else {
      console.log("✅ backend/.env configurato (chiavi principali presenti)");
    }
  }

  if (!exists(backendEnvExamplePath)) {
    console.log("❌ backend/.env.railway.example mancante");
    hasError = true;
  } else {
    console.log("✅ backend/.env.railway.example presente");
  }

  if (!exists(frontendEnvExamplePath)) {
    console.log("❌ frontend/.env.railway.example mancante");
    hasError = true;
  } else {
    console.log("✅ frontend/.env.railway.example presente");
  }

  console.log("");

  if (hasError) {
    console.log("⚠️ Readiness NON completa: completa i punti indicati sopra.");
    process.exitCode = 1;
  } else {
    console.log("🚀 Readiness OK: puoi procedere al deploy Railway.");
  }
}

main();

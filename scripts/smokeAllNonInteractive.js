"use strict";

const { spawnSync } = require("node:child_process");

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: true,
  });

  if (typeof result.status === "number") {
    return result.status;
  }

  if (result.error) {
    console.error("SMOKE_ALL_NONINTERACTIVE_FAILED");
    console.error(result.error.message);
  }

  return 1;
}

const token = String(process.env.SMOKE_AUTH_TOKEN || "").trim();

console.log("[smoke:all:noninteractive] Running smoke:payment-actions...");
const actionsStatus = run("npm", ["run", "smoke:payment-actions"]);
if (actionsStatus !== 0) {
  process.exit(actionsStatus);
}

if (!token) {
  console.log("[smoke:all:noninteractive] SMOKE_AUTH_TOKEN not set: skipping smoke:payment-history:readonly.");
  process.exit(0);
}

console.log("[smoke:all:noninteractive] Running smoke:payment-history:readonly...");
const readonlyStatus = run("npm", ["run", "smoke:payment-history:readonly"]);
process.exit(readonlyStatus);

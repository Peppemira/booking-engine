const { runEngine } = require("./engine");

const everySeconds = Number(process.env.ENGINE_AUTO_INTERVAL_SECONDS || 30);
const intervalMs = Math.max(10, everySeconds) * 1000;

let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    await runEngine();
  } catch (error) {
    console.error("engineAuto error:", error.message);
  } finally {
    running = false;
  }
}

console.log(`engineAuto attivo: controllo ogni ${intervalMs / 1000}s`);
setInterval(tick, intervalMs);

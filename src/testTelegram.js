require("dotenv").config({ quiet: true });
const { sendTelegram } = require("./telegram");

(async () => {
  const ok = await sendTelegram("Test: bot collegato correttamente");
  console.log("Inviato:", ok);
})();
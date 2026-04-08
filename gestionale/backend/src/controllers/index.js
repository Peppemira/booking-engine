/**
 * Export centralizzato controller REST.
 */

const candidatiController = require("./candidatiController");
const patenteController = require("./patenteController");
const prenotazioniController = require("./prenotazioniController");
const documentiController = require("./documentiController");
const pagamentiController = require("./pagamentiController");
const portaleController = require("./portaleController");
const syncController = require("./syncController");
const radarController = require("./radarController");
const calendarController = require("./calendarController");

module.exports = {
  candidatiController,
  patenteController,
  prenotazioniController,
  documentiController,
  pagamentiController,
  portaleController,
  syncController,
  radarController,
  calendarController,
};

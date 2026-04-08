require("dotenv").config({ quiet: true });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_ENABLED = String(process.env.TELEGRAM_ENABLED ?? "true").toLowerCase() !== "false";
const TELEGRAM_COOLDOWN_MS = Math.max(0, Number(process.env.TELEGRAM_COOLDOWN_SECONDS || 900) * 1000);

const lastSentAtByMessage = new Map();

function shouldSendNow(text) {
  if (!TELEGRAM_COOLDOWN_MS) return true;

  const normalized = String(text || "").trim();
  const now = Date.now();
  const last = lastSentAtByMessage.get(normalized) || 0;

  if (now - last < TELEGRAM_COOLDOWN_MS) {
    return false;
  }

  lastSentAtByMessage.set(normalized, now);
  return true;
}

async function sendTelegram(text) {
  if (!TELEGRAM_ENABLED) {
    return true;
  }

  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn("Telegram non configurato");
    return false;
  }

  if (!shouldSendNow(text)) {
    return true;
  }

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: String(text)
      })
    });

    const data = await res.json();

    if (!data.ok) {
      console.error("Errore Telegram:", data);
      return false;
    }

    return true;

  } catch (err) {
    console.error("Errore invio Telegram:", err.message);
    return false;
  }
}

/**
 * Invia un messaggio di prenotazione esame formattato
 * @param {object} booking - Dati prenotazione
 * @param {string} booking.data - Data esame (es. 2025-03-15)
 * @param {string} booking.nome - Nome candidato
 * @param {string} booking.cognome - Cognome candidato
 * @param {string} booking.categoria - Categoria patente (es. B, C, D)
 * @param {string} [booking.ora] - Ora esame (opzionale)
 * @param {string} [booking.luogo] - Luogo esame (opzionale)
 * @returns {Promise<boolean>} Successo invio
 */
async function sendBookingNotification(booking) {
  if (!booking || !booking.nome || !booking.cognome || !booking.data || !booking.categoria) {
    console.warn("Dati prenotazione incompleti");
    return false;
  }

  const formatDate = (dateStr) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString("it-IT", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      });
    } catch (e) {
      return dateStr;
    }
  };

  const text = `📅 *Prenotazione Esame*\n\n` +
    `👤 *Nome:* ${booking.nome}\n` +
    `📋 *Cognome:* ${booking.cognome}\n` +
    `🚗 *Categoria:* ${booking.categoria}\n` +
    `📆 *Data:* ${formatDate(booking.data)}\n` +
    (booking.ora ? `🕐 *Ora:* ${booking.ora}\n` : "") +
    (booking.luogo ? `📍 *Luogo:* ${booking.luogo}\n` : "") +
    `\n✅ Prenotazione registrata con successo`;

  return sendTelegram(text);
}

module.exports = { sendTelegram, sendBookingNotification };
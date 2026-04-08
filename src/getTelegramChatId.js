"use strict";

require("dotenv").config({ quiet: true });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error("Manca TELEGRAM_BOT_TOKEN nel file .env");
  process.exit(1);
}

const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?limit=100`;

(async () => {
  try {
    const res = await fetch(url);
    const json = await res.json().catch(() => null);

    if (!res.ok || !json || json.ok !== true) {
      console.error("Telegram API errore:", res.status, json);
      process.exit(1);
    }

    if (!json.result || json.result.length === 0) {
      console.log("Nessun aggiornamento: invia un messaggio al bot e riesegui lo script.");
      process.exit(0);
    }

    const chats = new Map();
    for (const upd of json.result) {
      const msg = upd.message || upd.channel_post || upd.edited_message || (upd.callback_query && upd.callback_query.message);
      if (!msg) continue;
      const chat = msg.chat;
      if (!chat) continue;
      chats.set(chat.id, {
        id: chat.id,
        type: chat.type,
        title: chat.title,
        username: chat.username,
        first_name: chat.first_name,
        last_name: chat.last_name,
      });
    }

    if (chats.size === 0) {
      console.log("Nessuna chat trovata negli aggiornamenti.");
      process.exit(0);
    }

    console.log("Chat trovate:");
    for (const [id, info] of chats) {
      const name = info.title || [info.first_name, info.last_name].filter(Boolean).join(" ") || "(nessun nome)";
      console.log(id, "-", info.type, "-", name, info.username ? `(@${info.username})` : "");
    }
  } catch (err) {
    console.error("Errore rete:", err && err.message ? err.message : err);
    process.exit(1);
  }
})();

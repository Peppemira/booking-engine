require("dotenv").config({ quiet: true });
const fs = require("fs");

const supabase = require("./database/supabase");
const { sendTelegram } = require("./telegram");
const { loginAndGetJar } = require("./connector/portalSession");
const { getSearchSettings, isWithinSearchWindow, getNextSearchWindow } = require("./server/searchSettings");
const { saveEngineStatus } = require("./server/engineStatus");
const {
  makeHttpClient,
  loadMenu,
  readSessioniQuizInterne,
} = require("./connector/portalHttp");
const { parseSessioni } = require("./parser/sessionParser");
const { prenotaSessione, confermaPrenotazione } = require("./connector/booking");

const pollingMs = Number(process.env.POLLING_INTERVAL || 60) * 1000;

async function runEngine() {
  console.log("Controllo lista attesa...");

  const searchSettings = await getSearchSettings();
  const canRunNow = isWithinSearchWindow(searchSettings);
  const forceRun = String(process.env.ENGINE_FORCE_RUN || "false").toLowerCase() === "true";

  if (!canRunNow && !forceRun) {
    const windowInfo = getNextSearchWindow(searchSettings);
    await saveEngineStatus({
      running: false,
      lastFinishedAt: new Date().toISOString(),
      lastResult: "warning",
      lastMessage: `Fuori finestra ricerca. Prossima: ${windowInfo.nextWindowLabel}`,
      lastCandidateId: null,
      pid: process.pid,
      trigger: forceRun ? "manual" : "schedule",
    });
    console.log(
      "Ricerca sedute fuori finestra operatore:",
      `enabled=${searchSettings.enabled}, days=${searchSettings.days.join(',')}, ` +
      `orario=${searchSettings.startTime}-${searchSettings.endTime} ${searchSettings.timezone}, ` +
      `next=${windowInfo.nextWindowLabel}`
    );
    return;
  }

  if (!canRunNow && forceRun) {
    console.log("Avvio forzato ricerca sedute (bypass finestra operatore)");
  }

  try {
    const { data, error } = await supabase
      .from("waitlist")
      .select("*")
      .eq("status", "pending")
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(1);

    console.log("SUPABASE error:", error);
    console.log("SUPABASE rows trovate:", data?.length);
    if (data?.[0]) console.log("SUPABASE first row:", data[0]);

    if (error) {
      console.error("Errore Supabase:", error.message);
      await sendTelegram("Errore Supabase: " + error.message);
      return;
    }

    if (!data || data.length === 0) {
      console.log("Nessun candidato in attesa con status 'pending'");
      await saveEngineStatus({
        running: false,
        lastFinishedAt: new Date().toISOString(),
        lastResult: "warning",
        lastMessage: "Nessun candidato pending",
        lastCandidateId: null,
        pid: process.pid,
        trigger: forceRun ? "manual" : "schedule",
      });
      return;
    }

    const candidate = data[0];

    console.log("Trovato candidato:", candidate.id);

    const { data: lockedCandidate, error: lockError } = await supabase
      .from("waitlist")
      .update({
        status: "in_progress",
        last_attempt_at: new Date().toISOString(),
      })
      .eq("id", candidate.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (lockError) {
      console.error("Errore lock candidato:", lockError.message);
      await sendTelegram("Errore lock candidato: " + lockError.message);
      return;
    }

    if (!lockedCandidate) {
      console.log("Candidato già in lavorazione da un altro processo:", candidate.id);
      return;
    }

    await sendTelegram(
      "Trovato candidato in attesa ID: " + candidate.id
    );

    // Esegui login e prenotazione
    try {
      console.log("Avvio login + sessioni HTTP per candidato", candidate.id);
      const jar = await loginAndGetJar({
        username: process.env.PORTAL_USER || process.env.PORTAL_USERNAME,
        password: process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD,
        pin: process.env.PORTAL_PIN,
      });
      const http = makeHttpClient(jar);

      await loadMenu(http);
      const html = await readSessioniQuizInterne(http);
      fs.writeFileSync(`sessioni_${candidate.id}.html`, html, "utf-8");
      fs.writeFileSync("sessioni_last.html", html, "utf-8");

      const sessioni = parseSessioni(html);
      console.log("Sessioni trovate:", sessioni);

      let bookingAttempted = false;
      let bookingConfirmed = false;

      if (!sessioni.length) {
        console.log("❌ Nessuna sessione disponibile");

        await supabase
          .from("waitlist")
          .update({
            status: "pending",
            last_error: "Nessuna sessione disponibile valida trovata",
            last_attempt_at: new Date().toISOString(),
          })
          .eq("id", candidate.id);

        await saveEngineStatus({
          running: false,
          lastFinishedAt: new Date().toISOString(),
          lastResult: "warning",
          lastMessage: "Nessuna sessione disponibile valida",
          lastCandidateId: candidate.id,
          pid: process.pid,
          trigger: forceRun ? "manual" : "schedule",
        });

        return;
      } else {
        console.log("✅ Prima sessione:", sessioni[0]);

        const primaConPosti = sessioni.find((s) => {
          const postiNumero = Number.parseInt(String(s.posti || "").replace(/[^0-9]/g, ""), 10);
          return Number.isFinite(postiNumero) && postiNumero > 0;
        }) || sessioni[0];

        await sendTelegram(
          `Seduta trovata: data=${primaConPosti.data || "n/d"}, posti=${primaConPosti.posti || "n/d"}`
        );

        const prima = primaConPosti;
        console.log("🎯 Provo a prenotare:", prima);

        const rispostaStep2 = await prenotaSessione(http, prima);
        fs.writeFileSync("step2.html", rispostaStep2, "utf-8");
        fs.writeFileSync(`step2_${candidate.id}.html`, rispostaStep2, "utf-8");
        bookingAttempted = true;

        let rispostaStep3 = "";
        try {
          rispostaStep3 = await confermaPrenotazione(http, rispostaStep2);
          fs.writeFileSync("step3.html", rispostaStep3, "utf-8");
          fs.writeFileSync(`step3_${candidate.id}.html`, rispostaStep3, "utf-8");
          console.log("📄 Salvato step3.html");
        } catch (confirmErr) {
          console.warn("⚠️ Conferma automatica non completata:", confirmErr.message);
          rispostaStep3 = rispostaStep2;
        }

        const responseText = String(rispostaStep3 || "").toLowerCase();
        bookingConfirmed =
          responseText.includes("prenotazione effettuata") ||
          responseText.includes("conferma prenotazione") ||
          responseText.includes("prenotazione confermata");

        console.log("📄 Salvato step2.html");
      }

      if (!bookingAttempted) {
        await supabase
          .from("waitlist")
          .update({
            status: "pending",
            last_error: "Prenotazione non avviata",
            last_attempt_at: new Date().toISOString(),
          })
          .eq("id", candidate.id);

        await saveEngineStatus({
          running: false,
          lastFinishedAt: new Date().toISOString(),
          lastResult: "warning",
          lastMessage: "Prenotazione non avviata",
          lastCandidateId: candidate.id,
          pid: process.pid,
          trigger: forceRun ? "manual" : "schedule",
        });
        return;
      }

      // Aggiorna stato solo se c'è conferma reale
      const { error: updateError } = await supabase
        .from("waitlist")
        .update({
          status: bookingConfirmed ? "completed" : "pending",
          last_error: bookingConfirmed
            ? null
            : "STEP2 eseguito ma manca conferma finale prenotazione",
          last_attempt_at: new Date().toISOString(),
        })
        .eq("id", candidate.id);

      if (updateError) {
        console.error("Errore aggiornamento:", updateError.message);
        await sendTelegram("Errore aggiornamento: " + updateError.message);
        return;
      }

      console.log(
        bookingConfirmed
          ? "Prenotazione completata:"
          : "STEP2 completato, in attesa di conferma finale:",
        candidate.id
      );

      await sendTelegram(
        bookingConfirmed
          ? "Prenotazione completata per candidato ID: " + candidate.id
          : "STEP2 completato per candidato ID: " + candidate.id + " (conferma finale mancante)"
      );

      await saveEngineStatus({
        running: false,
        lastFinishedAt: new Date().toISOString(),
        lastResult: bookingConfirmed ? "ok" : "warning",
        lastMessage: bookingConfirmed
          ? `Prenotazione completata candidato ${candidate.id}`
          : `STEP2 completato candidato ${candidate.id}, conferma finale mancante`,
        lastCandidateId: candidate.id,
        pid: process.pid,
        trigger: forceRun ? "manual" : "schedule",
      });

    } catch (loginErr) {
      console.error("Errore login/prenotazione:", loginErr.message);
      await sendTelegram("Errore login candidato " + candidate.id + ": " + loginErr.message);

      await supabase
        .from("waitlist")
        .update({
          status: "pending",
          last_error: loginErr.message,
          last_attempt_at: new Date().toISOString(),
        })
        .eq("id", candidate.id);

      await saveEngineStatus({
        running: false,
        lastFinishedAt: new Date().toISOString(),
        lastResult: "error",
        lastMessage: loginErr.message,
        lastCandidateId: candidate.id,
        pid: process.pid,
        trigger: forceRun ? "manual" : "schedule",
      });

      return;
    }

  } catch (err) {
    console.error("Errore generale:", err.message);
    await sendTelegram("Errore engine: " + err.message);
    await saveEngineStatus({
      running: false,
      lastFinishedAt: new Date().toISOString(),
      lastResult: "error",
      lastMessage: err.message,
      lastCandidateId: null,
      pid: process.pid,
      trigger: forceRun ? "manual" : "schedule",
    });
  }
}

async function start() {
  console.log("Engine avviato");
  console.log("Polling ogni", pollingMs / 1000, "secondi");

  await saveEngineStatus({
    running: true,
    lastStartedAt: new Date().toISOString(),
    lastResult: "running",
    lastMessage: "Esecuzione in corso",
    lastCandidateId: null,
    pid: process.pid,
    trigger: String(process.env.ENGINE_FORCE_RUN || "false").toLowerCase() === "true" ? "manual" : "schedule",
  });

  await runEngine();

  if (String(process.env.ENGINE_LOOP || "false").toLowerCase() === "true") {
    setInterval(runEngine, pollingMs);
  } else {
    console.log("Modalità single-run completata (ENGINE_LOOP != true)");
  }
}

if (require.main === module) {
  start();
}

module.exports = {
  runEngine,
  start,
};
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  API_BASE,
  authHeaders,
  checkSession,
  logoutSession,
} from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const GIORNI = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mer" },
  { value: 4, label: "Gio" },
  { value: 5, label: "Ven" },
  { value: 6, label: "Sab" },
  { value: 0, label: "Dom" },
];

// ---------------------------------------------------------------------------
// Hook stato sezione (loading / success / error)
// ---------------------------------------------------------------------------

function useSectionState() {
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState("");
  const [err, setErr] = useState("");

  function reset() { setOk(""); setErr(""); }

  async function run(fn) {
    setBusy(true); reset();
    try {
      const msg = await fn();
      setOk(msg || "Salvato.");
    } catch (e) {
      setErr(e.message || "Errore.");
    } finally {
      setBusy(false);
    }
  }

  return { busy, ok, err, run, reset };
}

// ---------------------------------------------------------------------------
// Card sezione
// ---------------------------------------------------------------------------

function SectionCard({ title, subtitle, icon, children }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-xl">{icon}</span>
        <div>
          <h2 className="font-bold text-slate-800">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feedback inline
// ---------------------------------------------------------------------------

function Feedback({ busy, ok, err }) {
  if (busy) return <p className="mt-2 text-xs text-slate-500">Salvataggio…</p>;
  if (ok)   return <p className="mt-2 text-xs font-medium text-emerald-700">✅ {ok}</p>;
  if (err)  return <p className="mt-2 text-xs font-medium text-red-600">❌ {err}</p>;
  return null;
}

// ---------------------------------------------------------------------------
// Campo form riutilizzabile
// ---------------------------------------------------------------------------

function Field({ label, required, children }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}{required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none";

// ---------------------------------------------------------------------------
// Componente principale
// ---------------------------------------------------------------------------

export default function ImpostazioniPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Auth
  useEffect(() => {
    let cancelled = false;
    async function init() {
      const session = await checkSession();
      if (!session.ok) { if (!cancelled) router.replace("/login"); return; }
      if (!cancelled) { setUser(session.autoscuola); setLoading(false); }
    }
    init();
    return () => { cancelled = true; };
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-slate-600">Caricamento...</p>
      </div>
    );
  }

  return (
    <ModernAppShell
      title="Impostazioni"
      subtitle="Dati autoscuola, portale, Telegram, orari ricerca sedute"
      activeKey="impostazioni"
      onLogout={() => logoutSession().then(() => router.replace("/login"))}
      user={user}
    >
      <div className="space-y-5 overflow-y-auto h-[calc(100vh-120px)] pr-1">
        <SezioneAutoscuola initialUser={user} />
        <SezionePortale />
        <SezioneTelegram />
        <SezioneOrariRicerca />
      </div>
    </ModernAppShell>
  );
}

// ---------------------------------------------------------------------------
// 1. Dati autoscuola
// ---------------------------------------------------------------------------

function SezioneAutoscuola({ initialUser }) {
  const { busy, ok, err, run } = useSectionState();
  const [form, setForm] = useState({
    nome: initialUser?.nome || "",
    codice_autoscuola: initialUser?.codice_autoscuola || "",
    indirizzo: "",
    partita_iva: "",
    telefono: "",
  });

  // Carica dati aggiornati dal backend
  useEffect(() => {
    fetch(`${API_BASE}/api/auth/me`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (d?.autoscuola) {
          setForm((f) => ({
            nome:              d.autoscuola.nome              || f.nome,
            codice_autoscuola: d.autoscuola.codice_autoscuola || f.codice_autoscuola,
            indirizzo:         d.autoscuola.indirizzo         || "",
            partita_iva:       d.autoscuola.partita_iva       || "",
            telefono:          d.autoscuola.telefono          || "",
          }));
        }
      })
      .catch(() => {});
  }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function handleSave(e) {
    e.preventDefault();
    await run(async () => {
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          nome:              form.nome,
          codice_autoscuola: form.codice_autoscuola,
          indirizzo:         form.indirizzo,
          partita_iva:       form.partita_iva,
          telefono:          form.telefono,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      return "Dati autoscuola salvati.";
    });
  }

  return (
    <SectionCard title="Dati autoscuola" subtitle="Nome, codice, indirizzo, P.IVA, telefono" icon="🏫">
      <form onSubmit={handleSave} className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome autoscuola" required>
          <input className={inputCls} value={form.nome}
            onChange={(e) => set("nome", e.target.value)} required />
        </Field>
        <Field label="Codice autoscuola">
          <input className={inputCls} value={form.codice_autoscuola}
            onChange={(e) => set("codice_autoscuola", e.target.value)}
            placeholder="Es. 12345" />
        </Field>
        <Field label="Indirizzo">
          <input className={inputCls} value={form.indirizzo}
            onChange={(e) => set("indirizzo", e.target.value)}
            placeholder="Via, numero civico, città" />
        </Field>
        <Field label="Partita IVA">
          <input className={inputCls} value={form.partita_iva}
            onChange={(e) => set("partita_iva", e.target.value)}
            placeholder="IT12345678901" />
        </Field>
        <Field label="Telefono">
          <input className={inputCls} value={form.telefono}
            onChange={(e) => set("telefono", e.target.value)}
            placeholder="+39 0123 456789" />
        </Field>
        <div className="sm:col-span-2 flex items-center gap-3 pt-1">
          <button type="submit" disabled={busy}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? "Salvataggio…" : "Salva dati autoscuola"}
          </button>
          <Feedback busy={busy} ok={ok} err={err} />
        </div>
      </form>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// 2. Credenziali Portale Automobilista
// ---------------------------------------------------------------------------

function SezionePortale() {
  const { busy, ok, err, run } = useSectionState();
  const [form, setForm] = useState({
    portal_user: "",
    portal_pass: "",
    portal_pin: "",
  });
  const [showPass, setShowPass] = useState(false);
  const [showPin, setShowPin] = useState(false);
  // Punto 19 — indica se le credenziali sono già configurate
  const [credStatus, setCredStatus] = useState({ user: null, pass: null, pin: null });

  useEffect(() => {
    fetch(`${API_BASE}/api/auth/me`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        const au = d?.autoscuola || d;
        // Usa i nuovi campi _set (boolean) dalla API; fallback ai valori precedenti
        setCredStatus({
          user:         au?.portal_user         ? true : false,
          pass:         au?.portal_pass_set     ?? (au?.portal_pass ? true : false),
          pin:          au?.portal_pin_set      ?? (au?.portal_pin  ? true : false),
          ok:           au?.portal_credenziali_ok ?? null,
          userName:     au?.portal_user || "",
        });
      })
      .catch(() => {});
  }, [ok]);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.portal_user && !form.portal_pass && !form.portal_pin) {
      return;
    }
    await run(async () => {
      const body = {};
      if (form.portal_user.trim()) body.portal_user = form.portal_user.trim();
      if (form.portal_pass)        body.portal_pass = form.portal_pass;
      if (form.portal_pin.trim())  body.portal_pin  = form.portal_pin.trim();
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      setForm({ portal_user: "", portal_pass: "", portal_pin: "" });
      return "Credenziali portale aggiornate.";
    });
  }

  async function handleTestLogin() {
    await run(async () => {
      const res = await fetch(`${API_BASE}/api/portal/login-diagnostics`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Errore diagnostica");
      return data.message || data.summary || "Diagnostica completata.";
    });
  }

  return (
    <SectionCard
      title="Credenziali Portale dell'Automobilista"
      subtitle="Lascia vuoto un campo per non modificarlo"
      icon="🔐"
    >
      <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Le credenziali sono cifrate in database. Compila solo i campi che vuoi aggiornare. Il PIN è richiesto per le operazioni di prenotazione.
      </div>
      {/* Punto 19 — stato attuale credenziali */}
      {/* Avviso credenziali placeholder o mancanti */}
      {(credStatus.ok === false || (credStatus.user && credStatus.userName === "TUO_USERNAME_PORTALE")) && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 font-medium">
          ⚠️ Le credenziali del portale non sono ancora configurate o sono valori segnaposto. Inseriscile qui sotto per abilitare la sincronizzazione con il Portale dell&apos;Automobilista.
        </div>
      )}
      <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 flex flex-wrap gap-3 text-xs">
        <span className="text-slate-500 font-medium">Stato attuale:</span>
        <span className={credStatus.user === true ? (credStatus.ok === false ? "text-amber-600" : "text-emerald-700") : credStatus.user === false ? "text-red-600" : "text-slate-400"}>
          {credStatus.user === true ? (credStatus.ok === false ? `⚠️ Username (${credStatus.userName})` : `✅ Username (${credStatus.userName})`) : "⬜ Username non impostato"}
        </span>
        <span className={credStatus.pass === true ? "text-emerald-700" : credStatus.pass === false ? "text-red-600" : "text-slate-400"}>
          {credStatus.pass === true ? "✅ Password" : credStatus.pass === false ? "⬜ Password non impostata" : "– Password"}
        </span>
        <span className={credStatus.pin === true ? "text-emerald-700" : credStatus.pin === false ? "text-amber-600" : "text-slate-400"}>
          {credStatus.pin === true ? "✅ PIN" : credStatus.pin === false ? "⚠️ PIN non impostato (opzionale)" : "– PIN"}
        </span>
      </div>
      <form onSubmit={handleSave} className="grid gap-4 sm:grid-cols-2">
        <Field label="Username portale">
          <input className={inputCls} value={form.portal_user}
            onChange={(e) => set("portal_user", e.target.value)}
            placeholder={credStatus.user ? "●●●●●●●● (impostato)" : "Nuovo username"}
            autoComplete="off" />
        </Field>
        <Field label="Password portale">
          <div className="relative">
            <input
              className={inputCls + " pr-16"}
              type={showPass ? "text" : "password"}
              value={form.portal_pass}
              onChange={(e) => set("portal_pass", e.target.value)}
              placeholder={credStatus.pass ? "●●●●●●●● (impostata)" : "Nuova password"}
              autoComplete="new-password"
            />
            <button type="button" onClick={() => setShowPass((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-800">
              {showPass ? "Nascondi" : "Mostra"}
            </button>
          </div>
        </Field>
        <Field label="PIN portale">
          <div className="relative">
            <input
              className={inputCls + " pr-16"}
              type={showPin ? "text" : "password"}
              value={form.portal_pin}
              onChange={(e) => set("portal_pin", e.target.value)}
              placeholder={credStatus.pin ? "●●●●●● (impostato)" : "Nuovo PIN (6 cifre)"}
              autoComplete="new-password"
              maxLength={6}
            />
            <button type="button" onClick={() => setShowPin((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-800">
              {showPin ? "Nascondi" : "Mostra"}
            </button>
          </div>
        </Field>
        <div className="sm:col-span-2 flex flex-wrap items-center gap-2 pt-1">
          <button type="submit" disabled={busy}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? "Salvataggio…" : "Aggiorna credenziali"}
          </button>
          <button type="button" disabled={busy} onClick={handleTestLogin}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            🔍 Test login portale
          </button>
          <Feedback busy={busy} ok={ok} err={err} />
        </div>
      </form>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// 3. Telegram
// ---------------------------------------------------------------------------

function SezioneTelegram() {
  const { busy, ok, err, run } = useSectionState();
  const [testMsg, setTestMsg] = useState("");

  async function handleTest() {
    if (!testMsg.trim() && !window.confirm("Inviare una notifica di test standard?")) return;
    await run(async () => {
      const res = await fetch(`${API_BASE}/api/telegram/sessioni-alert`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          totalOpen: 1,
          entries: [{
            data: new Date().toLocaleDateString("it-IT"),
            tipoEsame: testMsg.trim() || "Test notifica impostazioni",
            aula: "–",
            amPm: "–",
            postiLiberi: "OK",
          }],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Errore Telegram");
      if (data.skipped) return "Skipped (nessuna seduta da notificare — controlla token e chat ID in .env).";
      return data.sent ? "Messaggio inviato su Telegram ✅" : "Non inviato — verifica TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID nel .env del backend.";
    });
  }

  return (
    <SectionCard
      title="Notifiche Telegram"
      subtitle="Bot token e chat ID configurati nelle variabili d'ambiente del backend"
      icon="📨"
    >
      <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
        <strong>TELEGRAM_BOT_TOKEN</strong> e <strong>TELEGRAM_CHAT_ID</strong> sono impostati nel file <code>.env</code> del backend (Railway → Environment Variables).
        Le notifiche vengono inviate automaticamente dal motore radar.
      </div>

      <div className="space-y-3">
        {/* Campo messaggio test */}
        <Field label="Messaggio test (opzionale)">
          <input
            className={inputCls}
            value={testMsg}
            onChange={(e) => setTestMsg(e.target.value)}
            placeholder="Es. Test radar 22/03/2026"
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={handleTest}
            className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {busy ? "Invio…" : "📨 Invia notifica test"}
          </button>
          <Feedback busy={busy} ok={ok} err={err} />
        </div>

        {/* Variabili env di riferimento */}
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Variabili .env da configurare</p>
          <div className="space-y-1.5">
            {[
              { key: "TELEGRAM_BOT_TOKEN",      desc: "Token del bot (da @BotFather)" },
              { key: "TELEGRAM_CHAT_ID",         desc: "ID chat o canale destinatario" },
              { key: "TELEGRAM_ENABLED",         desc: "true/false — abilita/disabilita le notifiche" },
              { key: "TELEGRAM_COOLDOWN_SECONDS",desc: "Secondi tra un alert e il successivo (default 300)" },
            ].map(({ key, desc }) => (
              <div key={key} className="flex items-start gap-2">
                <code className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-xs font-mono text-slate-700">{key}</code>
                <span className="text-xs text-slate-500">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// 4. Orari ricerca sedute
// ---------------------------------------------------------------------------

function SezioneOrariRicerca() {
  const { busy, ok, err, run } = useSectionState();
  const [settings, setSettings] = useState(null);
  const [status, setStatus] = useState(null);
  const [loadErr, setLoadErr] = useState("");

  const load = useCallback(async () => {
    setLoadErr("");
    try {
      const res = await fetch(`${API_BASE}/api/search-settings`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Errore caricamento");
      setSettings({
        enabled:   Boolean(data.enabled ?? true),
        timezone:  data.timezone || "Europe/Rome",
        startTime: data.startTime || "08:00",
        endTime:   data.endTime   || "21:00",
        days:      Array.isArray(data.days) ? data.days : [1,2,3,4,5,6],
      });
      setStatus({
        allowedNow:      data.allowedNow,
        currentSlotLabel: data.currentSlotLabel,
        nextWindowLabel:  data.nextWindowLabel,
      });
    } catch (e) {
      setLoadErr(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function set(k, v) { setSettings((s) => ({ ...s, [k]: v })); }

  function toggleDay(day) {
    setSettings((s) => {
      const days = s.days.includes(day) ? s.days.filter((d) => d !== day) : [...s.days, day];
      return { ...s, days };
    });
  }

  async function handleSave(e) {
    e.preventDefault();
    await run(async () => {
      const res = await fetch(`${API_BASE}/api/search-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.settings) {
        setStatus({
          allowedNow:      data.settings.allowedNow,
          currentSlotLabel: data.settings.currentSlotLabel,
          nextWindowLabel:  data.settings.nextWindowLabel,
        });
      }
      return "Orari di ricerca salvati.";
    });
  }

  if (loadErr) {
    return (
      <SectionCard title="Orari ricerca sedute" icon="🕐">
        <p className="text-sm text-red-600">{loadErr}</p>
        <button onClick={load} className="mt-2 text-xs text-indigo-600 hover:underline">Ricarica</button>
      </SectionCard>
    );
  }

  if (!settings) {
    return (
      <SectionCard title="Orari ricerca sedute" icon="🕐">
        <p className="text-sm text-slate-400">Caricamento…</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Orari ricerca sedute (Radar)"
      subtitle="Finestra temporale entro cui il motore può prenotare automaticamente"
      icon="🕐"
    >
      {/* Status badge */}
      {status && (
        <div className={`mb-4 flex flex-wrap items-center gap-3 rounded-xl px-3 py-2 text-xs font-medium ${
          status.allowedNow
            ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border border-slate-200 bg-slate-50 text-slate-700"
        }`}>
          <span>{status.allowedNow ? "🟢 Ricerca ATTIVA ora" : "⚪ Ricerca non attiva"}</span>
          {status.currentSlotLabel && <span>Slot corrente: <strong>{status.currentSlotLabel}</strong></span>}
          {status.nextWindowLabel  && <span>Prossima finestra: <strong>{status.nextWindowLabel}</strong></span>}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-5">

        {/* Abilitato */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={settings.enabled}
            onClick={() => set("enabled", !settings.enabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              settings.enabled ? "bg-emerald-500" : "bg-slate-300"
            }`}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
              settings.enabled ? "translate-x-5" : "translate-x-0"
            }`} />
          </button>
          <span className="text-sm font-medium text-slate-700">
            Ricerca automatica {settings.enabled ? "abilitata" : "disabilitata"}
          </span>
        </div>

        {/* Orari */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Orario inizio">
            <input type="time" value={settings.startTime}
              onChange={(e) => set("startTime", e.target.value)}
              className={inputCls} />
          </Field>
          <Field label="Orario fine">
            <input type="time" value={settings.endTime}
              onChange={(e) => set("endTime", e.target.value)}
              className={inputCls} />
          </Field>
          <Field label="Fuso orario">
            <input type="text" value={settings.timezone}
              onChange={(e) => set("timezone", e.target.value)}
              className={inputCls}
              placeholder="Europe/Rome" />
          </Field>
        </div>

        {/* Giorni */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Giorni attivi</p>
          <div className="flex flex-wrap gap-2">
            {GIORNI.map(({ value, label }) => {
              const active = settings.days.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => toggleDay(value)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                    active
                      ? "bg-indigo-600 text-white"
                      : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-slate-400">
            Selezionati: {settings.days.length === 0
              ? "nessuno — ricerca mai eseguita"
              : GIORNI.filter((g) => settings.days.includes(g.value)).map((g) => g.label).join(", ")}
          </p>
        </div>

        {/* Riepilogo testuale */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Il motore radar cercherà sedute disponibili
          {settings.enabled
            ? ` ogni giorno tra ${settings.days.length ? GIORNI.filter((g) => settings.days.includes(g.value)).map((g) => g.label).join("/") : "—"}, dalle ${settings.startTime} alle ${settings.endTime} (${settings.timezone}).`
            : " — ricerca disabilitata."}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={busy}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? "Salvataggio…" : "Salva orari"}
          </button>
          <button type="button" onClick={load}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Ricarica
          </button>
          <Feedback busy={busy} ok={ok} err={err} />
        </div>
      </form>
    </SectionCard>
  );
}

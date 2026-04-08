"use client";

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { API_BASE, authHeaders, checkSession, logoutSession } from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const TIPI_EVENTO = [
  { value: "guida",        label: "Guida",        color: "bg-emerald-500", text: "text-emerald-700", light: "bg-emerald-50 border-emerald-200" },
  { value: "lezione",      label: "Lezione",      color: "bg-violet-500",  text: "text-violet-700",  light: "bg-violet-50 border-violet-200" },
  { value: "esame",        label: "Esame",        color: "bg-rose-500",    text: "text-rose-700",    light: "bg-rose-50 border-rose-200" },
  { value: "scadenza",     label: "Scadenza",     color: "bg-amber-500",   text: "text-amber-700",   light: "bg-amber-50 border-amber-200" },
  { value: "appuntamento", label: "Appuntamento", color: "bg-blue-500",    text: "text-blue-700",    light: "bg-blue-50 border-blue-200" },
  { value: "google",       label: "Google Cal",   color: "bg-red-400",     text: "text-red-700",     light: "bg-red-50 border-red-200" },
  { value: "altro",        label: "Altro",        color: "bg-slate-400",   text: "text-slate-700",   light: "bg-slate-50 border-slate-200" },
];

function getTipoInfo(tipo) {
  return TIPI_EVENTO.find((t) => t.value === tipo) || TIPI_EVENTO[TIPI_EVENTO.length - 1];
}

const MONTH_NAMES = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
const DAY_NAMES = ["Lun","Mar","Mer","Gio","Ven","Sab","Dom"];

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function isoDateStr(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Costruisce griglia 6×7 per il mese
function buildMonthGrid(year, month) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  // Lun=0 .. Dom=6
  const startDow = (firstDay.getDay() + 6) % 7;
  const days = [];
  for (let i = 0; i < startDow; i++) {
    const d = new Date(year, month, 1 - (startDow - i));
    days.push({ date: isoDateStr(d.getFullYear(), d.getMonth(), d.getDate()), current: false });
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push({ date: isoDateStr(year, month, d), current: true });
  }
  while (days.length % 7 !== 0) {
    const d = new Date(year, month + 1, days.length - (startDow + lastDay.getDate()) + 1);
    days.push({ date: isoDateStr(d.getFullYear(), d.getMonth(), d.getDate()), current: false });
  }
  return days;
}

function eventDateStr(ev) {
  const s = ev.start_at || "";
  return s.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Componente principale
// ---------------------------------------------------------------------------

function CalendarPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const [localEvents, setLocalEvents] = useState([]);
  const [googleEvents, setGoogleEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  const [googleStatus, setGoogleStatus] = useState({ configured: false, connected: false, updatedAt: null });
  const [googleBusy, setGoogleBusy] = useState(false);

  const [selectedDay, setSelectedDay] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", tipo: "guida", start_at: "", end_at: "", all_day: false, sync_google: true });
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const [deletingId, setDeletingId] = useState(null);
  const [view, setView] = useState("month"); // month | list

  // Notifiche da Google OAuth redirect
  useEffect(() => {
    const connected = searchParams.get("google_connected");
    const err = searchParams.get("google_error");
    if (connected) {
      window.history.replaceState({}, "", "/calendar");
      checkGoogleStatus();
    }
    if (err) {
      window.history.replaceState({}, "", "/calendar");
      alert(`Errore Google Calendar: ${err}`);
    }
  }, [searchParams]);

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

  const checkGoogleStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/calendar/google/status`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      setGoogleStatus(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!loading) checkGoogleStatus();
  }, [loading, checkGoogleStatus]);

  // Fetch eventi
  const fetchEvents = useCallback(async () => {
    const start = new Date(currentMonth.year, currentMonth.month, 1).toISOString();
    const end = new Date(currentMonth.year, currentMonth.month + 1, 0, 23, 59, 59).toISOString();
    setEventsLoading(true);
    try {
      const [localRes, googleRes] = await Promise.all([
        fetch(`${API_BASE}/api/calendar/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, { headers: authHeaders() }),
        googleStatus.connected
          ? fetch(`${API_BASE}/api/calendar/google/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, { headers: authHeaders() })
          : Promise.resolve(null),
      ]);
      const localData = await localRes.json().catch(() => ({}));
      setLocalEvents(Array.isArray(localData?.events) ? localData.events : []);

      if (googleRes) {
        const googleData = await googleRes.json().catch(() => ({}));
        setGoogleEvents(Array.isArray(googleData?.events) ? googleData.events : []);
      } else {
        setGoogleEvents([]);
      }
    } catch { /* ignore */ }
    finally { setEventsLoading(false); }
  }, [currentMonth.year, currentMonth.month, googleStatus.connected]);

  useEffect(() => {
    if (!loading) fetchEvents();
  }, [loading, fetchEvents]);

  // Tutti gli eventi unificati
  const allEvents = useMemo(() => [
    ...localEvents,
    ...googleEvents.map((ev) => ({ ...ev, source: "google" })),
  ], [localEvents, googleEvents]);

  // Grid mese
  const grid = useMemo(() => buildMonthGrid(currentMonth.year, currentMonth.month), [currentMonth]);

  // Eventi per giorno
  const eventsByDay = useMemo(() => {
    const map = {};
    for (const ev of allEvents) {
      const day = eventDateStr(ev);
      if (!map[day]) map[day] = [];
      map[day].push(ev);
    }
    return map;
  }, [allEvents]);

  const today = useMemo(() => isoDateStr(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()), []);

  // Navigazione mese
  const prevMonth = () => setCurrentMonth((m) => m.month === 0 ? { year: m.year - 1, month: 11 } : { year: m.year, month: m.month - 1 });
  const nextMonth = () => setCurrentMonth((m) => m.month === 11 ? { year: m.year + 1, month: 0 } : { year: m.year, month: m.month + 1 });

  // Google OAuth
  const connectGoogle = async () => {
    setGoogleBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/calendar/google/auth-url`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (data.url) window.location.href = data.url;
      else alert(data.error || "Errore generazione URL Google");
    } catch (e) { alert(e.message); }
    finally { setGoogleBusy(false); }
  };

  const disconnectGoogle = async () => {
    if (!confirm("Disconnettere Google Calendar? I token verranno eliminati.")) return;
    setGoogleBusy(true);
    try {
      await fetch(`${API_BASE}/api/calendar/google/disconnect`, { method: "DELETE", headers: authHeaders() });
      setGoogleStatus((s) => ({ ...s, connected: false, updatedAt: null }));
      setGoogleEvents([]);
    } catch (e) { alert(e.message); }
    finally { setGoogleBusy(false); }
  };

  // Crea evento
  const openNewEvent = (day) => {
    const dateStr = day || today;
    setForm({
      title: "",
      description: "",
      tipo: "guida",
      start_at: `${dateStr}T09:00`,
      end_at: `${dateStr}T10:00`,
      all_day: false,
      sync_google: googleStatus.connected,
    });
    setFormError("");
    setShowForm(true);
    setSelectedDay(null);
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!form.title.trim()) { setFormError("Titolo obbligatorio"); return; }
    const start = new Date(form.start_at);
    const end = new Date(form.end_at);
    if (isNaN(start) || isNaN(end)) { setFormError("Date non valide"); return; }
    if (end <= start) { setFormError("La fine deve essere dopo l'inizio"); return; }

    setFormBusy(true);
    setFormError("");
    try {
      const res = await fetch(`${API_BASE}/api/calendar/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          tipo: form.tipo,
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          all_day: form.all_day,
          sync_google: form.sync_google,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || "Errore creazione evento");
      setShowForm(false);
      fetchEvents();
    } catch (err) { setFormError(err.message); }
    finally { setFormBusy(false); }
  };

  const handleDelete = async (ev) => {
    if (!confirm(`Eliminare "${ev.title}"?`)) return;
    setDeletingId(ev.id);
    try {
      await fetch(`${API_BASE}/api/calendar/events/${ev.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      fetchEvents();
      if (selectedDay) setSelectedDay(selectedDay); // aggiorna pannello
    } catch { /* ignore */ }
    finally { setDeletingId(null); }
  };

  const dayEvents = selectedDay ? (eventsByDay[selectedDay] || []) : [];

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-slate-600">Caricamento...</p>
      </div>
    );
  }

  return (
    <ModernAppShell
      title="Calendario"
      subtitle="Guide, lezioni, esami, scadenze"
      activeKey="calendar"
      onLogout={() => logoutSession().then(() => router.replace("/login"))}
      user={user}
    >
      <div className="flex flex-col gap-3 h-[calc(100vh-110px)]">
        {/* HEADER */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Navigazione mese */}
          <button onClick={prevMonth} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            ← Prec
          </button>
          <h2 className="min-w-36 text-center text-base font-bold text-slate-800">
            {MONTH_NAMES[currentMonth.month]} {currentMonth.year}
          </h2>
          <button onClick={nextMonth} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Succ →
          </button>
          <button
            onClick={() => setCurrentMonth({ year: new Date().getFullYear(), month: new Date().getMonth() })}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Oggi
          </button>

          {/* Vista */}
          <div className="flex rounded-lg border border-slate-300 overflow-hidden">
            <button onClick={() => setView("month")} className={`px-3 py-1.5 text-sm ${view === "month" ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>Mese</button>
            <button onClick={() => setView("list")} className={`px-3 py-1.5 text-sm ${view === "list" ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>Lista</button>
          </div>

          <button
            onClick={() => openNewEvent(null)}
            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            + Nuovo evento
          </button>

          {/* Google Calendar status */}
          <div className="ml-auto flex items-center gap-2">
            {eventsLoading && <span className="text-xs text-slate-400">Caricamento...</span>}
            {googleStatus.configured ? (
              googleStatus.connected ? (
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-3 py-1 text-xs font-medium text-red-700">
                    <span className="h-2 w-2 rounded-full bg-red-400 inline-block" />
                    Google Calendar connesso
                  </span>
                  <button
                    onClick={disconnectGoogle}
                    disabled={googleBusy}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Disconnetti
                  </button>
                </div>
              ) : (
                <button
                  onClick={connectGoogle}
                  disabled={googleBusy}
                  className="flex items-center gap-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/>
                  </svg>
                  {googleBusy ? "Reindirizzamento..." : "Connetti Google Calendar"}
                </button>
              )
            ) : (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
                Google Calendar non configurato
              </span>
            )}
          </div>
        </div>

        {/* LEGENDA */}
        <div className="flex flex-wrap gap-2">
          {TIPI_EVENTO.map((t) => (
            <span key={t.value} className="flex items-center gap-1 text-xs text-slate-600">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${t.color}`} />
              {t.label}
            </span>
          ))}
        </div>

        {/* BODY */}
        <div className="flex flex-1 gap-3 min-h-0">
          {/* CALENDARIO / LISTA */}
          <div className={`flex flex-col ${selectedDay ? "w-2/3" : "w-full"} transition-all`}>
            {view === "month" ? (
              <MonthGrid
                grid={grid}
                today={today}
                eventsByDay={eventsByDay}
                selectedDay={selectedDay}
                onDayClick={(d) => setSelectedDay(d === selectedDay ? null : d)}
                onNewEvent={openNewEvent}
              />
            ) : (
              <EventList
                events={allEvents}
                onDelete={handleDelete}
                deletingId={deletingId}
              />
            )}
          </div>

          {/* PANNELLO GIORNO */}
          {selectedDay && (
            <div className="w-1/3 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-slate-800">
                  {new Date(selectedDay + "T12:00").toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}
                </h3>
                <div className="flex gap-1">
                  <button onClick={() => openNewEvent(selectedDay)} className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-500">
                    + Evento
                  </button>
                  <button onClick={() => setSelectedDay(null)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50">
                    ✕
                  </button>
                </div>
              </div>
              {dayEvents.length === 0 ? (
                <p className="text-sm text-slate-400">Nessun evento in questo giorno.</p>
              ) : (
                <ul className="space-y-2">
                  {dayEvents.map((ev) => {
                    const ti = getTipoInfo(ev.tipo);
                    return (
                      <li key={ev.id || ev.google_event_id} className={`rounded-lg border p-3 ${ti.light}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-slate-800 truncate">{ev.title}</p>
                            {!ev.all_day && (
                              <p className="text-xs text-slate-500 mt-0.5">
                                {formatTime(ev.start_at)} – {formatTime(ev.end_at)}
                              </p>
                            )}
                            {ev.description && <p className="text-xs text-slate-600 mt-1 truncate">{ev.description}</p>}
                            <span className={`mt-1 inline-block text-xs font-medium ${ti.text}`}>{ti.label}</span>
                          </div>
                          {!ev.source && (
                            <button
                              onClick={() => handleDelete(ev)}
                              disabled={deletingId === ev.id}
                              className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                              title="Elimina"
                            >
                              🗑
                            </button>
                          )}
                          {ev.source === "google" && ev.html_link && (
                            <a href={ev.html_link} target="_blank" rel="noreferrer" className="shrink-0 rounded p-1 text-slate-400 hover:text-red-500" title="Apri in Google Calendar">
                              ↗
                            </a>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {/* MODAL NUOVO EVENTO */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
            <div className="border-b border-slate-200 px-5 py-4 flex items-center justify-between">
              <h3 className="font-bold text-slate-900">Nuovo evento</h3>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Titolo *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Es. Guida Mario Rossi"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tipo</label>
                  <select
                    value={form.tipo}
                    onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
                  >
                    {TIPI_EVENTO.filter((t) => t.value !== "google").map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.all_day}
                      onChange={(e) => setForm((f) => ({ ...f, all_day: e.target.checked }))}
                      className="rounded"
                    />
                    Tutto il giorno
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Inizio</label>
                  <input
                    type={form.all_day ? "date" : "datetime-local"}
                    value={form.start_at}
                    onChange={(e) => setForm((f) => ({ ...f, start_at: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Fine</label>
                  <input
                    type={form.all_day ? "date" : "datetime-local"}
                    value={form.end_at}
                    onChange={(e) => setForm((f) => ({ ...f, end_at: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Descrizione</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Note opzionali"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
                />
              </div>
              {googleStatus.connected && (
                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.sync_google}
                    onChange={(e) => setForm((f) => ({ ...f, sync_google: e.target.checked }))}
                    className="rounded"
                  />
                  Sincronizza su Google Calendar
                </label>
              )}
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={formBusy}
                  className="flex-1 rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {formBusy ? "Salvataggio..." : "Crea evento"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
                >
                  Annulla
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </ModernAppShell>
  );
}

// ---------------------------------------------------------------------------
// Griglia mese
// ---------------------------------------------------------------------------

function MonthGrid({ grid, today, eventsByDay, selectedDay, onDayClick, onNewEvent }) {
  return (
    <div className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Intestazione giorni */}
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
        {DAY_NAMES.map((d) => (
          <div key={d} className="py-2 text-center text-xs font-semibold text-slate-500">{d}</div>
        ))}
      </div>
      {/* Celle */}
      <div className="grid grid-cols-7">
        {grid.map(({ date, current }) => {
          const dayEvs = eventsByDay[date] || [];
          const isToday = date === today;
          const isSelected = date === selectedDay;
          return (
            <div
              key={date}
              onClick={() => onDayClick(date)}
              className={`min-h-20 border-b border-r border-slate-100 p-1 cursor-pointer transition-colors
                ${!current ? "bg-slate-50/60" : ""}
                ${isSelected ? "bg-indigo-50 ring-1 ring-inset ring-indigo-300" : "hover:bg-slate-50"}
              `}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold
                  ${isToday ? "bg-indigo-600 text-white" : current ? "text-slate-700" : "text-slate-400"}
                `}>
                  {parseInt(date.slice(8), 10)}
                </span>
                {current && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onNewEvent(date); }}
                    className="h-5 w-5 rounded text-slate-400 hover:bg-emerald-100 hover:text-emerald-600 flex items-center justify-center text-sm leading-none"
                    title="Aggiungi evento"
                  >
                    +
                  </button>
                )}
              </div>
              <div className="space-y-0.5">
                {dayEvs.slice(0, 3).map((ev) => {
                  const ti = getTipoInfo(ev.tipo);
                  return (
                    <div key={ev.id || ev.google_event_id} className={`truncate rounded px-1 py-0.5 text-xs ${ti.light} ${ti.text} border`}>
                      {!ev.all_day && <span className="mr-1 font-medium">{formatTime(ev.start_at)}</span>}
                      {ev.title}
                    </div>
                  );
                })}
                {dayEvs.length > 3 && (
                  <div className="text-xs text-slate-400 px-1">+{dayEvs.length - 3} altri</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vista lista eventi
// ---------------------------------------------------------------------------

function EventList({ events, onDelete, deletingId }) {
  const sorted = useMemo(() => [...events].sort((a, b) => new Date(a.start_at) - new Date(b.start_at)), [events]);

  if (sorted.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm text-slate-400 text-sm">
        Nessun evento in questo mese
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-4 py-2 text-left font-semibold text-slate-600">Data / Ora</th>
            <th className="px-4 py-2 text-left font-semibold text-slate-600">Titolo</th>
            <th className="px-4 py-2 text-left font-semibold text-slate-600">Tipo</th>
            <th className="px-4 py-2 text-left font-semibold text-slate-600">Descrizione</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((ev) => {
            const ti = getTipoInfo(ev.tipo);
            return (
              <tr key={ev.id || ev.google_event_id} className="border-b border-slate-100 hover:bg-slate-50 last:border-0">
                <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{formatDateTime(ev.start_at)}</td>
                <td className="px-4 py-2 font-medium text-slate-800">{ev.title}</td>
                <td className="px-4 py-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ti.light} ${ti.text} border`}>
                    {ti.label}
                  </span>
                </td>
                <td className="px-4 py-2 text-slate-500 truncate max-w-48">{ev.description || "–"}</td>
                <td className="px-4 py-2">
                  {!ev.source ? (
                    <button
                      onClick={() => onDelete(ev)}
                      disabled={deletingId === ev.id}
                      className="text-slate-400 hover:text-red-500 disabled:opacity-40 text-xs"
                    >
                      Elimina
                    </button>
                  ) : ev.html_link ? (
                    <a href={ev.html_link} target="_blank" rel="noreferrer" className="text-xs text-red-600 hover:underline">Google ↗</a>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function CalendarPageWrapper() { return <Suspense fallback={null}><CalendarPage /></Suspense>; }

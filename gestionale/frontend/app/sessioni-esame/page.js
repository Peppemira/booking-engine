"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, authHeaders, checkSession, logoutSession } from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";
import { useProgressStream, ProgressPanel } from "../../lib/ProgressPanel";

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const TIPO_OPTIONS = [
  { value: "SQI",  label: "Quiz (SQI)" },
  { value: "SGOS", label: "Guida (SGOS)" },
];

const LINGUA_OPTIONS = [
  { value: "I",  label: "Italiano" },
  { value: "E",  label: "English" },
  { value: "F",  label: "Français" },
  { value: "D",  label: "Deutsch" },
  { value: "S",  label: "Español" },
  { value: "P",  label: "Português" },
  { value: "RU", label: "Русский" },
  { value: "AL", label: "Albanese" },
  { value: "AR", label: "Arabo" },
  { value: "ZH", label: "Cinese" },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function oneWeekLater() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Pagina principale
// ---------------------------------------------------------------------------

export default function SessioniEsamePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkSession().then((s) => {
      if (!s.ok) { router.replace("/login"); return; }
      setUser(s.autoscuola);
      setLoading(false);
    });
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-slate-600">Caricamento…</p>
      </div>
    );
  }

  return (
    <ModernAppShell
      title="Sessioni Esame"
      subtitle="Ricerca e prenotazione sessioni esame programmato SGOS/SQI"
      activeKey="sessioni-esame"
      onLogout={() => logoutSession().then(() => router.replace("/login"))}
      user={user}
    >
      <SessioniEsamePanel />
    </ModernAppShell>
  );
}

// ---------------------------------------------------------------------------
// Pannello principale
// ---------------------------------------------------------------------------

function SessioniEsamePanel() {
  // Ricerca
  const [filters, setFilters]   = useState({ data_da: today(), data_a: oneWeekLater(), tipo_sessione: "SQI" });
  const [credenziali, setCredenziali] = useState({ username: "", password: "", pin: "" });
  const [sessioni, setSessioni] = useState([]);
  const { messages: sseMessages, busy: sseBusy, error: sseErr, run: sseRun, reset: sseReset } = useProgressStream();

  // Prenotazione
  const [showBookModal, setShowBookModal] = useState(false);
  const [selSession, setSelSession]       = useState(null);
  const [bookForm, setBookForm]           = useState({
    candidate_id: "",
    cod_foglio_rosa: "",
    cognome: "",
    lingua: "I",
    audio: "N",
    turno: "1",
    aula: "1",
  });
  const [bookBusy, setBookBusy]   = useState(false);
  const [bookErr, setBookErr]     = useState("");
  const [bookOk, setBookOk]       = useState("");

  // Candidati (per autocomplete)
  const [candidati, setCandidati]   = useState([]);
  const [candSearch, setCandSearch] = useState("");

  function getBase() {
    if (typeof window === "undefined") return "http://localhost:3000";
    const saved = localStorage.getItem("autoscuola_api_base");
    if (saved) return saved.trim();
    const h = window.location.hostname;
    return `${window.location.protocol}//${h}:3000`;
  }

  function authH() {
    try {
      const tok = typeof window !== "undefined" ? localStorage.getItem("autoscuola_token") : null;
      return tok ? { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
    } catch { return { "Content-Type": "application/json" }; }
  }

  // Carica candidati all'avvio
  useEffect(() => {
    fetch(`${getBase()}/api/candidati-api`, { headers: authH() })
      .then((r) => r.json())
      .then((d) => setCandidati(Array.isArray(d) ? d : []))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cercaSessioni = useCallback(async () => {
    if (!credenziali.username || !credenziali.password) return;
    sseReset();
    setSessioni([]);
    try {
      const base = getBase();
      const data = await sseRun(`${base}/api/trasmiss/portale/sessioni-esame`, {
        method: "GET",
        params: {
          data_da: filters.data_da,
          data_a: filters.data_a,
          tipo_sessione: filters.tipo_sessione,
          username: credenziali.username,
          password: credenziali.password,
          ...(credenziali.pin ? { pin: credenziali.pin } : {}),
        },
      });
      setSessioni(Array.isArray(data?.sessioni) ? data.sessioni : []);
    } catch (_) { /* error displayed by ProgressPanel */ }
  }, [filters, credenziali, sseRun, sseReset]);

  async function prenotaEsame() {
    if (!selSession?.id_verbale) { setBookErr("Sessione non selezionata"); return; }
    if (!bookForm.cod_foglio_rosa && filters.tipo_sessione === "SQI") { setBookErr("Foglio rosa obbligatorio per SQI"); return; }
    setBookBusy(true); setBookErr(""); setBookOk("");
    try {
      const base = getBase();
      const res = await fetch(`${base}/api/trasmiss/portale/prenota-esame`, {
        method: "POST",
        headers: authH(),
        body: JSON.stringify({
          credenziali,
          id_verbale:     selSession.id_verbale,
          tipo_sessione:  filters.tipo_sessione,
          cod_foglio_rosa: bookForm.cod_foglio_rosa,
          cognome:        bookForm.cognome,
          lingua:         bookForm.lingua,
          audio:          bookForm.audio,
          turno:          bookForm.turno,
          aula:           bookForm.aula,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      setBookOk("✅ Prenotazione completata con successo!");
      setShowBookModal(false);
    } catch (e) {
      setBookErr(e.message || "Errore prenotazione");
    } finally {
      setBookBusy(false);
    }
  }

  function apriBooModal(sessione) {
    setSelSession(sessione);
    setBookErr(""); setBookOk("");
    setBookForm({ candidate_id: "", cod_foglio_rosa: "", cognome: "", lingua: "I", audio: "N", turno: "1", aula: "1" });
    setShowBookModal(true);
  }

  const filtCandidati = candSearch
    ? candidati.filter((c) => `${c.cognome} ${c.nome} ${c.codice_foglio_rosa || ""}`.toLowerCase().includes(candSearch.toLowerCase()))
    : [];

  const inp = "rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 w-full focus:border-indigo-400 focus:outline-none";
  const lbl = "block text-[10px] font-semibold text-slate-500 uppercase mb-0.5";

  return (
    <div className="space-y-4">

      {/* SEZIONE RICERCA */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 font-semibold text-slate-800">🔍 Ricerca sessioni disponibili</h2>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          <div>
            <label className={lbl}>Tipo sessione</label>
            <select className={inp} value={filters.tipo_sessione}
              onChange={(e) => setFilters((f) => ({ ...f, tipo_sessione: e.target.value }))}>
              {TIPO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Data da</label>
            <input type="date" className={inp} value={filters.data_da}
              onChange={(e) => setFilters((f) => ({ ...f, data_da: e.target.value }))} />
          </div>
          <div>
            <label className={lbl}>Data a</label>
            <input type="date" className={inp} value={filters.data_a}
              onChange={(e) => setFilters((f) => ({ ...f, data_a: e.target.value }))} />
          </div>
          <div>
            <label className={lbl}>Username portale *</label>
            <input type="text" className={inp} value={credenziali.username}
              onChange={(e) => setCredenziali((c) => ({ ...c, username: e.target.value }))}
              placeholder="username" autoComplete="off" />
          </div>
          <div>
            <label className={lbl}>Password *</label>
            <input type="password" className={inp} value={credenziali.password}
              onChange={(e) => setCredenziali((c) => ({ ...c, password: e.target.value }))}
              placeholder="password" autoComplete="new-password" />
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={cercaSessioni}
            disabled={sseBusy}
            className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-sky-500 disabled:opacity-50"
          >
            {sseBusy ? "⏳ Ricerca in corso…" : "🔍 Cerca sessioni"}
          </button>
          {bookOk && (
            <p className="text-sm text-emerald-600 font-medium">{bookOk}</p>
          )}
        </div>
        <ProgressPanel messages={sseMessages} busy={sseBusy} error={sseErr} title="Puppeteer — Ricerca sessioni" />
      </div>

      {/* TABELLA SESSIONI */}
      {sessioni.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
            <h2 className="font-semibold text-slate-800">
              {sessioni.length} sessioni {filters.tipo_sessione} disponibili
            </h2>
          </div>
          <div className="overflow-auto max-h-[60vh]">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Data sessione</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Desc. esame</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Fascia</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Località</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Aula</th>
                  <th className="px-3 py-2 text-center font-semibold text-slate-700">Turni</th>
                  <th className="px-3 py-2 text-center font-semibold text-slate-700">Posti</th>
                  <th className="px-3 py-2 text-center font-semibold text-slate-700">Prenotati</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Data limite</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Stato</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sessioni.map((s, i) => {
                  const posti    = parseInt(s.cand_possibili || "0", 10);
                  const prenotati = parseInt(s.cand_prenotati || "0", 10);
                  const liberi    = posti - prenotati;
                  return (
                    <tr key={s.id_verbale || i} className="border-b border-slate-100 hover:bg-sky-50">
                      <td className="px-3 py-2 font-medium text-slate-900">{s.data_sessione || "–"}</td>
                      <td className="px-3 py-2 text-slate-700 max-w-[12rem] truncate" title={s.desc_esame}>{s.desc_esame || "–"}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${s.fascia_oraria === "M" ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700"}`}>
                          {s.fascia_oraria === "M" ? "Mattina" : s.fascia_oraria === "P" ? "Pomeriggio" : (s.fascia_oraria || "–")}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{s.localita || "–"}</td>
                      <td className="px-3 py-2 text-slate-600">{s.aula || "–"}</td>
                      <td className="px-3 py-2 text-center text-slate-700">{s.turni || "–"}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`font-semibold ${liberi < 3 ? "text-red-600" : "text-emerald-600"}`}>
                          {liberi > 0 ? liberi : "0"}
                        </span>
                        <span className="text-slate-400">/{posti}</span>
                      </td>
                      <td className="px-3 py-2 text-center text-slate-600">{prenotati}</td>
                      <td className="px-3 py-2 text-slate-600">{s.data_limite || "–"}</td>
                      <td className="px-3 py-2">
                        <span className="rounded px-1.5 py-0.5 text-[10px] bg-emerald-100 text-emerald-700 font-medium">
                          {s.stato_verbale || "Aperta"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => apriBooModal(s)}
                          disabled={liberi <= 0}
                          className="rounded-lg bg-indigo-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-indigo-500 disabled:opacity-40 whitespace-nowrap"
                        >
                          📝 Prenota
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sessioni.length === 0 && !searchBusy && !searchErr && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 py-16 text-center text-slate-400">
          <p className="text-2xl mb-2">📅</p>
          <p className="text-sm">Inserisci le credenziali e clicca &quot;Cerca sessioni&quot; per visualizzare le sessioni disponibili</p>
        </div>
      )}

      {/* MODAL PRENOTAZIONE */}
      {showBookModal && selSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-800">📝 Prenota candidato</h3>
              <button onClick={() => setShowBookModal(false)} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
            </div>

            <div className="rounded-lg bg-slate-50 border border-slate-200 p-2 text-xs space-y-0.5">
              <p><span className="text-slate-500">Sessione:</span> <strong>{selSession.data_sessione}</strong></p>
              <p><span className="text-slate-500">Tipo:</span> <strong>{filters.tipo_sessione}</strong> · {selSession.desc_esame}</p>
              <p><span className="text-slate-500">Luogo:</span> {selSession.localita} · Aula {selSession.aula}</p>
              <p><span className="text-slate-500">ID verbale:</span> <code className="font-mono">{selSession.id_verbale}</code></p>
            </div>

            {/* Ricerca candidato */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Cerca candidato</label>
              <input type="text" className={inp} value={candSearch}
                onChange={(e) => {
                  setCandSearch(e.target.value);
                  setBookForm((f) => ({ ...f, cognome: e.target.value }));
                }}
                placeholder="Cognome, nome o foglio rosa…" />
              {filtCandidati.length > 0 && (
                <div className="mt-1 border border-slate-200 rounded-lg bg-white max-h-32 overflow-auto shadow">
                  {filtCandidati.slice(0, 8).map((c) => (
                    <button key={c.id} onClick={() => {
                      setBookForm((f) => ({
                        ...f,
                        candidate_id: c.id,
                        cognome: c.cognome || "",
                        cod_foglio_rosa: c.codice_foglio_rosa || c.raw_portale?.ppg_numero || "",
                      }));
                      setCandSearch(`${c.cognome} ${c.nome}`);
                      setCandidati((prev) => prev); // keep list
                    }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-sky-50 border-b border-slate-100 last:border-0"
                    >
                      <span className="font-medium">{c.cognome} {c.nome}</span>
                      <span className="ml-2 text-slate-400">{c.codice_foglio_rosa || "–"}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Foglio rosa *</label>
                <input type="text" className={inp} value={bookForm.cod_foglio_rosa}
                  onChange={(e) => setBookForm((f) => ({ ...f, cod_foglio_rosa: e.target.value }))}
                  placeholder="es. AB123" />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Cognome</label>
                <input type="text" className={inp} value={bookForm.cognome}
                  onChange={(e) => setBookForm((f) => ({ ...f, cognome: e.target.value }))} />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Lingua</label>
                <select className={inp} value={bookForm.lingua}
                  onChange={(e) => setBookForm((f) => ({ ...f, lingua: e.target.value }))}>
                  {LINGUA_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Audio</label>
                <select className={inp} value={bookForm.audio}
                  onChange={(e) => setBookForm((f) => ({ ...f, audio: e.target.value }))}>
                  <option value="N">No</option>
                  <option value="S">Sì</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Turno</label>
                <input type="number" min="1" max="10" className={inp} value={bookForm.turno}
                  onChange={(e) => setBookForm((f) => ({ ...f, turno: e.target.value }))} />
              </div>
              {filters.tipo_sessione === "SQI" && (
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Aula</label>
                  <input type="number" min="1" className={inp} value={bookForm.aula}
                    onChange={(e) => setBookForm((f) => ({ ...f, aula: e.target.value }))} />
                </div>
              )}
            </div>

            {bookErr && <p className="text-xs text-red-600">❌ {bookErr}</p>}

            <div className="flex gap-2 pt-1">
              <button onClick={prenotaEsame} disabled={bookBusy}
                className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
                {bookBusy ? "⏳ Prenotazione in corso…" : "✅ Conferma prenotazione"}
              </button>
              <button onClick={() => setShowBookModal(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

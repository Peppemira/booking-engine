"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getApiBase, authHeaders, checkSession, logoutSession } from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function apiBase() {
  if (typeof window === "undefined") return "http://localhost:3000";
  const saved = window.localStorage?.getItem("autoscuola_api_base");
  if (saved) return saved.trim();
  return getApiBase();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
function daysPlusMinus(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function formatIT(v) {
  if (!v) return "–";
  const s = String(v).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s))
    return new Date(s + "T00:00:00Z").toLocaleDateString("it-IT");
  return v;
}
function statoBadge(stato) {
  const s = (stato || "").toLowerCase();
  if (s === "prenotato" || s === "confermato") return "bg-emerald-100 text-emerald-800";
  if (s === "in_attesa" || s === "lista_attesa") return "bg-amber-100 text-amber-800";
  if (s === "annullato" || s === "rifiutato") return "bg-red-100 text-red-800";
  if (s === "superato") return "bg-sky-100 text-sky-800";
  return "bg-slate-100 text-slate-700";
}

// ─── Card Statistica ───────────────────────────────────────────────────────────

function StatCard({ icon, label, value, color = "indigo" }) {
  const colors = {
    indigo: "bg-indigo-50 border-indigo-200 text-indigo-700",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    violet: "bg-violet-50 border-violet-200 text-violet-700",
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${colors[color]}`}>
      <div className="flex items-center gap-2">
        <span className="text-xl">{icon}</span>
        <div>
          <div className="text-xs font-medium opacity-70">{label}</div>
          <div className="text-2xl font-bold">{value ?? "–"}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Pannello Sessioni Portale ─────────────────────────────────────────────────

const TIPO_SESSIONE = [
  { key: "SQI",  label: "Quiz",        icon: "🧪" },
  { key: "SGOS", label: "Guide/Orali", icon: "🚗" },
  { key: "SCQC", label: "CQC",         icon: "🚛" },
];

function PannelloSessioni() {
  const [tipoSel, setTipoSel] = useState("SQI");
  const [dataDa, setDataDa] = useState(today());
  const [dataA, setDataA] = useState(daysPlusMinus(7));
  const [busy, setBusy] = useState(false);
  const [sessioni, setSessioni] = useState([]);
  const [error, setError] = useState("");

  async function sincronizza() {
    setBusy(true);
    setError("");
    setSessioni([]);
    try {
      const res = await fetch(`${apiBase()}/api/portal/sessioni`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          indicatoreTipoSessione: tipoSel,
          dataInizio: dataDa,
          dataFine: dataA,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Errore portale");
      setSessioni(data.righe || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
        <p className="text-sm font-bold text-slate-700">📡 Sessioni dal Portale</p>
        <p className="text-xs text-slate-500">Visualizza sessioni disponibili per prenotare i candidati</p>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Tipo</label>
            <select value={tipoSel} onChange={(e) => setTipoSel(e.target.value)}
              className="h-8 rounded border border-slate-300 bg-white px-2 text-xs">
              {TIPO_SESSIONE.map((t) => (
                <option key={t.key} value={t.key}>{t.icon} {t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Da</label>
            <input type="date" value={dataDa} onChange={(e) => setDataDa(e.target.value)}
              className="h-8 rounded border border-slate-300 px-2 text-xs" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">A (max +7gg)</label>
            <input type="date" value={dataA} onChange={(e) => setDataA(e.target.value)}
              className="h-8 rounded border border-slate-300 px-2 text-xs" />
          </div>
          <button onClick={sincronizza} disabled={busy}
            className="h-8 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? "⏳..." : "🔄 Sincronizza"}
          </button>
        </div>

        {error && (
          <div className="rounded bg-red-50 border border-red-200 p-2 text-xs text-red-700">❌ {error}</div>
        )}

        {sessioni.length > 0 ? (
          <div className="overflow-auto max-h-52 rounded border border-slate-100">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 sticky top-0">
                <tr className="border-b border-slate-200">
                  <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Data</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Ora</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Luogo</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Posti</th>
                </tr>
              </thead>
              <tbody>
                {sessioni.map((s, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-2 py-1.5 font-medium">{formatIT(s.dataSessione || s.data)}</td>
                    <td className="px-2 py-1.5 text-slate-600">{s.oraSessione || s.ora || "–"}</td>
                    <td className="px-2 py-1.5 text-slate-600">{s.luogoSessione || s.luogo || s.sede || "–"}</td>
                    <td className="px-2 py-1.5">
                      {s.postiDisponibili != null ? (
                        <span className={`font-semibold ${s.postiDisponibili > 0 ? "text-emerald-700" : "text-red-600"}`}>
                          {s.postiDisponibili}
                        </span>
                      ) : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-center py-5 text-xs text-slate-400">
            {busy ? "Caricamento..." : "Premi Sincronizza per caricare le sessioni"}
          </p>
        )}

        {sessioni.length > 0 && (
          <div className="flex justify-between items-center pt-1">
            <span className="text-xs text-slate-500">{sessioni.length} sessioni</span>
            <Link href="/portale" className="text-xs text-indigo-600 hover:underline">
              Portale completo →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pannello Dettaglio Candidato ──────────────────────────────────────────────

function PannelloDettaglio({ candidato, user, onClose }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function cercaRichieste() {
    setBusy(true);
    setResult(null);
    setError("");
    try {
      const res = await fetch(`${apiBase()}/api/portal/cerca-richieste-esame`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          id_aut_ag: user?.codice_autoscuola || "",
          marca_operativa: candidato?.marca_operativa ||
            candidato?.raw_portale?.anagrafica?.portal_marca_operativa || "",
          codice_fiscale: candidato?.codice_fiscale || "",
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Errore portale");
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const marcaOp = candidato.marca_operativa ||
    candidato.raw_portale?.anagrafica?.portal_marca_operativa;

  return (
    <div className="rounded-xl border border-indigo-200 bg-white shadow-sm overflow-y-auto max-h-[72vh]">
      {/* Header */}
      <div className="sticky top-0 flex items-start justify-between border-b border-indigo-100 bg-indigo-50 p-3 z-10">
        <div>
          <p className="font-bold text-slate-800">{candidato.cognome} {candidato.nome}</p>
          <p className="text-xs text-slate-500 font-mono mt-0.5">{candidato.codice_fiscale || "–"}</p>
          <div className="mt-1 flex gap-1 flex-wrap">
            {candidato.categoria_patente && (
              <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-xs font-bold text-white">
                Cat. {candidato.categoria_patente}
              </span>
            )}
            {candidato.stato && (
              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${statoBadge(candidato.stato)}`}>
                {candidato.stato}
              </span>
            )}
          </div>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none ml-2">✕</button>
      </div>

      <div className="p-3 space-y-3">
        {/* Anagrafica */}
        <div>
          <p className="text-xs font-semibold uppercase text-slate-400 mb-1.5">Anagrafica</p>
          <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs">
            {[
              ["Data nasc.", formatIT(candidato.data_nascita)],
              ["Comune nasc.", candidato.comune_nascita],
              ["Sesso", candidato.sesso],
              ["Telefono", candidato.telefono || candidato.telefono_1],
              ["Email", candidato.email || candidato.email_contatto],
              ["Indirizzo", candidato.indirizzo],
              ["CAP", candidato.cap],
              ["Iscrizione", formatIT(candidato.data_iscrizione)],
            ].filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-slate-500 truncate">{k}</dt>
                <dd className="text-slate-800 truncate" title={v}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Documento */}
        {(candidato.tipo_documento || candidato.numero_documento) && (
          <div>
            <p className="text-xs font-semibold uppercase text-slate-400 mb-1.5">Documento</p>
            <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs">
              {[
                ["Tipo", candidato.tipo_documento],
                ["Numero", candidato.numero_documento],
                ["Rilascio", formatIT(candidato.data_rilascio_doc)],
                ["Scadenza", formatIT(candidato.scade_il_documento)],
              ].filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="text-slate-800 font-mono">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* Patente / Foglio Rosa */}
        {(candidato.patente_numero || candidato.codice_foglio_rosa || marcaOp) && (
          <div>
            <p className="text-xs font-semibold uppercase text-slate-400 mb-1.5">Patente / Portale</p>
            <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs">
              {[
                ["N° Patente", candidato.patente_numero],
                ["Foglio Rosa", candidato.codice_foglio_rosa],
                ["Marca Op.", marcaOp],
                ["Scade patente", formatIT(candidato.scade_il_patente)],
              ].filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="text-slate-800 font-mono">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* Azioni Portale */}
        <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-violet-700">⚡ Azioni rapide</p>
          <div className="flex flex-wrap gap-1.5">
            <button disabled={busy} onClick={cercaRichieste}
              className="rounded bg-violet-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
              {busy ? "⏳..." : "🔍 Cerca Richieste Esame"}
            </button>
            <Link href="/richieste-esame"
              className="rounded border border-violet-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50">
              📋 Richieste Esame →
            </Link>
            <Link href="/pratiche"
              className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              📁 Pratica →
            </Link>
            <Link href="/moduli"
              className="rounded border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">
              📄 Genera Moduli →
            </Link>
          </div>
          {error && <p className="mt-2 text-xs text-red-700">❌ {error}</p>}
        </div>

        {/* Risultati ricerca portale */}
        {result && (
          <div>
            <p className="text-xs font-semibold uppercase text-slate-400 mb-1.5">
              Richieste Portale ({result.righe?.length || 0})
            </p>
            {(result.righe?.length || 0) === 0 ? (
              <p className="text-xs text-slate-500 italic">Nessuna richiesta trovata sul portale</p>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {result.righe.map((r, i) => (
                  <div key={i} className="rounded bg-slate-50 border border-slate-200 p-2 text-xs">
                    <div className="font-mono font-semibold text-slate-700">
                      {r.marcaOperativa || r.marca_operativa || "–"}
                    </div>
                    <div className="text-slate-600">{r.cognome} {r.nome}</div>
                    <div className="flex gap-2 mt-0.5 text-slate-500">
                      <span>{r.tipoEsame || r.tipoRichiesta || r.tipo || "–"}</span>
                      {r.stato && <span className="font-medium text-slate-700">· {r.stato}</span>}
                      {r.dataPrenotazione && <span>· {formatIT(r.dataPrenotazione)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pagina Principale ─────────────────────────────────────────────────────────

const CATEGORIE = ["TUTTE", "A1", "A2", "A", "B", "BE", "C", "C1", "CE", "D", "DE", "AM", "CQC"];
const STATI = ["TUTTI", "attivo", "prenotato", "superato", "in_attesa", "sospeso"];

export default function EsamiPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [candidati, setCandidati] = useState([]);
  const [fetchError, setFetchError] = useState("");
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ search: "", categoria: "TUTTE", stato: "TUTTI" });

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

  const loadCandidati = useCallback(async () => {
    setFetchError("");
    try {
      const res = await fetch(`${apiBase()}/api/candidati-api`, {
        headers: authHeaders(), cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCandidati(Array.isArray(data) ? data : []);
    } catch (e) {
      setFetchError(e.message || "Errore caricamento candidati");
    }
  }, []);

  useEffect(() => { if (!loading) loadCandidati(); }, [loading, loadCandidati]);

  const stats = useMemo(() => ({
    totale: candidati.length,
    prenotati: candidati.filter((c) => (c.stato || "").toLowerCase() === "prenotato").length,
    in_attesa: candidati.filter((c) =>
      ["in_attesa", "lista_attesa"].includes((c.stato || "").toLowerCase())).length,
    senza_stato: candidati.filter((c) => !c.stato).length,
  }), [candidati]);

  const filtrati = useMemo(() => {
    const q = filters.search.trim().toUpperCase();
    return candidati.filter((c) => {
      if (q) {
        const hay = [c.cognome, c.nome, c.codice_fiscale, c.patente_numero, c.marca_operativa]
          .join(" ").toUpperCase();
        if (!hay.includes(q)) return false;
      }
      if (filters.categoria !== "TUTTE" && c.categoria_patente !== filters.categoria) return false;
      if (filters.stato !== "TUTTI" && (c.stato || "").toLowerCase() !== filters.stato) return false;
      return true;
    });
  }, [candidati, filters]);

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <p className="text-slate-500 text-sm">Caricamento...</p>
    </div>
  );

  return (
    <ModernAppShell
      title="Esami"
      subtitle="Gestione candidati esame · sessioni portale · richieste patente"
      activeKey="esami"
      onLogout={() => logoutSession().then(() => router.replace("/login"))}
      user={user}
    >
      <div className="space-y-4">

        {/* ── Intestazione ── */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Gestione Esami</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Candidati pronti · sessioni portale · prenotazioni
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/prenotazioni"
              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500">
              📅 Sedute & Prenotazioni →
            </Link>
            <Link href="/portale"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              🌐 Portale Completo →
            </Link>
          </div>
        </div>

        {/* ── Statistiche ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon="👥" label="Candidati totali" value={stats.totale} color="indigo" />
          <StatCard icon="✅" label="Prenotati" value={stats.prenotati} color="emerald" />
          <StatCard icon="⏳" label="In attesa" value={stats.in_attesa} color="amber" />
          <StatCard icon="❓" label="Da classificare" value={stats.senza_stato} color="violet" />
        </div>

        {/* ── Layout principale ── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

          {/* Colonna sinistra: candidati */}
          <div className="xl:col-span-2 space-y-3">

            {/* Filtri */}
            <div className="flex flex-wrap gap-2 items-center">
              <input
                type="text"
                placeholder="🔍 Cognome, nome, CF, marca op…"
                value={filters.search}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                className="h-9 w-56 rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-indigo-400 focus:outline-none"
              />
              <select
                value={filters.categoria}
                onChange={(e) => setFilters((f) => ({ ...f, categoria: e.target.value }))}
                className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm"
              >
                {CATEGORIE.map((c) => <option key={c}>{c}</option>)}
              </select>
              <select
                value={filters.stato}
                onChange={(e) => setFilters((f) => ({ ...f, stato: e.target.value }))}
                className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm"
              >
                {STATI.map((s) => <option key={s}>{s}</option>)}
              </select>
              <button onClick={loadCandidati}
                className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
                ↻
              </button>
              <span className="ml-auto text-xs text-slate-500 font-medium">
                {filtrati.length} / {candidati.length} candidati
              </span>
            </div>

            {fetchError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {fetchError}
              </div>
            )}

            {/* Tabella */}
            <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm max-h-[58vh]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 z-10">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2 text-left font-semibold text-slate-600">Candidato</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600">Cat.</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600">Stato</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600">Nascita</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600">Marca Op.</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrati.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-16 text-center text-slate-400 text-sm">
                        Nessun candidato trovato
                      </td>
                    </tr>
                  ) : filtrati.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => {
                        setSelected(selected?.id === c.id ? null : c);
                      }}
                      className={`cursor-pointer border-b border-slate-100 transition-colors last:border-0
                        ${selected?.id === c.id
                          ? "bg-indigo-50 border-l-2 border-l-indigo-500"
                          : "hover:bg-slate-50"}`}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-800">{c.cognome} {c.nome}</div>
                        <div className="text-xs text-slate-500 font-mono">{c.codice_fiscale || "–"}</div>
                      </td>
                      <td className="px-3 py-2">
                        {c.categoria_patente && (
                          <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-bold text-indigo-800">
                            {c.categoria_patente}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {c.stato ? (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statoBadge(c.stato)}`}>
                            {c.stato}
                          </span>
                        ) : <span className="text-slate-300 text-xs">–</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">{formatIT(c.data_nascita)}</td>
                      <td className="px-3 py-2 text-xs font-mono text-slate-500">
                        {c.marca_operativa || c.raw_portale?.anagrafica?.portal_marca_operativa || "–"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Banner flusso */}
            <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-800">
              <p className="font-semibold mb-1">📌 Flusso esame (equivalente GeCA):</p>
              <p>
                1. Seleziona candidato →{" "}
                2. <strong>Cerca Richieste Esame</strong> sul portale →{" "}
                3. Vai a <Link href="/prenotazioni" className="underline font-semibold">Sedute & Prenotazioni</Link> →{" "}
                4. Gestisci pagamento in <Link href="/richieste-esame" className="underline font-semibold">Richieste Esame</Link> →{" "}
                5. Stampa da <Link href="/moduli" className="underline font-semibold">Moduli</Link>
              </p>
            </div>
          </div>

          {/* Colonna destra */}
          <div className="space-y-4">
            {selected ? (
              <PannelloDettaglio
                candidato={selected}
                user={user}
                onClose={() => setSelected(null)}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-400">
                ← Seleziona un candidato dalla lista per vedere i dettagli e le azioni
              </div>
            )}

            <PannelloSessioni />
          </div>
        </div>
      </div>
    </ModernAppShell>
  );
}

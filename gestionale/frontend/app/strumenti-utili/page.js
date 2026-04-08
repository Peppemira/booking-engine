"use client";

import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import { getApiBase, authHeaders, checkSession, logoutSession } from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const TABS = [
  { key: "scadenze",   label: "⏰ Scadenze",       title: "Scadenze in evidenza" },
  { key: "crono",      label: "📋 Crono",           title: "Cronologia operazioni" },
  { key: "archivio",   label: "🗄 Archivio patenti", title: "Archivio patenti / ricerca avanzata" },
  { key: "export",     label: "📤 Export dati",      title: "Esporta dati candidati" },
  { key: "lookup-marca", label: "🔍 Lookup Marca",  title: "Cerca pratica per marca operativa" },
];

function toYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatData(val) {
  if (!val) return "–";
  const s = String(val).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return val;
  const d = new Date(s + "T00:00:00Z");
  return d.toLocaleDateString("it-IT");
}

function diffGiorni(dateStr) {
  if (!dateStr) return null;
  const d = new Date(String(dateStr).slice(0, 10) + "T00:00:00Z");
  const oggi = new Date();
  oggi.setHours(0, 0, 0, 0);
  return Math.round((d - oggi) / 86400000);
}

function scadenzaColor(days) {
  if (days === null) return "";
  if (days < 0) return "text-red-700 font-bold";
  if (days <= 7) return "text-red-600 font-semibold";
  if (days <= 30) return "text-amber-600 font-semibold";
  return "text-slate-700";
}

// ---------------------------------------------------------------------------
// Componente principale
// ---------------------------------------------------------------------------

function StrumentiUtiliPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("scadenze");

  // Scadenze
  const [scadenzeGiorni, setScadenzeGiorni] = useState(30);
  const [scadenzeData, setScadenzeData] = useState([]);
  const [scadenzeBusy, setScadenzeBusy] = useState(false);
  const [scadenzeErr, setScadenzeErr] = useState("");

  // Archivio
  const [archSearch, setArchSearch] = useState({ cognome: "", nome: "", codice_fiscale: "", numero_patente: "", archivio: "STORICO" });
  const [archResults, setArchResults] = useState([]);
  const [archBusy, setArchBusy] = useState(false);
  const [archErr, setArchErr] = useState("");

  // Export
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState("");

  // Cronologia (import-history)
  const [cronoData, setCronoData] = useState([]);
  const [cronoBusy, setCronoBusy] = useState(false);
  const [cronoErr, setCronoErr] = useState("");

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

  // ---------------------------------------------------------------------------
  // Scadenze
  // ---------------------------------------------------------------------------
  const fetchScadenze = useCallback(async () => {
    const base = getApiBase();
    setScadenzeBusy(true); setScadenzeErr("");
    try {
      const res = await fetch(`${base}/api/candidati-api/scadenze?giorni=${scadenzeGiorni}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setScadenzeData(Array.isArray(d) ? d : []);
    } catch (e) {
      setScadenzeErr(e.message || "Errore caricamento scadenze");
    } finally {
      setScadenzeBusy(false);
    }
  }, [scadenzeGiorni]);

  useEffect(() => {
    if (!loading && tab === "scadenze") fetchScadenze();
  }, [loading, tab, fetchScadenze]);

  // ---------------------------------------------------------------------------
  // Archivio Patenti / Ricerca Avanzata
  // ---------------------------------------------------------------------------
  const fetchArchivio = useCallback(async () => {
    const base = getApiBase();
    setArchBusy(true); setArchErr("");
    try {
      const p = new URLSearchParams();
      if (archSearch.cognome) p.set("cognome", archSearch.cognome);
      if (archSearch.nome) p.set("nome", archSearch.nome);
      if (archSearch.codice_fiscale) p.set("codice_fiscale", archSearch.codice_fiscale);
      if (archSearch.numero_patente) p.set("patente_numero", archSearch.numero_patente);
      p.set("archivio", archSearch.archivio);
      const res = await fetch(`${base}/api/candidati-api?${p.toString()}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setArchResults(Array.isArray(d) ? d : []);
    } catch (e) {
      setArchErr(e.message || "Errore ricerca archivio");
    } finally {
      setArchBusy(false);
    }
  }, [archSearch]);

  // ---------------------------------------------------------------------------
  // Cronologia
  // ---------------------------------------------------------------------------
  const fetchCrono = useCallback(async () => {
    const base = getApiBase();
    setCronoBusy(true); setCronoErr("");
    try {
      const res = await fetch(`${base}/api/import-history`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setCronoData(Array.isArray(d?.history) ? d.history : Array.isArray(d) ? d : []);
    } catch (e) {
      setCronoErr(e.message || "Errore caricamento cronologia");
    } finally {
      setCronoBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && tab === "crono") fetchCrono();
  }, [loading, tab, fetchCrono]);

  // ---------------------------------------------------------------------------
  // Export CSV
  // ---------------------------------------------------------------------------
  async function esportaCSV() {
    const base = getApiBase();
    setExportBusy(true); setExportMsg("");
    try {
      const res = await fetch(`${base}/api/candidati-api?archivio=ATTUALE&limit=2000`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();
      if (!Array.isArray(rows) || !rows.length) { setExportMsg("Nessun dato da esportare."); return; }

      const cols = ["cognome", "nome", "codice_fiscale", "data_nascita", "comune_nascita", "prov_nascita",
        "comune_residenza", "prov_residenza", "indirizzo_residenza", "numero_civico", "cap_residenza",
        "telefono_1", "email_contatto", "categoria_patente", "stato_richiesta",
        "data_iscrizione", "numero_registro", "patente_numero",
        "ppg_data_emissione", "ppg_data_scadenza", "scade_il_patente",
        "tipo_documento", "numero_documento", "scade_il_documento",
        "note"];

      const header = cols.join(";");
      const body = rows.map((r) =>
        cols.map((c) => {
          const v = String(r[c] ?? "").replace(/"/g, '""').replace(/;/g, ",");
          return v.includes(",") ? `"${v}"` : v;
        }).join(";")
      ).join("\n");

      const blob = new Blob(["\uFEFF" + header + "\n" + body], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `candidati_${toYMD(new Date())}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setExportMsg(`✅ Esportati ${rows.length} candidati.`);
    } catch (e) {
      setExportMsg("❌ " + (e.message || "Errore export"));
    } finally {
      setExportBusy(false);
    }
  }

  async function esportaPagamentiCSV() {
    const base = getApiBase();
    setExportBusy(true); setExportMsg("");
    try {
      const res = await fetch(`${base}/api/pagamenti?limit=5000`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();
      const data = Array.isArray(rows) ? rows : (rows?.data || []);
      if (!data.length) { setExportMsg("Nessun pagamento da esportare."); return; }

      const cols = ["id", "candidato_id", "tipo", "importo", "causale", "data_pagamento", "esito", "note", "created_at"];
      const header = cols.join(";");
      const body = data.map((r) =>
        cols.map((c) => String(r[c] ?? "").replace(/;/g, ",")).join(";")
      ).join("\n");

      const blob = new Blob(["\uFEFF" + header + "\n" + body], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pagamenti_${toYMD(new Date())}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setExportMsg(`✅ Esportati ${data.length} pagamenti.`);
    } catch (e) {
      setExportMsg("❌ " + (e.message || "Errore export pagamenti"));
    } finally {
      setExportBusy(false);
    }
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-100"><p className="text-slate-600">Caricamento...</p></div>;

  const currentTab = TABS.find((t) => t.key === tab) || TABS[0];

  return (
    <ModernAppShell
      title="Strumenti Utili"
      subtitle="Scadenze, archivio, cronologia, export dati"
      activeKey="strumenti-utili"
      onLogout={() => logoutSession().then(() => router.replace("/login"))}
      user={user}
    >
      <div className="space-y-4 overflow-y-auto h-[calc(100vh-120px)] pr-1">

        {/* Tab bar */}
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
                tab === t.key
                  ? "bg-indigo-600 text-white shadow"
                  : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <h2 className="text-lg font-bold text-slate-900">{currentTab.title}</h2>

        {/* ================================================================
            TAB: SCADENZE
            ================================================================ */}
        {tab === "scadenze" && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <label className="text-sm font-semibold text-slate-700">Mostra scadenze nei prossimi</label>
              {[7, 15, 30, 60, 90].map((g) => (
                <button
                  key={g}
                  onClick={() => setScadenzeGiorni(g)}
                  className={`rounded-lg px-3 py-1 text-sm font-semibold transition ${
                    scadenzeGiorni === g ? "bg-amber-500 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {g} giorni
                </button>
              ))}
              <button
                onClick={fetchScadenze}
                disabled={scadenzeBusy}
                className="rounded-lg bg-indigo-600 px-3 py-1 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {scadenzeBusy ? "Carico…" : "Aggiorna"}
              </button>
            </div>

            {scadenzeErr && <p className="text-sm text-red-600">❌ {scadenzeErr}</p>}

            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-2">
                <span className="text-amber-700 font-semibold text-sm">⏰ Scadenze nei prossimi {scadenzeGiorni} giorni</span>
                <span className="ml-auto text-xs text-amber-600 font-medium">{scadenzeData.length} trovate</span>
              </div>
              {scadenzeBusy ? (
                <p className="p-4 text-sm text-slate-500">Caricamento…</p>
              ) : scadenzeData.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">Nessuna scadenza nei prossimi {scadenzeGiorni} giorni.</p>
              ) : (
                <div className="overflow-auto max-h-[55vh]">
                  <table className="min-w-full text-xs">
                    <thead className="sticky top-0 bg-slate-100 z-10">
                      <tr>
                        <th className="px-2 py-2 text-left font-semibold text-slate-700">Candidato</th>
                        <th className="px-2 py-2 text-left font-semibold text-slate-700">C.F.</th>
                        <th className="px-2 py-2 text-left font-semibold text-slate-700">Categoria</th>
                        <th className="px-2 py-2 text-left font-semibold text-slate-700">Foglio Rosa</th>
                        <th className="px-2 py-2 text-left font-semibold text-slate-700">Scad. Patente</th>
                        <th className="px-2 py-2 text-left font-semibold text-slate-700">Scad. Documento</th>
                        <th className="px-2 py-2 text-left font-semibold text-slate-700">Telefono</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scadenzeData.map((r) => {
                        const gFr = diffGiorni(r.ppg_data_scadenza);
                        const gPat = diffGiorni(r.scade_il_patente);
                        const gDoc = diffGiorni(r.scade_il_documento);
                        return (
                          <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-2 py-1.5 font-medium text-slate-900">{r.cognome} {r.nome}</td>
                            <td className="px-2 py-1.5 text-slate-600 font-mono text-[10px]">{r.codice_fiscale || "–"}</td>
                            <td className="px-2 py-1.5 text-slate-700">{r.categoria_patente || "–"}</td>
                            <td className={`px-2 py-1.5 ${scadenzaColor(gFr)}`}>
                              {r.ppg_data_scadenza ? `${formatData(r.ppg_data_scadenza)}${gFr !== null ? ` (${gFr >= 0 ? "+" : ""}${gFr}gg)` : ""}` : "–"}
                            </td>
                            <td className={`px-2 py-1.5 ${scadenzaColor(gPat)}`}>
                              {r.scade_il_patente ? `${formatData(r.scade_il_patente)}${gPat !== null ? ` (${gPat >= 0 ? "+" : ""}${gPat}gg)` : ""}` : "–"}
                            </td>
                            <td className={`px-2 py-1.5 ${scadenzaColor(gDoc)}`}>
                              {r.scade_il_documento ? `${formatData(r.scade_il_documento)}${gDoc !== null ? ` (${gDoc >= 0 ? "+" : ""}${gDoc}gg)` : ""}` : "–"}
                            </td>
                            <td className="px-2 py-1.5 text-slate-600">{r.telefono_1 || "–"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================================================================
            TAB: CRONOLOGIA
            ================================================================ */}
        {tab === "crono" && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <button
                onClick={fetchCrono}
                disabled={cronoBusy}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {cronoBusy ? "Carico…" : "Aggiorna cronologia"}
              </button>
            </div>
            {cronoErr && <p className="text-sm text-red-600">❌ {cronoErr}</p>}
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="bg-slate-50 border-b border-slate-200 px-4 py-2">
                <span className="text-slate-700 font-semibold text-sm">📋 Ultime operazioni di sistema</span>
              </div>
              {cronoBusy ? (
                <p className="p-4 text-sm text-slate-500">Caricamento…</p>
              ) : cronoData.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">Nessuna operazione registrata.</p>
              ) : (
                <div className="overflow-auto max-h-[55vh]">
                  <table className="min-w-full text-xs">
                    <thead className="sticky top-0 bg-slate-100 z-10">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-slate-700">Data/Ora</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-700">Operazione</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-700">Dettaglio</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-700">Esito</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cronoData.map((r, i) => (
                        <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-3 py-1.5 text-slate-500 font-mono text-[10px] whitespace-nowrap">
                            {r.timestamp ? new Date(r.timestamp).toLocaleString("it-IT") : "–"}
                          </td>
                          <td className="px-3 py-1.5 font-medium text-slate-800 whitespace-nowrap">{r.operazione || r.tipo || r.action || "–"}</td>
                          <td className="px-3 py-1.5 text-slate-600 max-w-xs truncate">{r.dettaglio || r.message || r.note || "–"}</td>
                          <td className="px-3 py-1.5">
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              String(r.esito || r.status || "").toLowerCase().includes("ok") || String(r.esito || r.status || "").toLowerCase().includes("success")
                                ? "bg-emerald-100 text-emerald-700"
                                : String(r.esito || r.status || "").toLowerCase().includes("err") || String(r.esito || r.status || "").toLowerCase().includes("fail")
                                ? "bg-red-100 text-red-700"
                                : "bg-slate-100 text-slate-600"
                            }`}>
                              {r.esito || r.status || "–"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================================================================
            TAB: ARCHIVIO PATENTI
            ================================================================ */}
        {tab === "archivio" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">Ricerca avanzata archivio patenti</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-0.5">Cognome</label>
                  <input
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
                    value={archSearch.cognome}
                    onChange={(e) => setArchSearch((p) => ({ ...p, cognome: e.target.value }))}
                    placeholder="Cognome"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-0.5">Nome</label>
                  <input
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
                    value={archSearch.nome}
                    onChange={(e) => setArchSearch((p) => ({ ...p, nome: e.target.value }))}
                    placeholder="Nome"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-0.5">Codice Fiscale</label>
                  <input
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 uppercase"
                    value={archSearch.codice_fiscale}
                    onChange={(e) => setArchSearch((p) => ({ ...p, codice_fiscale: e.target.value.toUpperCase() }))}
                    placeholder="C.F."
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-0.5">Numero Patente</label>
                  <input
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
                    value={archSearch.numero_patente}
                    onChange={(e) => setArchSearch((p) => ({ ...p, numero_patente: e.target.value }))}
                    placeholder="N. patente"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-0.5">Archivio</label>
                  <select
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
                    value={archSearch.archivio}
                    onChange={(e) => setArchSearch((p) => ({ ...p, archivio: e.target.value }))}
                  >
                    <option value="ATTUALE">Attuale</option>
                    <option value="STORICO">Storico</option>
                    <option value="TUTTI">Tutti</option>
                  </select>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={fetchArchivio}
                  disabled={archBusy}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {archBusy ? "Ricerca…" : "🔍 Cerca"}
                </button>
                <button
                  onClick={() => { setArchSearch({ cognome: "", nome: "", codice_fiscale: "", numero_patente: "", archivio: "STORICO" }); setArchResults([]); }}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Azzera
                </button>
              </div>
            </div>

            {archErr && <p className="text-sm text-red-600">❌ {archErr}</p>}

            {archResults.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="bg-slate-50 border-b border-slate-200 px-4 py-2 flex items-center">
                  <span className="text-slate-700 font-semibold text-sm">Risultati: {archResults.length} candidati</span>
                </div>
                <div className="overflow-auto max-h-[50vh]">
                  <table className="min-w-full text-xs">
                    <thead className="sticky top-0 bg-slate-100 z-10">
                      <tr>
                        <th className="px-2 py-2 text-left font-semibold text-slate-700">Cognome / Nome</th>
                        <th className="px-2 py-2 text-left font-semibold text-slate-700">C.F.</th>
                        <th className="px-2 py-2 text-left font-semibold text-slate-700">Categoria</th>
                        <th className="px-2 py-2 text-left font-semibold text-slate-700">Tipo Iscrizione</th>
                        <th className="px-2 py-2 text-left font-semibold text-slate-700">Iscrizione</th>
                        <th className="px-2 py-2 text-left font-semibold text-slate-700">Foglio Rosa</th>
                        <th className="px-2 py-2 text-left font-semibold text-slate-700">N. Patente</th>
                        <th className="px-2 py-2 text-left font-semibold text-slate-700">Archivio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {archResults.map((r) => (
                        <tr key={r.id} className="border-b border-slate-100 hover:bg-indigo-50">
                          <td className="px-2 py-1.5 font-semibold text-slate-900">{r.cognome} {r.nome}</td>
                          <td className="px-2 py-1.5 font-mono text-[10px] text-slate-600">{r.codice_fiscale || "–"}</td>
                          <td className="px-2 py-1.5 text-center">
                            <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-800">{r.categoria_patente || "–"}</span>
                          </td>
                          <td className="px-2 py-1.5 text-slate-600 text-[10px] max-w-[120px] truncate">{r.stato_richiesta || "–"}</td>
                          <td className="px-2 py-1.5 text-slate-600">{formatData(r.data_iscrizione)}</td>
                          <td className="px-2 py-1.5 text-slate-600">{formatData(r.ppg_data_scadenza)}</td>
                          <td className="px-2 py-1.5 text-slate-600 font-mono text-[10px]">{r.patente_numero || "–"}</td>
                          <td className="px-2 py-1.5">
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${r.storico ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                              {r.storico ? "Storico" : "Attuale"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================================================================
            TAB: EXPORT DATI
            ================================================================ */}
        {tab === "export" && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Export candidati */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-3 mb-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-2xl">👥</span>
                  <div>
                    <h3 className="font-bold text-slate-800">Esporta Candidati</h3>
                    <p className="text-xs text-slate-500">Anagrafica completa in formato CSV</p>
                  </div>
                </div>
                <p className="text-xs text-slate-600 mb-3">
                  Esporta tutti i candidati dell&apos;archivio attuale con tutti i campi anagrafici, iscrizione, documenti e patente.
                </p>
                <button
                  onClick={esportaCSV}
                  disabled={exportBusy}
                  className="w-full rounded-xl bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {exportBusy ? "Esporto…" : "📥 Scarica CSV Candidati"}
                </button>
              </div>

              {/* Export pagamenti */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-3 mb-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-2xl">💰</span>
                  <div>
                    <h3 className="font-bold text-slate-800">Esporta Pagamenti</h3>
                    <p className="text-xs text-slate-500">Registro cassa completo in formato CSV</p>
                  </div>
                </div>
                <p className="text-xs text-slate-600 mb-3">
                  Esporta tutto il registro dei pagamenti: tipo, importo, causale, data e stato.
                </p>
                <button
                  onClick={esportaPagamentiCSV}
                  disabled={exportBusy}
                  className="w-full rounded-xl bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {exportBusy ? "Esporto…" : "📥 Scarica CSV Pagamenti"}
                </button>
              </div>
            </div>

            {exportMsg && (
              <div className={`rounded-xl p-3 text-sm font-medium ${exportMsg.startsWith("✅") ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                {exportMsg}
              </div>
            )}

            {/* Note formati */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h4 className="text-sm font-semibold text-slate-700 mb-2">ℹ️ Note sui formati esportati</h4>
              <ul className="text-xs text-slate-600 space-y-1 list-disc ml-4">
                <li>Il file CSV è separato da punto-e-virgola (;) e codificato in UTF-8 con BOM per compatibilità Excel</li>
                <li>Le date sono nel formato YYYY-MM-DD (ISO 8601)</li>
                <li>Il file viene scaricato direttamente nel browser senza passare per il server</li>
                <li>Per importare in Excel: seleziona il file, scegli delimitatore ; e codifica UTF-8</li>
              </ul>
            </div>
          </div>
        )}

        {/* Punto 14 — Lookup per marca operativa */}
        {tab === "lookup-marca" && (
          <LookupMarcaPanel apiBase={getApiBase()} />
        )}

      </div>
    </ModernAppShell>
  );
}

// ─── Lookup Marca Operativa (Punto 14) ───────────────────────────────────────

function LookupMarcaPanel({ apiBase }) {
  const [marca, setMarca]   = useState("");
  const [busy, setBusy]     = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError]   = useState("");

  async function cerca(e) {
    e.preventDefault();
    if (!marca.trim()) return;
    setBusy(true); setResult(null); setError("");
    try {
      const res  = await fetch(`${apiBase}/api/portale/cerca-per-marca`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ marca_operativa: marca.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult(data);
    } catch (err) {
      setError(err.message || "Errore ricerca");
    } finally {
      setBusy(false);
    }
  }

  // Renderizza coppie campo/valore dall'oggetto result
  function renderCampi(obj, prefix = "") {
    if (!obj || typeof obj !== "object") return null;
    return Object.entries(obj)
      .filter(([, v]) => v !== null && v !== undefined && v !== "" && !Array.isArray(v) && typeof v !== "object")
      .map(([k, v]) => (
        <div key={prefix + k} className="flex gap-2 items-start py-0.5 border-b border-slate-100">
          <span className="w-40 shrink-0 text-xs text-slate-500 font-medium">{k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</span>
          <span className="text-xs text-slate-900 break-all">{String(v)}</span>
        </div>
      ));
  }

  function renderSub(obj, label) {
    if (!obj || typeof obj !== "object") return null;
    const campi = renderCampi(obj);
    if (!campi || campi.length === 0) return null;
    return (
      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
        <div className="text-xs font-bold text-slate-700 mb-2 uppercase tracking-wide">{label}</div>
        {campi}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        🔍 Inserisci una <strong>marca operativa</strong> (es. <code>RM12345678</code>) per visualizzare tutti i dati della pratica sul Portale Automobilista.
      </div>

      <form onSubmit={cerca} className="flex gap-3 items-center flex-wrap">
        <input
          type="text"
          value={marca}
          onChange={(e) => setMarca(e.target.value.toUpperCase())}
          placeholder="Marca operativa (es. RM12345678)"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono w-64 focus:border-blue-500 focus:outline-none"
          autoFocus
        />
        <button
          type="submit"
          disabled={busy || !marca.trim()}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "⏳ Ricerca…" : "🔍 Cerca"}
        </button>
        {result && (
          <button type="button" onClick={() => { setResult(null); setMarca(""); }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">
            ✕ Pulisci
          </button>
        )}
      </form>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">❌ {error}</div>
      )}

      {result && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-1">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">📋</span>
            <div>
              <div className="font-bold text-slate-800 text-base">
                {result.cognome || result.stato?.cognome || "–"} {result.nome || result.stato?.nome || ""}
              </div>
              <div className="text-xs text-slate-500">
                Marca: <span className="font-mono font-bold text-blue-700">{marca}</span>
                {result.stato?.valore && (
                  <span className="ml-3 rounded px-2 py-0.5 text-xs font-bold bg-emerald-100 text-emerald-800">{result.stato.valore}</span>
                )}
              </div>
            </div>
          </div>

          {/* Campi top-level */}
          {renderCampi(result)}

          {/* Sottooggetti */}
          {typeof result.stato === "object" && renderSub(result.stato, "Stato richiesta")}
          {typeof result.anagrafica === "object" && renderSub(result.anagrafica, "Anagrafica")}
          {typeof result.patente === "object" && renderSub(result.patente, "Patente")}
          {typeof result.modulo === "object" && renderSub(result.modulo, "Dati modulo")}
          {typeof result.bollettini === "object" && renderSub(result.bollettini, "Bollettini")}

          {/* Trace (collassabile) */}
          {Array.isArray(result.trace) && result.trace.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-600">
                🔧 Trace debug ({result.trace.length} step)
              </summary>
              <pre className="mt-1 overflow-auto rounded bg-slate-800 p-3 text-[11px] text-green-300 max-h-60">
                {JSON.stringify(result.trace, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

export default function StrumentiUtiliPageWrapper() {
  return <Suspense fallback={null}><StrumentiUtiliPage /></Suspense>;
}

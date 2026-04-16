"use client";

/**
 * /scadenze-mediche — Scadenze rinnovi medici (art. 126 CdS)
 * Vista tabellare dei certificati medici TT2112 in scadenza, con filtri per
 * finestra temporale, ricerca, categoria. Export CSV.
 *
 * Dati: rinnovi_portale.tipo_rinnovo='medico' con data_scadenza materializzata
 *       dallo script scripts/recovery/calcola_scadenze_medico.js.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getApiBase,
  authHeaders,
  checkSession,
  logoutSession,
} from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDataIT(dateStr) {
  if (!dateStr) return "–";
  const s = String(dateStr).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return dateStr;
  return new Date(s + "T00:00:00Z").toLocaleDateString("it-IT");
}

function scadenzaClass(giorni) {
  if (giorni == null) return "text-slate-500";
  if (giorni < 0) return "text-red-700 font-bold";
  if (giorni <= 14) return "text-red-600 font-semibold";
  if (giorni <= 30) return "text-amber-700 font-semibold";
  if (giorni <= 60) return "text-amber-600";
  return "text-slate-600";
}

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  if (/[",;\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Categorie "pesanti" (C/D e derivate) in accordo a scadenzeService.js
const PESANTI = new Set(["C", "C1", "CE", "C1E", "D", "D1", "DE", "D1E"]);
function categoriaBucket(cat) {
  if (!cat) return "leggera";
  const c = String(cat).trim().toUpperCase().split(/[,/\s]/)[0];
  return PESANTI.has(c) ? "pesante" : "leggera";
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ScadenzeMedichePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({ scaduti: 0, giorni30: 0, giorni60: 0, giorni90: 0 });
  const [busy, setBusy] = useState(false);
  const [errore, setErrore] = useState(null);

  // Filtri
  const [giorni, setGiorni] = useState(90);
  const [includiScaduti, setIncludiScaduti] = useState(true);
  const [scadutiGiorni, setScadutiGiorni] = useState(30);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all"); // all | leggera | pesante

  // ---- Fetch -----------------------------------------------------------
  const fetchData = useCallback(async () => {
    setBusy(true);
    setErrore(null);
    try {
      const base = getApiBase();
      const qs = new URLSearchParams({
        giorni: String(giorni),
        limit: "500",
      });
      if (includiScaduti) {
        qs.set("includi_scaduti", "1");
        qs.set("scaduti_giorni", String(scadutiGiorni));
      }
      const res = await fetch(`${base}/api/visite-mediche/scadenze-medico?${qs}`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const d = await res.json();
      setItems(Array.isArray(d.items) ? d.items : []);
      setCounts(d.counts || { scaduti: 0, giorni30: 0, giorni60: 0, giorni90: 0 });
    } catch (e) {
      setErrore(e.message || "Errore caricamento");
      setItems([]);
    } finally {
      setBusy(false);
    }
  }, [giorni, includiScaduti, scadutiGiorni]);

  // ---- Init ------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await checkSession();
      if (!session.ok) {
        if (!cancelled) router.replace("/login");
        return;
      }
      if (!cancelled) {
        setUser(session.autoscuola || null);
        setLoading(false);
        fetchData();
      }
    })();
    return () => { cancelled = true; };
  }, [router, fetchData]);

  async function onLogout() {
    await logoutSession();
    router.replace("/login");
  }

  // ---- Filtri client-side ---------------------------------------------
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((r) => {
      if (catFilter === "leggera" && categoriaBucket(r.categoria_patente) !== "leggera") return false;
      if (catFilter === "pesante" && categoriaBucket(r.categoria_patente) !== "pesante") return false;
      if (q) {
        const hay = `${r.cognome || ""} ${r.nome || ""} ${r.codice_fiscale || ""} ${r.patente || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, search, catFilter]);

  // ---- Export CSV -----------------------------------------------------
  function exportCSV() {
    const header = [
      "Cognome", "Nome", "Codice Fiscale", "Categoria", "Patente",
      "Data Visita Medica", "Data Scadenza", "Giorni Rimanenti",
    ];
    const lines = [header.join(";")];
    for (const r of filtered) {
      lines.push([
        csvEscape(r.cognome),
        csvEscape(r.nome),
        csvEscape(r.codice_fiscale),
        csvEscape(r.categoria_patente),
        csvEscape(r.patente),
        csvEscape(formatDataIT(r.data_visita_medica) === "–" ? r.data_visita_medica || "" : formatDataIT(r.data_visita_medica)),
        csvEscape(formatDataIT(r.data_scadenza)),
        csvEscape(r.giorni_rimanenti),
      ].join(";"));
    }
    // BOM per Excel italiano
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scadenze-mediche-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---- Render ---------------------------------------------------------
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <p className="text-slate-600">Caricamento...</p>
      </div>
    );
  }

  return (
    <ModernAppShell
      title="Scadenze Mediche"
      subtitle="Rinnovi TT2112 in scadenza (art. 126 CdS)"
      activeKey="scadenze-mediche"
      onLogout={onLogout}
      user={user}
    >
      {/* Header + contatori */}
      <div className="mb-5">
        <h2 className="text-2xl font-black text-slate-900">⏳ Scadenze rinnovi medici</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Calcolo secondo art. 126 Codice della Strada: età alla visita medica × categoria patente.
        </p>
      </div>

      <div className="mb-5 grid gap-2 grid-cols-2 sm:grid-cols-4">
        <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-red-700">Già scaduti</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-red-700">
            {busy ? "…" : counts.scaduti}
          </p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-red-600">Entro 30gg</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-red-600">
            {busy ? "…" : counts.giorni30}
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Entro 60gg</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-amber-700">
            {busy ? "…" : counts.giorni60}
          </p>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-sky-600">Entro 90gg</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-sky-700">
            {busy ? "…" : counts.giorni90}
          </p>
        </div>
      </div>

      {/* Filtri */}
      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Finestra in avanti</label>
            <select
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              value={giorni}
              onChange={(e) => setGiorni(Number(e.target.value))}
            >
              <option value={30}>30 giorni</option>
              <option value={60}>60 giorni</option>
              <option value={90}>90 giorni</option>
              <option value={180}>180 giorni</option>
              <option value={365}>365 giorni</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              <input
                type="checkbox"
                className="mr-1 align-middle"
                checked={includiScaduti}
                onChange={(e) => setIncludiScaduti(e.target.checked)}
              />
              Includi scaduti (giorni all'indietro)
            </label>
            <select
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100"
              value={scadutiGiorni}
              onChange={(e) => setScadutiGiorni(Number(e.target.value))}
              disabled={!includiScaduti}
            >
              <option value={30}>30 giorni</option>
              <option value={60}>60 giorni</option>
              <option value={90}>90 giorni</option>
              <option value={180}>180 giorni</option>
              <option value={365}>365 giorni</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Categoria</label>
            <select
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
            >
              <option value="all">Tutte</option>
              <option value="leggera">Leggere (A/B)</option>
              <option value="pesante">Pesanti (C/D)</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Ricerca</label>
            <input
              type="text"
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              placeholder="Cognome, nome, CF, patente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Mostrati <strong className="tabular-nums">{filtered.length}</strong>
            {filtered.length !== items.length && (
              <> su <strong className="tabular-nums">{items.length}</strong></>
            )}{" "}
            rinnovi
          </p>
          <div className="flex gap-2">
            <button
              onClick={fetchData}
              disabled={busy}
              className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              {busy ? "Caricamento..." : "↻ Aggiorna"}
            </button>
            <button
              onClick={exportCSV}
              disabled={filtered.length === 0}
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
            >
              📥 Export CSV
            </button>
          </div>
        </div>

        {errore && (
          <p className="mt-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            Errore: {errore}
          </p>
        )}
      </section>

      {/* Tabella */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">Cognome Nome</th>
                <th className="px-3 py-2 text-left">Cat.</th>
                <th className="px-3 py-2 text-left">Patente</th>
                <th className="px-3 py-2 text-left">Codice Fiscale</th>
                <th className="px-3 py-2 text-left">Visita medica</th>
                <th className="px-3 py-2 text-left">Data scadenza</th>
                <th className="px-3 py-2 text-right">Giorni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {busy && items.length === 0 ? (
                <tr><td colSpan="7" className="px-3 py-6 text-center text-slate-500">Caricamento...</td></tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-3 py-6 text-center text-slate-500 italic">
                    Nessun rinnovo medico in scadenza per i filtri selezionati.
                  </td>
                </tr>
              ) : filtered.map((r) => {
                const g = r.giorni_rimanenti;
                const cellClass = scadenzaClass(g);
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2">
                      {r.candidato_id ? (
                        <Link
                          href={`/candidati?id=${r.candidato_id}`}
                          className="font-medium text-indigo-700 hover:underline"
                        >
                          {r.cognome || "–"} {r.nome || ""}
                        </Link>
                      ) : (
                        <span className="font-medium text-slate-800">
                          {r.cognome || "–"} {r.nome || ""}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{r.categoria_patente || "B"}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-500 text-xs">{r.patente || "–"}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-500 text-xs">{r.codice_fiscale || "–"}</td>
                    <td className="px-3 py-2 text-slate-600">{r.data_visita_medica || "–"}</td>
                    <td className={`px-3 py-2 ${cellClass}`}>{formatDataIT(r.data_scadenza)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${cellClass}`}>
                      {g == null ? "–" : g < 0 ? `-${Math.abs(g)}` : `+${g}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </ModernAppShell>
  );
}

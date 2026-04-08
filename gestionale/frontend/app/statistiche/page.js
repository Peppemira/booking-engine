"use client";

import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AreaChart, Area,
  BarChart, Bar,
  LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { getApiBase, authHeaders, checkSession, logoutSession } from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const TABS = [
  { key: "grafici",   label: "Grafici" },
  { key: "conteggi",  label: "Iscrizioni" },
  { key: "esami",     label: "Esami" },
  { key: "incassi",   label: "Incassi" },
  { key: "scheda",    label: "Scheda contabile" },
];

const PIE_COLORS = ["#6366f1","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#f97316","#84cc16","#ec4899","#14b8a6"];

function toYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function defaultRange() {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth() - 5, 1);
  return { dataini: toYMD(start), datafin: toYMD(end) };
}
function formatMese(str) {
  if (!str) return "";
  const d = new Date(str);
  return d.toLocaleDateString("it-IT", { month: "short", year: "2-digit" });
}
function formatEur(n) {
  return Number(n || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}
function pct(n, tot) {
  if (!tot) return "–";
  return `${Math.round((n / tot) * 100)}%`;
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

function KpiCard({ label, value, sub, color = "indigo", icon }) {
  const bg = {
    indigo: "bg-indigo-50 border-indigo-200",
    emerald: "bg-emerald-50 border-emerald-200",
    amber: "bg-amber-50 border-amber-200",
    violet: "bg-violet-50 border-violet-200",
  }[color] || "bg-slate-50 border-slate-200";
  const txt = {
    indigo: "text-indigo-700",
    emerald: "text-emerald-700",
    amber: "text-amber-700",
    violet: "text-violet-700",
  }[color] || "text-slate-700";

  return (
    <div className={`rounded-2xl border p-4 ${bg}`}>
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-slate-600">{label}</p>
        {icon && <span className="text-xl">{icon}</span>}
      </div>
      <p className={`mt-2 text-3xl font-extrabold ${txt}`}>{value ?? "–"}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tooltip custom recharts
// ---------------------------------------------------------------------------

function CustomTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-lg text-xs">
      <p className="mb-1.5 font-semibold text-slate-700">{formatMese(label) || label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }} className="flex justify-between gap-4">
          <span>{p.name}</span>
          <span className="font-bold">{formatter ? formatter(p.value, p.name) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente principale
// ---------------------------------------------------------------------------

function StatistichePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get?.("tab");
  const initTab = TABS.some((t) => t.key === tabParam) ? tabParam : "grafici";

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(initTab);
  const [range, setRange] = useState(defaultRange);
  const [codiceAutoscuola, setCodiceAutoscuola] = useState("");

  const [graficiData, setGraficiData] = useState(null);
  const [conteggiData, setConteggiData] = useState(null);
  const [esamiData, setEsamiData] = useState(null);
  const [incassiData, setIncassiData] = useState(null);
  const [apiLoading, setApiLoading] = useState(false);
  const [error, setError] = useState("");

  const base = String(getApiBase?.() || "").trim() || "http://localhost:3000";

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

  // ---------------------------------------------------------------------------
  // Fetch functions
  // ---------------------------------------------------------------------------

  const fetchGrafici = useCallback(async () => {
    setApiLoading(true); setError("");
    try {
      const p = new URLSearchParams({ dataini: range.dataini, datafin: range.datafin });
      const res = await fetch(`${base}/api/resoconti/grafici?${p}`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Errore grafici");
      setGraficiData(data);
    } catch (e) { setError(e.message); setGraficiData(null); }
    finally { setApiLoading(false); }
  }, [base, range.dataini, range.datafin]);

  const fetchConteggi = useCallback(async () => {
    setApiLoading(true); setError("");
    try {
      const p = new URLSearchParams({ dataini: range.dataini, datafin: range.datafin });
      if (codiceAutoscuola) p.set("codice_autoscuola", codiceAutoscuola);
      const res = await fetch(`${base}/api/resoconti/conteggi?${p}`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Errore conteggi");
      setConteggiData(data);
    } catch (e) { setError(e.message); setConteggiData(null); }
    finally { setApiLoading(false); }
  }, [base, range.dataini, range.datafin, codiceAutoscuola]);

  const fetchEsami = useCallback(async () => {
    setApiLoading(true); setError("");
    try {
      const p = new URLSearchParams({ dataini: range.dataini, datafin: range.datafin });
      if (codiceAutoscuola) p.set("codice_autoscuola", codiceAutoscuola);
      const res = await fetch(`${base}/api/resoconti/esami?${p}`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Errore esami");
      setEsamiData(data);
    } catch (e) { setError(e.message); setEsamiData(null); }
    finally { setApiLoading(false); }
  }, [base, range.dataini, range.datafin, codiceAutoscuola]);

  const fetchIncassi = useCallback(async () => {
    setApiLoading(true); setError("");
    try {
      const p = new URLSearchParams({ dataini: range.dataini, datafin: range.datafin });
      const res = await fetch(`${base}/api/resoconti/incassi?${p}`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Errore incassi");
      setIncassiData(data);
    } catch (e) { setError(e.message); setIncassiData(null); }
    finally { setApiLoading(false); }
  }, [base, range.dataini, range.datafin]);

  // Auto-load grafici on mount + when grafici tab active
  useEffect(() => {
    if (!loading) fetchGrafici();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  useEffect(() => {
    if (!loading && tab === "grafici") fetchGrafici();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  function runReport() {
    if (tab === "conteggi") fetchConteggi();
    else if (tab === "esami") fetchEsami();
    else if (tab === "incassi") fetchIncassi();
    else if (tab === "grafici") fetchGrafici();
  }

  // ---------------------------------------------------------------------------
  // KPI derivati dai dati grafici
  // ---------------------------------------------------------------------------

  const kpi = useMemo(() => {
    if (!graficiData) return null;
    const isc = graficiData.iscrizioni || [];
    const esm = graficiData.esami || [];
    const inc = graficiData.incassi || [];

    const totIscritti = isc.reduce((s, x) => s + (x.count || 0), 0);
    const totEsami = esm.reduce((s, x) => s + (x.totale || 0), 0);
    const totIdonei = esm.reduce((s, x) => s + (x.idonei || 0), 0);
    const totIncassi = inc.reduce((s, x) => s + (x.importo || 0), 0);

    // Esami nell'ultimo mese presente
    const lastMese = esm.length ? esm[esm.length - 1] : null;
    const esamiMese = lastMese?.totale ?? 0;
    const labelMese = lastMese ? formatMese(lastMese.mese) : "";

    return { totIscritti, totEsami, totIdonei, totIncassi, esamiMese, labelMese };
  }, [graficiData]);

  // Dati per PieChart tipo patente (da conteggi)
  const patenteData = useMemo(() => {
    const list = conteggiData?.list || [];
    const counts = {};
    list.forEach((r) => {
      const k = r.tipoiscrn || "–";
      counts[k] = (counts[k] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [conteggiData]);

  // Dati recharts per iscrizioni
  const iscrizioniChart = useMemo(() =>
    (graficiData?.iscrizioni || []).map((x) => ({ ...x, label: formatMese(x.mese) })),
    [graficiData]
  );

  // Dati recharts per esami (stacked bar)
  const esamiChart = useMemo(() =>
    (graficiData?.esami || []).map((x) => ({ ...x, label: formatMese(x.mese) })),
    [graficiData]
  );

  // Dati recharts per incassi
  const incassiChart = useMemo(() =>
    (graficiData?.incassi || []).map((x) => ({ ...x, label: formatMese(x.mese) })),
    [graficiData]
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-slate-600">Caricamento...</p>
      </div>
    );
  }

  return (
    <ModernAppShell
      title="Statistiche"
      subtitle="KPI, grafici, conteggi iscrizioni, resoconto esami e incassi"
      activeKey="statistiche"
      onLogout={() => logoutSession().then(() => router.replace("/login"))}
      user={user}
    >
      <div className="space-y-5 overflow-y-auto h-[calc(100vh-120px)] pr-1">

        {/* ── KPI CARDS ── */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            icon="👤"
            label="Iscritti nel periodo"
            value={kpi?.totIscritti ?? "–"}
            sub={graficiData ? `${graficiData.dataini} → ${graficiData.datafin}` : "Caricamento…"}
            color="indigo"
          />
          <KpiCard
            icon="📅"
            label={`Esami ${kpi?.labelMese || "questo mese"}`}
            value={kpi?.esamiMese ?? "–"}
            sub={kpi ? `Totale periodo: ${kpi.totEsami}` : "Caricamento…"}
            color="emerald"
          />
          <KpiCard
            icon="🎯"
            label="Tasso promozione"
            value={kpi ? pct(kpi.totIdonei, kpi.totEsami) : "–"}
            sub={kpi ? `${kpi.totIdonei} idonei su ${kpi.totEsami} esami` : "Caricamento…"}
            color="violet"
          />
          <KpiCard
            icon="💰"
            label="Incassi periodo"
            value={kpi ? formatEur(kpi.totIncassi) : "–"}
            sub="Da tabella pagamenti"
            color="amber"
          />
        </div>

        {/* ── CONTROLLI PERIODO + TAB ── */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-slate-600">
            Da
            <input type="date" value={range.dataini}
              onChange={(e) => setRange((r) => ({ ...r, dataini: e.target.value }))}
              className="ml-1 rounded-lg border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-sm text-slate-600">
            A
            <input type="date" value={range.datafin}
              onChange={(e) => setRange((r) => ({ ...r, datafin: e.target.value }))}
              className="ml-1 rounded-lg border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          {(tab === "conteggi" || tab === "esami") && (
            <label className="text-sm text-slate-600">
              Cod. autoscuola
              <input type="text" value={codiceAutoscuola}
                onChange={(e) => setCodiceAutoscuola(e.target.value)}
                placeholder="opzionale"
                className="ml-1 w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
          )}
          <button
            onClick={runReport}
            disabled={apiLoading}
            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            {apiLoading ? "Caricamento…" : tab === "grafici" ? "Aggiorna grafici" : "Elabora"}
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-2">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                tab === t.key ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* ================================================================
            TAB: GRAFICI
            ================================================================ */}
        {tab === "grafici" && (
          <div className="space-y-5">

            {/* Riga 1: Iscrizioni per mese + Distribuzione patente */}
            <div className="grid gap-4 lg:grid-cols-3">

              {/* Iscrizioni per mese — BarChart */}
              <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="mb-3 font-semibold text-slate-800">Iscrizioni per mese</h3>
                {iscrizioniChart.length ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={iscrizioniChart} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="count" name="Iscritti" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyChart loading={apiLoading} />
                )}
              </div>

              {/* Distribuzione tipo patente — PieChart (se dati conteggi disponibili) */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="mb-3 font-semibold text-slate-800">Iscrizioni per tipo patente</h3>
                {patenteData.length ? (
                  <>
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie
                          data={patenteData}
                          cx="50%" cy="50%"
                          outerRadius={70}
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${Math.round(percent * 100)}%`}
                          labelLine={false}
                        >
                          {patenteData.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v) => [`${v} iscritti`, ""]} />
                      </PieChart>
                    </ResponsiveContainer>
                    <ul className="mt-2 space-y-0.5">
                      {patenteData.slice(0, 6).map((d, i) => (
                        <li key={d.name} className="flex items-center gap-1.5 text-xs text-slate-600">
                          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                          {d.name} — {d.value}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-sm text-slate-400 italic mt-4">
                    Vai in &quot;Iscrizioni&quot;, clicca Elabora, poi torna qui.
                  </p>
                )}
              </div>
            </div>

            {/* Riga 2: Esami per mese — stacked BarChart */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 font-semibold text-slate-800">Esami per mese</h3>
              {esamiChart.length ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={esamiChart} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="idonei"   name="Idonei"   stackId="a" fill="#10b981" radius={[0,0,0,0]} />
                    <Bar dataKey="respinti" name="Respinti" stackId="a" fill="#ef4444" />
                    <Bar dataKey="assenti"  name="Assenti"  stackId="a" fill="#94a3b8" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart loading={apiLoading} />
              )}
            </div>

            {/* Riga 3: Incassi per mese — AreaChart */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 font-semibold text-slate-800">Incassi per mese (€)</h3>
              {incassiChart.some((x) => x.importo > 0) ? (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={incassiChart} margin={{ top: 4, right: 8, left: 10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradInc" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `€${(v/1000).toFixed(0)}k`} />
                    <Tooltip content={<CustomTooltip formatter={(v) => formatEur(v)} />} />
                    <Area
                      type="monotone" dataKey="importo" name="Incassi"
                      stroke="#f59e0b" fill="url(#gradInc)" strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart loading={apiLoading} msg="Nessun incasso nel periodo o tabella pagamenti non presente." />
              )}
            </div>

            {/* Riga 4: Tasso promozione — LineChart */}
            {esamiChart.some((x) => x.totale > 0) && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="mb-3 font-semibold text-slate-800">Tasso promozione per mese (%)</h3>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart
                    data={esamiChart.map((x) => ({
                      ...x,
                      tasso: x.totale ? Math.round((x.idonei / x.totale) * 100) : 0,
                    }))}
                    margin={{ top: 4, right: 8, left: -10, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                    <Tooltip content={<CustomTooltip formatter={(v) => `${v}%`} />} />
                    <Line
                      type="monotone" dataKey="tasso" name="Promozione"
                      stroke="#8b5cf6" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* ================================================================
            TAB: CONTEGGI ISCRIZIONI
            ================================================================ */}
        {tab === "conteggi" && (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            {!conteggiData && !apiLoading && (
              <p className="p-6 text-sm text-slate-500">Imposta il periodo e clicca <strong>Elabora</strong>.</p>
            )}
            {apiLoading && <p className="p-6 text-sm text-slate-400">Caricamento…</p>}
            {conteggiData && (
              <>
                {/* Sommario */}
                <div className="flex flex-wrap items-center gap-6 border-b border-slate-100 px-4 py-3">
                  <Stat label="Iscrizioni totali" value={conteggiData.totale} />
                  <Stat label="Periodo" value={`${conteggiData.dataini} → ${conteggiData.datafin}`} />
                </div>
                {/* Tabella */}
                <div className="max-h-120 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr className="border-b border-slate-200">
                        <th className="px-3 py-2 text-left font-semibold text-slate-600">Cognome / Nome</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-600">Codice Fiscale</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-600">Patente</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-600">Tipo</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-600">Cod. autoscuola</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-600">Data iscrizione</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(conteggiData.list || []).length === 0 ? (
                        <tr><td colSpan={6} className="py-8 text-center text-slate-400">Nessuna iscrizione nel periodo</td></tr>
                      ) : (
                        (conteggiData.list || []).map((r) => (
                          <tr key={r.cod_ana} className="border-b border-slate-100 hover:bg-slate-50 last:border-0">
                            <td className="px-3 py-2 font-medium text-slate-800">{r.cogn} {r.nom}</td>
                            <td className="px-3 py-2 text-slate-600 font-mono text-xs">{r.codice_fiscale || "–"}</td>
                            <td className="px-3 py-2 text-slate-600">{r.patrich || "–"}</td>
                            <td className="px-3 py-2">
                              {r.tipoiscrn ? (
                                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                                  {r.tipoiscrn}
                                </span>
                              ) : "–"}
                            </td>
                            <td className="px-3 py-2 text-slate-600">{r.codautos || "–"}</td>
                            <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                              {r.created_at ? new Date(r.created_at).toLocaleDateString("it-IT") : "–"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* ================================================================
            TAB: RESOCONTO ESAMI
            ================================================================ */}
        {tab === "esami" && (
          <div className="space-y-4">
            {!esamiData && !apiLoading && (
              <p className="text-sm text-slate-500">Imposta il periodo e clicca <strong>Elabora</strong>.</p>
            )}
            {apiLoading && <p className="text-sm text-slate-400">Caricamento…</p>}

            {esamiData && (
              <>
                {/* KPI esami */}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <KpiCard label="Totale esami"   value={esamiData.totali?.totale}   color="indigo"  icon="📋" />
                  <KpiCard label="Idonei"         value={esamiData.totali?.idonei}   color="emerald" icon="✅"
                    sub={pct(esamiData.totali?.idonei, esamiData.totali?.totale)} />
                  <KpiCard label="Respinti"       value={esamiData.totali?.respinti} color="violet"  icon="❌"
                    sub={pct(esamiData.totali?.respinti, esamiData.totali?.totale)} />
                  <KpiCard label="Assenti/Altro"  value={esamiData.totali?.assenti}  color="amber"   icon="⏸"
                    sub={pct(esamiData.totali?.assenti, esamiData.totali?.totale)} />
                </div>

                {/* Tabella riepilogo per tipo */}
                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 px-4 py-3">
                    <h3 className="font-semibold text-slate-800">Riepilogo per tipo</h3>
                    <p className="text-xs text-slate-500 mt-0.5">{esamiData.dataini} → {esamiData.datafin}</p>
                  </div>
                  <div className="overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr className="border-b border-slate-200">
                          <th className="px-4 py-2 text-left font-semibold text-slate-600">Tipo / Categoria</th>
                          <th className="px-4 py-2 text-right font-semibold text-emerald-700">Idonei</th>
                          <th className="px-4 py-2 text-right font-semibold text-red-600">Respinti</th>
                          <th className="px-4 py-2 text-right font-semibold text-slate-500">Assenti</th>
                          <th className="px-4 py-2 text-right font-semibold text-slate-700">Totale</th>
                          <th className="px-4 py-2 text-right font-semibold text-violet-700">Tasso %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(esamiData.riepilogo || []).length === 0 ? (
                          <tr><td colSpan={6} className="py-8 text-center text-slate-400">Nessun esame nel periodo</td></tr>
                        ) : (
                          (esamiData.riepilogo || []).map((r) => (
                            <tr key={r.tipo} className="border-b border-slate-100 hover:bg-slate-50 last:border-0">
                              <td className="px-4 py-2 font-medium text-slate-800">{r.tipo}</td>
                              <td className="px-4 py-2 text-right font-semibold text-emerald-700">{r.idonei}</td>
                              <td className="px-4 py-2 text-right font-semibold text-red-600">{r.respinti}</td>
                              <td className="px-4 py-2 text-right text-slate-500">{r.assenti}</td>
                              <td className="px-4 py-2 text-right font-bold text-slate-800">{r.totale}</td>
                              <td className="px-4 py-2 text-right text-violet-700 font-medium">
                                {pct(r.idonei, r.totale)}
                              </td>
                            </tr>
                          ))
                        )}
                        {/* Riga totali */}
                        {(esamiData.riepilogo || []).length > 0 && (
                          <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                            <td className="px-4 py-2 text-slate-700">Totale</td>
                            <td className="px-4 py-2 text-right text-emerald-700">{esamiData.totali?.idonei}</td>
                            <td className="px-4 py-2 text-right text-red-600">{esamiData.totali?.respinti}</td>
                            <td className="px-4 py-2 text-right text-slate-500">{esamiData.totali?.assenti}</td>
                            <td className="px-4 py-2 text-right text-slate-800">{esamiData.totali?.totale}</td>
                            <td className="px-4 py-2 text-right text-violet-700">
                              {pct(esamiData.totali?.idonei, esamiData.totali?.totale)}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Dettaglio singoli esami */}
                {(esamiData.list || []).length > 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-100 px-4 py-3">
                      <h3 className="font-semibold text-slate-800">Dettaglio esami ({esamiData.list.length})</h3>
                    </div>
                    <div className="max-h-64 overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-slate-50">
                          <tr className="border-b border-slate-200">
                            <th className="px-3 py-2 text-left font-semibold text-slate-600">Candidato</th>
                            <th className="px-3 py-2 text-left font-semibold text-slate-600">Categoria</th>
                            <th className="px-3 py-2 text-left font-semibold text-slate-600">Data esame</th>
                            <th className="px-3 py-2 text-left font-semibold text-slate-600">Esito</th>
                          </tr>
                        </thead>
                        <tbody>
                          {esamiData.list.map((r) => {
                            const es = String(r.esito || "").toUpperCase();
                            const chip =
                              es === "I" || es === "IDONEO" || es === "PROMOSSO"
                                ? "bg-emerald-100 text-emerald-800"
                                : es === "R" || es === "RESPINTO" || es === "BOCCIATO"
                                ? "bg-red-100 text-red-800"
                                : "bg-slate-100 text-slate-600";
                            return (
                              <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50 last:border-0">
                                <td className="px-3 py-2 font-medium text-slate-800">
                                  {r.cognome} {r.nome}
                                </td>
                                <td className="px-3 py-2 text-slate-600">{r.categoria || "–"}</td>
                                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                                  {r.data ? new Date(r.data).toLocaleDateString("it-IT") : "–"}
                                </td>
                                <td className="px-3 py-2">
                                  {r.esito ? (
                                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${chip}`}>
                                      {r.esito}
                                    </span>
                                  ) : "–"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ================================================================
            TAB: INCASSI
            ================================================================ */}
        {tab === "incassi" && (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            {!incassiData && !apiLoading && (
              <p className="p-6 text-sm text-slate-500">Imposta il periodo e clicca <strong>Elabora</strong>.</p>
            )}
            {apiLoading && <p className="p-6 text-sm text-slate-400">Caricamento…</p>}
            {incassiData && (
              <>
                <div className="flex flex-wrap items-center gap-6 border-b border-slate-100 px-4 py-3">
                  <Stat label="Movimenti" value={incassiData.totale} />
                  <Stat label="Totale incassato" value={formatEur(incassiData.somma)} />
                  <Stat label="Periodo" value={`${incassiData.dataini} → ${incassiData.datafin}`} />
                  {incassiData.note && (
                    <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-800">
                      ⚠ {incassiData.note}
                    </span>
                  )}
                </div>
                <div className="max-h-120 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr className="border-b border-slate-200">
                        <th className="px-3 py-2 text-left font-semibold text-slate-600">Data</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-600">Tipo</th>
                        <th className="px-3 py-2 text-right font-semibold text-slate-600">Importo</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-600">Causale</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(incassiData.list || []).length === 0 ? (
                        <tr><td colSpan={4} className="py-8 text-center text-slate-400">Nessun movimento nel periodo</td></tr>
                      ) : (
                        (incassiData.list || []).map((r) => (
                          <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50 last:border-0">
                            <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.data_rif || "–"}</td>
                            <td className="px-3 py-2">
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                                {r.tipo || "–"}
                              </span>
                            </td>
                            <td className={`px-3 py-2 text-right font-semibold tabular-nums ${
                              Number(r.importo) < 0 ? "text-red-600" : "text-slate-800"
                            }`}>
                              {formatEur(r.importo)}
                            </td>
                            <td className="px-3 py-2 text-slate-600">{r.causale || "–"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* ================================================================
            TAB: SCHEDA CONTABILE (GeCA: newschecont)
            ================================================================ */}
        {tab === "scheda" && (
          <SchedaContabile />
        )}

      </div>
    </ModernAppShell>
  );
}

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

function EmptyChart({ loading, msg }) {
  return (
    <div className="flex h-36 items-center justify-center text-sm text-slate-400">
      {loading ? "Caricamento…" : (msg || "Nessun dato nel periodo.")}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-base font-bold text-slate-800">{value ?? "–"}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SchedaContabile – equivalente GeCA: newschecont
// Ricerca un candidato, mostra riepilogo pagamenti/esami e totali
// ---------------------------------------------------------------------------
function SchedaContabile() {
  const base = typeof window !== "undefined"
    ? (localStorage.getItem("autoscuola_api_base") || "http://localhost:3000") : "http://localhost:3000";

  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [candBusy, setCandBusy] = useState(false);
  const [selected, setSelected] = useState(null);
  const [storia, setStoria] = useState(null);
  const [storiaBusy, setStoriaBusy] = useState(false);
  const [storiaErr, setStoriaErr] = useState("");

  function authH() {
    try {
      const tok = typeof window !== "undefined" ? localStorage.getItem("autoscuola_token") : null;
      return tok ? { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
    } catch { return { "Content-Type": "application/json" }; }
  }

  async function cercaCandidati() {
    if (search.trim().length < 2) return;
    setCandBusy(true);
    try {
      const q = new URLSearchParams({ cognome: search.trim() });
      const res = await fetch(`${base}/api/candidati-api?${q}`, { headers: authH() });
      const d = await res.json();
      setCandidates(Array.isArray(d) ? d.slice(0, 20) : []);
    } catch { setCandidates([]); }
    finally { setCandBusy(false); }
  }

  async function caricaStoria(candidato) {
    setSelected(candidato); setStoria(null); setStoriaErr(""); setStoriaBusy(true);
    try {
      const res = await fetch(`${base}/api/candidati-api/${candidato.id}/storia`, { headers: authH() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStoria(await res.json());
    } catch (e) { setStoriaErr(e.message || "Errore"); }
    finally { setStoriaBusy(false); }
  }

  function fmtEur(n) { return Number(n || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" }); }
  function fmtData(v) {
    const s = String(v || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return v || "–";
    return new Date(s + "T00:00:00Z").toLocaleDateString("it-IT");
  }

  const pagamenti = storia?.pagamenti || [];
  const prenotazioni = storia?.prenotazioni || [];
  const totIncassato = storia?.totaleIncassato || 0;
  const totPagamenti = pagamenti.length;
  const totEsami = prenotazioni.length;
  const idonei = prenotazioni.filter((p) => String(p.esito || "").toLowerCase().includes("idon")).length;

  // Raggruppa pagamenti per tipo
  const perTipo = pagamenti.reduce((acc, p) => {
    const t = p.tipo || "altro";
    acc[t] = (acc[t] || 0) + parseFloat(p.importo || 0);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Ricerca candidato */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="font-semibold text-slate-900 mb-2">Scheda contabile per candidato</h3>
        <p className="text-xs text-slate-500 mb-3">Equivalente GeCA: <code className="text-indigo-600">newschecont</code> — Riepilogo finanziario completo per candidato.</p>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            placeholder="Cerca per cognome…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && cercaCandidati()}
          />
          <button
            onClick={cercaCandidati}
            disabled={candBusy}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {candBusy ? "…" : "🔍 Cerca"}
          </button>
        </div>
        {candidates.length > 0 && (
          <div className="mt-2 rounded-lg border border-slate-200 overflow-hidden">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-100">
                <tr>
                  <th className="px-3 py-1.5 text-left font-semibold text-slate-700">Cognome / Nome</th>
                  <th className="px-3 py-1.5 text-left font-semibold text-slate-700">C.F.</th>
                  <th className="px-3 py-1.5 text-left font-semibold text-slate-700">Categoria</th>
                  <th className="px-3 py-1.5 text-left font-semibold text-slate-700">Iscrizione</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => caricaStoria(c)}
                    className={`border-b border-slate-100 cursor-pointer ${selected?.id === c.id ? "bg-indigo-50" : "hover:bg-slate-50"}`}
                  >
                    <td className="px-3 py-1.5 font-medium text-slate-900">{c.cognome} {c.nome}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-slate-600">{c.codice_fiscale || "–"}</td>
                    <td className="px-3 py-1.5 text-center"><span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-800">{c.categoria_patente || "–"}</span></td>
                    <td className="px-3 py-1.5 text-slate-600">{fmtData(c.data_iscrizione)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Scheda riepilogativa */}
      {selected && (
        <div className="space-y-3">
          {storiaBusy && <p className="text-sm text-slate-500">Caricamento scheda…</p>}
          {storiaErr && <p className="text-sm text-red-600">❌ {storiaErr}</p>}

          {storia && (
            <>
              {/* Header candidato */}
              <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <span><b>Candidato:</b> {selected.cognome} {selected.nome}</span>
                  <span><b>C.F.:</b> {selected.codice_fiscale || "–"}</span>
                  <span><b>Categoria:</b> {selected.categoria_patente || "–"}</span>
                  <span><b>Iscrizione:</b> {fmtData(selected.data_iscrizione)}</span>
                  <span><b>Tipo:</b> {selected.stato_richiesta || "–"}</span>
                  <span><b>Foglio Rosa:</b> {fmtData(selected.ppg_data_scadenza)}</span>
                </div>
              </div>

              {/* KPI finanziari */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Totale Incassato", value: fmtEur(totIncassato), color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
                  { label: "N. Pagamenti", value: totPagamenti, color: "text-indigo-700", bg: "bg-indigo-50 border-indigo-200" },
                  { label: "N. Esami", value: totEsami, color: "text-violet-700", bg: "bg-violet-50 border-violet-200" },
                  { label: "Esiti Idonei", value: idonei, color: "text-blue-700", bg: "bg-blue-50 border-blue-200" },
                ].map((k) => (
                  <div key={k.label} className={`rounded-xl border p-3 ${k.bg}`}>
                    <p className="text-xs font-semibold text-slate-500 uppercase">{k.label}</p>
                    <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                  </div>
                ))}
              </div>

              {/* Per tipo pagamento */}
              {Object.keys(perTipo).length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h4 className="font-semibold text-slate-700 mb-2 text-sm">Riepilogo per tipo pagamento</h4>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(perTipo).map(([tipo, tot]) => (
                      <div key={tipo} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
                        <span className="text-xs font-semibold text-indigo-600 uppercase mr-2">{tipo}</span>
                        <span className="text-sm font-bold text-emerald-700">{fmtEur(tot)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Lista pagamenti */}
              {pagamenti.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="bg-slate-50 border-b border-slate-200 px-4 py-2">
                    <span className="text-sm font-semibold text-slate-700">💰 Pagamenti ({pagamenti.length})</span>
                  </div>
                  <div className="overflow-auto max-h-48">
                    <table className="min-w-full text-xs">
                      <thead className="sticky top-0 bg-slate-100">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Data</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Tipo</th>
                          <th className="px-2 py-1.5 text-right font-semibold text-slate-700">Importo</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Causale</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagamenti.map((p) => (
                          <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-2 py-1 text-slate-700">{fmtData(p.data_pagamento)}</td>
                            <td className="px-2 py-1"><span className="rounded bg-indigo-100 px-1 py-0.5 text-[10px] font-medium text-indigo-700">{p.tipo || "–"}</span></td>
                            <td className="px-2 py-1 text-right font-bold text-emerald-700">{fmtEur(p.importo)}</td>
                            <td className="px-2 py-1 text-slate-500 max-w-[200px] truncate">{p.causale || "–"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Lista esami */}
              {prenotazioni.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="bg-slate-50 border-b border-slate-200 px-4 py-2">
                    <span className="text-sm font-semibold text-slate-700">📅 Esami ({prenotazioni.length})</span>
                  </div>
                  <div className="overflow-auto max-h-40">
                    <table className="min-w-full text-xs">
                      <thead className="sticky top-0 bg-slate-100">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Data</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Tipo</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Sede</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Esito</th>
                        </tr>
                      </thead>
                      <tbody>
                        {prenotazioni.map((p) => (
                          <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-2 py-1 text-slate-700">{fmtData(p.data_esame)}</td>
                            <td className="px-2 py-1 text-slate-600">{p.tipo_esame || "–"}</td>
                            <td className="px-2 py-1 text-slate-500">{p.sede_esame || "–"}</td>
                            <td className="px-2 py-1">
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                String(p.esito || "").toLowerCase().includes("idon") ? "bg-emerald-100 text-emerald-700"
                                : String(p.esito || "").toLowerCase().includes("non") ? "bg-red-100 text-red-700"
                                : "bg-slate-100 text-slate-600"
                              }`}>{p.esito || "–"}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function StatistichePageWrapper() { return <Suspense fallback={null}><StatistichePage /></Suspense>; }

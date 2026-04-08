"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getApiBase, authHeaders, checkSession, logoutSession } from "../lib/authClient";
import ModernAppShell from "./ModernAppShell";

function getBase() {
  if (typeof window === "undefined") return "http://localhost:3000";
  const saved = localStorage.getItem("autoscuola_api_base");
  if (saved) return saved.trim();
  const host = window.location.hostname;
  return `${window.location.protocol}//${host}:3000`;
}

function formatDataIT(dateStr) {
  if (!dateStr) return "–";
  const s = String(dateStr).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return dateStr;
  return new Date(s + "T00:00:00Z").toLocaleDateString("it-IT");
}

function diffGiorni(dateStr) {
  if (!dateStr) return null;
  const d = new Date(String(dateStr).slice(0, 10) + "T00:00:00Z");
  return Math.round((d - new Date()) / 86400000);
}

function scadenzaColor(giorni) {
  if (giorni == null) return "text-slate-500";
  if (giorni < 0) return "text-red-600 font-bold";
  if (giorni <= 14) return "text-red-600 font-semibold";
  if (giorni <= 30) return "text-amber-600 font-semibold";
  return "text-slate-600";
}

// ---------------------------------------------------------------------------
// Dashboard Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // KPI
  const [kpi, setKpi] = useState({
    candidati: null,
    esamiPrenotati: null,
    inAttesa: null,
    radarAttivo: null,
    seduteDisponibili: null,
    postiLiberi: null,
    incassoOggi: null,
    guideOggi: null,
  });

  // Scadenze (dettEvidenza)
  const [scadenze, setScadenze] = useState([]);
  const [scadenzeBusy, setScadenzeBusy] = useState(false);

  // Pagamenti oggi
  const [pagamentiOggi, setPagamentiOggi] = useState([]);

  const fetchData = useCallback(async () => {
    const base = getBase();
    const headers = authHeaders();

    try {
      const [candRes, waitRes, prenRes, radarRes, pagRes] = await Promise.all([
        fetch(`${base}/api/candidates`, { headers }),
        fetch(`${base}/api/waitlist`, { headers }),
        fetch(`${base}/api/prenotazioni`, { headers }),
        fetch(`${base}/api/radar/dashboard`, { headers }),
        fetch(`${base}/api/pagamenti`, { headers }),
      ]);

      const out = {};

      if (candRes.ok) {
        const d = await candRes.json();
        out.candidati = Array.isArray(d) ? d.length : 0;
      }
      if (waitRes.ok) {
        const d = await waitRes.json();
        out.inAttesa = Array.isArray(d) ? d.filter((w) => w.status === "pending").length : 0;
      }
      if (prenRes.ok) {
        const d = await prenRes.json();
        out.esamiPrenotati = Array.isArray(d) ? d.length : 0;
      }
      if (radarRes.ok) {
        const d = await radarRes.json();
        out.radarAttivo = d.radarAttivo === true;
        out.seduteDisponibili = d.seduteDisponibili ?? null;
        out.postiLiberi = d.totalePostiLiberi ?? null;
      }
      if (pagRes.ok) {
        const d = await pagRes.json();
        const today = new Date().toISOString().slice(0, 10);
        const righeOggi = (Array.isArray(d) ? d : []).filter(
          (r) => (r.data_pagamento || r.created_at || "").slice(0, 10) === today
        );
        setPagamentiOggi(righeOggi);
        out.incassoOggi = righeOggi.reduce((s, r) => s + (parseFloat(r.importo) || 0), 0);
      }

      setKpi((prev) => ({ ...prev, ...out }));
    } catch {
      // silenzioso
    }
  }, []);

  const fetchScadenze = useCallback(async () => {
    setScadenzeBusy(true);
    try {
      const base = getBase();
      const res = await fetch(`${base}/api/candidati-api/scadenze?giorni=30`, {
        headers: authHeaders(),
      });
      if (res.ok) {
        const d = await res.json();
        setScadenze(Array.isArray(d) ? d.slice(0, 8) : []);
      }
    } catch { /* non critico */ }
    finally { setScadenzeBusy(false); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      const session = await checkSession();
      if (!session.ok) {
        if (!cancelled) router.replace("/login");
        return;
      }
      if (!cancelled) {
        setUser(session.autoscuola || null);
        setLoading(false);
        fetchData();
        fetchScadenze();
      }
    }
    init();
    return () => { cancelled = true; };
  }, [router, fetchData, fetchScadenze]);

  async function onLogout() {
    await logoutSession();
    router.replace("/login");
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <p className="text-slate-600">Caricamento...</p>
      </div>
    );
  }

  const today = new Date().toLocaleDateString("it-IT", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const kpiCards = [
    { title: "Candidati attivi", value: kpi.candidati ?? "–", href: "/candidati", color: "text-indigo-700", bg: "bg-indigo-50 border-indigo-200" },
    { title: "Esami prenotati", value: kpi.esamiPrenotati ?? "–", href: "/esami", color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
    { title: "Lista attesa", value: kpi.inAttesa ?? "–", href: "/lista-attesa", color: "text-amber-700", bg: "bg-amber-50 border-amber-200" },
    { title: "Incasso oggi", value: kpi.incassoOggi != null ? kpi.incassoOggi.toLocaleString("it-IT", { style: "currency", currency: "EUR" }) : "–", href: "/pagamenti", color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
    { title: "Sedute disponibili", value: kpi.seduteDisponibili ?? "–", href: "/radar", color: "text-sky-700", bg: "bg-sky-50 border-sky-200" },
    { title: "Posti liberi", value: kpi.postiLiberi ?? "–", href: "/radar", color: "text-violet-700", bg: "bg-violet-50 border-violet-200" },
  ];

  const accessiRapidi = [
    { label: "👤 Candidati", href: "/candidati" },
    { label: "📋 Pratiche", href: "/pratiche" },
    { label: "🎓 Esami", href: "/esami" },
    { label: "⏳ Lista Attesa", href: "/lista-attesa" },
    { label: "📡 Radar", href: "/radar" },
    { label: "🚗 Guide", href: "/guide" },
    { label: "📚 Corsi", href: "/corsi" },
    { label: "💳 Pagamenti", href: "/pagamenti" },
    { label: "📄 Documenti", href: "/documenti" },
    { label: "📊 Statistiche", href: "/statistiche" },
    { label: "🛠 Strumenti", href: "/strumenti-utili" },
    { label: "⚙️ Impostazioni", href: "/impostazioni" },
  ];

  return (
    <ModernAppShell
      title="Dashboard"
      subtitle={`Benvenuto, ${user?.nome || "Autoscuola"}`}
      activeKey="dashboard"
      onLogout={onLogout}
      user={user}
    >
      {/* Header */}
      <div className="mb-5">
        <h2 className="text-2xl font-black text-slate-900">Dashboard</h2>
        <p className="mt-0.5 text-xs text-slate-500 capitalize">{today}</p>
      </div>

      {/* KPI grid */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {kpiCards.map((card) => (
          <Link
            key={card.title}
            href={card.href}
            className={`rounded-xl border p-4 shadow-sm transition hover:shadow-md ${card.bg}`}
          >
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{card.title}</p>
            <p className={`mt-1.5 text-2xl font-bold tabular-nums ${card.color}`}>{card.value}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">

        {/* Scadenze imminenti (dettEvidenza) */}
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-amber-900">⏰ Scadenze imminenti — 30 giorni</h3>
            <Link href="/strumenti-utili" className="text-xs text-amber-700 hover:underline">Vedi tutte →</Link>
          </div>
          {scadenzeBusy ? (
            <p className="text-xs text-amber-600">Caricamento...</p>
          ) : scadenze.length === 0 ? (
            <p className="text-xs text-amber-600 italic">Nessuna scadenza nei prossimi 30 giorni.</p>
          ) : (
            <div className="space-y-1.5">
              {scadenze.map((c) => {
                const scadData = c.foglio_rosa_scadenza || c.ppg_data_scadenza || "";
                const giorni = diffGiorni(scadData);
                return (
                  <div key={c.id} className="flex items-center justify-between rounded-lg bg-white border border-amber-100 px-3 py-1.5">
                    <div>
                      <span className="text-sm font-medium text-slate-800">{c.cognome} {c.nome}</span>
                      <span className="ml-2 text-xs text-slate-500">{c.categoria_patente}</span>
                    </div>
                    <div className="text-right">
                      <p className={`text-xs ${scadenzaColor(giorni)}`}>
                        {scadData ? formatDataIT(scadData) : "–"}
                      </p>
                      {giorni != null && (
                        <p className={`text-[10px] ${scadenzaColor(giorni)}`}>
                          {giorni < 0 ? `scad. ${Math.abs(giorni)}gg fa` : `tra ${giorni}gg`}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Incasso odierno */}
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-emerald-900">💳 Incasso di oggi</h3>
            <Link href="/pagamenti" className="text-xs text-emerald-700 hover:underline">Resoconto completo →</Link>
          </div>
          {pagamentiOggi.length === 0 ? (
            <p className="text-xs text-emerald-700 italic">Nessun pagamento registrato oggi.</p>
          ) : (
            <>
              <div className="mb-2 text-2xl font-bold text-emerald-800 tabular-nums">
                {(kpi.incassoOggi || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" })}
              </div>
              <div className="space-y-1 max-h-40 overflow-auto">
                {pagamentiOggi.slice(0, 6).map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg bg-white border border-emerald-100 px-3 py-1">
                    <div className="text-xs text-slate-700">
                      <span className="font-medium">{p.causale || "–"}</span>
                      <span className="ml-2 text-slate-400">{p.tipo}</span>
                    </div>
                    <span className={`text-xs font-semibold tabular-nums ${parseFloat(p.importo) < 0 ? "text-red-600" : "text-emerald-700"}`}>
                      {parseFloat(p.importo || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" })}
                    </span>
                  </div>
                ))}
                {pagamentiOggi.length > 6 && (
                  <p className="text-xs text-slate-400 text-center">+{pagamentiOggi.length - 6} altri</p>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {/* Accessi rapidi */}
      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-bold text-slate-800">🚀 Accessi rapidi</h3>
        <div className="flex flex-wrap gap-2">
          {accessiRapidi.map(({ label, href }) => (
            <Link
              key={href}
              href={href}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition"
            >
              {label}
            </Link>
          ))}
        </div>
      </section>
    </ModernAppShell>
  );
}

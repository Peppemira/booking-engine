"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { API_BASE, authHeaders, checkSession, logoutSession } from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";

function formatData(value) {
  if (!value) return "–";
  const d = typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10) : value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d))
    return new Date(d + "Z").toLocaleDateString("it-IT");
  return String(value).slice(0, 12) || "–";
}

export default function EsamiPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState([]);
  const [fetchError, setFetchError] = useState("");
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ search: "", categoria: "TUTTE" });
  const [portalStatus, setPortalStatus] = useState("");
  const [portalError, setPortalError] = useState("");
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalResult, setPortalResult] = useState(null);

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

  const loadCandidates = useCallback(async () => {
    setFetchError("");
    try {
      const res = await fetch(`${API_BASE}/api/candidati-api`, {
        headers: authHeaders(), cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCandidates(Array.isArray(data) ? data : []);
    } catch (e) {
      setFetchError(e.message || "Errore caricamento candidati");
    }
  }, []);

  useEffect(() => { if (!loading) loadCandidates(); }, [loading, loadCandidates]);

  const CATEGORIE = ["TUTTE", "A1", "A2", "A", "B", "BE", "C", "CE", "D", "DE", "CQC"];

  const filtered = useMemo(() => {
    const search = filters.search.trim().toUpperCase();
    return candidates.filter((r) => {
      if (search) {
        const hay = [r.cognome, r.nome, r.codice_fiscale, r.patente_numero].join(" ").toUpperCase();
        if (!hay.includes(search)) return false;
      }
      if (filters.categoria !== "TUTTE" && r.categoria_patente !== filters.categoria) return false;
      return true;
    });
  }, [candidates, filters]);

  async function cercaRichiesteEsame() {
    if (!selected) { setPortalError("Seleziona un candidato"); return; }
    setPortalBusy(true);
    setPortalResult(null);
    setPortalStatus("");
    setPortalError("");
    try {
      const res = await fetch(`${API_BASE}/api/portal/cerca-richieste-esame`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          id_aut_ag: user?.codice_autoscuola || "",
          marca_operativa: selected?.raw_portale?.anagrafica?.portal_marca_operativa || "",
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Errore portale");
      setPortalResult(data);
      setPortalStatus(`${data.righe?.length || 0} richieste trovate sul portale`);
    } catch (e) {
      setPortalError(e.message);
    } finally {
      setPortalBusy(false);
    }
  }

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <p className="text-slate-600">Caricamento...</p>
    </div>
  );

  return (
    <ModernAppShell
      title="Esami"
      subtitle="Candidati per l'esame — ricerca sedute, richieste esame portale"
      activeKey="esami"
      onLogout={() => logoutSession().then(() => router.replace("/login"))}
      user={user}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Candidati Esame</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Seleziona un candidato per verificare le richieste esame sul portale.
            </p>
          </div>
          <Link href="/prenotazioni" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
            Sedute &amp; Prenotazioni →
          </Link>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="Cerca cognome, nome, CF…"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            className="h-9 w-52 rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-indigo-400 focus:outline-none"
          />
          <select
            value={filters.categoria}
            onChange={(e) => setFilters((f) => ({ ...f, categoria: e.target.value }))}
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm"
          >
            {CATEGORIE.map((c) => <option key={c}>{c}</option>)}
          </select>
          <button onClick={loadCandidates} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
            Aggiorna
          </button>
          <span className="ml-auto flex items-center text-sm text-slate-500">{filtered.length} candidati</span>
        </div>

        {fetchError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{fetchError}</div>
        )}

        <div className="flex gap-4">
          <div className={`flex-1 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm ${selected ? "max-h-[55vh]" : "max-h-[65vh]"}`}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Cognome / Nome</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Cat.</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">C.F.</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Data nasc.</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={4} className="py-12 text-center text-slate-400">Nessun candidato trovato</td></tr>
                ) : filtered.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => { setSelected(selected?.id === r.id ? null : r); setPortalResult(null); setPortalStatus(""); setPortalError(""); }}
                    className={`cursor-pointer border-b border-slate-100 transition-colors last:border-0 ${selected?.id === r.id ? "bg-indigo-50" : "hover:bg-slate-50"}`}
                  >
                    <td className="px-3 py-2"><div className="font-medium text-slate-800">{r.cognome} {r.nome}</div></td>
                    <td className="px-3 py-2 text-slate-700">{r.categoria_patente || "–"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">{r.codice_fiscale || "–"}</td>
                    <td className="px-3 py-2 text-slate-600">{formatData(r.data_nascita)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected && (
            <div className="w-80 shrink-0 overflow-y-auto rounded-xl border border-indigo-200 bg-white shadow-sm">
              <div className="border-b border-indigo-100 bg-indigo-50 p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-slate-800">{selected.cognome} {selected.nome}</p>
                    <p className="text-xs text-slate-500">{selected.codice_fiscale} · cat. {selected.categoria_patente}</p>
                  </div>
                  <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-600">✕</button>
                </div>
              </div>
              <div className="p-3 space-y-3">
                <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-violet-700">Azioni Portale</p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      disabled={portalBusy}
                      onClick={cercaRichiesteEsame}
                      className="rounded bg-violet-600 px-2 py-1 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                    >
                      {portalBusy ? "..." : "🔍 Cerca Richieste Esame"}
                    </button>
                    <Link href="/richieste-esame" className="rounded border border-violet-300 bg-white px-2 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50">
                      📋 Richieste Esame →
                    </Link>
                    <Link href={`/pratiche`} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                      Apri Pratica →
                    </Link>
                  </div>
                  {portalStatus && <p className="mt-2 text-xs text-emerald-700">✅ {portalStatus}</p>}
                  {portalError && <p className="mt-2 text-xs text-red-700">❌ {portalError}</p>}
                </div>

                {portalResult?.righe?.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-semibold text-slate-600 uppercase">Richieste esame trovate</p>
                    <div className="space-y-1">
                      {portalResult.righe.map((r, i) => (
                        <div key={i} className="rounded bg-slate-50 p-2 text-xs">
                          <div className="font-mono font-semibold text-slate-700">{r.marcaOperativa || "–"}</div>
                          <div className="text-slate-600">{r.cognome} {r.nome} — {r.tipoEsame || r.tipoRichiesta || "–"}</div>
                          {r.stato && <div className="text-slate-500">{r.stato}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <p className="mb-1 text-xs font-semibold uppercase text-slate-400">Dati candidato</p>
                  <dl className="space-y-1 text-xs">
                    {[
                      ["Data nascita", formatData(selected.data_nascita)],
                      ["Comune nascita", selected.raw_portale?.anagrafica?.comune_nascita],
                      ["Telefono", selected.telefono || selected.raw_portale?.anagrafica?.telefono_1],
                      ["Email", selected.email || selected.raw_portale?.anagrafica?.email_contatto],
                      ["Patente n°", selected.patente_numero || selected.raw_portale?.anagrafica?.numero_patente_posseduta],
                      ["Marca operativa", selected.raw_portale?.anagrafica?.portal_marca_operativa],
                    ].filter(([, v]) => v).map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <dt className="w-24 shrink-0 text-slate-500">{k}</dt>
                        <dd className="text-slate-800">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="font-semibold mb-1">Flusso esame (equivalente GeCA):</p>
          <p>1. Seleziona candidato → 2. Cerca Richieste Esame sul portale → 3. Vai a <Link href="/prenotazioni" className="underline">Sedute &amp; Prenotazioni</Link> per prenotare → 4. Gestisci in <Link href="/richieste-esame" className="underline">Richieste Esame</Link> per pagamenti.</p>
        </div>
      </div>
    </ModernAppShell>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, authHeaders, checkSession, logoutSession } from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";

async function callPortale(endpoint, body, authHdrs) {
  const res = await fetch(`${API_BASE}/api/portal/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHdrs },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || "Errore portale");
  return data;
}

// ---------------------------------------------------------------------------
// Sezione Candidati con Foglio Rosa (ristampa one-click)
// ---------------------------------------------------------------------------
function SezioneCandidatiFoglioRosa({ authHdrs }) {
  const [candidati, setCandidati] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [busyId, setBusyId]   = useState(null);
  const [results, setResults] = useState({}); // id -> { ok, msg }
  const [search, setSearch]   = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr("");
    try {
      const res = await fetch(`${API_BASE}/api/candidati-api/foglio-rosa`, { headers: authHdrs });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
      setCandidati(json.data || []);
    } catch (e) {
      setLoadErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [authHdrs]);

  useEffect(() => { load(); }, [load]);

  async function ristampa(cand) {
    setBusyId(cand.id);
    setResults((r) => ({ ...r, [cand.id]: null }));
    try {
      const data = await callPortale("foglio-rosa", { token: cand.codice_foglio_rosa, ristampa: true }, authHdrs);
      setResults((r) => ({ ...r, [cand.id]: { ok: true, msg: data.messaggio || "Ristampa avviata" } }));
    } catch (e) {
      setResults((r) => ({ ...r, [cand.id]: { ok: false, msg: e.message } }));
    } finally {
      setBusyId(null);
    }
  }

  const filtered = candidati.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      c.cognome?.toLowerCase().includes(q) ||
      c.nome?.toLowerCase().includes(q) ||
      c.codice_fiscale?.toLowerCase().includes(q) ||
      c.codice_foglio_rosa?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="rounded-xl border border-violet-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-violet-100 bg-violet-50">
        <h3 className="text-sm font-bold text-slate-800">🔄 Ristampa Foglio Rosa — per Candidato</h3>
        <button
          onClick={load}
          disabled={loading}
          className="text-xs text-violet-600 hover:text-violet-800 disabled:opacity-50"
        >
          {loading ? "Caricamento…" : "↻ Aggiorna"}
        </button>
      </div>

      {loadErr && (
        <p className="m-3 rounded bg-red-50 p-2 text-xs text-red-700">❌ {loadErr}</p>
      )}

      {!loading && candidati.length === 0 && !loadErr && (
        <p className="m-4 text-xs text-slate-500">Nessun candidato con codice foglio rosa salvato in anagrafica.</p>
      )}

      {candidati.length > 0 && (
        <>
          <div className="px-3 py-2 border-b border-slate-100">
            <input
              className="w-full rounded border border-slate-300 px-3 py-1.5 text-xs"
              placeholder="Cerca per cognome, nome, CF o token…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Candidato</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Codice Fiscale</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Token Foglio Rosa</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Categoria</th>
                  <th className="px-3 py-2 text-center font-semibold text-slate-600">Azione</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {c.cognome} {c.nome}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-600">{c.codice_fiscale || "–"}</td>
                    <td className="px-3 py-2 font-mono text-violet-700">{c.codice_foglio_rosa}</td>
                    <td className="px-3 py-2 text-slate-600">{c.categoria_patente || "–"}</td>
                    <td className="px-3 py-2 text-center">
                      {results[c.id] ? (
                        <span className={`text-xs font-medium ${results[c.id].ok ? "text-emerald-600" : "text-red-600"}`}>
                          {results[c.id].ok ? "✅" : "❌"} {results[c.id].msg}
                        </span>
                      ) : (
                        <button
                          disabled={busyId === c.id}
                          onClick={() => ristampa(c)}
                          className="rounded-lg bg-violet-600 px-3 py-1 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                        >
                          {busyId === c.id ? "…" : "🔄 Ristampa"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-slate-400">Nessun risultato per "{search}"</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="px-3 py-2 text-xs text-slate-400 border-t border-slate-100">
            {candidati.length} candidati con foglio rosa in anagrafica
          </p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sezione Foglio Rosa (manuale — stampa / ristampa con token libero)
// ---------------------------------------------------------------------------
function SezioneRosa({ authHdrs }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function esegui(ristampa) {
    setBusy(ristampa ? "ristampa" : "stampa");
    setResult(null);
    setError("");
    try {
      const data = await callPortale("foglio-rosa", { token, ristampa }, authHdrs);
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="rounded-xl border border-violet-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-bold text-slate-800">
        🖨 Foglio Rosa — Stampa / Ristampa Manuale
      </h3>
      <p className="mb-3 text-xs text-slate-500">
        Replica GeCA: <em>STAMPAFRPATA()</em> — token opzionale (se già noto dalla pratica)
      </p>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm font-mono"
          placeholder="Token foglio rosa (opzionale)"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          disabled={!!busy}
          onClick={() => esegui(false)}
          className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {busy === "stampa" ? "..." : "🖨 Stampa Foglio Rosa"}
        </button>
        <button
          disabled={!!busy}
          onClick={() => esegui(true)}
          className="rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50"
        >
          {busy === "ristampa" ? "..." : "🔄 Ristampa Foglio Rosa"}
        </button>
      </div>
      {result && (
        <div className="mt-3 rounded bg-emerald-50 p-2 text-xs text-emerald-800">
          ✅ {result.messaggio || "Operazione completata"}
          {result.token && <span className="ml-2 font-mono text-slate-500">Token: {result.token}</span>}
        </div>
      )}
      {error && <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">❌ {error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sezione Cerca Candidato per Patente
// ---------------------------------------------------------------------------
function SezionePatente({ authHdrs }) {
  const [form, setForm] = useState({ cognome: "", numero_patente: "" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function cerca() {
    if (!form.cognome || !form.numero_patente) {
      setError("Cognome e numero patente obbligatori");
      return;
    }
    setBusy(true);
    setResult(null);
    setError("");
    try {
      const data = await callPortale("cerca-candidato-patente", form, authHdrs);
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-bold text-slate-800">
        🔍 Cerca Candidato per Patente
      </h3>
      <p className="mb-3 text-xs text-slate-500">
        Replica GeCA: <em>recupera() rad1</em> — ricerca per cognome + numero patente
      </p>
      <div className="grid grid-cols-2 gap-2">
        <input
          className="rounded border border-slate-300 px-3 py-2 text-sm uppercase"
          placeholder="Cognome *"
          value={form.cognome}
          onChange={(e) => setForm((p) => ({ ...p, cognome: e.target.value.toUpperCase() }))}
          onKeyDown={(e) => e.key === "Enter" && cerca()}
        />
        <input
          className="rounded border border-slate-300 px-3 py-2 text-sm font-mono uppercase"
          placeholder="Numero patente *"
          value={form.numero_patente}
          onChange={(e) => setForm((p) => ({ ...p, numero_patente: e.target.value.toUpperCase() }))}
          onKeyDown={(e) => e.key === "Enter" && cerca()}
        />
      </div>
      <button
        disabled={busy}
        onClick={cerca}
        className="mt-2 w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {busy ? "Ricerca in corso..." : "Cerca sul portale"}
      </button>
      {result && (
        <div className="mt-3 rounded bg-emerald-50 p-3 text-xs">
          <p className="font-semibold text-emerald-800 mb-2">
            {result.trovato ? "✅ Candidato trovato" : "⚠️ Nessun risultato"}
          </p>
          {result.messaggio && <p className="text-amber-700 mb-1">{result.messaggio}</p>}
          {result.dati && Object.keys(result.dati).length > 0 && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              {Object.entries(result.dati).map(([k, v]) => v ? (
                <div key={k} className="contents">
                  <dt className="font-semibold text-slate-600 capitalize">{k.replace(/([A-Z])/g, ' $1')}</dt>
                  <dd className="text-slate-800">{v}</dd>
                </div>
              ) : null)}
            </dl>
          )}
        </div>
      )}
      {error && <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">❌ {error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sezione Cerca per Marca Operativa
// ---------------------------------------------------------------------------
function SezioneMarca({ authHdrs }) {
  const [marca, setMarca] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function cerca() {
    if (!marca.trim()) { setError("Marca operativa obbligatoria"); return; }
    setBusy(true);
    setResult(null);
    setError("");
    try {
      const data = await callPortale("cerca-per-marca", { marca_operativa: marca }, authHdrs);
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-emerald-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-bold text-slate-800">
        🏷 Cerca Pratica per Marca Operativa
      </h3>
      <p className="mb-3 text-xs text-slate-500">
        Replica GeCA: <em>recuperadamarca()</em> — cerca pratica tramite codice marca operativa
      </p>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm font-mono uppercase"
          placeholder="Marca operativa *"
          value={marca}
          onChange={(e) => setMarca(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && cerca()}
        />
        <button
          disabled={busy}
          onClick={cerca}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? "..." : "Cerca"}
        </button>
      </div>
      {result && (
        <div className="mt-3 rounded bg-emerald-50 p-3 text-xs">
          <p className="font-semibold text-emerald-800 mb-2">
            {result.trovato ? `✅ ${result.righe?.length || 0} risultati` : "⚠️ Nessun risultato"}
          </p>
          {result.righe?.length > 0 && (
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-100">
                  <th className="px-2 py-1 text-left">Marca</th>
                  <th className="px-2 py-1 text-left">Cognome</th>
                  <th className="px-2 py-1 text-left">Nome</th>
                  <th className="px-2 py-1 text-left">Tipo</th>
                  <th className="px-2 py-1 text-left">Stato</th>
                </tr>
              </thead>
              <tbody>
                {result.righe.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-1 font-mono">{r.marcaOperativa || "–"}</td>
                    <td className="px-2 py-1">{r.cognome || "–"}</td>
                    <td className="px-2 py-1">{r.nome || "–"}</td>
                    <td className="px-2 py-1">{r.tipoRichiesta || "–"}</td>
                    <td className="px-2 py-1">{r.stato || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {error && <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">❌ {error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sezione Verifica Rinnovo
// ---------------------------------------------------------------------------
function SezioneRinnovo({ authHdrs }) {
  const [form, setForm] = useState({ numero_patente: "", codice_motivo: "R" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function verifica() {
    if (!form.numero_patente.trim()) { setError("Numero patente obbligatorio"); return; }
    setBusy(true);
    setResult(null);
    setError("");
    try {
      const data = await callPortale("rinnovo-patente", form, authHdrs);
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-bold text-slate-800">
        🔄 Verifica Rinnovabilità Patente
      </h3>
      <p className="mb-3 text-xs text-slate-500">
        Replica GeCA: <em>verrinnovab()</em> — verifica se una patente è rinnovabile
      </p>
      <div className="grid grid-cols-3 gap-2">
        <input
          className="col-span-2 rounded border border-slate-300 px-3 py-2 text-sm font-mono uppercase"
          placeholder="Numero patente *"
          value={form.numero_patente}
          onChange={(e) => setForm((p) => ({ ...p, numero_patente: e.target.value.toUpperCase() }))}
          onKeyDown={(e) => e.key === "Enter" && verifica()}
        />
        <select
          className="rounded border border-slate-300 px-2 py-2 text-sm"
          value={form.codice_motivo}
          onChange={(e) => setForm((p) => ({ ...p, codice_motivo: e.target.value }))}
        >
          <option value="R">R – Rinnovo</option>
          <option value="D">D – Duplicato</option>
          <option value="C">C – Conversione</option>
        </select>
      </div>
      <button
        disabled={busy}
        onClick={verifica}
        className="mt-2 w-full rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
      >
        {busy ? "Verifica in corso..." : "Verifica sul portale"}
      </button>
      {result && (
        <div className="mt-3 rounded bg-emerald-50 p-2 text-xs text-emerald-800">
          ✅ {result.messaggio || "Operazione completata"}
        </div>
      )}
      {error && <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">❌ {error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagina principale
// ---------------------------------------------------------------------------
export default function FogliRosaPatentiPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const hdrs = authHeaders();

  useEffect(() => {
    let cancelled = false;
    async function init() {
      const session = await checkSession();
      if (!session.ok) { if (!cancelled) router.replace("/login"); return; }
      if (!cancelled) { setUser(session.autoscuola); setReady(true); }
    }
    init();
    return () => { cancelled = true; };
  }, [router]);

  if (!ready) return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <p className="text-slate-600">Caricamento...</p>
    </div>
  );

  return (
    <ModernAppShell
      title="Fogli Rosa e Patenti"
      subtitle="Gestione fogli rosa, ricerca patenti, rinnovi — replica GeCA portale automobilista"
      activeKey="fogli-rosa-patenti"
      onLogout={() => logoutSession().then(() => router.replace("/login"))}
      user={user}
    >
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Fogli Rosa e Patenti</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Servizi portale: stampa foglio rosa, ricerca candidato, verifica rinnovo.
            Disponibile <strong>08:00–21:00</strong> — giorni feriali.
          </p>
        </div>

        {/* Ristampa one-click per candidato */}
        <SezioneCandidatiFoglioRosa authHdrs={hdrs} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SezioneRosa authHdrs={hdrs} />
          <SezionePatente authHdrs={hdrs} />
          <SezioneMarca authHdrs={hdrs} />
          <SezioneRinnovo authHdrs={hdrs} />
        </div>
      </div>
    </ModernAppShell>
  );
}

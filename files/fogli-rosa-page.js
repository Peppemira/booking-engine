"use client";

import { useEffect, useState } from "react";
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
// Sezione Foglio Rosa
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
        🖨 Foglio Rosa — Stampa / Ristampa
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

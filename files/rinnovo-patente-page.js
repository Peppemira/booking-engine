"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, authHeaders, checkSession, logoutSession } from "../../../lib/authClient";
import ModernAppShell from "../../ModernAppShell";

const CODICI_MOTIVO = [
  { value: "R", label: "R – Rinnovo" },
  { value: "D", label: "D – Duplicato" },
  { value: "C", label: "C – Conversione" },
];

export default function RinnovoPatentePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [form, setForm] = useState({ numero_patente: "", codice_motivo: "R" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

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

  async function onVerifica() {
    if (!form.numero_patente.trim()) { setError("Inserisci il numero patente"); return; }
    setBusy(true);
    setResult(null);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/portal/rinnovo-patente`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Errore verifica");
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <p className="text-sm text-slate-600">Verifica sessione...</p>
    </div>
  );

  return (
    <ModernAppShell
      title="Verifica Rinnovabilità"
      subtitle="Verifica rinnovabilità patente sul Portale dell'Automobilista"
      activeKey="servizi-online"
      onLogout={() => logoutSession().then(() => router.replace("/login"))}
      user={user}
    >
      <div className="mx-auto max-w-xl space-y-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Verifica Rinnovabilità Patente</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Equivalente GeCA: <em>verrinnovab()</em> — controlla la rinnovabilità di una patente sul portale.
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <div>
            <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
              Numero Patente <span className="text-red-500">*</span>
            </label>
            <input
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm font-mono uppercase"
              placeholder="es. AB1234567C"
              value={form.numero_patente}
              onChange={(e) => setForm((p) => ({ ...p, numero_patente: e.target.value.toUpperCase() }))}
              onKeyDown={(e) => e.key === "Enter" && onVerifica()}
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
              Codice Motivo
            </label>
            <select
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              value={form.codice_motivo}
              onChange={(e) => setForm((p) => ({ ...p, codice_motivo: e.target.value }))}
            >
              {CODICI_MOTIVO.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={onVerifica}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? "Verifica in corso..." : "Verifica sul portale"}
          </button>

          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
        </div>

        {result && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
            <h3 className="mb-2 text-sm font-bold text-emerald-800">Risultato verifica</h3>
            {result.messaggio && (
              <p className="text-sm text-emerald-700 mb-2">{result.messaggio}</p>
            )}
            <p className="text-xs text-slate-500">
              Stato: <strong>{result.successo ? "Operazione completata" : "Attenzione"}</strong>
            </p>
          </div>
        )}

        <div className="text-xs text-slate-400 text-center">
          Richiede connessione al Portale dell&apos;Automobilista (disponibile 08:00–21:00)
        </div>
      </div>
    </ModernAppShell>
  );
}

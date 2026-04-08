"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, authHeaders, checkSession, logoutSession } from "../../../lib/authClient";
import ModernAppShell from "../../ModernAppShell";

export default function VerificaCQCPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [form, setForm] = useState({ codice_fiscale: "", patente_italiana: "" });
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
    if (!form.codice_fiscale.trim()) { setError("Inserisci il codice fiscale"); return; }
    setBusy(true);
    setResult(null);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/portal/cerca-cqc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Errore verifica CQC");
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
      title="Verifica CQC"
      subtitle="Verifica patente CQC per codice fiscale"
      activeKey="servizi-online"
      onLogout={() => logoutSession().then(() => router.replace("/login"))}
      user={user}
    >
      <div className="mx-auto max-w-xl space-y-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Verifica / Trova Patente CQC</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Equivalente GeCA: <em>recuperadaticqcguidaAsync()</em> — recupera i dati CQC di un candidato dal codice fiscale.
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <div>
            <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
              Codice Fiscale <span className="text-red-500">*</span>
            </label>
            <input
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm font-mono uppercase"
              placeholder="es. RSSMRA80A01H501U"
              maxLength={16}
              value={form.codice_fiscale}
              onChange={(e) => setForm((p) => ({ ...p, codice_fiscale: e.target.value.toUpperCase() }))}
              onKeyDown={(e) => e.key === "Enter" && onVerifica()}
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
              Patente Italiana Posseduta
            </label>
            <input
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm font-mono uppercase"
              placeholder="es. C, CE, D (opzionale)"
              value={form.patente_italiana}
              onChange={(e) => setForm((p) => ({ ...p, patente_italiana: e.target.value.toUpperCase() }))}
            />
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={onVerifica}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? "Ricerca in corso..." : "Cerca sul portale"}
          </button>

          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
        </div>

        {result && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-bold text-emerald-800">
              {result.trovato ? "CQC trovata" : "Nessun risultato"}
            </h3>
            {result.messaggio && (
              <p className="text-sm text-amber-700 mb-2">{result.messaggio}</p>
            )}
            {result.dati && Object.keys(result.dati).length > 0 && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {result.dati.cognome && (
                  <>
                    <dt className="font-semibold text-slate-600">Cognome</dt>
                    <dd className="text-slate-900">{result.dati.cognome}</dd>
                  </>
                )}
                {result.dati.nome && (
                  <>
                    <dt className="font-semibold text-slate-600">Nome</dt>
                    <dd className="text-slate-900">{result.dati.nome}</dd>
                  </>
                )}
                {result.dati.codiceFiscale && (
                  <>
                    <dt className="font-semibold text-slate-600">Cod. Fiscale</dt>
                    <dd className="font-mono text-slate-900">{result.dati.codiceFiscale}</dd>
                  </>
                )}
                {result.dati.dataNascita && (
                  <>
                    <dt className="font-semibold text-slate-600">Data nascita</dt>
                    <dd className="text-slate-900">{result.dati.dataNascita}</dd>
                  </>
                )}
                {result.dati.categoriaPatente && (
                  <>
                    <dt className="font-semibold text-slate-600">Categoria patente</dt>
                    <dd className="text-slate-900">{result.dati.categoriaPatente}</dd>
                  </>
                )}
                {result.dati.scadenzaCQC && (
                  <>
                    <dt className="font-semibold text-slate-600">Scadenza CQC</dt>
                    <dd className="text-slate-900">{result.dati.scadenzaCQC}</dd>
                  </>
                )}
              </dl>
            )}
          </div>
        )}

        <div className="text-xs text-slate-400 text-center">
          Richiede connessione al Portale dell&apos;Automobilista (disponibile 08:00–21:00)
        </div>
      </div>
    </ModernAppShell>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, authHeaders, checkSession, logoutSession } from "../../../lib/authClient";
import ModernAppShell from "../../ModernAppShell";

export default function CambioCodiceAutoscuolaPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [form, setForm] = useState({ marca_operativa: "", nuovo_codice_autoscuola: "" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function init() {
      const session = await checkSession();
      if (!session.ok) { if (!cancelled) router.replace("/login"); return; }
      if (!cancelled) {
        setUser(session.autoscuola);
        if (session.autoscuola?.codice_autoscuola) {
          setForm((p) => ({ ...p, nuovo_codice_autoscuola: session.autoscuola.codice_autoscuola }));
        }
        setReady(true);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [router]);

  async function onCambio() {
    if (!form.marca_operativa.trim()) { setError("Inserisci la marca operativa"); return; }
    if (!form.nuovo_codice_autoscuola.trim()) { setError("Inserisci il nuovo codice autoscuola"); return; }
    setBusy(true);
    setResult(null);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/portal/cambio-codice-autoscuola`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Errore cambio codice");
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
      title="Cambio Codice Autoscuola"
      subtitle="Modifica il codice autoscuola associato a una pratica"
      activeKey="servizi-online"
      onLogout={() => logoutSession().then(() => router.replace("/login"))}
      user={user}
    >
      <div className="mx-auto max-w-xl space-y-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Cambio Codice Autoscuola</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Equivalente GeCA: <em>cambiocodice2()</em> — modifica il codice autoscuola associato a una richiesta esame.
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <div>
            <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
              Marca Operativa <span className="text-red-500">*</span>
            </label>
            <input
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm font-mono uppercase"
              placeholder="es. ME000001A"
              value={form.marca_operativa}
              onChange={(e) => setForm((p) => ({ ...p, marca_operativa: e.target.value.toUpperCase() }))}
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
              Nuovo Codice Autoscuola <span className="text-red-500">*</span>
            </label>
            <input
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm font-mono uppercase"
              placeholder="es. 0674"
              value={form.nuovo_codice_autoscuola}
              onChange={(e) => setForm((p) => ({ ...p, nuovo_codice_autoscuola: e.target.value.toUpperCase() }))}
            />
            <p className="mt-0.5 text-[10px] text-slate-400">
              Pre-compilato con il codice della tua autoscuola
            </p>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={onCambio}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? "Invio in corso..." : "Esegui cambio codice"}
          </button>

          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
        </div>

        {result && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
            <h3 className="mb-2 text-sm font-bold text-emerald-800">Risultato</h3>
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

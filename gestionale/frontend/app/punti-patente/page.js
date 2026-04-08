"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getApiBase, authHeaders, checkSession, logoutSession } from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";

function getPreferredApiBase() {
  const base = String(getApiBase?.() || "").trim() || "http://localhost:3000";
  if (typeof window !== "undefined" && (window.location?.hostname === "localhost" || window.location?.hostname === "127.0.0.1")) {
    return base.includes("localhost") ? base : `${window.location?.protocol || "http:"}//${window.location?.hostname || "localhost"}:3000`;
  }
  return base;
}

function PuntiPatenteInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [codiceFiscale, setCodiceFiscale] = useState(() => searchParams?.get("cf") || "");
  const [numeroPatente, setNumeroPatente] = useState(() => searchParams?.get("patente") || "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function init() {
      const session = await checkSession();
      if (!session.ok) {
        if (!cancelled) router.replace("/login");
        return;
      }
      if (!cancelled) {
        setUser(session.autoscuola);
        setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [router]);

  const handleSubmit = useCallback(async (e) => {
    e?.preventDefault?.();
    const cf = String(codiceFiscale || "").trim().toUpperCase();
    const npat = String(numeroPatente || "").trim();
    if (!cf || !npat) {
      setError("Inserire codice fiscale e numero patente.");
      return;
    }
    if (cf.length < 16) {
      setError("Codice fiscale non valido (16 caratteri).");
      return;
    }
    if (npat.length < 9) {
      setError("Numero patente non valido (almeno 9 caratteri).");
      return;
    }
    setError("");
    setResult(null);
    setBusy(true);
    try {
      const base = getPreferredApiBase();
      const res = await fetch(`${base}/api/portal/punti-patente`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({
          codice_fiscale: cf,
          numero_patente: npat,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Errore interrogazione punti patente");
        return;
      }
      setResult(data);
    } catch (err) {
      setError(err.message || "Errore di connessione");
    } finally {
      setBusy(false);
    }
  }, [codiceFiscale, numeroPatente]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-slate-600">Caricamento...</p>
      </div>
    );
  }

  return (
    <ModernAppShell
      title="Punti patente"
      subtitle="Consulta il saldo punti patente (Portale dell’automobilista)"
      activeKey="punti-patente"
      onLogout={() => logoutSession().then(() => router.replace("/login"))}
      user={user}
    >
      <div className="mx-auto max-w-2xl space-y-6">
        <p className="text-slate-600">
          Inserisci codice fiscale e numero patente per interrogare il saldo punti sul Portale dell’automobilista
          (come in GeCA: &quot;Visualizza Saldo Punti&quot;).
        </p>

        <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Codice fiscale</span>
              <input
                type="text"
                value={codiceFiscale}
                onChange={(e) => setCodiceFiscale(e.target.value)}
                placeholder="RSSMRA80A01H501X"
                maxLength={16}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm uppercase tracking-wider"
                disabled={busy}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Numero patente</span>
              <input
                type="text"
                value={numeroPatente}
                onChange={(e) => setNumeroPatente(e.target.value)}
                placeholder="Es. AB1234567"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                disabled={busy}
              />
            </label>
          </div>
          {error && (
            <p className="mt-3 text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
          <div className="mt-4">
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
            >
              {busy ? "Richiesta in corso…" : "Consulta saldo punti"}
            </button>
          </div>
        </form>

        {result && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h3 className="text-lg font-semibold text-slate-900">Risultato interrogazione</h3>
            {result.codice === "200" || result.esito === true ? (
              <div className="mt-4 space-y-4">
                {/* Saldo punti principale */}
                {(result.punti != null || result.puntiPatente != null) && (
                  <div className="flex items-center gap-3 rounded-xl bg-emerald-50 px-5 py-4 ring-1 ring-emerald-200">
                    <span className="text-4xl font-black text-emerald-700">
                      {result.punti ?? result.puntiPatente}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-emerald-800">punti disponibili</p>
                      {result.descrizione && <p className="text-xs text-emerald-600">{result.descrizione}</p>}
                    </div>
                  </div>
                )}

                {/* Dati patente */}
                {(result.titoloAbilitativo || result.scadenzaValidita || result.dataNascita) && (
                  <div className="grid gap-2 text-sm sm:grid-cols-2">
                    {result.titoloAbilitativo && (
                      <div className="rounded-lg bg-slate-50 px-3 py-2">
                        <span className="font-medium text-slate-500">Titolo abilitativo</span>
                        <p className="font-semibold text-slate-900">{result.titoloAbilitativo}</p>
                      </div>
                    )}
                    {result.scadenzaValidita && (
                      <div className="rounded-lg bg-slate-50 px-3 py-2">
                        <span className="font-medium text-slate-500">Scadenza validità</span>
                        <p className="font-semibold text-slate-900">{result.scadenzaValidita}</p>
                      </div>
                    )}
                    {result.dataNascita && (
                      <div className="rounded-lg bg-slate-50 px-3 py-2">
                        <span className="font-medium text-slate-500">Data di nascita</span>
                        <p className="font-semibold text-slate-900">{result.dataNascita}</p>
                      </div>
                    )}
                    {result.sesso && (
                      <div className="rounded-lg bg-slate-50 px-3 py-2">
                        <span className="font-medium text-slate-500">Sesso</span>
                        <p className="font-semibold text-slate-900">{result.sesso}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Categorie */}
                {Array.isArray(result.categorie) && result.categorie.length > 0 && (
                  <div>
                    <p className="mb-2 text-sm font-semibold text-slate-700">Categorie</p>
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="min-w-full text-sm">
                        <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                          <tr>
                            <th className="px-4 py-2 text-left">Categoria</th>
                            <th className="px-4 py-2 text-right">Punti</th>
                            <th className="px-4 py-2 text-left">Stato</th>
                            <th className="px-4 py-2 text-left">Scadenza</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {result.categorie.map((cat, i) => (
                            <tr key={i} className="hover:bg-slate-50">
                              <td className="px-4 py-2 font-bold text-slate-900">{cat.codiceCategoria || cat.categoria || "-"}</td>
                              <td className="px-4 py-2 text-right font-semibold text-emerald-700">{cat.puntiCategoria ?? cat.punti ?? "-"}</td>
                              <td className="px-4 py-2 text-slate-600">{cat.descrizioneStato || cat.stato || "-"}</td>
                              <td className="px-4 py-2 text-slate-600">{cat.dataScadenza || cat.scadenza || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Messaggio extra */}
                {result.messaggio && (
                  <p className="text-sm text-slate-600">{result.messaggio}</p>
                )}
                {result.messaggioEsito && (
                  <p className="text-sm text-slate-600">{result.messaggioEsito}</p>
                )}

                {/* Fallback JSON se nessun campo noto */}
                {result.punti == null && result.puntiPatente == null && !result.titoloAbilitativo && (
                  <pre className="max-h-64 overflow-auto rounded-lg bg-slate-100 p-3 text-xs text-slate-700">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-xl bg-red-50 p-4 ring-1 ring-red-200">
                <p className="font-semibold text-red-700">
                  {result.messaggioEsito || result.messaggio || result.error || "Nessun dato restituito dal portale."}
                </p>
                {result.codiceEsito && (
                  <p className="mt-1 text-xs text-red-500">Codice: {result.codiceEsito}</p>
                )}
                <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-white p-3 text-xs text-slate-600">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </ModernAppShell>
  );
}

export default function PuntiPatentePage() {
  return (
    <Suspense fallback={null}>
      <PuntiPatenteInner />
    </Suspense>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, authHeaders, checkSession, logoutSession } from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";

export default function ImportPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [form, setForm] = useState({
    cognome: "",
    numeroPatente: "",
    codiceFiscale: "",
    codiceAutoscuola: "",
    statoFiltro: "tutti",
  });
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState({});
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importRows, setImportRows] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function verify() {
      const session = await checkSession();
      if (!session.ok) {
        if (!cancelled) router.replace("/login");
        return;
      }
      if (!cancelled) {
        setUser(session.autoscuola);
        // Pre-popola codice autoscuola dall'account
        if (session.autoscuola?.codice_autoscuola) {
          setForm((prev) => ({ ...prev, codiceAutoscuola: session.autoscuola.codice_autoscuola }));
        }
        setReady(true);
      }
    }
    verify();
    return () => { cancelled = true; };
  }, [router]);

  function onChange(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setInfo(msg) { setStatus(msg); setIsError(false); }
  function setErr(msg)  { setStatus(msg); setIsError(true); }

  // ── Cerca candidati sul portale (senza importare) ──────────────────────────
  async function onCerca() {
    setBusy(true);
    setImportRows([]);
    setResults([]);
    setSelected({});
    setInfo("Ricerca sul portale in corso...");
    try {
      const res = await fetch(`${API_BASE}/api/portal/search-results`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Errore ricerca");
      setResults(data.results || []);
      setInfo(`${data.count || 0} candidati trovati sul portale`);
    } catch (e) {
      setErr(`Errore: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  // ── Seleziona / deseleziona tutto ──────────────────────────────────────────
  function onSelectAll(checked) {
    if (checked) {
      const all = {};
      results.forEach((_, i) => { all[i] = true; });
      setSelected(all);
    } else {
      setSelected({});
    }
  }

  // ── Importa solo i candidati selezionati ───────────────────────────────────
  async function onImportaSelezionati() {
    const candidates = results
      .filter((_, i) => selected[i])
      .map((r) => ({ cognome: r.cognome, nome: r.nome, numeroPatente: r.numeroPatente }));
    if (!candidates.length) { setErr("Seleziona almeno un candidato"); return; }

    setBusy(true);
    setImportRows([]);
    setInfo(`Importazione di ${candidates.length} candidati selezionati...`);
    try {
      const res = await fetch(`${API_BASE}/api/portal/import-massivo`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ ...form, candidates, autoSelectForBooking: false }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Errore import");
      setImportRows(data.importRows || []);
      setInfo(`Importati ${data.imported} candidati (${data.errors?.length || 0} errori)`);
    } catch (e) {
      setErr(`Errore: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  // ── Scarica TUTTI i candidati dell'autoscuola dal portale ──────────────────
  // Equivalente GeCA: creaarchivio / "Scarica archivio"
  async function onScaricaTutti() {
    const codice = String(form.codiceAutoscuola || "").trim();
    if (!codice) { setErr("Inserisci il codice autoscuola prima di scaricare l'archivio"); return; }

    if (!window.confirm(
      `Vuoi scaricare TUTTI i candidati dell'autoscuola "${codice}" dal portale?\n\nL'operazione potrebbe richiedere qualche minuto e aprirà una finestra del browser per il login al portale.`
    )) return;

    setBusy(true);
    setImportRows([]);
    setInfo("Connessione al portale dell'Automobilista in corso... (potrebbe aprirsi una finestra browser)");
    try {
      const res = await fetch(`${API_BASE}/api/portal/import-archivio`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          codiceAutoscuola: codice,
          statoFiltro: form.statoFiltro,
          collectAllSessions: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Errore import archivio");
      setImportRows(data.importRows || []);
      const msg = [
        `Archivio scaricato: ${data.imported} candidati importati`,
        data.parsed ? `(${data.parsed} trovati sul portale)` : "",
        data.bookingLinked ? `• ${data.bookingLinked} collegati in prenotazione` : "",
        data.errors?.length ? `• ${data.errors.length} errori` : "",
      ].filter(Boolean).join(" ");
      setInfo(msg);
    } catch (e) {
      setErr(`Errore: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  // ── Import candidati dalla pagina Situazione Candidati (sessione attiva) ───
  async function onImportSessione() {
    setBusy(true);
    setImportRows([]);
    setInfo("Recupero candidati dalla sessione attiva del portale...");
    try {
      const res = await fetch(`${API_BASE}/api/portal/import-candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Errore import sessione");
      setInfo(`Importati ${data.imported} candidati dalla sessione (${data.parsed} trovati)`);
    } catch (e) {
      setErr(`Errore: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-sm text-slate-600">Verifica sessione...</p>
      </div>
    );
  }

  const allSelected = results.length > 0 && results.every((_, i) => selected[i]);
  const nSelected = Object.values(selected).filter(Boolean).length;

  return (
    <ModernAppShell
      title="Import Portale"
      subtitle="Scarica candidati dal Portale dell'Automobilista"
      activeKey="import"
      onLogout={() => logoutSession().then(() => router.replace("/login"))}
      user={user}
    >
      <div className="space-y-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Import dal Portale dell'Automobilista</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Scarica e sincronizza candidati dal portale ministeriale – equivalente GeCA <em>creaarchivio / sistArchivi</em>.
          </p>
        </div>

        {/* Filtri */}
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-700">Filtri ricerca</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-600">Cognome</label>
              <input
                className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                placeholder="Cognome"
                value={form.cognome}
                onChange={(e) => onChange("cognome", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-600">N. Patente</label>
              <input
                className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                placeholder="Numero patente"
                value={form.numeroPatente}
                onChange={(e) => onChange("numeroPatente", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-600">Cod. Fiscale</label>
              <input
                className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                placeholder="Codice fiscale"
                value={form.codiceFiscale}
                onChange={(e) => onChange("codiceFiscale", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-600">Cod. Autoscuola</label>
              <input
                className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-mono"
                placeholder="Codice autoscuola"
                value={form.codiceAutoscuola}
                onChange={(e) => onChange("codiceAutoscuola", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-600">Stato</label>
              <select
                className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                value={form.statoFiltro}
                onChange={(e) => onChange("statoFiltro", e.target.value)}
              >
                <option value="tutti">Tutti</option>
                <option value="attivi">Attivi</option>
                <option value="passati">Passati</option>
              </select>
            </div>
          </div>

          {/* Azioni principali */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onCerca}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              Cerca sul portale
            </button>
            <button
              type="button"
              disabled={busy || nSelected === 0}
              onClick={onImportaSelezionati}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              Importa selezionati {nSelected > 0 ? `(${nSelected})` : ""}
            </button>

            {/* Azione principale GeCA: scarica tutto l'archivio */}
            <button
              type="button"
              disabled={busy}
              onClick={onScaricaTutti}
              className="rounded-lg bg-violet-700 px-3 py-1.5 text-sm font-bold text-white hover:bg-violet-600 disabled:opacity-50"
              title="Scarica tutti i candidati dell'autoscuola dal portale (equivalente GeCA creaarchivio)"
            >
              Scarica archivio autoscuola
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={onImportSessione}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              title="Importa candidati della sessione quiz attiva"
            >
              Import sessione attiva
            </button>

            {busy && (
              <span className="ml-1 inline-flex items-center gap-1 text-xs text-violet-700 font-semibold animate-pulse">
                <span className="h-2 w-2 rounded-full bg-violet-500" />
                In corso...
              </span>
            )}
          </div>

          {/* Status */}
          {status && (
            <p className={`mt-2 rounded px-2 py-1 text-sm font-medium ${isError ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-700"}`}>
              {status}
            </p>
          )}
        </div>

        {/* Risultati ricerca */}
        {results.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center gap-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">
                Risultati portale ({results.length})
              </h3>
              <label className="flex items-center gap-1 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => onSelectAll(e.target.checked)}
                />
                Seleziona tutti
              </label>
              {nSelected > 0 && (
                <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                  {nSelected} selezionati
                </span>
              )}
            </div>
            <div className="max-h-72 overflow-auto rounded border border-slate-200">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-slate-100">
                  <tr>
                    <th className="w-8 px-2 py-1 text-left">✓</th>
                    <th className="px-2 py-1 text-left font-semibold text-slate-700">COGNOME</th>
                    <th className="px-2 py-1 text-left font-semibold text-slate-700">NOME</th>
                    <th className="px-2 py-1 text-left font-semibold text-slate-700">N. PATENTE</th>
                    <th className="px-2 py-1 text-left font-semibold text-slate-700">STATO</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((row, i) => (
                    <tr
                      key={`${row.numeroPatente}-${i}`}
                      className={`cursor-pointer border-t border-slate-100 ${selected[i] ? "bg-indigo-50" : "hover:bg-slate-50"}`}
                      onClick={() => setSelected((prev) => ({ ...prev, [i]: !prev[i] }))}
                    >
                      <td className="px-2 py-0.5">
                        <input
                          type="checkbox"
                          checked={!!selected[i]}
                          onChange={() => {}}
                          className="h-3 w-3"
                        />
                      </td>
                      <td className="px-2 py-0.5 font-medium">{row.cognome || "–"}</td>
                      <td className="px-2 py-0.5">{row.nome || "–"}</td>
                      <td className="px-2 py-0.5 font-mono">{row.numeroPatente || "–"}</td>
                      <td className="px-2 py-0.5">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          row.stato === "passato"
                            ? "bg-slate-100 text-slate-500"
                            : "bg-emerald-100 text-emerald-700"
                        }`}>
                          {row.stato || "attivo"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Candidati importati */}
        {importRows.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-700">
              Candidati importati ({importRows.length})
            </h3>
            <div className="max-h-64 overflow-auto rounded border border-slate-200">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-slate-100">
                  <tr>
                    <th className="px-2 py-1 text-left font-semibold text-slate-700">COGNOME</th>
                    <th className="px-2 py-1 text-left font-semibold text-slate-700">NOME</th>
                    <th className="px-2 py-1 text-left font-semibold text-slate-700">C.F.</th>
                    <th className="px-2 py-1 text-left font-semibold text-slate-700">PATENTE</th>
                    <th className="px-2 py-1 text-left font-semibold text-slate-700">CAT.</th>
                    <th className="px-2 py-1 text-left font-semibold text-slate-700">FOTO</th>
                  </tr>
                </thead>
                <tbody>
                  {importRows.map((row, i) => {
                    const foto = row?.raw_portale?.foto_data_url || null;
                    return (
                      <tr key={row.id || i} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-2 py-0.5 font-medium">{row.cognome || "–"}</td>
                        <td className="px-2 py-0.5">{row.nome || "–"}</td>
                        <td className="px-2 py-0.5 font-mono text-[10px]">{row.codice_fiscale || "–"}</td>
                        <td className="px-2 py-0.5 font-mono">{row.patente_numero || "–"}</td>
                        <td className="px-2 py-0.5">{row.categoria_patente || "B"}</td>
                        <td className="px-2 py-0.5">
                          {foto ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={foto} alt="Foto" className="h-8 w-6 rounded border object-cover" />
                          ) : (
                            <span className="text-slate-400">–</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="mt-2 text-xs text-slate-500">
              I candidati importati sono ora disponibili in{" "}
              <a href="/anagrafica-iscrizioni" className="font-semibold text-indigo-600 hover:underline">
                Anagrafica e Iscrizioni
              </a>.
            </p>
          </div>
        )}

        {/* Istruzioni */}
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="font-semibold">Come funziona (equivalente GeCA):</p>
          <ol className="mt-1 ml-4 list-decimal space-y-0.5">
            <li><strong>Cerca sul portale</strong> – visualizza i candidati trovati senza importarli</li>
            <li><strong>Seleziona e importa</strong> – importa solo i candidati selezionati</li>
            <li><strong>Scarica archivio autoscuola</strong> – scarica TUTTI i candidati del tuo codice autoscuola (come GeCA <em>creaarchivio</em>). Richiede il login al portale (potrebbe aprirsi una finestra browser).</li>
          </ol>
          <p className="mt-1">Le credenziali portale vengono prese dalle impostazioni dell'autoscuola o dalle variabili di ambiente del server.</p>
        </div>
      </div>
    </ModernAppShell>
  );
}

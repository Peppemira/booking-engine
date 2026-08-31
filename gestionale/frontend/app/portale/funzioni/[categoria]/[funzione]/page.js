"use client";

/**
 * /portale/funzioni/[categoria]/[funzione] — Pagina funzione singola
 *
 * Se la funzione ha `tabType` o `endpoint` configurato, mostra un'interfaccia
 * OPERATIVA: form di ricerca (date / stato / tipo esame) + tabella risultati
 * chiamando il backend reale.
 *
 * Altrimenti mostra il classico placeholder "TODO".
 */

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import ModernAppShell from "../../../../ModernAppShell";
import { checkSession, logoutSession, getApiBase, authHeaders } from "../../../../../lib/authClient";
import { getCategory, getFunction } from "../../../../../lib/portalCatalog";

// Helper: formatta Date in DD/MM/YYYY
function formatDDMMYYYY(date) {
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// Helper: calcola default date range in base al tipo tab
function getDefaultDateRange(tabType) {
  const today = new Date();
  if (!tabType) return { from: "", to: "" };

  // VAC/VSC/VAQ/VSQ/VSR/VAR/VSRCQC/VARCQC — past 7 days
  if (tabType.startsWith("V")) {
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    return { from: formatDDMMYYYY(from), to: formatDDMMYYYY(today) };
  }
  // SCQCA — past 30 days
  if (tabType === "SCQCA") {
    const from = new Date(today);
    from.setDate(from.getDate() - 29);
    return { from: formatDDMMYYYY(from), to: formatDDMMYYYY(today) };
  }
  // Default (SQI, SGOS, SQA, SCQC) — future 30 days
  const to = new Date(today);
  to.setDate(to.getDate() + 29);
  return { from: formatDDMMYYYY(today), to: formatDDMMYYYY(to) };
}

/**
 * Banner che appare quando il portale segnala che la patente digitata
 * è stata sostituita da una nuova. Permette di aggiornare il candidato in DB.
 *
 * Props:
 *   info: { oldPatente, newPatente, codiceFiscale, message }
 *   onUpdated: callback(updatedRow) chiamato dopo update riuscito
 */
function PatenteSostituitaBanner({ info, onUpdated }) {
  const [updating, setUpdating] = useState(false);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState("");

  const apply = async () => {
    setErr("");
    if (!info?.codiceFiscale) {
      setErr("Codice Fiscale mancante: impossibile identificare il candidato");
      return;
    }
    setUpdating(true);
    try {
      const base = getApiBase();
      const res = await fetch(`${base}/api/portal/update-candidate-patente`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          codiceFiscale: info.codiceFiscale,
          oldPatente: info.oldPatente || undefined,
          newPatente: info.newPatente,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setErr(data.error || `Errore HTTP ${res.status}`);
      } else {
        setDone(data.updated || data);
        if (typeof onUpdated === "function") onUpdated(data.updated || data);
      }
    } catch (e) {
      setErr(e.message || "Errore di rete");
    } finally {
      setUpdating(false);
    }
  };

  if (done) {
    return (
      <div className="mb-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm">
        <div className="flex items-start gap-3">
          <span className="text-2xl">✅</span>
          <div className="flex-1">
            <div className="font-bold text-emerald-800">Patente aggiornata in archivio</div>
            <div className="mt-1 text-xs text-emerald-700">
              Candidato <strong>{done.cognome} {done.nome}</strong> (CF {done.codice_fiscale})
              <br/>Nuovo numero patente: <strong className="font-mono">{done.patente_numero}</strong>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-sm">
      <div className="flex items-start gap-3">
        <span className="text-2xl">⚠️</span>
        <div className="flex-1">
          <div className="font-bold text-amber-900">Il portale segnala una patente sostituita</div>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-amber-700">Patente attuale (in archivio):</div>
              <div className="font-mono font-bold text-slate-700">{info.oldPatente || "—"}</div>
            </div>
            <div>
              <div className="text-amber-700">Nuova patente (dal portale):</div>
              <div className="font-mono font-bold text-emerald-700">{info.newPatente}</div>
            </div>
          </div>
          <div className="mt-2 text-[11px] italic text-amber-700">{info.message}</div>
          {err && <div className="mt-2 rounded bg-red-100 p-2 text-xs text-red-700">{err}</div>}
        </div>
        <button
          type="button"
          onClick={apply}
          disabled={updating || !info.codiceFiscale}
          className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"
          title={!info.codiceFiscale ? "CF mancante" : "Aggiorna patente_numero del candidato in DB"}
        >
          {updating ? "Aggiorno..." : "Aggiorna candidato"}
        </button>
      </div>
    </div>
  );
}

/**
 * Banner che appare quando la pagina del portale contiene anagrafica candidato
 * (risposta "Inserimento Richiesta Certificato Medico" dopo Solo CF).
 * Permette di:
 *  1) Vedere preview (dryRun) delle differenze tra dati portale e DB
 *  2) Applicare l'update al candidato in DB
 *
 * Props:
 *   anagrafica: object da results.portalAnagrafica (cognome, nome, data_nascita, ...)
 *   patenteNuova?: string (se proviene da detectedPatenteUpdate, altrimenti usa anagrafica.patente_numero)
 *   onSynced?: callback(updatedRow) chiamato dopo sync riuscito
 */
function SyncCandidateBanner({ anagrafica, patenteNuova, onSynced }) {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null); // dryRun result
  const [applied, setApplied] = useState(null); // post-apply result
  const [err, setErr] = useState("");
  const [includePunti, setIncludePunti] = useState(true);

  const cf = anagrafica?.codice_fiscale || "";
  const hasMinimum = !!cf && (anagrafica?.cognome || anagrafica?.nome);

  const callSync = async (dryRun) => {
    setErr("");
    if (!cf) { setErr("CF mancante nei dati portale"); return; }
    setLoading(true);
    try {
      const base = getApiBase();
      const res = await fetch(`${base}/api/portal/sync-candidate-from-portal`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          codiceFiscale: cf,
          anagraficaPortale: anagrafica,
          patenteNuova: patenteNuova || undefined,
          includePunti,
          dryRun,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setErr(data.error || `Errore HTTP ${res.status}`);
        return null;
      }
      return data;
    } catch (e) {
      setErr(e.message || "Errore di rete");
      return null;
    } finally {
      setLoading(false);
    }
  };

  const showPreview = async () => {
    const data = await callSync(true);
    if (data) setPreview(data);
  };

  const applyChanges = async () => {
    const data = await callSync(false);
    if (data) {
      setApplied(data);
      setPreview(null);
      if (typeof onSynced === "function") onSynced(data.updated || data);
    }
  };

  const closeModal = () => { setPreview(null); setErr(""); };

  // Stato finale: già applicato
  if (applied) {
    return (
      <div className="mb-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm">
        <div className="flex items-start gap-3">
          <span className="text-2xl">✅</span>
          <div className="flex-1">
            <div className="font-bold text-emerald-800">
              Candidato sincronizzato dal portale
            </div>
            <div className="mt-1 text-xs text-emerald-700">
              {applied.candidate?.cognome} {applied.candidate?.nome} (CF {applied.candidate?.codice_fiscale})
              <br/>Campi aggiornati: <strong>{applied.willUpdateCount}</strong>
              {applied.puntiError && (
                <><br/><span className="text-amber-700 italic">Punti API non disponibile: {applied.puntiError}</span></>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 rounded-2xl border border-indigo-300 bg-indigo-50 p-4 text-sm">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🔄</span>
          <div className="flex-1">
            <div className="font-bold text-indigo-900">
              Anagrafica candidato disponibile dal portale
            </div>
            <div className="mt-1 text-xs text-indigo-700">
              {anagrafica?.cognome} {anagrafica?.nome}
              {anagrafica?.data_nascita_raw && ` — Nato il ${anagrafica.data_nascita_raw}`}
              {anagrafica?.comune_nascita && ` (${anagrafica.comune_nascita})`}
              <br/>CF: <span className="font-mono">{cf || "—"}</span>
              {anagrafica?.patente_numero && (
                <> · Patente: <span className="font-mono">{anagrafica.patente_numero}</span></>
              )}
            </div>
            <div className="mt-2 flex items-center gap-2 text-[11px]">
              <label className="flex items-center gap-1 text-indigo-700">
                <input
                  type="checkbox"
                  checked={includePunti}
                  onChange={(e) => setIncludePunti(e.target.checked)}
                />
                Includi chiamata Punti Patente (per scadenza)
              </label>
            </div>
            {err && <div className="mt-2 rounded bg-red-100 p-2 text-xs text-red-700">{err}</div>}
          </div>
          <button
            type="button"
            onClick={showPreview}
            disabled={loading || !hasMinimum}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
            title={!hasMinimum ? "Servono almeno CF + cognome/nome" : "Mostra anteprima differenze"}
          >
            {loading ? "Verifica..." : "🔄 Sincronizza dal portale"}
          </button>
        </div>
      </div>

      {/* Modale diff preview */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeModal}>
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div>
                <div className="text-sm font-bold text-slate-800">
                  Anteprima sincronizzazione candidato
                </div>
                <div className="text-[11px] text-slate-500">
                  {preview.candidate?.cognome} {preview.candidate?.nome} · CF {preview.candidate?.codice_fiscale}
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >×</button>
            </div>

            <div className="max-h-[55vh] overflow-y-auto p-5">
              {preview.diff && preview.diff.length > 0 ? (
                <table className="w-full border-collapse text-xs">
                  <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase text-slate-600">
                    <tr>
                      <th className="border-b border-slate-200 px-2 py-1.5">Campo</th>
                      <th className="border-b border-slate-200 px-2 py-1.5">Valore in DB</th>
                      <th className="border-b border-slate-200 px-2 py-1.5">Valore dal portale</th>
                      <th className="border-b border-slate-200 px-2 py-1.5 text-center">Cambia?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.diff.map((row, i) => (
                      <tr key={i} className={row.willChange ? "bg-amber-50" : "hover:bg-slate-50"}>
                        <td className="border-b border-slate-100 px-2 py-1.5 font-mono text-slate-700">{row.field}</td>
                        <td className="border-b border-slate-100 px-2 py-1.5 text-slate-500">{row.current ?? <span className="italic text-slate-300">(vuoto)</span>}</td>
                        <td className="border-b border-slate-100 px-2 py-1.5 font-medium text-slate-800">{row.portal ?? "—"}</td>
                        <td className="border-b border-slate-100 px-2 py-1.5 text-center">
                          {row.willChange ? (
                            <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[9px] font-bold text-amber-900">SÌ</span>
                          ) : (
                            <span className="text-slate-300">=</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="rounded-lg bg-slate-100 p-4 text-center text-xs text-slate-500">
                  Nessun campo da confrontare.
                </div>
              )}
              {preview.puntiError && (
                <div className="mt-3 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-700">
                  ⚠ Punti Patente API: {preview.puntiError}
                </div>
              )}
              {err && <div className="mt-2 rounded bg-red-100 p-2 text-xs text-red-700">{err}</div>}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <div className="text-[11px] text-slate-600">
                {preview.willUpdateCount > 0
                  ? <>Verranno aggiornati <strong>{preview.willUpdateCount}</strong> campi</>
                  : <>Nessuna modifica necessaria</>}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Annulla
                </button>
                <button
                  type="button"
                  onClick={applyChanges}
                  disabled={loading || preview.willUpdateCount === 0}
                  className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {loading ? "Aggiorno..." : "Conferma sincronizzazione"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function FunzionePage() {
  const router = useRouter();
  const params = useParams();
  const categoriaSlug = params?.categoria;
  const funzioneSlug = params?.funzione;

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Stato form ricerca
  const [dataFrom, setDataFrom] = useState("");
  const [dataTo, setDataTo] = useState("");
  const [stato, setStato] = useState("");
  const [tipoEsame, setTipoEsame] = useState("");

  // Stato risultati
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState("");

  // Stato form interattivo (per page-view con campi editabili)
  const [formValues, setFormValues] = useState({});
  const [submitting, setSubmitting] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await checkSession();
      if (!session.ok) {
        if (!cancelled) router.replace("/login");
        return;
      }
      if (!cancelled) {
        setUser(session.autoscuola);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  const categoria = getCategory(categoriaSlug);
  const funzione = getFunction(categoriaSlug, funzioneSlug);
  const hasTabType = Boolean(funzione?.tabType);
  const hasCustomEndpoint = Boolean(funzione?.endpoint);
  const hasPageView = Boolean(funzione?.pageViewUrl);

  // Reset form quando cambia funzione
  useEffect(() => {
    if (funzione?.tabType) {
      const range = getDefaultDateRange(funzione.tabType);
      setDataFrom(range.from);
      setDataTo(range.to);
      setStato("");
      setTipoEsame("");
      setResults(null);
      setError("");
    }
    // Reset form interattivo ogni volta che cambia la funzione
    setFormValues({});
    setSubmitting("");
  }, [funzioneSlug, funzione?.tabType]);

  async function handleLogout() {
    await logoutSession();
    router.replace("/login");
  }

  // Handler ricerca generica
  const runSearch = useCallback(async () => {
    if (!hasTabType && !hasCustomEndpoint && !hasPageView) return;
    setSearching(true);
    setError("");
    setResults(null);
    setFormValues({});

    try {
      const base = getApiBase();
      let res, data;

      if (hasTabType) {
        // Endpoint generico ricerca tab (con filtri date/stato/tipo esame)
        const body = {
          tabType: funzione.tabType,
          dataFrom,
          dataTo,
          stato,
          tipoEsame,
        };
        res = await fetch(`${base}/api/portal/ricerca-generica`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(body),
        });
      } else if (hasCustomEndpoint) {
        // Endpoint custom (es. credito-residuo): no body di ricerca
        res = await fetch(`${base}${funzione.endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({}),
        });
      } else if (hasPageView) {
        // Page view generico: carica URL del portale
        res = await fetch(`${base}/api/portal/page-view`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ pageUrl: funzione.pageViewUrl }),
        });
      }

      data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || `Errore HTTP ${res.status}`);
      } else {
        setResults(data);
      }
    } catch (err) {
      setError(err.message || "Errore di rete");
    } finally {
      setSearching(false);
    }
  }, [hasTabType, hasCustomEndpoint, hasPageView, funzione, dataFrom, dataTo, stato, tipoEsame]);

  // Handler submit form interattivo (solo per pageView con campi editabili)
  const submitPageForm = useCallback(async (actionName) => {
    if (!hasPageView || !funzione?.pageViewUrl) return;
    setSubmitting(actionName);
    setError("");
    try {
      const base = getApiBase();

      // WYSIWYG: invia i valori VISIBILI nel form (portale + override utente).
      // Se l'utente ha svuotato un campo (formValues[name] === ""), quella stringa
      // vuota OVERRIDE il valore pre-compilato dal portale. Questo è essenziale
      // per i casi tipo "ricerca con solo CF" dove il portale memorizza la
      // patente da una sessione precedente.
      const inputFields = (results?.formFields || []).filter(
        (f) => f.type !== "submit" && f.type !== "button" && f.type !== "image"
      );
      const mergedFormData = {};
      for (const f of inputFields) {
        if (!f.name) continue;
        if (Object.prototype.hasOwnProperty.call(formValues, f.name)) {
          mergedFormData[f.name] = formValues[f.name];
        } else if (f.value) {
          mergedFormData[f.name] = f.value;
        }
      }

      const res = await fetch(`${base}/api/portal/page-form-submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          pageUrl: funzione.pageViewUrl,
          formData: mergedFormData,
          action: actionName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || `Errore HTTP ${res.status}`);
      } else {
        setResults(data);
        // Reset degli override utente: i nuovi valori display vengono da data.formFields
        setFormValues({});
        // Mostra eventuali messaggi di errore visibili sulla pagina del portale
        if (data.errorMessages && data.errorMessages.length > 0) {
          setError(`Portale: ${data.errorMessages.join(" — ")}`);
        }
      }
    } catch (err) {
      setError(err.message || "Errore di rete");
    } finally {
      setSubmitting("");
    }
  }, [hasPageView, funzione, formValues, results]);

  // Helper: estrae label friendly da name complesso (es. "view.from.thePatente.numero" → "Numero patente")
  const friendlyLabel = useCallback((name) => {
    if (!name) return "";
    // Prendi ultimi 2 segmenti dopo l'ultimo punto
    const parts = name.split(".");
    const last = parts[parts.length - 1] || name;
    // CamelCase → spazi
    const human = last
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (c) => c.toUpperCase())
      .trim();
    // Aggiungi contesto da penultimo segmento se rilevante
    const prev = parts.length > 1 ? parts[parts.length - 2] : "";
    if (prev && /patente|patente|cqc|persona|certificato|fis|cod/i.test(prev)) {
      const prevHuman = prev.replace(/([A-Z])/g, " $1").replace(/^the/i, "").trim();
      return `${human} (${prevHuman})`;
    }
    return human;
  }, []);

  if (loading) {
    return (
      <ModernAppShell title="Portale - Funzione" subtitle="Caricamento..." activeKey="portale-funzioni" onLogout={handleLogout} user={user}>
        <div className="flex h-96 items-center justify-center text-slate-500">Caricamento...</div>
      </ModernAppShell>
    );
  }

  if (!funzione || !categoria) {
    return (
      <ModernAppShell title="Funzione non trovata" subtitle="" activeKey="portale-funzioni" onLogout={handleLogout} user={user}>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
          <div className="text-lg font-semibold">Funzione non trovata</div>
          <p className="mt-1 text-sm">
            La funzione "<code>{categoriaSlug}/{funzioneSlug}</code>" non esiste nel catalogo.
          </p>
          <Link
            href="/portale/funzioni"
            className="mt-4 inline-block rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            ← Torna al catalogo
          </Link>
        </div>
      </ModernAppShell>
    );
  }

  const portalFullUrl = `https://www.ilportaledellautomobilista.it${funzione.portalUrl}`;
  const isOperative = hasTabType || hasCustomEndpoint || hasPageView;

  return (
    <ModernAppShell
      title={funzione.label}
      subtitle={`${categoria.label} › ${funzione.group}`}
      activeKey="portale-funzioni"
      onLogout={handleLogout}
      user={user}
    >
      <div className="space-y-5">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Link href="/portale" className="hover:text-indigo-600">Portale</Link>
          <span>›</span>
          <Link href="/portale/funzioni" className="hover:text-indigo-600">Funzioni</Link>
          <span>›</span>
          <Link href={`/portale/funzioni/${categoriaSlug}`} className="hover:text-indigo-600">
            {categoria.label}
          </Link>
          <span>›</span>
          <span className="font-semibold text-slate-700">{funzione.label}</span>
        </div>

        {/* Header funzione */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className={`absolute inset-x-0 top-0 h-1 bg-linear-to-r ${categoria.color}`} />
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>{categoria.icon}</span>
                <span className="font-semibold">{categoria.label}</span>
                <span>›</span>
                <span>{funzione.group}</span>
              </div>
              <h2 className="mt-1 text-2xl font-bold text-slate-800">{funzione.label}</h2>
              <p className="mt-2 text-sm text-slate-600">{funzione.desc}</p>
            </div>
            <div>
              {funzione.implemented ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold uppercase text-emerald-700">
                  ✓ Operativa
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase text-amber-700">
                  ⚠ TODO
                </span>
              )}
            </div>
          </div>
        </div>

        {/* OPERATIVE VIEW: form + risultati */}
        {isOperative ? (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[2fr_1fr]">
            <div className="space-y-5">
              {/* Form ricerca */}
              {hasTabType && (
                <div className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
                  <h3 className="mb-4 text-sm font-bold text-slate-800 flex items-center gap-2">
                    <span>🔍</span> Ricerca
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Data da (DD/MM/YYYY)</label>
                      <input
                        type="text"
                        value={dataFrom}
                        onChange={(e) => setDataFrom(e.target.value)}
                        placeholder="DD/MM/YYYY"
                        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Data a (DD/MM/YYYY)</label>
                      <input
                        type="text"
                        value={dataTo}
                        onChange={(e) => setDataTo(e.target.value)}
                        placeholder="DD/MM/YYYY"
                        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                    {/* Stato: solo per sessioni, non per verbali */}
                    {["SQI", "SGOS", "SQA", "SCQC", "SCQCA"].includes(funzione.tabType) && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">Stato</label>
                        <select
                          value={stato}
                          onChange={(e) => setStato(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                        >
                          <option value="">Tutti</option>
                          <option value="APERTA">Aperta</option>
                          <option value="CHIUSA">Chiusa</option>
                          <option value="APPROVATA">Approvata</option>
                        </select>
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Tipo esame</label>
                      <select
                        value={tipoEsame}
                        onChange={(e) => setTipoEsame(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                      >
                        <option value="">Tutti</option>
                        <option value="T">Teoria</option>
                        <option value="P">Pratica</option>
                      </select>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      onClick={runSearch}
                      disabled={searching}
                      className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {searching ? "Ricerca in corso..." : "Cerca"}
                    </button>
                    <button
                      onClick={() => {
                        const range = getDefaultDateRange(funzione.tabType);
                        setDataFrom(range.from);
                        setDataTo(range.to);
                        setStato("");
                        setTipoEsame("");
                        setResults(null);
                        setError("");
                      }}
                      disabled={searching}
                      className="rounded-lg bg-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-300 disabled:opacity-50"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              )}

              {/* Custom endpoint (es. credito-residuo) o page-view: solo bottone Carica */}
              {(hasCustomEndpoint || hasPageView) && !hasTabType && (
                <div className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
                  <h3 className="mb-3 text-sm font-bold text-slate-800 flex items-center gap-2">
                    <span>{hasCustomEndpoint ? "💳" : "📄"}</span>
                    {hasCustomEndpoint ? "Dati dal portale" : "Snapshot pagina portale"}
                  </h3>
                  <p className="mb-3 text-xs text-slate-500">
                    {hasPageView && !hasCustomEndpoint
                      ? "Carica la pagina del portale via browser automatico: login + navigazione + parsing della tabella eventualmente presente."
                      : "Carica i dati dall'endpoint dedicato del portale."}
                  </p>
                  <button
                    onClick={runSearch}
                    disabled={searching}
                    className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {searching ? "Caricamento..." : "Carica dal portale"}
                  </button>
                </div>
              )}

              {/* Errore */}
              {error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  <div className="font-semibold">Errore</div>
                  <p className="mt-1 text-xs">{error}</p>
                </div>
              )}

              {/* Risultati */}
              {results && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-slate-800">
                      Risultati ({results.count || 0})
                      {results.pageTitle && (
                        <span className="ml-2 text-xs font-normal text-slate-500">— {results.pageTitle}</span>
                      )}
                    </h3>
                    {results.saldo && (
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">
                        Saldo: {results.saldo}
                      </span>
                    )}
                  </div>

                  {results.message && (
                    <div className="mb-3 rounded-lg bg-blue-50 p-2 text-xs text-blue-800">{results.message}</div>
                  )}

                  {results.righe && results.righe.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-xs">
                        <thead className="bg-slate-100">
                          <tr>
                            {results.intestazioni?.map((h, i) => (
                              <th key={i} className="px-2 py-1.5 text-left font-semibold text-slate-700 border-b border-slate-200">
                                {h || `Col ${i + 1}`}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {results.righe.map((row, ri) => (
                            <tr key={ri} className="border-b border-slate-100 hover:bg-slate-50">
                              {row.map((cell, ci) => (
                                <td key={ci} className="px-2 py-1.5 text-slate-700 align-top">
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500 italic">Nessun risultato in formato tabellare.</div>
                  )}

                  {/* Campi form rilevati (per page-view su pagine con form) — INTERATTIVI */}
                  {hasPageView && results.formFields && results.formFields.length > 0 && (() => {
                    const inputFields = results.formFields.filter((f) => f.type !== "submit" && f.type !== "button" && f.type !== "image");
                    const submitFields = results.formFields.filter((f) => f.type === "submit" || f.type === "button" || f.type === "image");
                    return (
                      <div className="mt-4 border-t border-slate-200 pt-4">
                        <div className="mb-3 flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-slate-800">📝 Compila e invia</span>
                          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                            {inputFields.length} campi · {submitFields.length} azioni
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const empties = {};
                              for (const f of inputFields) if (f.name) empties[f.name] = "";
                              setFormValues(empties);
                            }}
                            disabled={!!submitting}
                            className="ml-auto rounded-lg bg-slate-200 px-3 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-300 disabled:opacity-50"
                            title="Imposta tutti i campi a stringa vuota (override valori pre-compilati dal portale)"
                          >
                            🧹 Svuota tutti i campi
                          </button>
                          <button
                            type="button"
                            onClick={() => setFormValues({})}
                            disabled={!!submitting}
                            className="rounded-lg bg-slate-100 px-3 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-50"
                            title="Annulla le modifiche, ripristina i valori pre-compilati dal portale"
                          >
                            ↺ Ripristina valori portale
                          </button>
                        </div>

                        {/* Banner: patente sostituita rilevata */}
                        {results.detectedPatenteUpdate && (
                          <PatenteSostituitaBanner
                            info={results.detectedPatenteUpdate}
                            onUpdated={(updated) => {
                              setResults((prev) => ({ ...prev, detectedPatenteUpdate: null, _lastPatenteUpdate: updated }));
                            }}
                          />
                        )}

                        {/* Banner: anagrafica candidato disponibile dal portale */}
                        {results.portalAnagrafica && results.portalAnagrafica.codice_fiscale && (
                          <SyncCandidateBanner
                            anagrafica={results.portalAnagrafica}
                            patenteNuova={results.detectedPatenteUpdate?.newPatente || null}
                            onSynced={(updated) => {
                              setResults((prev) => ({ ...prev, _lastSyncedCandidate: updated }));
                            }}
                          />
                        )}

                        {inputFields.length > 0 && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                            {inputFields.map((field, idx) => {
                              const userOverride = Object.prototype.hasOwnProperty.call(formValues, field.name);
                              const value = userOverride ? formValues[field.name] : (field.value || "");
                              const isPrefilledFromPortal = !!field.value && !userOverride;
                              const onChange = (e) => {
                                const v = field.type === "checkbox" ? e.target.checked : e.target.value;
                                setFormValues((prev) => ({ ...prev, [field.name]: v }));
                              };
                              const clearField = () => setFormValues((prev) => ({ ...prev, [field.name]: "" }));
                              // Priorità label: portale (label/value) → friendly da name
                              const labelText = field.label || friendlyLabel(field.name);
                              const inputClass = "w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-indigo-500 focus:outline-none disabled:bg-slate-100";
                              return (
                                <div key={idx} className="space-y-1">
                                  <label className="block text-[11px] font-semibold text-slate-600 flex items-center gap-1">
                                    <span>{labelText}</span>
                                    <span className="text-[9px] font-mono font-normal text-slate-400">{field.type}</span>
                                    {isPrefilledFromPortal && (
                                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[8px] font-bold text-amber-700" title="Valore pre-compilato dal portale (sarà inviato così com'è se non lo modifichi)">PRE-COMPILATO</span>
                                    )}
                                    {value && (
                                      <button
                                        type="button"
                                        onClick={clearField}
                                        disabled={!!submitting}
                                        className="ml-auto rounded text-[10px] text-slate-400 hover:text-red-500 disabled:opacity-50"
                                        title="Svuota questo campo"
                                      >×</button>
                                    )}
                                  </label>
                                  {field.type === "checkbox" ? (
                                    <label className="flex items-center gap-2 text-xs text-slate-700">
                                      <input
                                        type="checkbox"
                                        checked={!!value}
                                        onChange={onChange}
                                        disabled={!!submitting}
                                        className="rounded border-slate-300"
                                      />
                                      {labelText}
                                    </label>
                                  ) : field.type === "select" ? (
                                    <input
                                      type="text"
                                      placeholder="Valore (option value)"
                                      value={value}
                                      onChange={onChange}
                                      disabled={!!submitting}
                                      className={inputClass}
                                    />
                                  ) : field.type === "textarea" ? (
                                    <textarea
                                      rows={2}
                                      placeholder={field.label || ""}
                                      value={value}
                                      onChange={onChange}
                                      disabled={!!submitting}
                                      className={inputClass}
                                    />
                                  ) : (
                                    <input
                                      type={field.type === "password" ? "password" : "text"}
                                      placeholder={field.label || ""}
                                      value={value}
                                      onChange={onChange}
                                      disabled={!!submitting}
                                      className={inputClass}
                                    />
                                  )}
                                  <div className="text-[9px] font-mono text-slate-400 break-all">{field.name}</div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {submitFields.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {submitFields.map((field, idx) => {
                              const isClear = /clear|reset|annulla/i.test(field.name);
                              const isPaging = /paging|search|cerca|pag/i.test(field.name);
                              const cls = isClear
                                ? "rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-300 disabled:opacity-50"
                                : isPaging
                                ? "rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                                : "rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50";
                              const cleanName = field.name.replace(/^action:/, "").replace(/_/g, " ");
                              const isThisSubmitting = submitting === field.name;
                              return (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => submitPageForm(field.name)}
                                  disabled={!!submitting}
                                  className={cls}
                                  title={field.name}
                                >
                                  {isThisSubmitting ? "Invio..." : (field.label || cleanName)}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {results.fillResult && (results.fillResult.skipped?.length > 0 || results.fillResult.filled?.length > 0) && (
                          <div className="mt-3 rounded-lg bg-slate-50 p-2 text-[10px] text-slate-600">
                            Compilati: <span className="font-bold text-emerald-700">{results.fillResult.filled?.length || 0}</span>
                            {results.fillResult.skipped?.length > 0 && (
                              <> · Skippati: <span className="font-bold text-amber-700">{results.fillResult.skipped.length}</span> ({results.fillResult.skipped.map((s) => s.name).join(", ")})</>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Fallback per non-pageView (es. credito-residuo): mostra read-only */}
                  {!hasPageView && results.formFields && results.formFields.length > 0 && (
                    <div className="mt-4 border-t border-slate-200 pt-3">
                      <div className="text-xs font-semibold text-slate-600 mb-2">
                        Campi form rilevati ({results.formFields.length})
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {results.formFields.map((field, idx) => (
                          <div key={idx} className="rounded-lg bg-slate-50 px-2 py-1.5 text-[10px]">
                            <span className="font-mono font-semibold text-indigo-600">{field.type}</span>{" "}
                            <span className="text-slate-700">{field.name}</span>
                            {field.label && <div className="text-slate-500 italic">{field.label}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Sidebar metadati */}
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-bold text-slate-600 uppercase mb-2">Endpoint backend</div>
                <code className="block rounded-lg bg-slate-50 p-2.5 text-[10px] font-mono text-slate-700 break-all">
                  {hasTabType
                    ? "/api/portal/ricerca-generica"
                    : hasCustomEndpoint
                    ? funzione.endpoint
                    : "/api/portal/page-view"}
                </code>
                {hasTabType && (
                  <div className="mt-2 text-[10px] text-slate-500">
                    Tab type: <code className="font-mono font-semibold text-indigo-600">{funzione.tabType}</code>
                  </div>
                )}
                {hasPageView && !hasTabType && (
                  <div className="mt-2 text-[10px] text-slate-500">
                    Modalita': <code className="font-mono font-semibold text-indigo-600">page-view snapshot</code>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-bold text-slate-600 uppercase mb-2">URL action portale</div>
                <code className="block rounded-lg bg-slate-50 p-2.5 text-[10px] font-mono text-slate-700 break-all">
                  {funzione.portalUrl}
                </code>
                <a
                  href={portalFullUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 block text-[10px] text-indigo-600 hover:underline break-all"
                >
                  Apri nel portale ↗
                </a>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-bold text-slate-600 uppercase mb-3">Metadati</div>
                <dl className="space-y-2 text-xs">
                  <div>
                    <dt className="text-slate-500">Categoria</dt>
                    <dd className="font-semibold text-slate-800">{categoria.label}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Gruppo</dt>
                    <dd className="font-semibold text-slate-800">{funzione.group}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Slug</dt>
                    <dd className="font-mono text-slate-800">{funzione.slug}</dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-bold text-slate-600 uppercase mb-3">Azioni</div>
                <div className="space-y-2">
                  <Link
                    href={`/portale/funzioni/${categoriaSlug}`}
                    className="block w-full rounded-lg bg-slate-100 px-3 py-2 text-center text-xs font-semibold text-slate-700 hover:bg-slate-200"
                  >
                    ← Torna alla categoria
                  </Link>
                  <Link
                    href="/portale/funzioni"
                    className="block w-full rounded-lg bg-slate-100 px-3 py-2 text-center text-xs font-semibold text-slate-700 hover:bg-slate-200"
                  >
                    Tutte le funzioni
                  </Link>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* PLACEHOLDER VIEW: vecchio layout TODO */
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[2fr_1fr]">
            <div className="space-y-5">
              {funzione.implemented ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                  <div className="flex items-start gap-3">
                    <div className="text-2xl">✓</div>
                    <div className="flex-1">
                      <div className="text-sm font-bold text-emerald-800">
                        Funzione gia' disponibile
                      </div>
                      <p className="mt-1 text-xs text-emerald-700 leading-relaxed">
                        Questa funzione e' gia' integrata nel gestionale.
                        {funzione.backendHint && (
                          <>
                            <br/><br/>
                            <span className="font-semibold">Funzioni backend:</span><br/>
                            <code className="rounded bg-white px-1 py-0.5 font-mono text-[10px]">{funzione.backendHint}</code>
                          </>
                        )}
                      </p>
                      <div className="mt-3">
                        <Link
                          href="/portale"
                          className="inline-block rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                          → Apri la pagina operativa
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                  <div className="flex items-start gap-3">
                    <div className="text-2xl">🚧</div>
                    <div className="flex-1">
                      <div className="text-sm font-bold text-amber-800">
                        Funzione non ancora implementata
                      </div>
                      <p className="mt-1 text-xs text-amber-700 leading-relaxed">
                        Questa voce e' un <strong>placeholder</strong> generato dalla mappatura del portale.
                        Il flusso operativo (form + scraping + salvataggio risultati) deve ancora essere sviluppato
                        lato backend in
                        <code className="mx-1 rounded bg-white px-1 py-0.5 font-mono text-[10px]">portalSession.js</code>.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {funzione.fields && funzione.fields.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="mb-3 text-sm font-bold text-slate-800">Campi form portale</h3>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {funzione.fields.map((f) => (
                      <div key={f}>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">
                          {f}
                        </label>
                        <input
                          type="text"
                          disabled
                          placeholder="(non attivo - placeholder)"
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-400 italic cursor-not-allowed"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-bold text-slate-600 uppercase mb-2">URL action portale</div>
                <code className="block rounded-lg bg-slate-50 p-2.5 text-[10px] font-mono text-slate-700 break-all">
                  {funzione.portalUrl}
                </code>
                <a
                  href={portalFullUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 block text-[10px] text-indigo-600 hover:underline break-all"
                >
                  Apri nel portale ↗
                </a>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-bold text-slate-600 uppercase mb-3">Azioni</div>
                <div className="space-y-2">
                  <Link
                    href={`/portale/funzioni/${categoriaSlug}`}
                    className="block w-full rounded-lg bg-slate-100 px-3 py-2 text-center text-xs font-semibold text-slate-700 hover:bg-slate-200"
                  >
                    ← Torna alla categoria
                  </Link>
                  <Link
                    href="/portale/funzioni"
                    className="block w-full rounded-lg bg-slate-100 px-3 py-2 text-center text-xs font-semibold text-slate-700 hover:bg-slate-200"
                  >
                    Tutte le funzioni
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ModernAppShell>
  );
}

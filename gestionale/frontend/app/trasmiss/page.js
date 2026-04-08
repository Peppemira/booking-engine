"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, authHeaders, checkSession, logoutSession } from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const STATI_COLORE = {
  pronto_trasmissione: "bg-emerald-100 text-emerald-800",
  da_trasmettere:      "bg-amber-100 text-amber-800",
  pronto:              "bg-sky-100 text-sky-800",
  trasmesso:           "bg-slate-100 text-slate-600",
  approvato:           "bg-green-100 text-green-700",
  respinto:            "bg-red-100 text-red-700",
  sospeso:             "bg-orange-100 text-orange-700",
};

const STATI_LABEL = {
  pronto_trasmissione: "Pronto",
  da_trasmettere:      "Da trasmettere",
  pronto:              "Pronto",
  trasmesso:           "Trasmesso",
  approvato:           "Approvato",
  respinto:            "Respinto",
  sospeso:             "Sospeso",
};

const STATI_MANUALI = [
  { value: "da_trasmettere",      label: "Da trasmettere" },
  { value: "pronto_trasmissione", label: "Pronto trasmissione" },
  { value: "trasmesso",           label: "Trasmesso" },
  { value: "approvato",           label: "Approvato" },
  { value: "respinto",            label: "Respinto" },
  { value: "sospeso",             label: "Sospeso" },
];

function formatData(v) {
  if (!v) return "–";
  const d = typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date(d + "Z").toLocaleDateString("it-IT");
  return String(v).slice(0, 12) || "–";
}

// ---------------------------------------------------------------------------
// Componente principale
// ---------------------------------------------------------------------------

export default function TrasmissPage() {
  const router = useRouter();
  const [user, setUser]         = useState(null);
  const [loading, setLoading]   = useState(true);

  // Pratiche
  const [pratiche, setPratiche]       = useState([]);
  const [storico, setStorico]         = useState([]);
  const [tab, setTab]                 = useState("pronte"); // pronte | storico
  const [fetchErr, setFetchErr]       = useState("");
  const [selected, setSelected]       = useState(new Set());

  // Credenziali SDC
  const [showCredForm, setShowCredForm] = useState(false);
  const [cred, setCred] = useState({
    usr: "", pwd: "", pin: "", piva: "", tipoincarico: "01",
    codiceFiscale: "", denominazione: "",
  });

  // Stato trasmissione
  const [invio, setInvio]           = useState({ busy: false, risultati: null, error: "" });

  // Cambio stato manuale
  const [cambioStato, setCambioStato] = useState({ id: null, valore: "" });

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    async function init() {
      const s = await checkSession();
      if (!s.ok) { if (!cancelled) router.replace("/login"); return; }
      if (!cancelled) { setUser(s.autoscuola); setLoading(false); }
    }
    init();
    return () => { cancelled = true; };
  }, [router]);

  // ---------------------------------------------------------------------------
  // Caricamento dati
  // ---------------------------------------------------------------------------
  const loadPronte = useCallback(async () => {
    setFetchErr("");
    try {
      const r = await fetch(`${API_BASE}/api/trasmiss/pratiche-pronte`, {
        headers: authHeaders(), cache: "no-store",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setPratiche(await r.json());
    } catch (e) { setFetchErr(e.message); }
  }, []);

  const loadStorico = useCallback(async () => {
    setFetchErr("");
    try {
      const r = await fetch(`${API_BASE}/api/trasmiss/storico?limit=100`, {
        headers: authHeaders(), cache: "no-store",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setStorico(await r.json());
    } catch (e) { setFetchErr(e.message); }
  }, []);

  useEffect(() => {
    if (!loading) {
      loadPronte();
      loadStorico();
    }
  }, [loading, loadPronte, loadStorico]);

  // ---------------------------------------------------------------------------
  // Selezione checkbox
  // ---------------------------------------------------------------------------
  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === pratiche.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pratiche.map((p) => p.id)));
    }
  }

  // ---------------------------------------------------------------------------
  // Invio massivo
  // ---------------------------------------------------------------------------
  async function onInviaMassivo() {
    if (selected.size === 0) {
      setInvio((s) => ({ ...s, error: "Seleziona almeno una pratica" }));
      return;
    }
    if (!cred.usr || !cred.pwd || !cred.pin || !cred.piva) {
      setShowCredForm(true);
      setInvio((s) => ({ ...s, error: "Compila le credenziali SDC prima di procedere" }));
      return;
    }

    setInvio({ busy: true, risultati: null, error: "" });
    try {
      const r = await fetch(`${API_BASE}/api/trasmiss/invia-massivo`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          pratica_ids: Array.from(selected),
          credenziali: cred,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Errore invio");
      setInvio({ busy: false, risultati: data, error: "" });
      setSelected(new Set());
      await loadPronte();
      await loadStorico();
    } catch (e) {
      setInvio({ busy: false, risultati: null, error: e.message });
    }
  }

  // ---------------------------------------------------------------------------
  // Invio singolo
  // ---------------------------------------------------------------------------
  async function onInviaSingolo(praticaId) {
    if (!cred.usr || !cred.pwd || !cred.pin || !cred.piva) {
      setShowCredForm(true);
      setInvio((s) => ({ ...s, error: "Compila le credenziali SDC prima di procedere" }));
      return;
    }
    setInvio({ busy: true, risultati: null, error: "" });
    try {
      const r = await fetch(`${API_BASE}/api/trasmiss/invia`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ pratica_id: praticaId, credenziali: cred }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Errore invio");
      setInvio({
        busy: false,
        risultati: { totale: 1, trasmesse: 1, fallite: 0, risultati: [{ ...data, pratica_id: praticaId, successo: true }] },
        error: "",
      });
      await loadPronte();
      await loadStorico();
    } catch (e) {
      setInvio({ busy: false, risultati: null, error: e.message });
    }
  }

  // ---------------------------------------------------------------------------
  // Cambio stato manuale
  // ---------------------------------------------------------------------------
  async function onCambioStato(id, stato) {
    try {
      const r = await fetch(`${API_BASE}/api/trasmiss/stato/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ stato_pratica: stato }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await loadPronte();
      await loadStorico();
      setCambioStato({ id: null, valore: "" });
    } catch (e) {
      setFetchErr(e.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <p className="text-slate-600">Caricamento...</p>
    </div>
  );

  const nPronte = pratiche.length;
  const nSelezionate = selected.size;

  return (
    <ModernAppShell
      title="Trasmissioni CED"
      subtitle="Invio pratiche al CED — equivalente GeCA frmTrasmiss"
      activeKey="trasmiss"
      onLogout={() => logoutSession().then(() => router.replace("/login"))}
      user={user}
    >
      <div className="space-y-4">

        {/* Header + KPI */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Trasmissioni CED</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Invia pratiche al CED tramite SDC (Agenzia Entrate) — flusso GeCA.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCredForm((v) => !v)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              🔑 {showCredForm ? "Nascondi" : "Credenziali SDC"}
            </button>
            <button
              onClick={loadPronte}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              🔄 Aggiorna
            </button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Pratiche pronte", value: nPronte, color: "bg-emerald-50 border-emerald-200" },
            { label: "Selezionate",     value: nSelezionate, color: "bg-indigo-50 border-indigo-200" },
            { label: "Trasmesse oggi",  value: storico.filter(p => p.created_at?.startsWith(new Date().toISOString().slice(0,10))).length, color: "bg-slate-50 border-slate-200" },
          ].map((k) => (
            <div key={k.label} className={`rounded-xl border p-3 ${k.color}`}>
              <p className="text-xs text-slate-500">{k.label}</p>
              <p className="text-2xl font-bold text-slate-800">{k.value}</p>
            </div>
          ))}
        </div>

        {/* Form credenziali SDC */}
        {showCredForm && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <h3 className="mb-3 text-sm font-bold text-amber-900">
              🔑 Credenziali SDC (Agenzia Entrate) — equivalente GeCA
            </h3>
            <p className="mb-3 text-xs text-amber-700">
              Inserisci le credenziali per accedere al servizio SendDocComm.
              Se lasciate vuote, verranno usate le variabili d&apos;ambiente del server.
            </p>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {[
                { key: "usr",          label: "Username AE",      type: "text" },
                { key: "pwd",          label: "Password AE",      type: "password" },
                { key: "pin",          label: "PIN",              type: "password" },
                { key: "piva",         label: "P.IVA",            type: "text" },
                { key: "codiceFiscale",label: "Codice Fiscale",   type: "text" },
                { key: "denominazione",label: "Denominazione",    type: "text" },
              ].map(({ key, label, type }) => (
                <div key={key}>
                  <label className="block text-xs font-semibold text-amber-800 mb-0.5">{label}</label>
                  <input
                    type={type}
                    className="w-full rounded border border-amber-300 bg-white px-2 py-1.5 text-sm font-mono"
                    value={cred[key]}
                    onChange={(e) => setCred((p) => ({ ...p, [key]: e.target.value }))}
                    autoComplete="off"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs font-semibold text-amber-800 mb-0.5">Tipo incarico</label>
                <select
                  className="w-full rounded border border-amber-300 bg-white px-2 py-1.5 text-sm"
                  value={cred.tipoincarico}
                  onChange={(e) => setCred((p) => ({ ...p, tipoincarico: e.target.value }))}
                >
                  <option value="01">01 – Intermediario</option>
                  <option value="10">10 – Soggetto stesso</option>
                  <option value="11">11 – Soggetto dello stesso gruppo</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {fetchErr && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{fetchErr}</div>
        )}

        {/* Risultati invio */}
        {invio.error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            ❌ {invio.error}
          </div>
        )}
        {invio.risultati && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="mb-2 font-semibold text-emerald-800">
              ✅ Trasmissione completata — {invio.risultati.trasmesse}/{invio.risultati.totale} pratiche inviate
              {invio.risultati.fallite > 0 && (
                <span className="ml-2 text-red-700">({invio.risultati.fallite} fallite)</span>
              )}
            </p>
            <div className="space-y-1">
              {(invio.risultati.risultati || []).map((r, i) => (
                <div key={i} className={`rounded p-2 text-xs ${r.successo ? "bg-white" : "bg-red-50"}`}>
                  {r.successo ? "✅" : "❌"}{" "}
                  <span className="font-medium">{r.candidato || r.pratica_id}</span>
                  {r.successo && r.idtrx && (
                    <span className="ml-2 font-mono text-slate-500">IDTrx: {r.idtrx}</span>
                  )}
                  {r.successo && r.progressivo && (
                    <span className="ml-2 font-mono text-slate-500">Progr: {r.progressivo}</span>
                  )}
                  {!r.successo && r.errori && (
                    <span className="ml-2 text-red-700">
                      {Array.isArray(r.errori) ? r.errori.map((e) => e.descrizione).join(", ") : String(r.errori)}
                    </span>
                  )}
                  {!r.successo && r.errore && (
                    <span className="ml-2 text-red-700">{r.errore}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-200">
          {[
            { key: "pronte",  label: `📤 Pratiche pronte (${nPronte})` },
            { key: "storico", label: `📋 Storico trasmissioni (${storico.length})` },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "border-b-2 border-indigo-600 text-indigo-700"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab: Pratiche pronte */}
        {tab === "pronte" && (
          <div className="space-y-3">
            {/* Toolbar selezione + invio */}
            {nPronte > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={toggleAll}
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  {selected.size === pratiche.length ? "Deseleziona tutto" : "Seleziona tutto"}
                </button>
                <span className="text-xs text-slate-500">{nSelezionate} selezionate</span>
                <button
                  disabled={nSelezionate === 0 || invio.busy}
                  onClick={onInviaMassivo}
                  className="ml-auto rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
                >
                  {invio.busy ? "Invio in corso..." : `📤 Invia selezionate (${nSelezionate})`}
                </button>
              </div>
            )}

            {nPronte === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
                <p className="text-slate-400">Nessuna pratica pronta per la trasmissione.</p>
                <p className="mt-1 text-xs text-slate-400">
                  Vai a <span className="font-medium">Pratiche</span> e imposta lo stato
                  a &quot;Pronto trasmissione&quot; per le pratiche da inviare.
                </p>
              </div>
            ) : (
              <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr className="border-b border-slate-200">
                      <th className="w-8 px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected.size === pratiche.length && pratiche.length > 0}
                          onChange={toggleAll}
                          className="rounded"
                        />
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Candidato</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Tipo pratica</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Categoria</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Marca operativa</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Iscrizione</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Stato</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pratiche.map((p) => (
                      <tr
                        key={p.id}
                        className={`border-b border-slate-100 last:border-0 transition-colors ${
                          selected.has(p.id) ? "bg-indigo-50" : "hover:bg-slate-50"
                        }`}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selected.has(p.id)}
                            onChange={() => toggleSelect(p.id)}
                            className="rounded"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-800">
                            {p.candidates?.cognome} {p.candidates?.nome}
                          </div>
                          <div className="text-xs text-slate-500 font-mono">
                            {p.candidates?.codice_fiscale || "–"}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">{p.tipo_pratica || "–"}</td>
                        <td className="px-3 py-2 text-slate-700">{p.categoria_patente || "–"}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-600">
                          {p.marca_operativa || "–"}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{formatData(p.data_iscrizione)}</td>
                        <td className="px-3 py-2">
                          {cambioStato.id === p.id ? (
                            <div className="flex items-center gap-1">
                              <select
                                className="rounded border border-slate-300 px-1 py-0.5 text-xs"
                                value={cambioStato.valore}
                                onChange={(e) => setCambioStato((s) => ({ ...s, valore: e.target.value }))}
                              >
                                <option value="">Scegli...</option>
                                {STATI_MANUALI.map((s) => (
                                  <option key={s.value} value={s.value}>{s.label}</option>
                                ))}
                              </select>
                              <button
                                onClick={() => onCambioStato(p.id, cambioStato.valore)}
                                disabled={!cambioStato.valore}
                                className="rounded bg-indigo-600 px-2 py-0.5 text-xs text-white disabled:opacity-40"
                              >
                                ✓
                              </button>
                              <button
                                onClick={() => setCambioStato({ id: null, valore: "" })}
                                className="rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-700"
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setCambioStato({ id: p.id, valore: p.stato_pratica || "" })}
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                STATI_COLORE[p.stato_pratica] || "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {STATI_LABEL[p.stato_pratica] || p.stato_pratica || "–"}
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            disabled={invio.busy}
                            onClick={() => onInviaSingolo(p.id)}
                            className="rounded bg-indigo-600 px-2 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
                          >
                            📤 Invia
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab: Storico trasmissioni */}
        {tab === "storico" && (
          <div>
            {storico.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
                <p className="text-slate-400">Nessuna trasmissione effettuata.</p>
              </div>
            ) : (
              <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr className="border-b border-slate-200">
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Candidato</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Tipo pratica</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Categoria</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Marca operativa</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Stato</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Data iscrizione</th>
                    </tr>
                  </thead>
                  <tbody>
                    {storico.map((p) => (
                      <tr
                        key={p.id}
                        className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                      >
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-800">
                            {p.candidates?.cognome} {p.candidates?.nome}
                          </div>
                          <div className="text-xs text-slate-500 font-mono">
                            {p.candidates?.codice_fiscale || "–"}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">{p.tipo_pratica || "–"}</td>
                        <td className="px-3 py-2 text-slate-700">{p.categoria_patente || "–"}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-600">
                          {p.marca_operativa || "–"}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            STATI_COLORE[p.stato_pratica] || "bg-slate-100 text-slate-600"
                          }`}>
                            {STATI_LABEL[p.stato_pratica] || p.stato_pratica || "–"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-600">{formatData(p.data_iscrizione)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Nota info */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <p className="font-semibold mb-1">Flusso trasmissione (equivalente GeCA frmTrasmiss):</p>
          <p>
            1. Vai a <strong>Pratiche</strong> e imposta stato → &quot;Pronto trasmissione&quot; •{" "}
            2. Torna qui e seleziona le pratiche •{" "}
            3. Inserisci credenziali SDC → <strong>Invia selezionate</strong> •{" "}
            4. Il sistema chiama il servizio SDC di Agenzia Entrate e aggiorna lo stato a &quot;Trasmesso&quot;.
          </p>
        </div>

      </div>
    </ModernAppShell>
  );
}

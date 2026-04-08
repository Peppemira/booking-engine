"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  API_BASE,
  authHeaders,
  checkSession,
  logoutSession,
} from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";
import { formatData, PATENTE_RICHIESTA_OPTIONS } from "../../lib/candidatoEditor";
import { exportCSV } from "../../lib/exportTable";

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const TIPO_PRATICA_OPTIONS = [
  { value: "", label: "Tutte le pratiche" },
  { value: "ESAME", label: "Conseguimento per Esame" },
  { value: "RINNOVO", label: "Rinnovo / Conferma Validità" },
  { value: "CERTIFICATO_MEDICO", label: "Certificato Medico" },
  { value: "DUPLICATO", label: "Duplicato / Conversione" },
  { value: "CQC", label: "Patente CQC / CQC Card" },
  { value: "GUIDA_ACCOMPAGNATA", label: "Guida Accompagnata" },
  { value: "NAUTICA", label: "Patente Nautica" },
  { value: "CORSO", label: "Corsi (RP, CQC, ADR)" },
  { value: "ALTRO", label: "Altro" },
];

const STATO_OPTIONS = [
  { value: "", label: "Tutti gli stati" },
  { value: "attivo", label: "Attivo" },
  { value: "da_trasmettere",      label: "Da trasmettere" },
  { value: "pronto_trasmissione", label: "Pronto trasmissione" },
  { value: "trasmesso",           label: "Trasmesso" },
  { value: "approvato",           label: "Approvato" },
  { value: "respinto",            label: "Respinto" },
  { value: "sospeso",             label: "Sospeso" },
];

const PATENTE_FILTER = ["TUTTE", ...PATENTE_RICHIESTA_OPTIONS];

const STATO_RICHIESTA_MAP = [
  { keys: ["ESAME", "RILASCIO", "INTERNO", "PRIVATISTA", "REVISIONE", "CONSEGUIMENTO"], tipo: "ESAME" },
  { keys: ["RINNOVO", "CONFERMA", "VALIDITÀ", "VALIDITA"], tipo: "RINNOVO" },
  { keys: ["MEDICO", "CERTIFICATO"], tipo: "CERTIFICATO_MEDICO" },
  { keys: ["DUPLICATO", "CONVERSIONE", "SMARRIM", "DETERIORAM", "RICLASSIF"], tipo: "DUPLICATO" },
  { keys: ["CQC", "C.Q.C"], tipo: "CQC" },
  { keys: ["ACCOMPAGNATA", "GUIDA ACC"], tipo: "GUIDA_ACCOMPAGNATA" },
  { keys: ["NAUTICA"], tipo: "NAUTICA" },
  { keys: ["CORSO", "RECUPERO PUNTI", "ADR", "CAP"], tipo: "CORSO" },
];

function getTipoPratica(row) {
  const sr = String(
    row?.raw_portale?.anagrafica?.stato_richiesta || row?.stato || ""
  ).toUpperCase();
  if (!sr) return "ALTRO";
  for (const { keys, tipo } of STATO_RICHIESTA_MAP) {
    if (keys.some((k) => sr.includes(k))) return tipo;
  }
  return "ALTRO";
}

function tipoPraticaLabel(tipo) {
  return TIPO_PRATICA_OPTIONS.find((o) => o.value === tipo)?.label || tipo || "–";
}

function statoChip(stato) {
  const s = String(stato || "").toLowerCase();
  const map = {
    attivo:              "bg-emerald-100 text-emerald-800",
    da_trasmettere:      "bg-amber-100 text-amber-800",
    pronto_trasmissione: "bg-violet-100 text-violet-800",
    trasmesso:           "bg-blue-100 text-blue-800",
    approvato:           "bg-green-100 text-green-800",
    respinto:            "bg-red-100 text-red-800",
    sospeso:             "bg-orange-100 text-orange-800",
  };
  return map[s] || "bg-slate-100 text-slate-700";
}

function scadenzaColor(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = (d - now) / 86400000;
  if (diffDays < 0) return "text-red-600 font-semibold";
  if (diffDays < 30) return "text-amber-600 font-semibold";
  return "text-slate-700";
}

// ---------------------------------------------------------------------------
// Componente principale
// ---------------------------------------------------------------------------

// Tipi pratica per il wizard
const WIZARD_TIPO_OPTIONS = [
  { value: "ESAME",              label: "Conseguimento per Esame (A/B/C/D/AM)" },
  { value: "RINNOVO",            label: "Rinnovo / Conferma Validità" },
  { value: "CERTIFICATO_MEDICO", label: "Certificato Medico TT2112" },
  { value: "DUPLICATO",          label: "Duplicato / Smarrimento / Deterioramento" },
  { value: "CQC",                label: "Conseguimento CQC / Carta Qualificazione Conducente" },
  { value: "RINNOVO_CQC",       label: "Rinnovo CQC (Carta Qualificazione Conducente)" },
  { value: "GUIDA_ACCOMPAGNATA", label: "Guida Accompagnata (Prima Fase)" },
  { value: "NAUTICA",            label: "Patente Nautica" },
  { value: "CORSO",              label: "Corso (RP, CQC, ADR)" },
  { value: "ALTRO",              label: "Altro" },
];

const CATEGORIE_PATENTE = ["A1", "A2", "A", "AM", "B", "B1", "BE", "C", "CE", "C1", "C1E", "D", "DE", "D1", "D1E", "T"];

const BOLLETTINO_PRESET = [
  { codice: "9001", importo: "16.00",  descrizione: "Contrassegno patente €16" },
  { codice: "9004", importo: "10.20",  descrizione: "Contrassegno foglio rosa €10.20" },
  { codice: "9005", importo: "32.00",  descrizione: "Contrassegno duplicato €32" },
  { codice: "9006", importo: "16.00",  descrizione: "Contrassegno rinnovo €16" },
];

const EMPTY_WIZARD = {
  step: 1,         // 1 = candidato, 2 = tipo+categoria, 3 = bollettini, 4 = conferma
  candidato_id: "",
  candidato_label: "",
  candidato_raw: null,  // dati completi per auto-fill
  tipo_pratica: "ESAME",
  categoria: "B",
  stato: "attivo",
  data_richiesta: new Date().toISOString().slice(0, 10),
  codice_autoscuola: "",
  codice_foglio_rosa: "",
  note: "",
  bollettini: [],  // [{ codice, importo, descrizione, data_pagamento }]
  newBollettino: { codice: "", importo: "", descrizione: "", data_pagamento: new Date().toISOString().slice(0,10) },
};

export default function PratichePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [fetchError, setFetchError] = useState("");
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({
    search: "",
    tipo_pratica: "",
    categoria_patente: "TUTTE",
    stato: "",
  });

  // Wizard Nuova Pratica
  const [showWizard, setShowWizard] = useState(false);
  const [wizard, setWizard] = useState(EMPTY_WIZARD);
  const [wizardCandidati, setWizardCandidati] = useState([]);
  const [wizardCandSearch, setWizardCandSearch] = useState("");
  const [wizardBusy, setWizardBusy] = useState(false);
  const [wizardErr, setWizardErr] = useState("");
  const [wizardOk, setWizardOk] = useState("");

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

  const loadPratiche = useCallback(async () => {
    setFetchError("");
    try {
      const res = await fetch(`${API_BASE}/api/candidati-api`, {
        headers: authHeaders(),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setFetchError(e.message || "Errore caricamento pratiche");
    }
  }, []);

  useEffect(() => {
    if (!loading) loadPratiche();
  }, [loading, loadPratiche]);

  // Carica candidati per wizard
  useEffect(() => {
    if (!loading) {
      fetch(`${API_BASE}/api/candidati-api`, { headers: authHeaders() })
        .then((r) => r.json())
        .then((d) => setWizardCandidati(Array.isArray(d) ? d : []))
        .catch(() => {});
    }
  }, [loading]);

  async function salvaWizard() {
    if (!wizard.candidato_id) { setWizardErr("Seleziona un candidato"); return; }
    if (!wizard.tipo_pratica)  { setWizardErr("Seleziona il tipo di pratica"); return; }
    setWizardBusy(true); setWizardErr(""); setWizardOk("");
    try {
      const res = await fetch(`${API_BASE}/api/pratiche`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          candidato_id:       wizard.candidato_id,
          tipo_pratica:       wizard.tipo_pratica,
          categoria:          wizard.categoria,
          categoria_patente:  wizard.categoria,
          stato:              wizard.stato,
          data_richiesta:     wizard.data_richiesta,
          note:               wizard.note,
          codice_autoscuola:  wizard.codice_autoscuola,
          codice_foglio_rosa: wizard.codice_foglio_rosa || undefined,
          bollettini:        wizard.bollettini.length > 0 ? wizard.bollettini : null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      setWizardOk("✅ Pratica creata con successo!");
      setShowWizard(false);
      setWizard(EMPTY_WIZARD);
      setWizardCandSearch("");
      await loadPratiche();
    } catch (e) {
      setWizardErr(e.message || "Errore creazione pratica");
    } finally {
      setWizardBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const search = filters.search.trim().toUpperCase();
    return rows.filter((r) => {
      if (search) {
        const hay = [r.cognome, r.nome, r.codice_fiscale, r.patente_numero]
          .join(" ")
          .toUpperCase();
        if (!hay.includes(search)) return false;
      }
      if (filters.categoria_patente && filters.categoria_patente !== "TUTTE") {
        if (r.categoria_patente !== filters.categoria_patente) return false;
      }
      if (filters.tipo_pratica) {
        if (getTipoPratica(r) !== filters.tipo_pratica) return false;
      }
      if (filters.stato) {
        const st = String(r?.raw_portale?.stato_pratica || r?.stato || "").toLowerCase();
        if (st !== filters.stato) return false;
      }
      return true;
    });
  }, [rows, filters]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-slate-600">Caricamento...</p>
      </div>
    );
  }

  return (
    <ModernAppShell
      title="Pratiche Patente"
      subtitle="Gestione pratiche per tipo — conseguimento, rinnovo, duplicato, certificato medico, CQC"
      activeKey="pratiche"
      onLogout={() => logoutSession().then(() => router.replace("/login"))}
      user={user}
    >
      <div className="flex h-[calc(100vh-120px)] gap-4">
        {/* COLONNA SINISTRA: filtri + tabella */}
        <div className={`flex flex-col ${selected ? "w-1/2" : "w-full"} transition-all duration-200`}>
          <div className="mb-3 flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="Cerca cognome, nome, CF…"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-indigo-400 focus:outline-none w-52"
            />
            <select
              value={filters.tipo_pratica}
              onChange={(e) => setFilters((f) => ({ ...f, tipo_pratica: e.target.value }))}
              className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none"
            >
              {TIPO_PRATICA_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              value={filters.categoria_patente}
              onChange={(e) => setFilters((f) => ({ ...f, categoria_patente: e.target.value }))}
              className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none"
            >
              {PATENTE_FILTER.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            <select
              value={filters.stato}
              onChange={(e) => setFilters((f) => ({ ...f, stato: e.target.value }))}
              className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none"
            >
              {STATO_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              onClick={loadPratiche}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Aggiorna
            </button>
            <button
              onClick={() => {
                setShowWizard(true);
                setWizard({ ...EMPTY_WIZARD, codice_autoscuola: user?.codice_autoscuola || user?.codice || "" });
                setWizardCandSearch("");
                setWizardErr("");
                setWizardOk("");
              }}
              className="h-9 flex items-center rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white shadow hover:bg-emerald-500"
            >
              ➕ Nuova Pratica
            </button>
            <Link
              href="/trasmiss"
              className="h-9 flex items-center rounded-lg bg-violet-600 px-3 text-sm font-semibold text-white hover:bg-violet-700"
            >
              📤 Trasmissioni CED
            </Link>
            <span className="ml-auto flex items-center gap-2 text-sm text-slate-500">
              {/* Punto 12 — Export CSV pratiche */}
              <button
                type="button"
                disabled={filtered.length === 0}
                onClick={() => exportCSV(
                  filtered.map((p) => ({
                    cognome:            p.candidates?.cognome || "",
                    nome:               p.candidates?.nome || "",
                    codice_fiscale:     p.candidates?.codice_fiscale || "",
                    tipo_pratica:       p.tipo_pratica || "",
                    categoria:          p.categoria || p.categoria_patente || "",
                    stato:              p.stato || p.stato_pratica || "",
                    data_richiesta:     p.data_richiesta || "",
                    tipo_trasmissione:  p.tipo_trasmissione || "",
                    codice_foglio_rosa: p.codice_foglio_rosa || p.candidates?.codice_foglio_rosa || "",
                    codice_autoscuola:  p.codice_autoscuola || "",
                    id_richiesta_portale: p.id_richiesta_portale || "",
                    data_trasmissione_portale: p.data_trasmissione_portale || "",
                    note:               p.note || "",
                  })),
                  "pratiche"
                )}
                className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                title="Esporta pratiche filtrate in CSV"
              >
                📥 Export CSV
              </button>
              {filtered.length} pratiche
            </span>
          </div>

          {wizardOk && (
            <div className="mb-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700">
              {wizardOk}
            </div>
          )}

          {fetchError && (
            <div className="mb-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {fetchError}
            </div>
          )}

          <div className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Cognome / Nome</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Cat.</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Tipo Pratica</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Foglio Rosa</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Scadenza FR</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Stato</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      Nessuna pratica trovata
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => {
                    const tipoPratica = getTipoPratica(r);
                    const ppgNum = r?.raw_portale?.ppg_numero || r?.codice_foglio_rosa || "–";
                    const ppgScad = r?.raw_portale?.ppg_data_scadenza || "";
                    const stato = r?.raw_portale?.stato_pratica || r?.stato || "";
                    const isSelected = selected?.id === r.id;
                    return (
                      <tr
                        key={r.id}
                        onClick={() => setSelected(isSelected ? null : r)}
                        className={`cursor-pointer border-b border-slate-100 transition-colors last:border-0 ${
                          isSelected ? "bg-indigo-50" : "hover:bg-slate-50"
                        }`}
                      >
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-800">{r.cognome} {r.nome}</div>
                          <div className="text-xs text-slate-500">{r.codice_fiscale || "–"}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">{r.categoria_patente || "–"}</td>
                        <td className="px-3 py-2">
                          <span className="inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                            {tipoPraticaLabel(tipoPratica)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-700">{ppgNum}</td>
                        <td className={`px-3 py-2 text-sm ${scadenzaColor(ppgScad)}`}>
                          {ppgScad ? formatData(ppgScad) : "–"}
                        </td>
                        <td className="px-3 py-2">
                          {stato ? (
                            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statoChip(stato)}`}>
                              {stato}
                            </span>
                          ) : (
                            <span className="text-slate-400">–</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* COLONNA DESTRA: pannello dettaglio */}
        {selected && (
          <div className="w-1/2 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <DettaglioPratica
              row={selected}
              onClose={() => setSelected(null)}
              onRefresh={() => { loadPratiche(); setSelected(null); }}
            />
          </div>
        )}
      </div>

      {/* ——— WIZARD NUOVA PRATICA ——— */}
      {showWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="font-bold text-slate-800">➕ Nuova Pratica</h2>
                <div className="flex gap-1 mt-1">
                  {[1,2,3,4].map((s) => (
                    <span key={s} className={`h-1.5 w-8 rounded-full ${wizard.step >= s ? "bg-emerald-500" : "bg-slate-200"}`} />
                  ))}
                </div>
              </div>
              <button onClick={() => setShowWizard(false)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {/* STEP 1 — Candidato */}
              {wizard.step === 1 && (
                <div className="space-y-3">
                  <h3 className="font-semibold text-slate-700">1. Seleziona candidato</h3>
                  <input
                    type="text"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm w-full focus:border-indigo-400 focus:outline-none"
                    placeholder="Cerca per cognome, nome, CF, foglio rosa…"
                    value={wizardCandSearch}
                    onChange={(e) => setWizardCandSearch(e.target.value)}
                    autoFocus
                  />
                  {wizardCandSearch.length >= 2 && (
                    <div className="border border-slate-200 rounded-lg bg-white max-h-52 overflow-auto shadow">
                      {wizardCandidati
                        .filter((c) => `${c.cognome} ${c.nome} ${c.codice_fiscale || ""} ${c.codice_foglio_rosa || ""}`.toLowerCase().includes(wizardCandSearch.toLowerCase()))
                        .slice(0, 10)
                        .map((c) => (
                          <button
                            key={c.id}
                            onClick={() => {
                              const cfr = c.codice_foglio_rosa || c.raw_portale?.codice_foglio_rosa || "";
                              setWizard((w) => ({
                                ...w,
                                candidato_id:       c.id,
                                candidato_label:    `${c.cognome} ${c.nome}`,
                                candidato_raw:      c,
                                categoria:          c.categoria_patente || "B",
                                codice_foglio_rosa: cfr,
                                step: 2,
                              }));
                              setWizardCandSearch(`${c.cognome} ${c.nome}`);
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-sky-50 border-b border-slate-100 last:border-0"
                          >
                            <span className="font-medium text-slate-800">{c.cognome} {c.nome}</span>
                            <span className="ml-2 text-xs text-slate-400">{c.codice_fiscale || ""}</span>
                            <span className="ml-2 text-xs text-slate-400">cat. {c.categoria_patente || "–"}</span>
                          </button>
                        ))}
                    </div>
                  )}
                  {wizard.candidato_id && wizard.candidato_raw && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 space-y-1">
                      <p className="text-xs font-semibold text-emerald-800">✅ Candidato selezionato: <strong>{wizard.candidato_label}</strong></p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-slate-600">
                        {wizard.candidato_raw.codice_fiscale && (
                          <><span className="text-slate-400">CF:</span><span className="font-mono">{wizard.candidato_raw.codice_fiscale}</span></>
                        )}
                        {wizard.candidato_raw.data_nascita && (
                          <><span className="text-slate-400">Nascita:</span><span>{wizard.candidato_raw.data_nascita}</span></>
                        )}
                        {wizard.candidato_raw.categoria_patente && (
                          <><span className="text-slate-400">Categoria:</span><span className="font-semibold">{wizard.candidato_raw.categoria_patente}</span></>
                        )}
                        {wizard.codice_foglio_rosa && (
                          <><span className="text-slate-400">Foglio Rosa:</span><span className="font-mono text-violet-700">{wizard.codice_foglio_rosa}</span></>
                        )}
                        {(wizard.candidato_raw.telefono_1 || wizard.candidato_raw.telefono) && (
                          <><span className="text-slate-400">Tel:</span><span>{wizard.candidato_raw.telefono_1 || wizard.candidato_raw.telefono}</span></>
                        )}
                        {wizard.candidato_raw.indirizzo && (
                          <><span className="text-slate-400">Indirizzo:</span><span>{wizard.candidato_raw.indirizzo}</span></>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* STEP 2 — Tipo pratica + categoria */}
              {wizard.step === 2 && (
                <div className="space-y-3">
                  <h3 className="font-semibold text-slate-700">2. Tipo pratica e categoria</h3>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Tipo pratica *</label>
                    <select
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm w-full focus:border-indigo-400 focus:outline-none"
                      value={wizard.tipo_pratica}
                      onChange={(e) => setWizard((w) => ({ ...w, tipo_pratica: e.target.value }))}
                    >
                      {WIZARD_TIPO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Categoria patente</label>
                    <div className="flex flex-wrap gap-1.5">
                      {CATEGORIE_PATENTE.map((cat) => (
                        <button
                          key={cat}
                          onClick={() => setWizard((w) => ({ ...w, categoria: cat }))}
                          className={`rounded-lg px-3 py-1 text-xs font-semibold border transition ${wizard.categoria === cat ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"}`}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Data richiesta</label>
                      <input type="date" className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm w-full"
                        value={wizard.data_richiesta}
                        onChange={(e) => setWizard((w) => ({ ...w, data_richiesta: e.target.value }))} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Stato</label>
                      <select className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm w-full"
                        value={wizard.stato}
                        onChange={(e) => setWizard((w) => ({ ...w, stato: e.target.value }))}>
                        <option value="attivo">Attivo</option>
                        <option value="da_trasmettere">Da trasmettere</option>
                        <option value="pronto_trasmissione">Pronto trasmissione</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Codice autoscuola</label>
                    <input type="text" className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm w-full"
                      value={wizard.codice_autoscuola}
                      onChange={(e) => setWizard((w) => ({ ...w, codice_autoscuola: e.target.value }))}
                      placeholder="es. RM1234" />
                  </div>
                </div>
              )}

              {/* STEP 3 — Bollettini */}
              {wizard.step === 3 && (
                <div className="space-y-3">
                  <h3 className="font-semibold text-slate-700">3. Bollettini di pagamento</h3>

                  {/* Preimpostazioni rapide */}
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase mb-1">Aggiungi rapido</p>
                    <div className="flex flex-wrap gap-1.5">
                      {BOLLETTINO_PRESET.map((b) => (
                        <button
                          key={b.codice}
                          onClick={() => setWizard((w) => ({
                            ...w,
                            bollettini: [...w.bollettini, { ...b, data_pagamento: new Date().toISOString().slice(0,10) }],
                          }))}
                          className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-100"
                        >
                          + {b.codice} (€{b.importo})
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Form bollettino manuale */}
                  <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                    <p className="text-xs font-semibold text-slate-600">Aggiungi bollettino manuale</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-0.5">Codice</label>
                        <input type="text" className="rounded border border-slate-300 bg-white px-2 py-1 text-xs w-full"
                          value={wizard.newBollettino.codice}
                          onChange={(e) => setWizard((w) => ({ ...w, newBollettino: { ...w.newBollettino, codice: e.target.value } }))}
                          placeholder="es. 9001" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-0.5">Importo €</label>
                        <input type="number" step="0.01" className="rounded border border-slate-300 bg-white px-2 py-1 text-xs w-full"
                          value={wizard.newBollettino.importo}
                          onChange={(e) => setWizard((w) => ({ ...w, newBollettino: { ...w.newBollettino, importo: e.target.value } }))}
                          placeholder="16.00" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-0.5">Descrizione</label>
                        <input type="text" className="rounded border border-slate-300 bg-white px-2 py-1 text-xs w-full"
                          value={wizard.newBollettino.descrizione}
                          onChange={(e) => setWizard((w) => ({ ...w, newBollettino: { ...w.newBollettino, descrizione: e.target.value } }))}
                          placeholder="es. Contrassegno" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-0.5">Data pagamento</label>
                        <input type="date" className="rounded border border-slate-300 bg-white px-2 py-1 text-xs w-full"
                          value={wizard.newBollettino.data_pagamento}
                          onChange={(e) => setWizard((w) => ({ ...w, newBollettino: { ...w.newBollettino, data_pagamento: e.target.value } }))} />
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        if (!wizard.newBollettino.codice || !wizard.newBollettino.importo) return;
                        setWizard((w) => ({
                          ...w,
                          bollettini: [...w.bollettini, { ...w.newBollettino }],
                          newBollettino: { codice: "", importo: "", descrizione: "", data_pagamento: new Date().toISOString().slice(0,10) },
                        }));
                      }}
                      className="rounded-lg bg-slate-600 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-500"
                    >
                      ➕ Aggiungi
                    </button>
                  </div>

                  {/* Lista bollettini aggiunti */}
                  {wizard.bollettini.length > 0 ? (
                    <div className="space-y-1">
                      {wizard.bollettini.map((b, i) => (
                        <div key={i} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5 text-xs">
                          <span className="font-mono font-semibold text-slate-700">{b.codice}</span>
                          <span className="text-slate-600">{b.descrizione || "–"}</span>
                          <span className="font-semibold text-emerald-700">€{b.importo}</span>
                          <span className="text-slate-400">{b.data_pagamento}</span>
                          <button onClick={() => setWizard((w) => ({ ...w, bollettini: w.bollettini.filter((_, j) => j !== i) }))}
                            className="text-red-500 hover:text-red-700 ml-2">✕</button>
                        </div>
                      ))}
                      <p className="text-xs text-slate-500 text-right">
                        Totale: <strong className="text-emerald-700">
                          €{wizard.bollettini.reduce((s, b) => s + parseFloat(b.importo || 0), 0).toFixed(2)}
                        </strong>
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 italic">Nessun bollettino aggiunto (opzionale)</p>
                  )}
                </div>
              )}

              {/* STEP 4 — Riepilogo + conferma */}
              {wizard.step === 4 && (
                <div className="space-y-3">
                  <h3 className="font-semibold text-slate-700">4. Riepilogo e conferma</h3>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-sm">
                    {[
                      ["Candidato", wizard.candidato_label],
                      ["Tipo pratica", WIZARD_TIPO_OPTIONS.find((o) => o.value === wizard.tipo_pratica)?.label || wizard.tipo_pratica],
                      ["Categoria", wizard.categoria],
                      ["Data richiesta", wizard.data_richiesta],
                      ["Stato", wizard.stato],
                      ["Codice autoscuola", wizard.codice_autoscuola || "–"],
                      ...(wizard.codice_foglio_rosa ? [["Foglio Rosa (auto-fill)", wizard.codice_foglio_rosa]] : []),
                      ["Bollettini", wizard.bollettini.length > 0 ? `${wizard.bollettini.length} bollettino/i (€${wizard.bollettini.reduce((s,b) => s+parseFloat(b.importo||0),0).toFixed(2)})` : "Nessuno"],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between border-b border-slate-200 pb-1 last:border-0 last:pb-0">
                        <span className="text-slate-500">{k}</span>
                        <span className="font-medium text-slate-800">{v}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Note aggiuntive</label>
                    <textarea
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm w-full h-16 resize-none focus:outline-none focus:border-indigo-400"
                      value={wizard.note}
                      onChange={(e) => setWizard((w) => ({ ...w, note: e.target.value }))}
                      placeholder="Note opzionali…"
                    />
                  </div>
                  {wizardErr && <p className="text-sm text-red-600">❌ {wizardErr}</p>}
                </div>
              )}
            </div>

            {/* Footer nav */}
            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
              <button
                onClick={() => {
                  if (wizard.step === 1) setShowWizard(false);
                  else setWizard((w) => ({ ...w, step: w.step - 1 }));
                }}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                {wizard.step === 1 ? "Annulla" : "← Indietro"}
              </button>
              {wizard.step < 4 ? (
                <button
                  onClick={() => {
                    if (wizard.step === 1 && !wizard.candidato_id) { setWizardErr("Seleziona un candidato"); return; }
                    setWizardErr("");
                    setWizard((w) => ({ ...w, step: w.step + 1 }));
                  }}
                  className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
                >
                  Avanti →
                </button>
              ) : (
                <button
                  onClick={salvaWizard}
                  disabled={wizardBusy}
                  className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {wizardBusy ? "Salvo…" : "✅ Crea Pratica"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {/* ——— END WIZARD ——— */}
    </ModernAppShell>
  );
}

// ---------------------------------------------------------------------------
// Pannello dettaglio pratica
// ---------------------------------------------------------------------------

function DettaglioPratica({ row, onClose, onRefresh }) {
  const anagrafica = row?.raw_portale?.anagrafica || {};
  const tipoPratica = getTipoPratica(row);

  // Stato azioni portale
  const [portaleStatus, setPortaleStatus] = useState("");
  const [portaleError, setPortaleError] = useState("");
  const [portaleBusy, setPortaleBusy] = useState("");

  async function callPortale(endpoint, body) {
    setPortaleStatus("");
    setPortaleError("");
    setPortaleBusy(endpoint);
    try {
      const res = await fetch(`${API_BASE}/api/portal/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Errore portale");
      setPortaleStatus(data.messaggio || "Operazione completata sul portale.");
    } catch (e) {
      setPortaleError(e.message || "Errore connessione portale");
    } finally {
      setPortaleBusy("");
    }
  }

  function onStampaFoglioRosa() {
    const token = row?.raw_portale?.ppg_token || "";
    callPortale("foglio-rosa", { token, ristampa: false });
  }

  function onRistampaFoglioRosa() {
    const token = row?.raw_portale?.ppg_token || "";
    callPortale("foglio-rosa", { token, ristampa: true });
  }

  function onVerificaRinnovo() {
    const numeroPatente = anagrafica.numero_patente_posseduta || "";
    if (!numeroPatente) {
      setPortaleError("Numero patente non disponibile per questo candidato.");
      return;
    }
    callPortale("rinnovo-patente", { numero_patente: numeroPatente, codice_motivo: "R" });
  }

  function onCercaPatente() {
    const cognome = row.cognome || "";
    const numeroPatente = anagrafica.numero_patente_posseduta || "";
    if (!cognome || !numeroPatente) {
      setPortaleError("Cognome o numero patente non disponibili.");
      return;
    }
    callPortale("cerca-candidato-patente", { cognome, numero_patente: numeroPatente });
  }

  const fields = [
    { label: "Cognome", value: row.cognome },
    { label: "Nome", value: row.nome },
    { label: "Codice Fiscale", value: row.codice_fiscale },
    { label: "Categoria patente", value: row.categoria_patente },
    { label: "Tipo pratica", value: tipoPraticaLabel(tipoPratica) },
    { label: "Tipo iscrizione", value: anagrafica.stato_richiesta || row.stato },
    { label: "Data iscrizione", value: formatData(anagrafica.data_iscrizione || row.created_at) },
    { label: "Numero registro", value: anagrafica.numero_registro },
    { label: "Data registro", value: formatData(anagrafica.data_registro) },
    { label: "Codice autoscuola", value: anagrafica.codice_autoscuola || row.codice_autoscuola },
  ];

  const contatti = [
    { label: "Telefono", value: anagrafica.telefono_1 || row.telefono },
    { label: "Email", value: anagrafica.email_contatto || row.email },
    { label: "Data nascita", value: formatData(anagrafica.data_nascita || row.data_nascita) },
    { label: "Comune nascita", value: anagrafica.comune_nascita },
    { label: "Residenza", value: [anagrafica.indirizzo_residenza, anagrafica.numero_civico, anagrafica.comune_residenza, anagrafica.prov_residenza].filter(Boolean).join(", ") },
  ];

  const ppg = [
    { label: "Numero foglio rosa", value: row?.raw_portale?.ppg_numero || row.codice_foglio_rosa },
    { label: "Emissione foglio rosa", value: formatData(row?.raw_portale?.ppg_data_emissione) },
    { label: "Scadenza foglio rosa", value: formatData(row?.raw_portale?.ppg_data_scadenza), color: scadenzaColor(row?.raw_portale?.ppg_data_scadenza) },
    { label: "Presenze A2/A", value: row?.raw_portale?.presenze_a2_a },
  ];

  const documento = [
    { label: "Tipo documento", value: anagrafica.tipo_documento },
    { label: "Numero documento", value: anagrafica.numero_documento },
    { label: "Rilasciato da", value: anagrafica.ente_rilascio_documento },
    { label: "Rilasciato il", value: formatData(anagrafica.rilasciato_il_documento) },
    { label: "Scade il", value: formatData(anagrafica.scade_il_documento) },
  ];

  const patentePoss = [
    { label: "Patente posseduta n°", value: anagrafica.numero_patente_posseduta },
    { label: "Ente rilascio", value: anagrafica.ente_rilascio_patente },
    { label: "Rilasciata il", value: formatData(anagrafica.rilasciata_il_patente) },
    { label: "Scade il", value: formatData(anagrafica.scade_il_patente) },
  ];

  return (
    <div className="p-4">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-800">
            {row.cognome} {row.nome}
          </h2>
          <p className="text-sm text-slate-500">
            {row.codice_fiscale} · cat. {row.categoria_patente}
          </p>
          <span className="mt-1 inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
            {tipoPraticaLabel(tipoPratica)}
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg border border-slate-200 px-3 py-1 text-sm text-slate-500 hover:bg-slate-50"
        >
          ✕ Chiudi
        </button>
      </div>

      {/* Sezioni dati */}
      <Section title="Dati pratica" fields={fields} />
      <Section title="Foglio Rosa / PPG" fields={ppg} />
      <Section title="Contatti e anagrafica" fields={contatti} />
      <Section title="Documento identità" fields={documento} />
      <Section title="Patente posseduta" fields={patentePoss} />

      {/* Note */}
      {row?.raw_portale?.note && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="mb-1 text-xs font-semibold text-slate-500 uppercase tracking-wide">Note</p>
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{row.raw_portale.note}</p>
        </div>
      )}

      {/* ================================================================
          AZIONI PORTALE — replica GeCA (richiede portale 08:00-21:00)
          ================================================================ */}
      <div className="mt-5 rounded-lg border border-violet-200 bg-violet-50 p-3">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-violet-700">
          Azioni Portale dell&apos;Automobilista
        </p>
        <p className="mb-3 text-xs text-violet-600">
          Disponibile 08:00–21:00 · Usa le credenziali configurate in .env
        </p>

        <div className="flex flex-wrap gap-2">
          {/* Foglio Rosa - Stampa */}
          <button
            type="button"
            disabled={!!portaleBusy}
            onClick={onStampaFoglioRosa}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            title="Replica GeCA: STAMPAFRPATA() — stampa foglio rosa"
          >
            {portaleBusy === "foglio-rosa" ? "..." : "🖨 Stampa Foglio Rosa"}
          </button>

          {/* Foglio Rosa - Ristampa */}
          <button
            type="button"
            disabled={!!portaleBusy}
            onClick={onRistampaFoglioRosa}
            className="rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50"
            title="Replica GeCA: STAMPAFRPATA(ristampa) — ristampa foglio rosa"
          >
            {portaleBusy === "foglio-rosa" ? "..." : "🔄 Ristampa Foglio Rosa"}
          </button>

          {/* Verifica Rinnovo */}
          {(tipoPratica === "RINNOVO" || tipoPratica === "ESAME") && (
            <button
              type="button"
              disabled={!!portaleBusy}
              onClick={onVerificaRinnovo}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              title="Replica GeCA: verrinnovab() — verifica rinnovabilità patente"
            >
              {portaleBusy === "rinnovo-patente" ? "..." : "🔍 Verifica Rinnovo"}
            </button>
          )}

          {/* Cerca sul portale */}
          <button
            type="button"
            disabled={!!portaleBusy}
            onClick={onCercaPatente}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            title="Replica GeCA: recupera() — cerca candidato per cognome + patente"
          >
            {portaleBusy === "cerca-candidato-patente" ? "..." : "🔎 Cerca sul Portale"}
          </button>
        </div>

        {/* Feedback azioni portale */}
        {portaleStatus && (
          <p className="mt-2 rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-800">
            ✅ {portaleStatus}
          </p>
        )}
        {portaleError && (
          <p className="mt-2 rounded bg-red-100 px-2 py-1 text-xs text-red-700">
            ❌ {portaleError}
          </p>
        )}
      </div>

      {/* Azioni navigazione */}
      <div className="mt-4 flex gap-2">
        <a
          href={`/anagrafica-iscrizioni?id=${row.id}`}
          className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
        >
          Apri in Anagrafica
        </a>
        <button
          onClick={onClose}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          Chiudi
        </button>
      </div>
    </div>
  );
}

function Section({ title, fields }) {
  const hasValues = fields.some((f) => f.value);
  if (!hasValues) return null;
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      <div className="rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            {fields.map(({ label, value, color }) =>
              value ? (
                <tr key={label} className="border-b border-slate-100 last:border-0">
                  <td className="w-40 px-3 py-1.5 text-slate-500">{label}</td>
                  <td className={`px-3 py-1.5 font-medium ${color || "text-slate-800"}`}>{value}</td>
                </tr>
              ) : null
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
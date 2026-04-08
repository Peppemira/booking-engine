"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  API_BASE,
  authHeaders,
  checkSession,
  logoutSession,
} from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";
import { formatData, PATENTE_RICHIESTA_OPTIONS } from "../../lib/candidatoEditor";

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const TIPO_CORSO_OPTIONS = [
  { value: "CQC", label: "CQC — Carta Qualificazione Conducente" },
  { value: "CQC_CARD", label: "CQC Card" },
  { value: "ADR", label: "ADR — Merci Pericolose" },
  { value: "RECUPERO_PUNTI", label: "Recupero Punti Patente" },
  { value: "ALTRO", label: "Altro corso" },
];

const TIPO_CORSO_FILTER = [{ value: "", label: "Tutti i corsi" }, ...TIPO_CORSO_OPTIONS];

const STATO_CORSO_OPTIONS = [
  { value: "in_corso", label: "In corso" },
  { value: "completato", label: "Completato" },
  { value: "sospeso", label: "Sospeso" },
  { value: "annullato", label: "Annullato" },
];

const ESITO_CORSO_OPTIONS = [
  { value: "", label: "– (non definito)" },
  { value: "idoneo", label: "Idoneo" },
  { value: "non_idoneo", label: "Non idoneo" },
];

const EMPTY_CORSO = {
  tipo_corso: "CQC",
  data_inizio: "",
  data_fine: "",
  ente_organizzatore: "",
  sede_corso: "",
  ore_totali: "",
  ore_frequentate: "",
  stato: "in_corso",
  esito: "",
  note: "",
};

const EMPTY_PRESENZA = {
  data_lezione: new Date().toISOString().slice(0, 10),
  ora_inizio: "",
  ora_fine: "",
  argomento: "",
  docente: "",
  ore: "",
  presente: true,
  note: "",
};

// Categorie patente associate a CQC
const CATEGORIE_CQC = new Set(["C", "CE", "C1", "C1E", "D", "DE", "D1", "D1E"]);

const PATENTE_FILTER = ["TUTTE", ...PATENTE_RICHIESTA_OPTIONS];

function getTipoCorso(r) {
  const raw = String(r?.raw_portale?.tipo_corso || r?.raw_portale?.anagrafica?.stato_richiesta || r?.stato || "").toUpperCase();
  if (raw.includes("RECUPERO") || raw.includes("RP")) return "RECUPERO_PUNTI";
  if (raw.includes("ADR") || raw.includes("CAP")) return "ADR";
  if (raw.includes("CQC CARD") || raw.includes("CQC_CARD")) return "CQC_CARD";
  if (raw.includes("CQC") || raw.includes("C.Q.C")) return "CQC";
  if (r?.raw_portale?.cqc || CATEGORIE_CQC.has(r?.categoria_patente)) return "CQC";
  if (raw) return "ALTRO";
  return "";
}

function tipoCorsoLabel(tipo) {
  return TIPO_CORSO_OPTIONS.find((o) => o.value === tipo)?.label?.split(" — ")[0] || tipo || "–";
}

function tipoCorsoChip(tipo) {
  const map = {
    CQC: "bg-violet-100 text-violet-800",
    CQC_CARD: "bg-purple-100 text-purple-800",
    ADR: "bg-orange-100 text-orange-800",
    RECUPERO_PUNTI: "bg-amber-100 text-amber-800",
    ALTRO: "bg-slate-100 text-slate-700",
  };
  return map[tipo] || "bg-slate-100 text-slate-700";
}

function statoCorsoChip(stato) {
  const map = {
    in_corso: "bg-emerald-100 text-emerald-800",
    completato: "bg-blue-100 text-blue-800",
    sospeso: "bg-amber-100 text-amber-800",
    annullato: "bg-red-100 text-red-800",
  };
  return map[stato] || "bg-slate-100 text-slate-700";
}

function scadenzaColor(dateStr) {
  if (!dateStr) return "";
  const diffDays = (new Date(dateStr) - new Date()) / 86400000;
  if (diffDays < 0) return "text-red-600 font-semibold";
  if (diffDays < 30) return "text-amber-600 font-semibold";
  return "text-slate-700";
}

// ---------------------------------------------------------------------------
// Componente principale
// ---------------------------------------------------------------------------

export default function CorsiPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [fetchError, setFetchError] = useState("");
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({
    search: "",
    tipo_corso: "",
    categoria_patente: "TUTTE",
  });

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

  const loadCandidati = useCallback(async () => {
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
      setFetchError(e.message || "Errore caricamento candidati");
    }
  }, []);

  useEffect(() => {
    if (!loading) loadCandidati();
  }, [loading, loadCandidati]);

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
      if (filters.tipo_corso) {
        if (getTipoCorso(r) !== filters.tipo_corso) return false;
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
      title="Corsi"
      subtitle="Gestione corsi ADR, CQC, recupero punti patente — GeCorsi, presenze, aule"
      activeKey="corsi"
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
              value={filters.tipo_corso}
              onChange={(e) => setFilters((f) => ({ ...f, tipo_corso: e.target.value }))}
              className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none"
            >
              {TIPO_CORSO_FILTER.map((o) => (
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
            <button
              onClick={loadCandidati}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Aggiorna
            </button>
            <span className="ml-auto flex items-center text-sm text-slate-500">
              {filtered.length} candidati
            </span>
          </div>

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
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Tipo corso</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Patente n°</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Scadenza CQC</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Stato</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      Nessun candidato trovato
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => {
                    const tipoCorso = getTipoCorso(r);
                    const scadCqc = r?.raw_portale?.cqc?.data_scadenza || r?.raw_portale?.scadenza_cqc || "";
                    const stato = r?.raw_portale?.stato || r?.stato || "";
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
                          {tipoCorso ? (
                            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tipoCorsoChip(tipoCorso)}`}>
                              {tipoCorsoLabel(tipoCorso)}
                            </span>
                          ) : (
                            <span className="text-slate-400">–</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-700">{r.patente_numero || "–"}</td>
                        <td className={`px-3 py-2 text-sm ${scadenzaColor(scadCqc)}`}>
                          {scadCqc ? formatData(scadCqc) : "–"}
                        </td>
                        <td className="px-3 py-2">
                          {stato ? (
                            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statoCorsoChip(stato)}`}>
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
            <DettaglioCorso
              row={selected}
              onClose={() => setSelected(null)}
            />
          </div>
        )}
      </div>
    </ModernAppShell>
  );
}

// ---------------------------------------------------------------------------
// Pannello dettaglio corso — GeCorsi, PRESENZECORSI, auleLezioni
// ---------------------------------------------------------------------------

function DettaglioCorso({ row, onClose }) {
  const [activeTab, setActiveTab] = useState("iscrizioni");

  // ---- STATO ISCRIZIONI (corsi_sessions) ----
  const [corsi, setCorsi] = useState([]);
  const [conteggio, setConteggio] = useState(null);
  const [corsiBusy, setCorsiBusy] = useState(false);
  const [corsiErr, setCorsiErr] = useState("");
  const [showCorsoForm, setShowCorsoForm] = useState(false);
  const [corsoForm, setCorsoForm] = useState(EMPTY_CORSO);
  const [corsoBusy, setCorsoBusy] = useState(false);
  const [corsoErr, setCorsoErr] = useState("");
  const [corsoOk, setCorsoOk] = useState("");
  const [editCorsoId, setEditCorsoId] = useState(null);

  // ---- STATO PRESENZE ----
  const [selectedCorsoId, setSelectedCorsoId] = useState(null);
  const [presenze, setPresenze] = useState([]);
  const [presenzeBusy, setPresenzeBusy] = useState(false);
  const [presenzeErr, setPresenzeErr] = useState("");
  const [showPresenzaForm, setShowPresenzaForm] = useState(false);
  const [presenzaForm, setPresenzaForm] = useState(EMPTY_PRESENZA);
  const [presenzaFormBusy, setPresenzaFormBusy] = useState(false);
  const [presenzaFormErr, setPresenzaFormErr] = useState("");
  const [presenzaFormOk, setPresenzaFormOk] = useState("");
  const [editPresenzaId, setEditPresenzaId] = useState(null);

  // ---- STATO CQC PORTALE ----
  const [cqcResult, setCqcResult] = useState(null);
  const [cqcBusy, setCqcBusy] = useState(false);
  const [cqcError, setCqcError] = useState("");

  function getBase() {
    if (typeof window === "undefined") return "http://localhost:3000";
    const saved = localStorage.getItem("autoscuola_api_base");
    if (saved) return saved.trim();
    const h = window.location.hostname;
    return `${window.location.protocol}//${h}:3000`;
  }

  function authH() {
    try {
      const tok = typeof window !== "undefined" ? localStorage.getItem("autoscuola_token") : null;
      return tok ? { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
    } catch { return { "Content-Type": "application/json" }; }
  }

  function fmtData(v) {
    const s = String(v || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return v || "–";
    return new Date(s + "T00:00:00Z").toLocaleDateString("it-IT");
  }

  // === LOAD ISCRIZIONI ===
  const loadCorsi = useCallback(async () => {
    setCorsiBusy(true); setCorsiErr("");
    try {
      const base = getBase();
      const [corsiRes, cntRes] = await Promise.all([
        fetch(`${base}/api/corsi?candidate_id=${row.id}`, { headers: authH() }),
        fetch(`${base}/api/corsi/conteggio?candidate_id=${row.id}`, { headers: authH() }),
      ]);
      if (corsiRes.ok) {
        const d = await corsiRes.json();
        setCorsi(Array.isArray(d?.data) ? d.data : Array.isArray(d) ? d : []);
      }
      if (cntRes.ok) setConteggio(await cntRes.json());
    } catch (e) {
      setCorsiErr(e.message || "Errore caricamento corsi");
    } finally {
      setCorsiBusy(false);
    }
  }, [row.id]);

  useEffect(() => { loadCorsi(); }, [loadCorsi]);

  // === SALVA ISCRIZIONE ===
  async function salvaCorso() {
    if (!corsoForm.tipo_corso) { setCorsoErr("Tipo corso obbligatorio"); return; }
    setCorsoBusy(true); setCorsoErr(""); setCorsoOk("");
    try {
      const base = getBase();
      const payload = {
        ...corsoForm,
        candidate_id: row.id,
        ore_totali: corsoForm.ore_totali ? parseFloat(corsoForm.ore_totali) : null,
        ore_frequentate: corsoForm.ore_frequentate ? parseFloat(corsoForm.ore_frequentate) : null,
        esito: corsoForm.esito || null,
      };
      const url = editCorsoId ? `${base}/api/corsi/${editCorsoId}` : `${base}/api/corsi`;
      const method = editCorsoId ? "PUT" : "POST";
      const res = await fetch(url, { method, headers: authH(), body: JSON.stringify(payload) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || `HTTP ${res.status}`); }
      setCorsoOk("✅ Corso salvato");
      setShowCorsoForm(false);
      setEditCorsoId(null);
      setCorsoForm(EMPTY_CORSO);
      await loadCorsi();
    } catch (e) {
      setCorsoErr(e.message || "Errore salvataggio corso");
    } finally {
      setCorsoBusy(false);
    }
  }

  async function eliminaCorso(id) {
    if (!window.confirm("Eliminare questo corso e tutte le sue presenze?")) return;
    const base = getBase();
    await fetch(`${base}/api/corsi/${id}`, { method: "DELETE", headers: authH() });
    if (selectedCorsoId === id) { setSelectedCorsoId(null); setPresenze([]); }
    await loadCorsi();
  }

  function apriModificaCorso(c) {
    setCorsoForm({
      tipo_corso: c.tipo_corso || "CQC",
      data_inizio: c.data_inizio || "",
      data_fine: c.data_fine || "",
      ente_organizzatore: c.ente_organizzatore || "",
      sede_corso: c.sede_corso || "",
      ore_totali: c.ore_totali != null ? String(c.ore_totali) : "",
      ore_frequentate: c.ore_frequentate != null ? String(c.ore_frequentate) : "",
      stato: c.stato || "in_corso",
      esito: c.esito || "",
      note: c.note || "",
    });
    setEditCorsoId(c.id);
    setShowCorsoForm(true);
    setCorsoErr(""); setCorsoOk("");
  }

  // === LOAD PRESENZE ===
  const loadPresenze = useCallback(async (corsiSessionId) => {
    if (!corsiSessionId) return;
    setPresenzeBusy(true); setPresenzeErr("");
    try {
      const base = getBase();
      const res = await fetch(`${base}/api/corsi/${corsiSessionId}/presenze`, { headers: authH() });
      if (res.ok) {
        const d = await res.json();
        setPresenze(Array.isArray(d?.data) ? d.data : []);
      }
    } catch (e) {
      setPresenzeErr(e.message || "Errore caricamento presenze");
    } finally {
      setPresenzeBusy(false);
    }
  }, []);

  useEffect(() => {
    if (selectedCorsoId) loadPresenze(selectedCorsoId);
  }, [selectedCorsoId, loadPresenze]);

  // === SALVA PRESENZA ===
  async function salvaPresenza() {
    if (!presenzaForm.data_lezione) { setPresenzaFormErr("Data lezione obbligatoria"); return; }
    setPresenzaFormBusy(true); setPresenzaFormErr(""); setPresenzaFormOk("");
    try {
      const base = getBase();
      const payload = {
        ...presenzaForm,
        ore: presenzaForm.ore ? parseFloat(presenzaForm.ore) : null,
        presente: Boolean(presenzaForm.presente),
      };
      const url = editPresenzaId
        ? `${base}/api/corsi/${selectedCorsoId}/presenze/${editPresenzaId}`
        : `${base}/api/corsi/${selectedCorsoId}/presenze`;
      const method = editPresenzaId ? "PUT" : "POST";
      const res = await fetch(url, { method, headers: authH(), body: JSON.stringify(payload) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || `HTTP ${res.status}`); }
      setPresenzaFormOk("✅ Presenza salvata");
      setShowPresenzaForm(false);
      setEditPresenzaId(null);
      setPresenzaForm(EMPTY_PRESENZA);
      await loadPresenze(selectedCorsoId);
    } catch (e) {
      setPresenzaFormErr(e.message || "Errore salvataggio presenza");
    } finally {
      setPresenzaFormBusy(false);
    }
  }

  async function eliminaPresenza(id) {
    if (!window.confirm("Eliminare questa presenza?")) return;
    const base = getBase();
    await fetch(`${base}/api/corsi/${selectedCorsoId}/presenze/${id}`, { method: "DELETE", headers: authH() });
    await loadPresenze(selectedCorsoId);
  }

  // === CQC PORTALE ===
  async function handleCercaCQC() {
    if (!row.codice_fiscale) { setCqcError("Codice fiscale mancante."); return; }
    setCqcBusy(true); setCqcError(""); setCqcResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/portal/cerca-cqc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ codice_fiscale: row.codice_fiscale, patente_italiana: row.patente_numero || "" }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Errore portale");
      setCqcResult(data);
    } catch (e) {
      setCqcError(e.message || "Errore connessione portale");
    } finally {
      setCqcBusy(false);
    }
  }

  const inp = "rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 w-full";
  const lbl = "block text-[10px] font-semibold text-slate-500 uppercase mb-0.5";

  const corsoSelezionato = corsi.find((c) => c.id === selectedCorsoId);
  const oreFreqTot = presenze.filter((p) => p.presente).reduce((s, p) => s + parseFloat(p.ore || 0), 0);

  return (
    <div className="p-4">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-800">{row.cognome} {row.nome}</h2>
          <p className="text-xs text-slate-500">{row.codice_fiscale} · cat. {row.categoria_patente} · {row.patente_numero || "–"}</p>
        </div>
        <button onClick={onClose} className="rounded border border-slate-200 p-1 text-slate-400 hover:bg-slate-50 text-sm">✕</button>
      </div>

      {/* KPI corsi */}
      {conteggio && (
        <div className="mb-3 grid grid-cols-4 gap-2">
          {[
            { label: "Totale", value: conteggio.totale ?? 0, color: "bg-violet-50 text-violet-700 border-violet-200" },
            { label: "In corso", value: conteggio.in_corso ?? 0, color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
            { label: "Completati", value: conteggio.completati ?? 0, color: "bg-blue-50 text-blue-700 border-blue-200" },
            { label: "Ore freq.", value: conteggio.ore_frequentate ? `${conteggio.ore_frequentate}h` : "–", color: "bg-slate-50 text-slate-700 border-slate-200" },
          ].map((k) => (
            <div key={k.label} className={`rounded-lg border p-2 ${k.color}`}>
              <p className="text-[10px] font-semibold uppercase">{k.label}</p>
              <p className="text-lg font-bold">{k.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 mb-3">
        {[
          { k: "iscrizioni", l: "📚 Iscrizioni" },
          { k: "presenze", l: "✅ Presenze" },
          { k: "cqc", l: "🔍 CQC Portale" },
          { k: "dati", l: "👤 Anagrafica" },
        ].map((t) => (
          <button key={t.k} onClick={() => setActiveTab(t.k)}
            className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${activeTab === t.k ? "bg-violet-600 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}>
            {t.l}
          </button>
        ))}
      </div>

      {/* ================================================================
          TAB: ISCRIZIONI CORSI
      ================================================================ */}
      {activeTab === "iscrizioni" && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-slate-500">{corsiBusy ? "Caricamento…" : `${corsi.length} iscrizione/i registrata/e`}</p>
            <button
              onClick={() => { setEditCorsoId(null); setCorsoForm(EMPTY_CORSO); setCorsoErr(""); setCorsoOk(""); setShowCorsoForm(true); }}
              className="rounded-lg bg-violet-600 px-2 py-1 text-xs font-semibold text-white hover:bg-violet-500">
              ➕ Nuova iscrizione
            </button>
          </div>
          {corsiErr && <p className="text-xs text-red-600 mb-2">❌ {corsiErr}</p>}
          {corsoOk && <p className="text-xs text-emerald-600 mb-2">{corsoOk}</p>}

          {/* FORM CORSO */}
          {showCorsoForm && (
            <div className="mb-3 rounded-lg border border-violet-200 bg-violet-50 p-3 space-y-2">
              <h3 className="text-sm font-semibold text-violet-900">{editCorsoId ? "Modifica iscrizione corso" : "Nuova iscrizione corso"}</h3>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={lbl}>Tipo corso *</label>
                  <select className={inp} value={corsoForm.tipo_corso} onChange={(e) => setCorsoForm((p) => ({ ...p, tipo_corso: e.target.value }))}>
                    {TIPO_CORSO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Stato</label>
                  <select className={inp} value={corsoForm.stato} onChange={(e) => setCorsoForm((p) => ({ ...p, stato: e.target.value }))}>
                    {STATO_CORSO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Data inizio</label>
                  <input type="date" className={inp} value={corsoForm.data_inizio} onChange={(e) => setCorsoForm((p) => ({ ...p, data_inizio: e.target.value }))} />
                </div>
                <div>
                  <label className={lbl}>Data fine</label>
                  <input type="date" className={inp} value={corsoForm.data_fine} onChange={(e) => setCorsoForm((p) => ({ ...p, data_fine: e.target.value }))} />
                </div>
                <div>
                  <label className={lbl}>Ore totali</label>
                  <input type="number" step="0.5" min="0" className={inp} value={corsoForm.ore_totali} onChange={(e) => setCorsoForm((p) => ({ ...p, ore_totali: e.target.value }))} placeholder="es. 35" />
                </div>
                <div>
                  <label className={lbl}>Ore frequentate</label>
                  <input type="number" step="0.5" min="0" className={inp} value={corsoForm.ore_frequentate} onChange={(e) => setCorsoForm((p) => ({ ...p, ore_frequentate: e.target.value }))} placeholder="es. 28" />
                </div>
                <div>
                  <label className={lbl}>Ente organizzatore</label>
                  <input type="text" className={inp} value={corsoForm.ente_organizzatore} onChange={(e) => setCorsoForm((p) => ({ ...p, ente_organizzatore: e.target.value }))} placeholder="Nome ente" />
                </div>
                <div>
                  <label className={lbl}>Sede corso</label>
                  <input type="text" className={inp} value={corsoForm.sede_corso} onChange={(e) => setCorsoForm((p) => ({ ...p, sede_corso: e.target.value }))} placeholder="es. Aula A, Via Roma" />
                </div>
                <div>
                  <label className={lbl}>Esito</label>
                  <select className={inp} value={corsoForm.esito} onChange={(e) => setCorsoForm((p) => ({ ...p, esito: e.target.value }))}>
                    {ESITO_CORSO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={lbl}>Note</label>
                <textarea className={`${inp} h-14 resize-none`} value={corsoForm.note} onChange={(e) => setCorsoForm((p) => ({ ...p, note: e.target.value }))} placeholder="Annotazioni…" />
              </div>
              {corsoErr && <p className="text-xs text-red-600">❌ {corsoErr}</p>}
              <div className="flex gap-2">
                <button onClick={salvaCorso} disabled={corsoBusy} className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{corsoBusy ? "Salvo…" : "✅ Salva"}</button>
                <button onClick={() => { setShowCorsoForm(false); setEditCorsoId(null); setCorsoForm(EMPTY_CORSO); setCorsoErr(""); }} className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Annulla</button>
              </div>
            </div>
          )}

          {corsi.length === 0 && !showCorsoForm ? (
            <p className="text-sm text-slate-400 text-center py-6">Nessuna iscrizione corso registrata.</p>
          ) : (
            <div className="space-y-2 overflow-auto max-h-[45vh]">
              {corsi.map((c) => (
                <div key={c.id} className={`rounded-lg border p-3 ${selectedCorsoId === c.id ? "border-violet-400 bg-violet-50" : "border-slate-200 bg-white"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tipoCorsoChip(c.tipo_corso)}`}>{tipoCorsoLabel(c.tipo_corso)}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statoCorsoChip(c.stato)}`}>{c.stato}</span>
                        {c.esito && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.esito === "idoneo" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{c.esito}</span>}
                      </div>
                      <div className="mt-1 text-xs text-slate-500 space-x-3">
                        {c.data_inizio && <span>📅 {fmtData(c.data_inizio)}{c.data_fine ? ` → ${fmtData(c.data_fine)}` : ""}</span>}
                        {c.ente_organizzatore && <span>🏫 {c.ente_organizzatore}</span>}
                        {c.ore_frequentate != null && <span>⏱ {c.ore_frequentate}h {c.ore_totali != null ? `/ ${c.ore_totali}h` : ""}</span>}
                      </div>
                      {c.note && <p className="mt-1 text-xs text-slate-600 italic">{c.note}</p>}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => { setSelectedCorsoId(c.id === selectedCorsoId ? null : c.id); setActiveTab("presenze"); }}
                        className="rounded border border-violet-300 bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700 hover:bg-violet-100" title="Presenze">
                        ✅ Pres.
                      </button>
                      <button onClick={() => apriModificaCorso(c)} className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] hover:bg-slate-50" title="Modifica">✏️</button>
                      <button onClick={() => eliminaCorso(c.id)} className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-100" title="Elimina">🗑</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================================================================
          TAB: PRESENZE LEZIONI
      ================================================================ */}
      {activeTab === "presenze" && (
        <div>
          {/* Selettore corso */}
          <div className="mb-3">
            <label className={lbl}>Seleziona corso per le presenze</label>
            <select className={inp} value={selectedCorsoId || ""} onChange={(e) => { setSelectedCorsoId(e.target.value || null); setPresenze([]); }}>
              <option value="">– Seleziona corso –</option>
              {corsi.map((c) => (
                <option key={c.id} value={c.id}>
                  {tipoCorsoLabel(c.tipo_corso)} · {c.data_inizio ? fmtData(c.data_inizio) : "data n.d."} · {c.stato}
                </option>
              ))}
            </select>
          </div>

          {!selectedCorsoId && (
            <p className="text-sm text-slate-400 italic py-4">Seleziona un corso per vedere le presenze lezioni.</p>
          )}

          {selectedCorsoId && (
            <>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-slate-500">
                  {presenzeBusy ? "Caricamento…" : `${presenze.length} lezioni · ${oreFreqTot.toFixed(1)}h frequentate`}
                </div>
                <div className="flex gap-1.5">
                  {/* Punto 16 — Stampa registro presenze */}
                  {presenze.length > 0 && (
                    <button
                      onClick={() => {
                        const corso = corsi.find((c) => c.id === selectedCorsoId);
                        const corsoLabel = corso ? `${tipoCorsoLabel(corso.tipo_corso)} — ${fmtData(corso.data_inizio)} / ${fmtData(corso.data_fine)}` : "";
                        const righe = presenze.map((p) => `
                          <tr>
                            <td>${fmtData(p.data_lezione)}</td>
                            <td>${p.ora_inizio || ""}${p.ora_inizio && p.ora_fine ? "–" : ""}${p.ora_fine || ""}</td>
                            <td>${p.argomento || ""}</td>
                            <td>${p.docente || ""}</td>
                            <td style="text-align:center">${p.ore != null ? p.ore + "h" : ""}</td>
                            <td style="text-align:center">${p.presente ? "✓" : "✗"}</td>
                            <td style="min-width:120px">&nbsp;</td>
                          </tr>`).join("");
                        const html = `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8">
                          <title>Registro Presenze</title>
                          <style>
                            body { font-family: Arial, sans-serif; font-size: 11pt; margin: 20mm 15mm; }
                            h2 { font-size: 14pt; margin-bottom: 4px; }
                            .sub { font-size: 10pt; color: #555; margin-bottom: 14px; }
                            table { width: 100%; border-collapse: collapse; }
                            th, td { border: 1px solid #999; padding: 5px 7px; font-size: 10pt; }
                            th { background: #e8e8e8; font-weight: bold; }
                            .totale { margin-top: 12px; font-size: 10pt; }
                            @media print { body { margin: 10mm; } }
                          </style></head><body>
                          <h2>FOGLIO PRESENZE CORSO</h2>
                          <div class="sub">${corsoLabel}</div>
                          <table>
                            <thead><tr>
                              <th>Data</th><th>Orario</th><th>Argomento</th><th>Docente</th><th>Ore</th><th>Pres.</th><th>Firma</th>
                            </tr></thead>
                            <tbody>${righe}</tbody>
                          </table>
                          <div class="totale">Totale ore frequentate: <strong>${oreFreqTot.toFixed(1)}h</strong></div>
                          <script>window.onload=()=>window.print();</script>
                          </body></html>`;
                        const w = window.open("", "_blank", "width=900,height=700");
                        w.document.write(html);
                        w.document.close();
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      🖨️ Stampa Registro
                    </button>
                  )}
                  <button
                    onClick={() => { setEditPresenzaId(null); setPresenzaForm(EMPTY_PRESENZA); setPresenzaFormErr(""); setPresenzaFormOk(""); setShowPresenzaForm(true); }}
                    className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-500">
                    ➕ Aggiungi lezione
                  </button>
                </div>
              </div>
              {presenzeErr && <p className="text-xs text-red-600 mb-2">❌ {presenzeErr}</p>}
              {presenzaFormOk && <p className="text-xs text-emerald-600 mb-2">{presenzaFormOk}</p>}

              {/* FORM PRESENZA */}
              {showPresenzaForm && (
                <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-2">
                  <h3 className="text-sm font-semibold text-emerald-900">{editPresenzaId ? "Modifica lezione" : "Nuova lezione"}</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={lbl}>Data lezione *</label>
                      <input type="date" className={inp} value={presenzaForm.data_lezione} onChange={(e) => setPresenzaForm((p) => ({ ...p, data_lezione: e.target.value }))} />
                    </div>
                    <div className="flex items-center gap-2 pt-5">
                      <input type="checkbox" id="presente-chk" checked={Boolean(presenzaForm.presente)} onChange={(e) => setPresenzaForm((p) => ({ ...p, presente: e.target.checked }))} className="h-4 w-4" />
                      <label htmlFor="presente-chk" className="text-sm font-medium text-slate-700">Presente</label>
                    </div>
                    <div>
                      <label className={lbl}>Ora inizio</label>
                      <input type="time" className={inp} value={presenzaForm.ora_inizio} onChange={(e) => setPresenzaForm((p) => ({ ...p, ora_inizio: e.target.value }))} />
                    </div>
                    <div>
                      <label className={lbl}>Ora fine</label>
                      <input type="time" className={inp} value={presenzaForm.ora_fine} onChange={(e) => setPresenzaForm((p) => ({ ...p, ora_fine: e.target.value }))} />
                    </div>
                    <div>
                      <label className={lbl}>Ore lezione</label>
                      <input type="number" step="0.5" min="0" className={inp} value={presenzaForm.ore} onChange={(e) => setPresenzaForm((p) => ({ ...p, ore: e.target.value }))} placeholder="es. 3.5" />
                    </div>
                    <div>
                      <label className={lbl}>Docente</label>
                      <input type="text" className={inp} value={presenzaForm.docente} onChange={(e) => setPresenzaForm((p) => ({ ...p, docente: e.target.value }))} placeholder="Nome docente" />
                    </div>
                  </div>
                  <div>
                    <label className={lbl}>Argomento lezione</label>
                    <input type="text" className={inp} value={presenzaForm.argomento} onChange={(e) => setPresenzaForm((p) => ({ ...p, argomento: e.target.value }))} placeholder="es. Normativa trasporto merci, Primo soccorso…" />
                  </div>
                  <div>
                    <label className={lbl}>Note</label>
                    <textarea className={`${inp} h-12 resize-none`} value={presenzaForm.note} onChange={(e) => setPresenzaForm((p) => ({ ...p, note: e.target.value }))} />
                  </div>
                  {presenzaFormErr && <p className="text-xs text-red-600">❌ {presenzaFormErr}</p>}
                  <div className="flex gap-2">
                    <button onClick={salvaPresenza} disabled={presenzaFormBusy} className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{presenzaFormBusy ? "Salvo…" : "✅ Salva"}</button>
                    <button onClick={() => { setShowPresenzaForm(false); setEditPresenzaId(null); setPresenzaForm(EMPTY_PRESENZA); setPresenzaFormErr(""); }} className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Annulla</button>
                  </div>
                </div>
              )}

              {presenze.length === 0 && !showPresenzaForm ? (
                <p className="text-sm text-slate-400 text-center py-4">Nessuna lezione registrata per questo corso.</p>
              ) : (
                <div className="overflow-auto max-h-[40vh]">
                  <table className="min-w-full text-xs border-collapse">
                    <thead className="sticky top-0 bg-slate-100">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Data</th>
                        <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Orario</th>
                        <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Argomento</th>
                        <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Docente</th>
                        <th className="px-2 py-1.5 text-center font-semibold text-slate-700">Ore</th>
                        <th className="px-2 py-1.5 text-center font-semibold text-slate-700">Pres.</th>
                        <th className="px-2 py-1.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {presenze.map((p) => (
                        <tr key={p.id} className="border-b border-slate-100 hover:bg-violet-50">
                          <td className="px-2 py-1.5 font-medium text-slate-900">{fmtData(p.data_lezione)}</td>
                          <td className="px-2 py-1.5 text-slate-600">{p.ora_inizio && p.ora_fine ? `${p.ora_inizio}–${p.ora_fine}` : p.ora_inizio || "–"}</td>
                          <td className="px-2 py-1.5 text-slate-700 max-w-[140px] truncate">{p.argomento || "–"}</td>
                          <td className="px-2 py-1.5 text-slate-600">{p.docente || "–"}</td>
                          <td className="px-2 py-1.5 text-center text-slate-700">{p.ore != null ? `${p.ore}h` : "–"}</td>
                          <td className="px-2 py-1.5 text-center">
                            {p.presente ? (
                              <span className="text-emerald-600 font-bold">✓</span>
                            ) : (
                              <span className="text-red-500 font-bold">✗</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 flex gap-1">
                            <button onClick={() => {
                              setPresenzaForm({ data_lezione: p.data_lezione || "", ora_inizio: p.ora_inizio || "", ora_fine: p.ora_fine || "", argomento: p.argomento || "", docente: p.docente || "", ore: p.ore != null ? String(p.ore) : "", presente: p.presente !== false, note: p.note || "" });
                              setEditPresenzaId(p.id);
                              setShowPresenzaForm(true);
                              setPresenzaFormErr(""); setPresenzaFormOk("");
                            }} className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] hover:bg-slate-50">✏️</button>
                            <button onClick={() => eliminaPresenza(p.id)} className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-100">🗑</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ================================================================
          TAB: CQC PORTALE
      ================================================================ */}
      {activeTab === "cqc" && (
        <div>
          {/* Dati CQC portale sincronizzati */}
          {(row?.raw_portale?.cqc || row?.raw_portale?.numero_cqc) && (
            <div className="mb-4 rounded-lg border border-violet-200 bg-white overflow-hidden">
              <p className="bg-violet-50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-violet-700">Dati CQC — Portale sincronizzato</p>
              <table className="w-full text-sm">
                <tbody>
                  {[
                    { label: "Numero CQC", value: row?.raw_portale?.cqc?.numero || row?.raw_portale?.numero_cqc },
                    { label: "Tipo CQC", value: row?.raw_portale?.cqc?.tipo || row?.raw_portale?.tipo_cqc },
                    { label: "Emissione", value: formatData(row?.raw_portale?.cqc?.data_emissione) },
                    { label: "Scadenza CQC", value: formatData(row?.raw_portale?.cqc?.data_scadenza || row?.raw_portale?.scadenza_cqc), color: scadenzaColor(row?.raw_portale?.cqc?.data_scadenza || row?.raw_portale?.scadenza_cqc) },
                    { label: "Categoria CQC", value: row?.raw_portale?.cqc?.categoria },
                  ].filter((f) => f.value && f.value !== "–").map(({ label, value, color }) => (
                    <tr key={label} className="border-b border-slate-100 last:border-0">
                      <td className="w-36 px-3 py-1.5 text-slate-500">{label}</td>
                      <td className={`px-3 py-1.5 font-medium ${color || "text-slate-800"}`}>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Ricerca live portale */}
          <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-violet-700">Ricerca CQC live — Portale dell&apos;Automobilista</p>
            <p className="mb-3 text-xs text-violet-600">Verifica in tempo reale. Disponibile 08:00–21:00.</p>
            <button type="button" disabled={cqcBusy} onClick={handleCercaCQC}
              className="rounded-lg bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
              {cqcBusy ? "Ricerca in corso…" : "🔍 Cerca CQC sul Portale"}
            </button>
            {cqcError && <p className="mt-2 rounded bg-red-100 px-2 py-1 text-xs text-red-700">❌ {cqcError}</p>}
            {cqcResult && (
              <div className="mt-3 rounded-lg border border-violet-200 bg-white p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-700">Risultato portale</p>
                <CqcResultTable data={cqcResult} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================
          TAB: DATI CANDIDATO
      ================================================================ */}
      {activeTab === "dati" && (
        <div>
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {[
                  { label: "Cognome", value: row.cognome },
                  { label: "Nome", value: row.nome },
                  { label: "Codice Fiscale", value: row.codice_fiscale },
                  { label: "Data nascita", value: formatData(row?.raw_portale?.anagrafica?.data_nascita || row.data_nascita) },
                  { label: "Categoria patente", value: row.categoria_patente },
                  { label: "Patente n°", value: row.patente_numero },
                  { label: "Telefono", value: row?.raw_portale?.anagrafica?.telefono_1 || row.telefono },
                  { label: "Email", value: row?.raw_portale?.anagrafica?.email_contatto || row.email },
                  { label: "Residenza", value: [row?.raw_portale?.anagrafica?.indirizzo_residenza, row?.raw_portale?.anagrafica?.comune_residenza, row?.raw_portale?.anagrafica?.prov_residenza].filter(Boolean).join(", ") },
                  { label: "Ente corso", value: row?.raw_portale?.ente_corso },
                  { label: "Ore frequentate", value: row?.raw_portale?.ore_frequentate },
                  { label: "Esito corso", value: row?.raw_portale?.esito_corso },
                ].filter((f) => f.value).map(({ label, value }) => (
                  <tr key={label} className="border-b border-slate-100 last:border-0">
                    <td className="w-36 px-3 py-1.5 text-slate-500">{label}</td>
                    <td className="px-3 py-1.5 font-medium text-slate-800">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <a href={`/anagrafica-iscrizioni?id=${row.id}`} className="mt-3 inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-indigo-700">
            Apri in Anagrafica
          </a>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabella risultato CQC (helper)
// ---------------------------------------------------------------------------
function CqcResultTable({ data }) {
  const entries = Object.entries(data).filter(([k, v]) => k !== "trace" && v != null && v !== "" && typeof v !== "object");
  const nested = Object.entries(data).filter(([k, v]) => k !== "trace" && v != null && typeof v === "object" && !Array.isArray(v));
  if (entries.length === 0 && nested.length === 0) {
    return <p className="text-xs text-slate-400 italic">Nessun dato restituito dal portale.</p>;
  }
  return (
    <div className="space-y-2">
      {entries.length > 0 && (
        <table className="w-full text-xs">
          <tbody>
            {entries.map(([k, v]) => (
              <tr key={k} className="border-b border-slate-100 last:border-0">
                <td className="py-1 pr-3 text-slate-500 capitalize">{k.replace(/_/g, " ")}</td>
                <td className="py-1 font-medium text-slate-800">{String(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {nested.map(([k, v]) => (
        <div key={k}>
          <p className="text-xs font-semibold text-slate-500 capitalize mb-1">{k.replace(/_/g, " ")}</p>
          <table className="w-full text-xs">
            <tbody>
              {Object.entries(v).filter(([, val]) => val != null && val !== "").map(([sk, sv]) => (
                <tr key={sk} className="border-b border-slate-100 last:border-0">
                  <td className="py-1 pr-3 text-slate-500 capitalize">{sk.replace(/_/g, " ")}</td>
                  <td className="py-1 font-medium text-slate-800">{String(sv)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

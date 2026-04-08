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

const STATO_OPTIONS = [
  { value: "", label: "Tutti gli stati" },
  { value: "attivo", label: "In corso" },
  { value: "completato", label: "Completato" },
  { value: "sospeso", label: "Sospeso" },
];

const PATENTE_FILTER = ["TUTTE", ...PATENTE_RICHIESTA_OPTIONS];

function statoChip(stato) {
  const s = String(stato || "").toLowerCase();
  const map = {
    attivo: "bg-emerald-100 text-emerald-800",
    "in corso": "bg-emerald-100 text-emerald-800",
    completato: "bg-blue-100 text-blue-800",
    sospeso: "bg-amber-100 text-amber-800",
    respinto: "bg-red-100 text-red-800",
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

function getGuideCount(r) {
  return (
    r?.raw_portale?.guide_effettuate ??
    r?.raw_portale?.newcontguiall ??
    r?.tentativi_quiz ??
    "–"
  );
}

// ---------------------------------------------------------------------------
// Componente principale
// ---------------------------------------------------------------------------

export default function GuidePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [fetchError, setFetchError] = useState("");
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({
    search: "",
    categoria_patente: "TUTTE",
    stato: "",
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
        const hay = [r.cognome, r.nome, r.codice_fiscale, r.codice_foglio_rosa]
          .join(" ")
          .toUpperCase();
        if (!hay.includes(search)) return false;
      }
      if (filters.categoria_patente && filters.categoria_patente !== "TUTTE") {
        if (r.categoria_patente !== filters.categoria_patente) return false;
      }
      if (filters.stato) {
        const st = String(r?.raw_portale?.stato || r?.stato || "").toLowerCase();
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
      title="Guide"
      subtitle="Planning guide, conteggi istruttore/allievo, guide certificate, valutazioni"
      activeKey="guide"
      onLogout={() => logoutSession().then(() => router.replace("/login"))}
      user={user}
    >
      <div className="flex h-[calc(100vh-120px)] gap-4">
        {/* COLONNA SINISTRA: filtri + tabella */}
        <div className={`flex flex-col ${selected ? "w-1/2" : "w-full"} transition-all duration-200`}>
          <div className="mb-3 flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="Cerca cognome, nome, CF, foglio rosa…"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-indigo-400 focus:outline-none w-60"
            />
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
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Foglio Rosa</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Scadenza FR</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Guide</th>
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
                    const ppgNum = r?.raw_portale?.ppg_numero || r?.codice_foglio_rosa || "–";
                    const ppgScad = r?.raw_portale?.ppg_data_scadenza || "";
                    const stato = r?.raw_portale?.stato || r?.stato || "";
                    const guide = getGuideCount(r);
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
                        <td className="px-3 py-2 text-slate-700">{ppgNum}</td>
                        <td className={`px-3 py-2 text-sm ${scadenzaColor(ppgScad)}`}>
                          {ppgScad ? formatData(ppgScad) : "–"}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="inline-block rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                            {guide}
                          </span>
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
            <DettaglioGuide
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
// Pannello dettaglio guide – newguide, conguist, newcontguiall, guiobb, valutazioni
// ---------------------------------------------------------------------------

const TIPO_GUIDA_OPTIONS = [
  { value: "normale", label: "Normale" },
  { value: "obbligatoria", label: "Obbligatoria / Certificata" },
  { value: "A2A", label: "Presenze A2/A" },
];

// Esercitazioni guida portale
const MODULO_OPTIONS = [
  { value: "A", label: "Modulo A (≤30 min)" },
  { value: "B", label: "Modulo B (≤60 min)" },
  { value: "C", label: "Modulo C (≤90 min)" },
  { value: "D", label: "Modulo D (>90 min)" },
];

const DURATA_OPTIONS = [
  { value: "30",  label: "30 min (Modulo A)" },
  { value: "60",  label: "60 min (Modulo B)" },
  { value: "90",  label: "90 min (Modulo C)" },
  { value: "120", label: "120 min (Modulo D)" },
];

const EMPTY_ESERC = {
  data_esercitazione: new Date().toISOString().slice(0, 10),
  ora_inizio: "",
  durata_minuti: "60",
  tipo_guida: "B",
  targa_veicolo: "",
  istruttore_nome: "",
  istruttore_cognome: "",
  n_iscrizione: "",
  note: "",
};

const ESITO_OPTIONS = [
  { value: "completata", label: "Completata" },
  { value: "annullata", label: "Annullata" },
  { value: "sospesa", label: "Sospesa" },
];

const EMPTY_SEDUTA = {
  data_guida: new Date().toISOString().slice(0, 10),
  ora_inizio: "",
  ora_fine: "",
  istruttore: "",
  tipo_guida: "normale",
  percorso: "",
  km: "",
  valutazione: "",
  note: "",
  esito: "completata",
};

function DettaglioGuide({ row, onClose }) {
  const anagrafica = row?.raw_portale?.anagrafica || {};
  const [sedute, setSedute] = useState([]);
  const [conteggio, setConteggio] = useState(null);
  const [seduteBusy, setSeduteBusy] = useState(false);
  const [seduteErr, setSeduteErr] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState(EMPTY_SEDUTA);
  const [formBusy, setFormBusy] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [formOk, setFormOk] = useState("");
  const [editId, setEditId] = useState(null);
  const [activeTab, setActiveTab] = useState("sedute");

  // — Esercitazioni guida (portale) state —
  const [esercitazioni, setEsercitazioni] = useState([]);
  const [esercBusy, setEsercBusy]     = useState(false);
  const [esercErr, setEsercErr]       = useState("");
  const [esercOk, setEsercOk]         = useState("");
  const [esercForm, setEsercForm]     = useState(EMPTY_ESERC);
  const [esercFormBusy, setEsercFormBusy] = useState(false);
  const [esercFormErr, setEsercFormErr]   = useState("");
  const [showEsercForm, setShowEsercForm] = useState(false);
  // Trasmissione portale — modal credenziali
  const [showTrasmModal, setShowTrasmModal] = useState(false);
  const [trCredenziali, setTrCredenziali]   = useState({ username: "", password: "", pin: "" });
  const [trPraticaId, setTrPraticaId]       = useState("");
  const [trBusy, setTrBusy]                 = useState(false);
  const [trErr, setTrErr]                   = useState("");
  const [trOk, setTrOk]                     = useState("");

  function getBase() {
    if (typeof window === "undefined") return "http://localhost:3000";
    const saved = localStorage.getItem("autoscuola_api_base");
    if (saved) return saved.trim();
    const h = window.location.hostname;
    if (h === "localhost" || h === "127.0.0.1") return `${window.location.protocol}//${h}:3000`;
    return `${window.location.protocol}//${h}:3000`;
  }

  function authH() {
    try {
      const tok = typeof window !== "undefined" ? localStorage.getItem("autoscuola_token") : null;
      return tok ? { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
    } catch { return { "Content-Type": "application/json" }; }
  }

  const loadSedute = useCallback(async () => {
    setSeduteBusy(true); setSeduteErr("");
    try {
      const base = getBase();
      const [seduteRes, conteggioRes] = await Promise.all([
        fetch(`${base}/api/guide?candidate_id=${row.id}`, { headers: authH() }),
        fetch(`${base}/api/guide/conteggio?candidate_id=${row.id}`, { headers: authH() }),
      ]);
      if (seduteRes.ok) {
        const d = await seduteRes.json();
        setSedute(Array.isArray(d?.data) ? d.data : Array.isArray(d) ? d : []);
      }
      if (conteggioRes.ok) setConteggio(await conteggioRes.json());
    } catch (e) {
      setSeduteErr(e.message || "Errore caricamento sedute");
    } finally {
      setSeduteBusy(false);
    }
  }, [row.id]);

  useEffect(() => { loadSedute(); }, [loadSedute]);

  async function salvaSeduta() {
    if (!formData.data_guida) { setFormErr("Data guida obbligatoria"); return; }
    setFormBusy(true); setFormErr(""); setFormOk("");
    try {
      const base = getBase();
      const payload = { ...formData, candidate_id: row.id, km: formData.km ? parseFloat(formData.km) : null, valutazione: formData.valutazione ? parseInt(formData.valutazione) : null };
      const url = editId ? `${base}/api/guide/${editId}` : `${base}/api/guide`;
      const method = editId ? "PUT" : "POST";
      const res = await fetch(url, { method, headers: authH(), body: JSON.stringify(payload) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || `HTTP ${res.status}`); }
      setFormOk("✅ Seduta salvata");
      setShowForm(false);
      setEditId(null);
      setFormData(EMPTY_SEDUTA);
      await loadSedute();
    } catch (e) {
      setFormErr(e.message || "Errore salvataggio");
    } finally {
      setFormBusy(false);
    }
  }

  async function eliminaSeduta(id) {
    if (!window.confirm("Eliminare questa seduta guida?")) return;
    const base = getBase();
    await fetch(`${base}/api/guide/${id}`, { method: "DELETE", headers: authH() });
    await loadSedute();
  }

  function apriModifica(seduta) {
    setFormData({
      data_guida: seduta.data_guida || "",
      ora_inizio: seduta.ora_inizio || "",
      ora_fine: seduta.ora_fine || "",
      istruttore: seduta.istruttore || "",
      tipo_guida: seduta.tipo_guida || "normale",
      percorso: seduta.percorso || "",
      km: seduta.km != null ? String(seduta.km) : "",
      valutazione: seduta.valutazione != null ? String(seduta.valutazione) : "",
      note: seduta.note || "",
      esito: seduta.esito || "completata",
    });
    setEditId(seduta.id);
    setShowForm(true);
    setFormErr(""); setFormOk("");
  }

  // ————————————————————————————————————————————————
  // Esercitazioni guida — load / create / delete
  // ————————————————————————————————————————————————
  const loadEsercitazioni = useCallback(async () => {
    setEsercBusy(true); setEsercErr("");
    try {
      const base = getBase();
      const res = await fetch(`${base}/api/guide/esercitazioni?candidate_id=${row.id}`, { headers: authH() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setEsercitazioni(Array.isArray(d?.data) ? d.data : []);
      // Cerca la pratica attiva del candidato per avere pratica_id
      try {
        const pr = await fetch(`${base}/api/prenotazioni?candidate_id=${row.id}&limit=1`, { headers: authH() });
        if (pr.ok) {
          const pd = await pr.json();
          const pratiche = Array.isArray(pd?.data) ? pd.data : Array.isArray(pd) ? pd : [];
          if (pratiche.length > 0) setTrPraticaId(String(pratiche[0].id));
        }
      } catch (_) { /* non bloccante */ }
    } catch (e) {
      setEsercErr(e.message || "Errore caricamento esercitazioni");
    } finally {
      setEsercBusy(false);
    }
  }, [row.id]);

  useEffect(() => {
    if (activeTab === "portale") loadEsercitazioni();
  }, [activeTab, loadEsercitazioni]);

  async function salvaEsercitazione() {
    if (!esercForm.data_esercitazione) { setEsercFormErr("Data obbligatoria"); return; }
    setEsercFormBusy(true); setEsercFormErr("");
    try {
      const base = getBase();
      const payload = {
        ...esercForm,
        candidate_id:  row.id,
        pratica_id:    trPraticaId || null,
        durata_minuti: parseInt(esercForm.durata_minuti, 10),
      };
      const res = await fetch(`${base}/api/guide/esercitazioni`, {
        method: "POST",
        headers: authH(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || `HTTP ${res.status}`); }
      setEsercOk("✅ Esercitazione salvata");
      setShowEsercForm(false);
      setEsercForm(EMPTY_ESERC);
      await loadEsercitazioni();
    } catch (e) {
      setEsercFormErr(e.message || "Errore salvataggio");
    } finally {
      setEsercFormBusy(false);
    }
  }

  async function eliminaEsercitazione(id) {
    if (!window.confirm("Eliminare questa esercitazione?")) return;
    const base = getBase();
    await fetch(`${base}/api/guide/esercitazioni/${id}`, { method: "DELETE", headers: authH() });
    await loadEsercitazioni();
  }

  async function trasmettiAlPortale() {
    if (!trCredenziali.username || !trCredenziali.password) {
      setTrErr("Username e password obbligatori");
      return;
    }
    if (!trPraticaId) { setTrErr("Nessuna pratica trovata per questo candidato. Inserisci pratica_id manualmente."); return; }
    if (esercitazioni.length === 0) { setTrErr("Nessuna esercitazione da trasmettere"); return; }
    setTrBusy(true); setTrErr(""); setTrOk("");
    try {
      const base = getBase();
      const guide = esercitazioni.map((e) => ({
        modulo:           e.tipo_guida || "B",
        targa:            e.targa_veicolo || "",
        istruttore_nome:  e.istruttore_nome || "",
        istruttore_cognome: e.istruttore_cognome || "",
        data:             (e.data_esercitazione || "").split("-").reverse().join("/"),
        ora:              e.ora_inizio || "09:00",
        durata_minuti:    e.durata_minuti || 60,
        n_iscrizione:     e.n_iscrizione || "",
      }));
      const res = await fetch(`${base}/api/trasmiss/portale/guide`, {
        method: "POST",
        headers: authH(),
        body: JSON.stringify({
          pratica_id:  trPraticaId,
          credenziali: trCredenziali,
          guide,
        }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.error || `HTTP ${res.status}`);
      setTrOk(`✅ Trasmissione completata. Marca: ${result.marcaOperativa || "–"}`);
      setShowTrasmModal(false);
      await loadEsercitazioni();
    } catch (e) {
      setTrErr(e.message || "Errore trasmissione");
    } finally {
      setTrBusy(false);
    }
  }

  function fmtData(v) {
    const s = String(v || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return v || "–";
    return new Date(s + "T00:00:00Z").toLocaleDateString("it-IT");
  }

  const inp = "rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 w-full";
  const lbl = "block text-[10px] font-semibold text-slate-500 uppercase mb-0.5";

  const guideOld = [
    { label: "Guide effettuate (portale)", value: row?.raw_portale?.guide_effettuate ?? row?.tentativi_quiz },
    { label: "Guide certificate (guiobb)", value: row?.raw_portale?.guide_certificate },
    { label: "Guide obbligatorie", value: row?.raw_portale?.guide_obbligatorie },
    { label: "Istruttore", value: row?.raw_portale?.istruttore },
    { label: "Presenze A2/A", value: row?.raw_portale?.presenze_a2_a },
  ].filter((f) => f.value != null && f.value !== "" && f.value !== "–");


  return (
    <div className="p-4">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-800">{row.cognome} {row.nome}</h2>
          <p className="text-xs text-slate-500">{row.codice_fiscale} · cat. {row.categoria_patente} · FR scad.: {formatData(row?.raw_portale?.ppg_data_scadenza || row.ppg_data_scadenza)}</p>
        </div>
        <button onClick={onClose} className="rounded border border-slate-200 p-1 text-slate-400 hover:bg-slate-50 text-sm">✕</button>
      </div>

      {/* KPI conteggio guide */}
      {conteggio && (
        <div className="mb-3 grid grid-cols-4 gap-2">
          {[
            { label: "Totale guide", value: conteggio.totale ?? 0, color: "bg-sky-50 text-sky-700 border-sky-200" },
            { label: "Normali", value: conteggio.normale ?? 0, color: "bg-slate-50 text-slate-700 border-slate-200" },
            { label: "Obbligatorie", value: conteggio.obbligatoria ?? 0, color: "bg-violet-50 text-violet-700 border-violet-200" },
            { label: "Km tot.", value: conteggio.totKm ? `${Math.round(conteggio.totKm)} km` : "–", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
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
        {[{ k: "sedute", l: "🚗 Sedute" }, { k: "form", l: editId ? "✏️ Modifica" : "➕ Nuova" }, { k: "portale", l: "📋 Portale" }].map((t) => (
          <button key={t.k} onClick={() => setActiveTab(t.k)}
            className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${activeTab === t.k ? "bg-sky-600 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}>
            {t.l}
          </button>
        ))}
      </div>

      {/* TAB SEDUTE */}
      {activeTab === "sedute" && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-slate-500">{seduteBusy ? "Caricamento…" : `${sedute.length} sedute registrate`}</p>
            <button onClick={() => { setEditId(null); setFormData(EMPTY_SEDUTA); setFormErr(""); setFormOk(""); setActiveTab("form"); }}
              className="rounded-lg bg-sky-600 px-2 py-1 text-xs font-semibold text-white hover:bg-sky-500">
              ➕ Nuova seduta
            </button>
          </div>
          {seduteErr && <p className="text-xs text-red-600 mb-2">❌ {seduteErr}</p>}
          {formOk && <p className="text-xs text-emerald-600 mb-2">{formOk}</p>}
          {sedute.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">Nessuna seduta registrata. Usa &quot;Nuova seduta&quot; per aggiungere.</p>
          ) : (
            <div className="overflow-auto max-h-[45vh]">
              <table className="min-w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-slate-100">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Data</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Orario</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Tipo</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Istruttore</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Km</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Voto</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Esito</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {sedute.map((s) => (
                    <tr key={s.id} className="border-b border-slate-100 hover:bg-sky-50">
                      <td className="px-2 py-1.5 font-medium text-slate-900">{fmtData(s.data_guida)}</td>
                      <td className="px-2 py-1.5 text-slate-600">{s.ora_inizio && s.ora_fine ? `${s.ora_inizio}–${s.ora_fine}` : s.ora_inizio || "–"}</td>
                      <td className="px-2 py-1.5">
                        <span className={`rounded px-1 py-0.5 text-[10px] font-medium ${s.tipo_guida === "obbligatoria" || s.tipo_guida === "certificata" ? "bg-violet-100 text-violet-700" : s.tipo_guida === "A2A" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                          {s.tipo_guida || "normale"}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-slate-600">{s.istruttore || "–"}</td>
                      <td className="px-2 py-1.5 text-slate-600">{s.km != null ? `${s.km} km` : "–"}</td>
                      <td className="px-2 py-1.5 text-center">
                        {s.valutazione ? <span className="text-amber-500">{"★".repeat(s.valutazione)}{"☆".repeat(5 - s.valutazione)}</span> : "–"}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={`rounded px-1 py-0.5 text-[10px] font-medium ${s.esito === "completata" ? "bg-emerald-100 text-emerald-700" : s.esito === "annullata" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                          {s.esito || "–"}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 flex gap-1">
                        <button onClick={() => apriModifica(s)} className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] hover:bg-slate-50" title="Modifica">✏️</button>
                        <button onClick={() => eliminaSeduta(s.id)} className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-100" title="Elimina">🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB FORM NUOVA/MODIFICA SEDUTA */}
      {activeTab === "form" && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-800">{editId ? "Modifica seduta guida" : "Nuova seduta guida"}</h3>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={lbl}>Data guida *</label><input type="date" className={inp} value={formData.data_guida} onChange={(e) => setFormData((p) => ({ ...p, data_guida: e.target.value }))} /></div>
            <div><label className={lbl}>Istruttore</label><input type="text" className={inp} value={formData.istruttore} onChange={(e) => setFormData((p) => ({ ...p, istruttore: e.target.value }))} placeholder="Cognome istruttore" /></div>
            <div><label className={lbl}>Ora inizio</label><input type="time" className={inp} value={formData.ora_inizio} onChange={(e) => setFormData((p) => ({ ...p, ora_inizio: e.target.value }))} /></div>
            <div><label className={lbl}>Ora fine</label><input type="time" className={inp} value={formData.ora_fine} onChange={(e) => setFormData((p) => ({ ...p, ora_fine: e.target.value }))} /></div>
            <div><label className={lbl}>Tipo guida</label>
              <select className={inp} value={formData.tipo_guida} onChange={(e) => setFormData((p) => ({ ...p, tipo_guida: e.target.value }))}>
                {TIPO_GUIDA_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div><label className={lbl}>Esito</label>
              <select className={inp} value={formData.esito} onChange={(e) => setFormData((p) => ({ ...p, esito: e.target.value }))}>
                {ESITO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div><label className={lbl}>Km percorsi</label><input type="number" step="0.1" min="0" className={inp} value={formData.km} onChange={(e) => setFormData((p) => ({ ...p, km: e.target.value }))} placeholder="es. 18.5" /></div>
            <div><label className={lbl}>Valutazione (1–5 ★)</label>
              <select className={inp} value={formData.valutazione} onChange={(e) => setFormData((p) => ({ ...p, valutazione: e.target.value }))}>
                <option value="">–</option>
                {[1,2,3,4,5].map((v) => <option key={v} value={v}>{v} {"★".repeat(v)}</option>)}
              </select>
            </div>
          </div>
          <div><label className={lbl}>Percorso</label><input type="text" className={inp} value={formData.percorso} onChange={(e) => setFormData((p) => ({ ...p, percorso: e.target.value }))} placeholder="es. Centro – Autostrada – Zona traffico" /></div>
          <div><label className={lbl}>Note</label><textarea className={`${inp} h-16 resize-none`} value={formData.note} onChange={(e) => setFormData((p) => ({ ...p, note: e.target.value }))} placeholder="Annotazioni seduta…" /></div>
          {formErr && <p className="text-xs text-red-600">❌ {formErr}</p>}
          {formOk && <p className="text-xs text-emerald-600">{formOk}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={salvaSeduta} disabled={formBusy} className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{formBusy ? "Salvo…" : "✅ Salva seduta"}</button>
            <button onClick={() => { setActiveTab("sedute"); setEditId(null); setFormData(EMPTY_SEDUTA); setFormErr(""); }} className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Annulla</button>
          </div>
        </div>
      )}

      {/* TAB ESERCITAZIONI PORTALE */}
      {activeTab === "portale" && (
        <div className="space-y-3">

          {/* Header azioni */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">{esercBusy ? "Caricamento…" : `${esercitazioni.length} esercitazioni`}</p>
            <div className="flex gap-2">
              <button onClick={() => { setShowEsercForm(true); setEsercFormErr(""); }}
                className="rounded-lg bg-sky-600 px-2 py-1 text-xs font-semibold text-white hover:bg-sky-500">
                ➕ Aggiungi
              </button>
              <button onClick={() => { setShowTrasmModal(true); setTrErr(""); setTrOk(""); }}
                className="rounded-lg bg-indigo-600 px-2 py-1 text-xs font-semibold text-white hover:bg-indigo-500">
                🏛️ Trasmetti al portale
              </button>
            </div>
          </div>

          {esercErr  && <p className="text-xs text-red-600">❌ {esercErr}</p>}
          {esercOk   && <p className="text-xs text-emerald-600">{esercOk}</p>}

          {/* Form nuova esercitazione */}
          {showEsercForm && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 space-y-2">
              <p className="text-xs font-semibold text-sky-800">Nuova esercitazione guida</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={lbl}>Data *</label>
                  <input type="date" className={inp} value={esercForm.data_esercitazione}
                    onChange={(e) => setEsercForm((f) => ({ ...f, data_esercitazione: e.target.value }))} />
                </div>
                <div>
                  <label className={lbl}>Ora inizio</label>
                  <input type="time" className={inp} value={esercForm.ora_inizio}
                    onChange={(e) => setEsercForm((f) => ({ ...f, ora_inizio: e.target.value }))} />
                </div>
                <div>
                  <label className={lbl}>Durata / Modulo</label>
                  <select className={inp} value={esercForm.durata_minuti}
                    onChange={(e) => {
                      const dm = e.target.value;
                      const mod = dm <= "30" ? "A" : dm <= "60" ? "B" : dm <= "90" ? "C" : "D";
                      setEsercForm((f) => ({ ...f, durata_minuti: dm, tipo_guida: mod }));
                    }}>
                    {DURATA_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Modulo</label>
                  <select className={inp} value={esercForm.tipo_guida}
                    onChange={(e) => setEsercForm((f) => ({ ...f, tipo_guida: e.target.value }))}>
                    {MODULO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Targa veicolo</label>
                  <input type="text" className={inp} placeholder="es. AB123CD" value={esercForm.targa_veicolo}
                    onChange={(e) => setEsercForm((f) => ({ ...f, targa_veicolo: e.target.value.toUpperCase() }))} />
                </div>
                <div>
                  <label className={lbl}>N. iscrizione registro</label>
                  <input type="text" className={inp} placeholder="es. 1234/2024" value={esercForm.n_iscrizione}
                    onChange={(e) => setEsercForm((f) => ({ ...f, n_iscrizione: e.target.value }))} />
                </div>
                <div>
                  <label className={lbl}>Nome istruttore</label>
                  <input type="text" className={inp} value={esercForm.istruttore_nome}
                    onChange={(e) => setEsercForm((f) => ({ ...f, istruttore_nome: e.target.value }))} />
                </div>
                <div>
                  <label className={lbl}>Cognome istruttore</label>
                  <input type="text" className={inp} value={esercForm.istruttore_cognome}
                    onChange={(e) => setEsercForm((f) => ({ ...f, istruttore_cognome: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className={lbl}>Note</label>
                <input type="text" className={inp} value={esercForm.note}
                  onChange={(e) => setEsercForm((f) => ({ ...f, note: e.target.value }))} />
              </div>
              {esercFormErr && <p className="text-xs text-red-600">❌ {esercFormErr}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={salvaEsercitazione} disabled={esercFormBusy}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
                  {esercFormBusy ? "Salvo…" : "✅ Salva"}
                </button>
                <button onClick={() => { setShowEsercForm(false); setEsercFormErr(""); }}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
                  Annulla
                </button>
              </div>
            </div>
          )}

          {/* Lista esercitazioni */}
          {esercitazioni.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">Nessuna esercitazione registrata. Usa ➕ Aggiungi per inserire.</p>
          ) : (
            <div className="overflow-auto max-h-[40vh]">
              <table className="min-w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-slate-100">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Data</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Ora</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Mod.</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Durata</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Targa</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Istruttore</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Iscrizione</th>
                    <th className="px-2 py-1.5 text-center font-semibold text-slate-700">Trasm.</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {esercitazioni.map((e) => (
                    <tr key={e.id} className={`border-b border-slate-100 hover:bg-sky-50 ${e.trasmessa_portale ? "opacity-70" : ""}`}>
                      <td className="px-2 py-1.5 font-medium text-slate-900">{fmtData(e.data_esercitazione)}</td>
                      <td className="px-2 py-1.5 text-slate-600">{e.ora_inizio || "–"}</td>
                      <td className="px-2 py-1.5">
                        <span className="rounded px-1 py-0.5 text-[10px] font-bold bg-indigo-100 text-indigo-700">{e.tipo_guida || "–"}</span>
                      </td>
                      <td className="px-2 py-1.5 text-slate-600">{e.durata_minuti ? `${e.durata_minuti} min` : "–"}</td>
                      <td className="px-2 py-1.5 font-mono text-slate-700">{e.targa_veicolo || "–"}</td>
                      <td className="px-2 py-1.5 text-slate-600">
                        {[e.istruttore_nome, e.istruttore_cognome].filter(Boolean).join(" ") || "–"}
                      </td>
                      <td className="px-2 py-1.5 text-slate-600">{e.n_iscrizione || "–"}</td>
                      <td className="px-2 py-1.5 text-center">
                        {e.trasmessa_portale
                          ? <span className="text-emerald-600" title={e.data_trasmissione ? fmtData(e.data_trasmissione) : ""}>✅</span>
                          : <span className="text-slate-300">○</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        {!e.trasmessa_portale && (
                          <button onClick={() => eliminaEsercitazione(e.id)}
                            className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-100" title="Elimina">
                            🗑
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Sezione riepilogo guide dal portale (raw_portale) */}
          {guideOld.length > 0 && (
            <div className="mt-2">
              <p className="text-[10px] font-semibold uppercase text-slate-400 mb-1">Dati portale (anagrafica)</p>
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <table className="w-full text-xs">
                  <tbody>
                    {guideOld.map(({ label, value }) => (
                      <tr key={label} className="border-b border-slate-100 last:border-0">
                        <td className="w-44 px-3 py-1.5 text-slate-500">{label}</td>
                        <td className="px-3 py-1.5 font-medium text-slate-800">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Modal credenziali trasmissione */}
          {showTrasmModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
              <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-800">🏛️ Trasmissione guide al portale</h3>
                  <button onClick={() => setShowTrasmModal(false)} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
                </div>
                <p className="text-xs text-slate-500">
                  Verranno trasmesse <strong>{esercitazioni.filter((e) => !e.trasmessa_portale).length}</strong> esercitazioni non ancora trasmesse.
                </p>
                <div className="space-y-2">
                  <div>
                    <label className={lbl}>Username portale *</label>
                    <input type="text" className={inp} value={trCredenziali.username}
                      onChange={(e) => setTrCredenziali((c) => ({ ...c, username: e.target.value }))}
                      placeholder="username portale" autoComplete="off" />
                  </div>
                  <div>
                    <label className={lbl}>Password *</label>
                    <input type="password" className={inp} value={trCredenziali.password}
                      onChange={(e) => setTrCredenziali((c) => ({ ...c, password: e.target.value }))}
                      placeholder="password" autoComplete="new-password" />
                  </div>
                  <div>
                    <label className={lbl}>PIN (se richiesto)</label>
                    <input type="text" className={inp} value={trCredenziali.pin}
                      onChange={(e) => setTrCredenziali((c) => ({ ...c, pin: e.target.value }))}
                      placeholder="PIN" />
                  </div>
                  <div>
                    <label className={lbl}>ID Pratica</label>
                    <input type="text" className={inp} value={trPraticaId}
                      onChange={(e) => setTrPraticaId(e.target.value)}
                      placeholder="Auto-rilevato o inserisci manualmente" />
                  </div>
                </div>
                {trErr && <p className="text-xs text-red-600">❌ {trErr}</p>}
                {trOk  && <p className="text-xs text-emerald-600">{trOk}</p>}
                <div className="flex gap-2 pt-1">
                  <button onClick={trasmettiAlPortale} disabled={trBusy}
                    className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
                    {trBusy ? "Trasmissione in corso…" : "🏛️ Trasmetti"}
                  </button>
                  <button onClick={() => setShowTrasmModal(false)}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                    Annulla
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, fields, emptyMessage }) {
  const hasValues = fields.some((f) => f.value != null && f.value !== "" && f.value !== "–");
  if (!hasValues) {
    if (!emptyMessage) return null;
    return (
      <div className="mb-4">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
        <p className="text-sm text-slate-400 italic">{emptyMessage}</p>
      </div>
    );
  }
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      <div className="rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            {fields.map(({ label, value, color }) =>
              value != null && value !== "" && value !== "–" ? (
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

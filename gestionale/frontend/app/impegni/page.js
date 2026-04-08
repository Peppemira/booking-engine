"use client";

/**
 * /impegni — Impegni e Scadenze
 * Ispirato a iPatenteCloud Cap 15 — Impegni e Scadenze.
 * Task, promemoria, appuntamenti, scadenze con notifiche e candidati associati.
 */

import { useState, useEffect, useCallback } from "react";
import ModernAppShell from "../ModernAppShell";
import { getApiBase, authHeaders } from "../../lib/authClient";

async function apiFetch(path, opts = {}) {
  const base = getApiBase();
  const res = await fetch(`${base}/api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

const TIPI = [
  { value: "scadenza",     label: "Scadenza",     icon: "⏰" },
  { value: "appuntamento", label: "Appuntamento", icon: "📅" },
  { value: "promemoria",   label: "Promemoria",   icon: "📌" },
  { value: "task",         label: "Task",         icon: "✅" },
  { value: "visita_medica",label: "Visita Medica",icon: "🏥" },
  { value: "esame",        label: "Esame",        icon: "📝" },
  { value: "corso",        label: "Corso",        icon: "📚" },
];

const PRIORITA = [
  { value: "bassa",   label: "Bassa",   color: "bg-gray-100 text-gray-700" },
  { value: "normale", label: "Normale", color: "bg-blue-100 text-blue-700" },
  { value: "alta",    label: "Alta",    color: "bg-orange-100 text-orange-700" },
  { value: "urgente", label: "Urgente", color: "bg-red-100 text-red-700" },
];

const STATI = [
  { value: "aperto",     label: "Aperto",     color: "bg-blue-100 text-blue-700" },
  { value: "in_corso",   label: "In corso",   color: "bg-yellow-100 text-yellow-700" },
  { value: "completato", label: "Completato", color: "bg-green-100 text-green-700" },
  { value: "annullato",  label: "Annullato",  color: "bg-gray-100 text-gray-500" },
  { value: "scaduto",    label: "Scaduto",    color: "bg-red-100 text-red-700" },
];

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("it-IT");
}

function isScaduto(d) {
  if (!d) return false;
  return new Date(d) < new Date() && new Date(d).toDateString() !== new Date().toDateString();
}

// ─── Modal impegno ────────────────────────────────────────────────────────────
function ModalImpegno({ impegno, candidati, onClose, onSave }) {
  const isNew = !impegno?.id;
  const [form, setForm] = useState(isNew ? {
    titolo: "", descrizione: "", tipo: "promemoria",
    data_inizio: "", data_fine: "", data_scadenza: "",
    priorita: "normale", stato: "aperto",
    notifica_abilitata: false, notifica_minuti: 60,
    candidato_id: "", note: ""
  } : {
    ...impegno,
    candidato_id: impegno.candidato_id || "",
    data_scadenza: impegno.data_scadenza || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body = {
        ...form,
        candidato_id: form.candidato_id || null,
        data_scadenza: form.data_scadenza || null,
        data_inizio: form.data_inizio || null,
        data_fine: form.data_fine || null,
      };
      const result = isNew
        ? await apiFetch("/impegni", { method: "POST", body })
        : await apiFetch(`/impegni/${impegno.id}`, { method: "PUT", body });
      onSave(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-900">
            {isNew ? "Nuovo Impegno" : "Modifica Impegno"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 text-red-700 rounded-lg px-4 py-2 text-sm">{error}</div>}

          {/* Tipo */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-2">Tipo</label>
            <div className="flex flex-wrap gap-2">
              {TIPI.map(t => (
                <button key={t.value} type="button" onClick={() => set("tipo", t.value)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm border-2 transition-colors ${
                    form.tipo === t.value
                      ? "border-blue-500 bg-blue-50 text-blue-700 font-semibold"
                      : "border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Titolo *</label>
            <input value={form.titolo} onChange={e => set("titolo", e.target.value)}
              required className="w-full border rounded-lg px-3 py-2 text-sm font-medium"
              placeholder="es. Scadenza revisione auto, Appuntamento candidato…" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Descrizione</label>
            <textarea value={form.descrizione || ""} onChange={e => set("descrizione", e.target.value)}
              rows={2} className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
              placeholder="Dettagli aggiuntivi…" />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Data scadenza</label>
              <input type="date" value={form.data_scadenza || ""} onChange={e => set("data_scadenza", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Data inizio</label>
              <input type="datetime-local" value={form.data_inizio || ""} onChange={e => set("data_inizio", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Data fine</label>
              <input type="datetime-local" value={form.data_fine || ""} onChange={e => set("data_fine", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Priorità</label>
              <select value={form.priorita} onChange={e => set("priorita", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm">
                {PRIORITA.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Stato</label>
              <select value={form.stato} onChange={e => set("stato", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm">
                {STATI.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          {/* Candidato associato */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Candidato associato (opzionale)</label>
            <select value={form.candidato_id || ""} onChange={e => set("candidato_id", e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">— nessun candidato —</option>
              {(candidati || []).map(c => (
                <option key={c.id} value={c.id}>
                  {c.cognome} {c.nome} {c.codice_fiscale ? `— ${c.codice_fiscale}` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Notifica */}
          <div className="bg-yellow-50 rounded-xl p-4 space-y-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.notifica_abilitata}
                onChange={e => set("notifica_abilitata", e.target.checked)} className="w-4 h-4 rounded" />
              <span className="font-medium">Abilita notifica promemoria</span>
            </label>
            {form.notifica_abilitata && (
              <div>
                <label className="block text-xs text-gray-600 mb-1">Notifica quanti minuti prima?</label>
                <select value={form.notifica_minuti} onChange={e => set("notifica_minuti", parseInt(e.target.value))}
                  className="border rounded-lg px-3 py-2 text-sm bg-white">
                  <option value={15}>15 minuti</option>
                  <option value={30}>30 minuti</option>
                  <option value={60}>1 ora</option>
                  <option value={120}>2 ore</option>
                  <option value={1440}>1 giorno</option>
                  <option value={4320}>3 giorni</option>
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Note</label>
            <textarea value={form.note || ""} onChange={e => set("note", e.target.value)}
              rows={2} className="w-full border rounded-lg px-3 py-2 text-sm resize-none" />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50">Annulla</button>
            <button type="submit" disabled={saving}
              className="px-6 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? "Salvataggio…" : isNew ? "Crea impegno" : "Salva modifiche"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Card impegno ─────────────────────────────────────────────────────────────
function CardImpegno({ item, onEdit, onChangeStato, onDelete }) {
  const tipo    = TIPI.find(t => t.value === item.tipo) || TIPI[2];
  const priorita= PRIORITA.find(p => p.value === item.priorita) || PRIORITA[1];
  const stato   = STATI.find(s => s.value === item.stato) || STATI[0];
  const scad    = isScaduto(item.data_scadenza);
  const cand    = item.candidates;

  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-4 transition-all hover:shadow-md ${
      scad && item.stato === "aperto" ? "border-red-200" : ""
    }`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{tipo.icon}</span>
          <div>
            <h3 className={`font-semibold text-sm ${item.stato === "completato" ? "line-through text-gray-400" : "text-gray-900"}`}>
              {item.titolo}
            </h3>
            {cand && (
              <p className="text-xs text-blue-600 font-medium">
                👤 {cand.cognome} {cand.nome}
              </p>
            )}
          </div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${priorita.color}`}>
          {priorita.label}
        </span>
      </div>

      {item.descrizione && (
        <p className="text-xs text-gray-600 mb-2 line-clamp-2">{item.descrizione}</p>
      )}

      <div className="flex items-center gap-2 mb-3">
        {item.data_scadenza && (
          <span className={`text-xs font-medium ${
            scad ? "text-red-600" : "text-gray-600"
          }`}>
            {scad ? "⚠️ Scaduto " : "⏰ "}{fmtDate(item.data_scadenza)}
          </span>
        )}
        {item.notifica_abilitata && !item.notifica_inviata && (
          <span className="text-xs text-yellow-600">🔔</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <select
          value={item.stato}
          onChange={e => onChangeStato(item, e.target.value)}
          className={`text-xs px-2 py-1 rounded-full font-semibold border-0 cursor-pointer ${stato.color}`}
        >
          {STATI.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button onClick={() => onEdit(item)}
          className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 ml-auto">✏️</button>
        <button onClick={() => onDelete(item)}
          className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded-lg hover:bg-red-100">🗑️</button>
      </div>
    </div>
  );
}

// ─── Pagina principale ────────────────────────────────────────────────────────
export default function ImpegniPage() {
  const [impegni, setImpegni]   = useState([]);
  const [candidati, setCandidati] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filtroStato, setFiltroStato]   = useState("aperto,in_corso");
  const [filtroTipo, setFiltroTipo]     = useState("");
  const [filtroSearch, setFiltroSearch] = useState("");
  const [modal, setModal]       = useState(null);
  const [error, setError]       = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filtroStato && !filtroStato.includes(",")) params.set("stato", filtroStato);
      if (filtroTipo) params.set("tipo", filtroTipo);
      const [{ data }, candRes] = await Promise.all([
        apiFetch(`/impegni?${params}`),
        apiFetch("/candidati-api?limit=500&fields=id,cognome,nome,codice_fiscale"),
      ]);
      setImpegni(data || []);
      setCandidati(candRes.data || candRes || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filtroStato, filtroTipo]);

  useEffect(() => { load(); }, [load]);

  const filtered = impegni.filter(item => {
    // Filtro stati multipli (aperto,in_corso)
    if (filtroStato && filtroStato.includes(",")) {
      const stati = filtroStato.split(",");
      if (!stati.includes(item.stato)) return false;
    }
    if (!filtroSearch) return true;
    const q = filtroSearch.toLowerCase();
    return (item.titolo || "").toLowerCase().includes(q) ||
           (item.descrizione || "").toLowerCase().includes(q);
  });

  async function handleChangeStato(item, stato) {
    try {
      const updated = await apiFetch(`/impegni/${item.id}/stato`, { method: "PATCH", body: { stato } });
      setImpegni(prev => prev.map(x => x.id === updated.id ? { ...x, ...updated } : x));
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(item) {
    if (!confirm(`Eliminare "${item.titolo}"?`)) return;
    try {
      await apiFetch(`/impegni/${item.id}`, { method: "DELETE" });
      setImpegni(prev => prev.filter(x => x.id !== item.id));
    } catch (e) {
      setError(e.message);
    }
  }

  function handleSave(saved) {
    setImpegni(prev => {
      const idx = prev.findIndex(x => x.id === saved.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = saved; return n; }
      return [saved, ...prev];
    });
    setModal(null);
  }

  // Contatori
  const nAperti     = impegni.filter(i => i.stato === "aperto").length;
  const nInCorso    = impegni.filter(i => i.stato === "in_corso").length;
  const nUrgenti    = impegni.filter(i => i.priorita === "urgente" && ["aperto","in_corso"].includes(i.stato)).length;
  const nScaduti    = impegni.filter(i => isScaduto(i.data_scadenza) && ["aperto","in_corso"].includes(i.stato)).length;

  return (
    <ModernAppShell title="Impegni e Scadenze" subtitle="Task, promemoria e appuntamenti" activeKey="impegni">
      {/* Statistiche */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-blue-700">{nAperti}</div>
          <div className="text-xs text-blue-600">Aperti</div>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-yellow-700">{nInCorso}</div>
          <div className="text-xs text-yellow-600">In corso</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-red-700">{nUrgenti}</div>
          <div className="text-xs text-red-600">Urgenti</div>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-orange-700">{nScaduti}</div>
          <div className="text-xs text-orange-600">Scaduti</div>
        </div>
      </div>

      {/* Filtri */}
      <div className="bg-white rounded-2xl shadow-sm border p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-center">
          <input value={filtroSearch} onChange={e => setFiltroSearch(e.target.value)}
            placeholder="Cerca titolo, descrizione…"
            className="border rounded-lg px-3 py-2 text-sm w-56" />
          <select value={filtroStato} onChange={e => setFiltroStato(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm">
            <option value="aperto,in_corso">Attivi (aperti + in corso)</option>
            <option value="aperto">Solo aperti</option>
            <option value="in_corso">Solo in corso</option>
            <option value="completato">Completati</option>
            <option value="annullato">Annullati</option>
            <option value="">Tutti</option>
          </select>
          <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm">
            <option value="">Tutti i tipi</option>
            {TIPI.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
          </select>
          <button onClick={() => setModal("new")}
            className="ml-auto flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700">
            + Nuovo Impegno
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 rounded-xl px-4 py-3 mb-4 text-sm flex justify-between">
          <span>⚠️ {error}</span>
          <button onClick={() => setError("")} className="font-bold">×</button>
        </div>
      )}

      {/* Griglia impegni */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Caricamento…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border shadow-sm p-12 text-center">
          <div className="text-5xl mb-3">📌</div>
          <div className="text-gray-500 font-medium">Nessun impegno trovato</div>
          <div className="text-gray-400 text-sm mt-1">
            Aggiungi task, promemoria e scadenze per tenere tutto sotto controllo
          </div>
          <button onClick={() => setModal("new")}
            className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            + Aggiungi impegno
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(item => (
            <CardImpegno
              key={item.id}
              item={item}
              onEdit={setModal}
              onChangeStato={handleChangeStato}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="text-center mt-4 text-xs text-gray-400">
          {filtered.length} impegn{filtered.length === 1 ? "o" : "i"} mostrat{filtered.length === 1 ? "o" : "i"}
        </div>
      )}

      {modal && (
        <ModalImpegno
          impegno={modal === "new" ? null : modal}
          candidati={candidati}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
    </ModernAppShell>
  );
}

"use client";

/**
 * /veicoli — Parco Veicoli
 * Ispirato a iPatenteCloud Cap 5 — Gestione Parco Veicoli.
 * Gestione flotta: auto, moto, camion, furgoni per esercitazioni e guide.
 */

import { useState, useEffect, useCallback } from "react";
import ModernAppShell from "../ModernAppShell";
import { getApiBase, authHeaders } from "../../lib/authClient";

// ─── helpers ────────────────────────────────────────────────────────────────

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

const TIPI = ["auto", "moto", "camion", "furgone", "altro"];
const STATI = ["attivo", "manutenzione", "dismesso"];
const CATEGORIE = ["B", "C", "D", "BE", "CE", "A", "A2", "A1", "AM", "CQC"];

const STATO_COLORS = {
  attivo: "bg-green-100 text-green-800",
  manutenzione: "bg-yellow-100 text-yellow-800",
  dismesso: "bg-red-100 text-red-800",
};
const TIPO_ICON = { auto: "🚗", moto: "🏍️", camion: "🚛", furgone: "🚐", altro: "🚙" };

// ─── Formattazione date ──────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("it-IT");
}

function isScaduto(d) {
  if (!d) return false;
  return new Date(d) < new Date();
}

function isInScadenza(d, giorni = 30) {
  if (!d) return false;
  const t = new Date(d);
  const oggi = new Date();
  const limite = new Date(oggi.getTime() + giorni * 86400000);
  return t > oggi && t <= limite;
}

// ─── Componente StatCard ──────────────────────────────────────────────────────
function StatCard({ label, value, icon, color = "blue" }) {
  const colors = {
    blue: "bg-blue-50 border-blue-200 text-blue-700",
    green: "bg-green-50 border-green-200 text-green-700",
    yellow: "bg-yellow-50 border-yellow-200 text-yellow-700",
    red: "bg-red-50 border-red-200 text-red-700",
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm opacity-80">{label}</div>
    </div>
  );
}

// ─── Modal Veicolo ────────────────────────────────────────────────────────────
function ModalVeicolo({ veicolo, onClose, onSave }) {
  const isNew = !veicolo?.id;
  const [form, setForm] = useState(
    isNew
      ? {
          targa: "", marca: "", modello: "", colore: "#3B82F6",
          anno: new Date().getFullYear(), tipo: "auto", categoria_patente: "B",
          km_attuali: 0, data_acquisto: "", data_immatricolazione: "",
          scadenza_revisione: "", scadenza_assicurazione: "", stato: "attivo", note: "",
        }
      : { ...veicolo }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      let result;
      if (isNew) {
        result = await apiFetch("/veicoli", { method: "POST", body: form });
      } else {
        result = await apiFetch(`/veicoli/${veicolo.id}`, { method: "PUT", body: form });
      }
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
            {isNew ? "Nuovo Veicolo" : `Modifica — ${veicolo.targa}`}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 text-red-700 rounded-lg px-4 py-2 text-sm">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Targa *</label>
              <input
                value={form.targa} onChange={e => set("targa", e.target.value.toUpperCase())}
                required className="w-full border rounded-lg px-3 py-2 text-sm font-mono uppercase"
                placeholder="AB123CD"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Tipo</label>
              <select value={form.tipo} onChange={e => set("tipo", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm">
                {TIPI.map(t => <option key={t} value={t}>{TIPO_ICON[t]} {t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Marca</label>
              <input value={form.marca || ""} onChange={e => set("marca", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="es. Fiat" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Modello</label>
              <input value={form.modello || ""} onChange={e => set("modello", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="es. Punto" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Anno</label>
              <input type="number" value={form.anno || ""} onChange={e => set("anno", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm" min="1990" max="2030" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Categoria Patente</label>
              <select value={form.categoria_patente || ""} onChange={e => set("categoria_patente", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="">— seleziona —</option>
                {CATEGORIE.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Km attuali</label>
              <input type="number" value={form.km_attuali || 0} onChange={e => set("km_attuali", parseInt(e.target.value))}
                className="w-full border rounded-lg px-3 py-2 text-sm" min="0" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Stato</label>
              <select value={form.stato} onChange={e => set("stato", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm">
                {STATI.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Data acquisto</label>
              <input type="date" value={form.data_acquisto || ""} onChange={e => set("data_acquisto", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Data immatricolazione</label>
              <input type="date" value={form.data_immatricolazione || ""} onChange={e => set("data_immatricolazione", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Scadenza revisione</label>
              <input type="date" value={form.scadenza_revisione || ""} onChange={e => set("scadenza_revisione", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Scadenza assicurazione</label>
              <input type="date" value={form.scadenza_assicurazione || ""} onChange={e => set("scadenza_assicurazione", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Colore calendario</label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.colore || "#3B82F6"} onChange={e => set("colore", e.target.value)}
                  className="w-10 h-10 rounded border cursor-pointer" />
                <span className="text-sm text-gray-500">{form.colore || "#3B82F6"}</span>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Note</label>
            <textarea value={form.note || ""} onChange={e => set("note", e.target.value)}
              rows={2} className="w-full border rounded-lg px-3 py-2 text-sm resize-none" />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50">
              Annulla
            </button>
            <button type="submit" disabled={saving}
              className="px-6 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? "Salvataggio…" : isNew ? "Aggiungi veicolo" : "Salva modifiche"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Riga Veicolo ─────────────────────────────────────────────────────────────
function RigaVeicolo({ veicolo, onEdit, onDelete }) {
  const revScaduta = isScaduto(veicolo.scadenza_revisione);
  const assScaduta = isScaduto(veicolo.scadenza_assicurazione);
  const revInScad  = !revScaduta && isInScadenza(veicolo.scadenza_revisione);
  const assInScad  = !assScaduta && isInScadenza(veicolo.scadenza_assicurazione);

  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-lg"
            style={{ backgroundColor: veicolo.colore + "22", border: `2px solid ${veicolo.colore}` }}>
            {TIPO_ICON[veicolo.tipo] || "🚗"}
          </div>
          <div>
            <div className="font-bold text-sm font-mono">{veicolo.targa}</div>
            <div className="text-xs text-gray-500">{veicolo.marca} {veicolo.modello}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">{veicolo.anno || "—"}</td>
      <td className="px-4 py-3 text-sm">
        <span className="bg-blue-50 text-blue-700 rounded-full px-2 py-0.5 text-xs font-medium">
          {veicolo.categoria_patente || "—"}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">
        {veicolo.km_attuali ? veicolo.km_attuali.toLocaleString("it-IT") + " km" : "—"}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            revScaduta ? "bg-red-100 text-red-700" :
            revInScad ? "bg-yellow-100 text-yellow-700" : "text-gray-600"
          }`}>
            Rev: {fmtDate(veicolo.scadenza_revisione)}
            {revScaduta && " ⚠️"}{revInScad && " ⚠️"}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            assScaduta ? "bg-red-100 text-red-700" :
            assInScad ? "bg-yellow-100 text-yellow-700" : "text-gray-600"
          }`}>
            Ass: {fmtDate(veicolo.scadenza_assicurazione)}
            {assScaduta && " ⚠️"}{assInScad && " ⚠️"}
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${STATO_COLORS[veicolo.stato] || "bg-gray-100 text-gray-700"}`}>
          {veicolo.stato}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-2">
          <button onClick={() => onEdit(veicolo)}
            className="text-xs px-3 py-1 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 font-medium">
            Modifica
          </button>
          <button onClick={() => onDelete(veicolo)}
            className="text-xs px-3 py-1 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 font-medium">
            Elimina
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Pagina principale ────────────────────────────────────────────────────────
export default function VeicoliPage() {
  const [veicoli, setVeicoli]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filtroStato, setFiltroStato]   = useState("");
  const [filtroTipo, setFiltroTipo]     = useState("");
  const [filtroSearch, setFiltroSearch] = useState("");
  const [modal, setModal]         = useState(null); // null | "new" | veicolo
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [error, setError]         = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filtroStato) params.set("stato", filtroStato);
      if (filtroTipo)  params.set("tipo", filtroTipo);
      const { data } = await apiFetch(`/veicoli?${params}`);
      setVeicoli(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filtroStato, filtroTipo]);

  useEffect(() => { load(); }, [load]);

  const filtered = veicoli.filter(v => {
    if (!filtroSearch) return true;
    const q = filtroSearch.toLowerCase();
    return (v.targa || "").toLowerCase().includes(q) ||
           (v.marca || "").toLowerCase().includes(q) ||
           (v.modello || "").toLowerCase().includes(q);
  });

  async function handleDelete(v) {
    try {
      await apiFetch(`/veicoli/${v.id}`, { method: "DELETE" });
      setVeicoli(prev => prev.filter(x => x.id !== v.id));
      setDeleteConfirm(null);
    } catch (e) {
      setError(e.message);
    }
  }

  function handleSave(saved) {
    setVeicoli(prev => {
      const idx = prev.findIndex(x => x.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [saved, ...prev];
    });
    setModal(null);
  }

  // Statistiche
  const attivi    = veicoli.filter(v => v.stato === "attivo").length;
  const manut     = veicoli.filter(v => v.stato === "manutenzione").length;
  const allerte   = veicoli.filter(v =>
    isScaduto(v.scadenza_revisione) || isScaduto(v.scadenza_assicurazione) ||
    isInScadenza(v.scadenza_revisione) || isInScadenza(v.scadenza_assicurazione)
  ).length;

  return (
    <ModernAppShell title="Parco Veicoli" subtitle="Gestione flotta autoscuola" activeKey="veicoli">
      {/* Statistiche */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Totale veicoli"    value={veicoli.length} icon="🚗" color="blue" />
        <StatCard label="Attivi"            value={attivi}          icon="✅" color="green" />
        <StatCard label="In manutenzione"   value={manut}           icon="🔧" color="yellow" />
        <StatCard label="Allerte scadenze"  value={allerte}         icon="⚠️" color="red" />
      </div>

      {/* Barra filtri */}
      <div className="bg-white rounded-2xl shadow-sm border p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-center">
          <input
            value={filtroSearch}
            onChange={e => setFiltroSearch(e.target.value)}
            placeholder="Cerca targa, marca, modello…"
            className="border rounded-lg px-3 py-2 text-sm w-60"
          />
          <select value={filtroStato} onChange={e => setFiltroStato(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm">
            <option value="">Tutti gli stati</option>
            {STATI.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm">
            <option value="">Tutti i tipi</option>
            {TIPI.map(t => <option key={t} value={t}>{TIPO_ICON[t]} {t}</option>)}
          </select>
          <div className="ml-auto">
            <button
              onClick={() => setModal("new")}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700">
              + Nuovo Veicolo
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 rounded-xl px-4 py-3 mb-4 text-sm flex justify-between">
          <span>⚠️ {error}</span>
          <button onClick={() => setError("")} className="font-bold">×</button>
        </div>
      )}

      {/* Tabella */}
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Veicolo</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Anno</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Categoria</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Km</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Scadenze</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Stato</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">Caricamento…</td></tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-16">
                    <div className="text-5xl mb-3">🚗</div>
                    <div className="text-gray-500 font-medium">Nessun veicolo trovato</div>
                    <div className="text-gray-400 text-sm mt-1">Aggiungi il primo veicolo della tua flotta</div>
                    <button onClick={() => setModal("new")}
                      className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
                      + Aggiungi veicolo
                    </button>
                  </td>
                </tr>
              ) : filtered.map(v => (
                <RigaVeicolo
                  key={v.id}
                  veicolo={v}
                  onEdit={setModal}
                  onDelete={setDeleteConfirm}
                />
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > 0 && (
          <div className="px-4 py-3 border-t bg-gray-50 text-xs text-gray-500">
            {filtered.length} veicol{filtered.length === 1 ? "o" : "i"} mostrat{filtered.length === 1 ? "o" : "i"}
          </div>
        )}
      </div>

      {/* Modal nuovo/modifica */}
      {modal && (
        <ModalVeicolo
          veicolo={modal === "new" ? null : modal}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}

      {/* Conferma eliminazione */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <div className="text-center">
              <div className="text-5xl mb-3">⚠️</div>
              <h3 className="text-lg font-bold mb-2">Elimina veicolo</h3>
              <p className="text-gray-600 text-sm mb-6">
                Sei sicuro di voler eliminare il veicolo{" "}
                <strong>{deleteConfirm.targa}</strong>?
                <br />Questa operazione non può essere annullata.
              </p>
              <div className="flex gap-3 justify-center">
                <button onClick={() => setDeleteConfirm(null)}
                  className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">
                  Annulla
                </button>
                <button onClick={() => handleDelete(deleteConfirm)}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 font-semibold">
                  Elimina
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ModernAppShell>
  );
}

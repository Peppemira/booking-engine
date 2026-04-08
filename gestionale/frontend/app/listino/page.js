"use client";

/**
 * /listino — Listino Prezzi
 * Ispirato a iPatenteCloud Cap 6 — Listino Prezzi.
 * Gestione servizi offerti con prezzi, IVA, rateizzazione.
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

const TIPI_SERVIZIO = [
  { value: "corso", label: "Corso" },
  { value: "pratica", label: "Pratica" },
  { value: "guida", label: "Guida" },
  { value: "esame", label: "Esame" },
  { value: "visita_medica", label: "Visita Medica" },
  { value: "altro", label: "Altro" },
];

const TIPO_COLOR = {
  corso: "bg-blue-100 text-blue-800",
  pratica: "bg-purple-100 text-purple-800",
  guida: "bg-green-100 text-green-800",
  esame: "bg-orange-100 text-orange-800",
  visita_medica: "bg-pink-100 text-pink-800",
  altro: "bg-gray-100 text-gray-700",
};

const CATEGORIE_DEFAULT = [
  "Patente B", "Patente A", "Patente A2", "Patente A1", "Patente AM",
  "Patente C", "Patente D", "Patente BE", "Patente CE",
  "CQC Merci", "CQC Persone", "Revisione Patente", "Recupero Punti", "Altro"
];

// ─── Modal voce listino ───────────────────────────────────────────────────────
function ModalVoce({ voce, onClose, onSave }) {
  const isNew = !voce?.id;
  const [form, setForm] = useState(isNew ? {
    categoria: "Patente B", codice: "", descrizione: "", descrizione_estesa: "",
    tipo_servizio: "corso", prezzo_base: "", iva_pct: 22,
    prezzo_iva_inclusa: false, rateizzabile: false, num_rate_default: 1,
    blocco_morosi: false, attivo: true, ordine: 0, note: ""
  } : { ...voce });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const prezzoConIva = () => {
    const base = parseFloat(form.prezzo_base) || 0;
    const iva  = parseFloat(form.iva_pct) || 0;
    return (base * (1 + iva / 100)).toFixed(2);
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = isNew
        ? await apiFetch("/listino", { method: "POST", body: form })
        : await apiFetch(`/listino/${voce.id}`, { method: "PUT", body: form });
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
            {isNew ? "Nuova Voce Listino" : "Modifica Voce"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 text-red-700 rounded-lg px-4 py-2 text-sm">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Categoria *</label>
              <input
                list="categorie-list"
                value={form.categoria} onChange={e => set("categoria", e.target.value)}
                required className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="es. Patente B"
              />
              <datalist id="categorie-list">
                {CATEGORIE_DEFAULT.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Tipo servizio</label>
              <select value={form.tipo_servizio} onChange={e => set("tipo_servizio", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm">
                {TIPI_SERVIZIO.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Descrizione *</label>
              <input
                value={form.descrizione} onChange={e => set("descrizione", e.target.value)}
                required className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="es. Corso completo patente B"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Descrizione estesa</label>
              <textarea value={form.descrizione_estesa || ""} onChange={e => set("descrizione_estesa", e.target.value)}
                rows={2} className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
                placeholder="Dettagli aggiuntivi per preventivi/ricevute…" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Codice interno</label>
              <input value={form.codice || ""} onChange={e => set("codice", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono" placeholder="es. CORS-B-001" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Ordine visualizzazione</label>
              <input type="number" value={form.ordine || 0} onChange={e => set("ordine", parseInt(e.target.value))}
                className="w-full border rounded-lg px-3 py-2 text-sm" min="0" />
            </div>
          </div>

          {/* Prezzi */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">💶 Prezzi e IVA</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Prezzo base (€) *</label>
                <input type="number" step="0.01" value={form.prezzo_base} onChange={e => set("prezzo_base", e.target.value)}
                  required className="w-full border rounded-lg px-3 py-2 text-sm" min="0" placeholder="0.00" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">IVA %</label>
                <select value={form.iva_pct} onChange={e => set("iva_pct", parseFloat(e.target.value))}
                  className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value={0}>0% (esente)</option>
                  <option value={4}>4%</option>
                  <option value={10}>10%</option>
                  <option value={22}>22%</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Totale IVA inclusa</label>
                <div className="border rounded-lg px-3 py-2 text-sm bg-white font-bold text-green-700">
                  € {prezzoConIva()}
                </div>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.prezzo_iva_inclusa}
                onChange={e => set("prezzo_iva_inclusa", e.target.checked)}
                className="w-4 h-4 rounded" />
              <span>Il prezzo base include già l'IVA</span>
            </label>
          </div>

          {/* Rateizzazione */}
          <div className="bg-blue-50 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">📅 Rateizzazione (Cap 10 iPatenteCloud)</h3>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.rateizzabile}
                onChange={e => set("rateizzabile", e.target.checked)} className="w-4 h-4 rounded" />
              <span>Servizio rateizzabile</span>
            </label>
            {form.rateizzabile && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Numero rate default</label>
                  <input type="number" value={form.num_rate_default} onChange={e => set("num_rate_default", parseInt(e.target.value))}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-white" min="2" max="24" />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={form.blocco_morosi}
                      onChange={e => set("blocco_morosi", e.target.checked)} className="w-4 h-4 rounded" />
                    <span>Blocca app quiz in caso di morosità</span>
                  </label>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.attivo}
                onChange={e => set("attivo", e.target.checked)} className="w-4 h-4 rounded" />
              <span className="font-medium">Voce attiva nel listino</span>
            </label>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Note interne</label>
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
              {saving ? "Salvataggio…" : isNew ? "Aggiungi voce" : "Salva modifiche"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Pagina principale ────────────────────────────────────────────────────────
export default function ListinoPage() {
  const [voci, setVoci]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroSearch, setFiltroSearch] = useState("");
  const [mostraInattivi, setMostraInattivi] = useState(false);
  const [modal, setModal]       = useState(null);
  const [error, setError]       = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filtroCategoria) params.set("categoria", filtroCategoria);
      if (filtroTipo)      params.set("tipo_servizio", filtroTipo);
      const { data } = await apiFetch(`/listino?${params}`);
      setVoci(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filtroCategoria, filtroTipo]);

  useEffect(() => { load(); }, [load]);

  const filtered = voci.filter(v => {
    if (!mostraInattivi && !v.attivo) return false;
    if (!filtroSearch) return true;
    const q = filtroSearch.toLowerCase();
    return (v.descrizione || "").toLowerCase().includes(q) ||
           (v.categoria || "").toLowerCase().includes(q) ||
           (v.codice || "").toLowerCase().includes(q);
  });

  // Raggruppa per categoria
  const perCategoria = filtered.reduce((acc, v) => {
    const cat = v.categoria || "Altro";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(v);
    return acc;
  }, {});

  const categorie = Object.keys(perCategoria).sort();

  async function handleToggleAttivo(v) {
    try {
      const updated = await apiFetch(`/listino/${v.id}`, { method: "PUT", body: { attivo: !v.attivo } });
      setVoci(prev => prev.map(x => x.id === updated.id ? updated : x));
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(v) {
    if (!confirm(`Eliminare "${v.descrizione}"?`)) return;
    try {
      await apiFetch(`/listino/${v.id}`, { method: "DELETE" });
      setVoci(prev => prev.filter(x => x.id !== v.id));
    } catch (e) {
      setError(e.message);
    }
  }

  function handleSave(saved) {
    setVoci(prev => {
      const idx = prev.findIndex(x => x.id === saved.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = saved; return n; }
      return [saved, ...prev];
    });
    setModal(null);
  }

  const totaleAttive = voci.filter(v => v.attivo).length;

  return (
    <ModernAppShell title="Listino Prezzi" subtitle="Servizi offerti e tariffe" activeKey="listino">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-center">
            <div className="text-2xl font-bold text-blue-700">{totaleAttive}</div>
            <div className="text-xs text-blue-600">Servizi attivi</div>
          </div>
          <div className="bg-gray-50 border rounded-xl px-4 py-3 text-center">
            <div className="text-2xl font-bold text-gray-700">{categorie.length}</div>
            <div className="text-xs text-gray-600">Categorie</div>
          </div>
        </div>
        <button onClick={() => setModal("new")}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700">
          + Nuova Voce
        </button>
      </div>

      {/* Filtri */}
      <div className="bg-white rounded-2xl shadow-sm border p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-center">
          <input value={filtroSearch} onChange={e => setFiltroSearch(e.target.value)}
            placeholder="Cerca servizio, codice…"
            className="border rounded-lg px-3 py-2 text-sm w-56" />
          <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm">
            <option value="">Tutti i tipi</option>
            {TIPI_SERVIZIO.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm cursor-pointer ml-2">
            <input type="checkbox" checked={mostraInattivi}
              onChange={e => setMostraInattivi(e.target.checked)} className="w-4 h-4 rounded" />
            <span>Mostra voci inattive</span>
          </label>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 rounded-xl px-4 py-3 mb-4 text-sm flex justify-between">
          <span>⚠️ {error}</span>
          <button onClick={() => setError("")} className="font-bold">×</button>
        </div>
      )}

      {/* Lista per categoria */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Caricamento…</div>
      ) : categorie.length === 0 ? (
        <div className="bg-white rounded-2xl border shadow-sm p-12 text-center">
          <div className="text-5xl mb-3">💶</div>
          <div className="text-gray-500 font-medium">Nessuna voce nel listino</div>
          <div className="text-gray-400 text-sm mt-1">Aggiungi i servizi che offri con i relativi prezzi</div>
          <button onClick={() => setModal("new")}
            className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            + Aggiungi prima voce
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {categorie.map(cat => (
            <div key={cat} className="bg-white rounded-2xl shadow-sm border overflow-hidden">
              {/* Header categoria */}
              <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-3 flex items-center justify-between">
                <h3 className="text-white font-bold">{cat}</h3>
                <span className="text-blue-200 text-sm">{perCategoria[cat].length} voc{perCategoria[cat].length === 1 ? "e" : "i"}</span>
              </div>

              {/* Tabella voci */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Descrizione</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Tipo</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Prezzo base</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">IVA %</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Totale</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Rate</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Stato</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Azioni</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {perCategoria[cat].map(v => {
                    const totale = (parseFloat(v.prezzo_base) * (1 + parseFloat(v.iva_pct) / 100)).toFixed(2);
                    return (
                      <tr key={v.id} className={`hover:bg-gray-50 transition-colors ${!v.attivo ? "opacity-50" : ""}`}>
                        <td className="px-4 py-3">
                          <div className="font-medium">{v.descrizione}</div>
                          {v.codice && <div className="text-xs text-gray-400 font-mono">{v.codice}</div>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TIPO_COLOR[v.tipo_servizio] || "bg-gray-100 text-gray-700"}`}>
                            {TIPI_SERVIZIO.find(t => t.value === v.tipo_servizio)?.label || v.tipo_servizio}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-medium">€ {parseFloat(v.prezzo_base).toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{v.iva_pct}%</td>
                        <td className="px-4 py-3 text-right font-bold text-green-700">€ {totale}</td>
                        <td className="px-4 py-3 text-center">
                          {v.rateizzabile
                            ? <span className="text-xs bg-blue-50 text-blue-700 rounded-full px-2 py-0.5">{v.num_rate_default} rate</span>
                            : <span className="text-gray-400 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button onClick={() => handleToggleAttivo(v)}
                            className={`text-xs px-2 py-1 rounded-full font-medium transition-colors ${
                              v.attivo ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                            }`}>
                            {v.attivo ? "Attiva" : "Inattiva"}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex gap-1 justify-center">
                            <button onClick={() => setModal(v)}
                              className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100">
                              ✏️
                            </button>
                            <button onClick={() => handleDelete(v)}
                              className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100">
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <ModalVoce voce={modal === "new" ? null : modal} onClose={() => setModal(null)} onSave={handleSave} />
      )}
    </ModernAppShell>
  );
}

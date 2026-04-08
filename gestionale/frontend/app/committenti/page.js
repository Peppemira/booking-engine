"use client";

/**
 * /committenti — Committenti
 * Ispirato a iPatenteCloud Cap 11 — Committenti.
 * Gestione soggetti terzi (aziende, enti, autoscuole partner) per cui si svolgono corsi/pratiche.
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

const TIPOLOGIE = ["PRIVATO", "AZIENDA", "AUTOSCUOLA"];
const TIP_ICON  = { PRIVATO: "👤", AZIENDA: "🏢", AUTOSCUOLA: "🚗" };
const TIP_COLOR = {
  PRIVATO: "bg-blue-100 text-blue-800",
  AZIENDA: "bg-purple-100 text-purple-800",
  AUTOSCUOLA: "bg-green-100 text-green-800",
};

// ─── Modal committente ────────────────────────────────────────────────────────
function ModalCommittente({ committente, onClose, onSave }) {
  const isNew = !committente?.id;
  const [form, setForm] = useState(isNew ? {
    tipologia: "AZIENDA", ragione_sociale: "", nome_referente: "", cognome_referente: "",
    codice_fiscale: "", partita_iva: "", email: "", telefono: "",
    indirizzo: "", cap: "", comune: "", provincia: "",
    codice_destinatario: "", pec: "", note: ""
  } : { ...committente });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loadingPiva, setLoadingPiva] = useState(false);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // Lookup P.IVA (simulato — in produzione chiama AdE o OpenAPI)
  async function lookupPiva() {
    if (!form.partita_iva || form.partita_iva.length < 11) return;
    setLoadingPiva(true);
    // In produzione: fetch `/api/committenti/lookup-piva?piva=...`
    // Per ora: mostra solo messaggio
    setTimeout(() => {
      setLoadingPiva(false);
      alert("Funzionalità lookup P.IVA dall'Agenzia delle Entrate — configurabile in Impostazioni");
    }, 500);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = isNew
        ? await apiFetch("/committenti", { method: "POST", body: form })
        : await apiFetch(`/committenti/${committente.id}`, { method: "PUT", body: form });
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
            {isNew ? "Nuovo Committente" : `Modifica — ${committente.ragione_sociale}`}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 text-red-700 rounded-lg px-4 py-2 text-sm">{error}</div>}

          {/* Tipologia */}
          <div className="flex gap-3">
            {TIPOLOGIE.map(t => (
              <button key={t} type="button"
                onClick={() => set("tipologia", t)}
                className={`flex-1 py-2 rounded-xl text-sm font-semibold border-2 transition-colors ${
                  form.tipologia === t
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-gray-200 text-gray-600 hover:border-gray-300"
                }`}>
                {TIP_ICON[t]} {t}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-gray-500 mb-1">
                {form.tipologia === "PRIVATO" ? "Nome e cognome" : "Ragione sociale"} *
              </label>
              <input value={form.ragione_sociale} onChange={e => set("ragione_sociale", e.target.value)}
                required className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder={form.tipologia === "PRIVATO" ? "Mario Rossi" : "Nome Azienda S.r.l."} />
            </div>

            {form.tipologia !== "PRIVATO" && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Nome referente</label>
                  <input value={form.nome_referente || ""} onChange={e => set("nome_referente", e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Cognome referente</label>
                  <input value={form.cognome_referente || ""} onChange={e => set("cognome_referente", e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Codice Fiscale</label>
              <input value={form.codice_fiscale || ""} onChange={e => set("codice_fiscale", e.target.value.toUpperCase())}
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Partita IVA</label>
              <div className="flex gap-2">
                <input value={form.partita_iva || ""} onChange={e => set("partita_iva", e.target.value)}
                  className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono" placeholder="IT00000000000" />
                <button type="button" onClick={lookupPiva} disabled={loadingPiva}
                  title="Recupera dati dall'Agenzia delle Entrate"
                  className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm border">
                  {loadingPiva ? "⏳" : "🔍"}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Email</label>
              <input type="email" value={form.email || ""} onChange={e => set("email", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Telefono</label>
              <input value={form.telefono || ""} onChange={e => set("telefono", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          {/* Indirizzo */}
          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Indirizzo</label>
              <input value={form.indirizzo || ""} onChange={e => set("indirizzo", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Via Roma, 1" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">CAP</label>
              <input value={form.cap || ""} onChange={e => set("cap", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm" maxLength={5} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Prov.</label>
              <input value={form.provincia || ""} onChange={e => set("provincia", e.target.value.toUpperCase())}
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono" maxLength={2} />
            </div>
            <div className="col-span-4">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Comune</label>
              <input value={form.comune || ""} onChange={e => set("comune", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          {/* Fatturazione elettronica */}
          {form.tipologia !== "PRIVATO" && (
            <div className="grid grid-cols-2 gap-4 bg-gray-50 rounded-xl p-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Codice SDI destinatario</label>
                <input value={form.codice_destinatario || ""} onChange={e => set("codice_destinatario", e.target.value.toUpperCase())}
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono bg-white" placeholder="XXXXXXX" maxLength={7} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">PEC</label>
                <input type="email" value={form.pec || ""} onChange={e => set("pec", e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-white" />
              </div>
            </div>
          )}

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
              {saving ? "Salvataggio…" : isNew ? "Aggiungi committente" : "Salva modifiche"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Card committente ─────────────────────────────────────────────────────────
function CardCommittente({ c, onEdit, onDelete }) {
  return (
    <div className="bg-white rounded-2xl border shadow-sm p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl ${
            c.tipologia === "AZIENDA" ? "bg-purple-100" :
            c.tipologia === "AUTOSCUOLA" ? "bg-green-100" : "bg-blue-100"
          }`}>
            {TIP_ICON[c.tipologia] || "👤"}
          </div>
          <div>
            <h3 className="font-bold text-gray-900 text-sm">{c.ragione_sociale}</h3>
            {(c.nome_referente || c.cognome_referente) && (
              <p className="text-xs text-gray-500">Ref: {c.nome_referente} {c.cognome_referente}</p>
            )}
          </div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${TIP_COLOR[c.tipologia]}`}>
          {c.tipologia}
        </span>
      </div>

      <div className="space-y-1 text-xs text-gray-600 mb-4">
        {c.partita_iva && <div>P.IVA: <span className="font-mono">{c.partita_iva}</span></div>}
        {c.email && <div>✉️ {c.email}</div>}
        {c.telefono && <div>📞 {c.telefono}</div>}
        {(c.comune || c.provincia) && <div>📍 {c.comune}{c.provincia ? ` (${c.provincia})` : ""}</div>}
      </div>

      <div className="flex gap-2">
        <button onClick={() => onEdit(c)}
          className="flex-1 text-xs py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 font-medium">
          Modifica
        </button>
        <button onClick={() => onDelete(c)}
          className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 text-xs font-medium">
          🗑️
        </button>
      </div>
    </div>
  );
}

// ─── Pagina principale ────────────────────────────────────────────────────────
export default function CommittentiPage() {
  const [committenti, setCommittenti] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [filtroTipologia, setFiltroTipologia] = useState("");
  const [filtroSearch, setFiltroSearch]       = useState("");
  const [modal, setModal]             = useState(null);
  const [deleteConfirm, setDeleteConfirm]     = useState(null);
  const [error, setError]             = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filtroTipologia) params.set("tipologia", filtroTipologia);
      params.set("attivo", "true");
      const { data } = await apiFetch(`/committenti?${params}`);
      setCommittenti(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filtroTipologia]);

  useEffect(() => { load(); }, [load]);

  const filtered = committenti.filter(c => {
    if (!filtroSearch) return true;
    const q = filtroSearch.toLowerCase();
    return (c.ragione_sociale || "").toLowerCase().includes(q) ||
           (c.partita_iva || "").includes(q) ||
           (c.email || "").toLowerCase().includes(q) ||
           (c.comune || "").toLowerCase().includes(q);
  });

  async function handleDelete(c) {
    try {
      await apiFetch(`/committenti/${c.id}`, { method: "DELETE" });
      setCommittenti(prev => prev.filter(x => x.id !== c.id));
      setDeleteConfirm(null);
    } catch (e) {
      setError(e.message);
    }
  }

  function handleSave(saved) {
    setCommittenti(prev => {
      const idx = prev.findIndex(x => x.id === saved.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = saved; return n; }
      return [saved, ...prev];
    });
    setModal(null);
  }

  const totAziende    = committenti.filter(c => c.tipologia === "AZIENDA").length;
  const totPrivati    = committenti.filter(c => c.tipologia === "PRIVATO").length;
  const totAutoscuole = committenti.filter(c => c.tipologia === "AUTOSCUOLA").length;

  return (
    <ModernAppShell title="Committenti" subtitle="Enti, aziende e organizzazioni terze" activeKey="committenti">
      {/* Statistiche */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-purple-700">{totAziende}</div>
          <div className="text-xs text-purple-600">🏢 Aziende</div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-blue-700">{totPrivati}</div>
          <div className="text-xs text-blue-600">👤 Privati</div>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-green-700">{totAutoscuole}</div>
          <div className="text-xs text-green-600">🚗 Autoscuole</div>
        </div>
      </div>

      {/* Filtri */}
      <div className="bg-white rounded-2xl shadow-sm border p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-center">
          <input value={filtroSearch} onChange={e => setFiltroSearch(e.target.value)}
            placeholder="Cerca nome, P.IVA, email, comune…"
            className="border rounded-lg px-3 py-2 text-sm w-64" />
          <div className="flex gap-2">
            {["", ...TIPOLOGIE].map(t => (
              <button key={t} onClick={() => setFiltroTipologia(t)}
                className={`text-sm px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                  filtroTipologia === t ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 hover:bg-gray-50"
                }`}>
                {t ? `${TIP_ICON[t]} ${t}` : "Tutti"}
              </button>
            ))}
          </div>
          <button onClick={() => setModal("new")}
            className="ml-auto flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700">
            + Nuovo Committente
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 rounded-xl px-4 py-3 mb-4 text-sm flex justify-between">
          <span>⚠️ {error}</span>
          <button onClick={() => setError("")} className="font-bold">×</button>
        </div>
      )}

      {/* Griglia */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Caricamento…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border shadow-sm p-12 text-center">
          <div className="text-5xl mb-3">🏢</div>
          <div className="text-gray-500 font-medium">Nessun committente trovato</div>
          <div className="text-gray-400 text-sm mt-1">
            Aggiungi aziende, enti o autoscuole che commissionano corsi e pratiche
          </div>
          <button onClick={() => setModal("new")}
            className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            + Aggiungi committente
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(c => (
            <CardCommittente key={c.id} c={c} onEdit={setModal} onDelete={setDeleteConfirm} />
          ))}
        </div>
      )}

      {modal && (
        <ModalCommittente
          committente={modal === "new" ? null : modal}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4 text-center">
            <div className="text-5xl mb-3">⚠️</div>
            <h3 className="text-lg font-bold mb-2">Elimina committente</h3>
            <p className="text-gray-600 text-sm mb-6">
              Sei sicuro di voler eliminare <strong>{deleteConfirm.ragione_sociale}</strong>?
            </p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Annulla</button>
              <button onClick={() => handleDelete(deleteConfirm)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 font-semibold">
                Elimina
              </button>
            </div>
          </div>
        </div>
      )}
    </ModernAppShell>
  );
}

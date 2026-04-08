"use client";

/**
 * /preventivi — Gestione Preventivi
 * CRUD preventivi con voci dinamiche, calcolo IVA, workflow stati.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { getApiBase, authHeaders, checkSession } from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function formatImporto(val) {
  if (val == null || val === "") return "\u2013";
  const n = parseFloat(val);
  if (isNaN(n)) return String(val);
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function formatData(iso) {
  if (!iso) return "\u2013";
  return new Date(iso).toLocaleDateString("it-IT");
}

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const STATI = [
  { value: "", label: "Tutti gli stati" },
  { value: "bozza", label: "Bozza" },
  { value: "inviato", label: "Inviato" },
  { value: "accettato", label: "Accettato" },
  { value: "rifiutato", label: "Rifiutato" },
  { value: "scaduto", label: "Scaduto" },
];

const STATO_CHIP = {
  bozza: "bg-slate-100 text-slate-700",
  inviato: "bg-blue-100 text-blue-800",
  accettato: "bg-emerald-100 text-emerald-800",
  rifiutato: "bg-red-100 text-red-800",
  scaduto: "bg-amber-100 text-amber-800",
};

function statoChip(stato) {
  return STATO_CHIP[stato] || "bg-slate-100 text-slate-600";
}

const EMPTY_VOCE = {
  descrizione: "",
  quantita: 1,
  prezzo_unitario: "",
  iva_pct: 22,
  subtotale: 0,
};

const EMPTY_FORM = {
  numero_preventivo: "",
  candidato_id: "",
  committente_id: "",
  data_preventivo: new Date().toISOString().slice(0, 10),
  data_scadenza: "",
  note_interne: "",
  note_cliente: "",
  voci: [{ ...EMPTY_VOCE }],
};

// ---------------------------------------------------------------------------
// Calcoli voci
// ---------------------------------------------------------------------------

function calcolaSubtotale(voce) {
  const qty = parseFloat(voce.quantita) || 0;
  const prezzo = parseFloat(voce.prezzo_unitario) || 0;
  return qty * prezzo;
}

function calcolaTotali(voci) {
  let imponibile = 0;
  let totaleIva = 0;
  for (const v of voci) {
    const sub = calcolaSubtotale(v);
    imponibile += sub;
    totaleIva += sub * ((parseFloat(v.iva_pct) || 0) / 100);
  }
  return {
    imponibile: Math.round(imponibile * 100) / 100,
    iva: Math.round(totaleIva * 100) / 100,
    totale: Math.round((imponibile + totaleIva) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Export CSV
// ---------------------------------------------------------------------------

function exportCSV(rows) {
  const headers = ["Numero", "Data", "Candidato", "Committente", "Voci", "Imponibile", "IVA", "Totale", "Stato"];
  const lines = rows.map((r) => [
    r.numero_preventivo || "",
    r.data_preventivo ? new Date(r.data_preventivo).toLocaleDateString("it-IT") : "",
    r._candidatoLabel || "",
    r._committenteLabel || "",
    String(r.voci?.length || 0),
    r.imponibile != null ? String(r.imponibile).replace(".", ",") : "",
    r.iva_totale != null ? String(r.iva_totale).replace(".", ",") : "",
    r.totale != null ? String(r.totale).replace(".", ",") : "",
    r.stato || "",
  ]);
  const csv = [headers.join(";"), ...lines.map((l) => l.join(";"))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `preventivi_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Ricerca candidato con dropdown
// ---------------------------------------------------------------------------

function CandidatoSearch({ candidati, value, onChange }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const selected = candidati.find((c) => c.id === value);
  const label = selected ? `${selected.cognome} ${selected.nome}` : "";

  const results = useMemo(() => {
    if (!query.trim()) return candidati.slice(0, 30);
    const q = query.trim().toLowerCase();
    return candidati.filter((c) => {
      const hay = `${c.cognome} ${c.nome} ${c.codice_fiscale || ""}`.toLowerCase();
      return hay.includes(q);
    }).slice(0, 30);
  }, [candidati, query]);

  return (
    <div className="relative">
      <input
        type="text"
        value={open ? query : label}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); setQuery(""); }}
        placeholder="Cerca candidato..."
        className="w-full border rounded-lg px-3 py-2 text-sm"
      />
      {value && !open && (
        <button type="button" onClick={() => { onChange(""); setQuery(""); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none"
          title="Rimuovi">
          &times;
        </button>
      )}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-400">Nessun risultato</div>
          ) : (
            results.map((c) => (
              <button key={c.id} type="button"
                onClick={() => { onChange(c.id); setQuery(""); setOpen(false); }}
                className="block w-full text-left px-3 py-2 text-sm hover:bg-blue-50 truncate">
                <span className="font-medium">{c.cognome} {c.nome}</span>
                {c.codice_fiscale && <span className="ml-2 text-xs text-gray-400 font-mono">{c.codice_fiscale}</span>}
              </button>
            ))
          )}
        </div>
      )}
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ricerca committente con dropdown
// ---------------------------------------------------------------------------

function CommittenteSearch({ committenti, value, onChange }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const selected = committenti.find((c) => c.id === value);
  const label = selected ? (selected.ragione_sociale || `${selected.cognome || ""} ${selected.nome || ""}`.trim()) : "";

  const results = useMemo(() => {
    if (!query.trim()) return committenti.slice(0, 30);
    const q = query.trim().toLowerCase();
    return committenti.filter((c) => {
      const hay = `${c.ragione_sociale || ""} ${c.partita_iva || ""} ${c.email || ""}`.toLowerCase();
      return hay.includes(q);
    }).slice(0, 30);
  }, [committenti, query]);

  return (
    <div className="relative">
      <input
        type="text"
        value={open ? query : label}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); setQuery(""); }}
        placeholder="Cerca committente (opzionale)..."
        className="w-full border rounded-lg px-3 py-2 text-sm"
      />
      {value && !open && (
        <button type="button" onClick={() => { onChange(""); setQuery(""); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none"
          title="Rimuovi">
          &times;
        </button>
      )}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-400">Nessun risultato</div>
          ) : (
            results.map((c) => (
              <button key={c.id} type="button"
                onClick={() => { onChange(c.id); setQuery(""); setOpen(false); }}
                className="block w-full text-left px-3 py-2 text-sm hover:bg-blue-50 truncate">
                <span className="font-medium">{c.ragione_sociale || `${c.cognome || ""} ${c.nome || ""}`}</span>
                {c.partita_iva && <span className="ml-2 text-xs text-gray-400 font-mono">{c.partita_iva}</span>}
              </button>
            ))
          )}
        </div>
      )}
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor voci preventivo
// ---------------------------------------------------------------------------

function VociEditor({ voci, onChange, listino }) {
  function updateVoce(idx, field, value) {
    const next = voci.map((v, i) => {
      if (i !== idx) return v;
      const updated = { ...v, [field]: value };
      updated.subtotale = calcolaSubtotale(updated);
      return updated;
    });
    onChange(next);
  }

  function addVoce() {
    onChange([...voci, { ...EMPTY_VOCE }]);
  }

  function removeVoce(idx) {
    if (voci.length <= 1) return;
    onChange(voci.filter((_, i) => i !== idx));
  }

  function loadFromListino(idx, listinoItem) {
    const next = voci.map((v, i) => {
      if (i !== idx) return v;
      const updated = {
        ...v,
        descrizione: listinoItem.descrizione || listinoItem.codice || "",
        prezzo_unitario: listinoItem.prezzo_base || "",
        iva_pct: listinoItem.iva_pct != null ? listinoItem.iva_pct : 22,
      };
      updated.subtotale = calcolaSubtotale(updated);
      return updated;
    });
    onChange(next);
  }

  const totali = calcolaTotali(voci);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-semibold text-gray-500">Voci preventivo</label>
        <button type="button" onClick={addVoce}
          className="text-xs px-3 py-1 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 font-medium">
          + Aggiungi voce
        </button>
      </div>

      <div className="border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 w-[35%]">Descrizione</th>
              <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500 w-[10%]">Qty</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 w-[18%]">Prezzo unit.</th>
              <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500 w-[10%]">IVA %</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 w-[17%]">Subtotale</th>
              <th className="px-3 py-2 w-[10%]"></th>
            </tr>
          </thead>
          <tbody>
            {voci.map((voce, idx) => (
              <tr key={idx} className="border-t">
                <td className="px-2 py-1.5">
                  <div className="flex gap-1">
                    <input
                      value={voce.descrizione}
                      onChange={(e) => updateVoce(idx, "descrizione", e.target.value)}
                      placeholder="Descrizione voce..."
                      className="flex-1 border rounded px-2 py-1.5 text-sm min-w-0"
                    />
                    {listino.length > 0 && (
                      <select
                        value=""
                        onChange={(e) => {
                          const item = listino.find((l) => String(l.id) === e.target.value);
                          if (item) loadFromListino(idx, item);
                        }}
                        className="border rounded px-1 py-1.5 text-xs text-gray-500 w-20 shrink-0"
                        title="Carica da listino"
                      >
                        <option value="">Listino</option>
                        {listino.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.descrizione || l.codice || `#${l.id}`}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={voce.quantita}
                    onChange={(e) => updateVoce(idx, "quantita", e.target.value)}
                    className="w-full border rounded px-2 py-1.5 text-sm text-center"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={voce.prezzo_unitario}
                    onChange={(e) => updateVoce(idx, "prezzo_unitario", e.target.value)}
                    placeholder="0.00"
                    className="w-full border rounded px-2 py-1.5 text-sm text-right"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={voce.iva_pct}
                    onChange={(e) => updateVoce(idx, "iva_pct", e.target.value)}
                    className="w-full border rounded px-2 py-1.5 text-sm text-center"
                  />
                </td>
                <td className="px-2 py-1.5 text-right font-medium text-gray-700 tabular-nums">
                  {formatImporto(calcolaSubtotale(voce))}
                </td>
                <td className="px-2 py-1.5 text-center">
                  <button
                    type="button"
                    onClick={() => removeVoce(idx)}
                    disabled={voci.length <= 1}
                    className="text-red-400 hover:text-red-600 disabled:opacity-30 text-lg leading-none"
                    title="Rimuovi voce"
                  >
                    &times;
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totali */}
        <div className="bg-gray-50 border-t px-4 py-3 space-y-1">
          <div className="flex justify-between text-sm text-gray-600">
            <span>Imponibile</span>
            <span className="tabular-nums">{formatImporto(totali.imponibile)}</span>
          </div>
          <div className="flex justify-between text-sm text-gray-600">
            <span>IVA</span>
            <span className="tabular-nums">{formatImporto(totali.iva)}</span>
          </div>
          <div className="flex justify-between text-sm font-bold text-gray-900 pt-1 border-t border-gray-200">
            <span>Totale</span>
            <span className="tabular-nums">{formatImporto(totali.totale)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal crea / modifica preventivo
// ---------------------------------------------------------------------------

function ModalPreventivo({ preventivo, candidati, committenti, listino, onClose, onSave }) {
  const isNew = !preventivo?.id;
  const [form, setForm] = useState(() => {
    if (isNew) return { ...EMPTY_FORM };
    return {
      numero_preventivo: preventivo.numero_preventivo || "",
      candidato_id: preventivo.candidato_id || "",
      committente_id: preventivo.committente_id || "",
      data_preventivo: preventivo.data_preventivo ? preventivo.data_preventivo.slice(0, 10) : new Date().toISOString().slice(0, 10),
      data_scadenza: preventivo.data_scadenza ? preventivo.data_scadenza.slice(0, 10) : "",
      note_interne: preventivo.note_interne || "",
      note_cliente: preventivo.note_cliente || "",
      voci: preventivo.voci?.length
        ? preventivo.voci.map((v) => ({
            descrizione: v.descrizione || "",
            quantita: v.quantita || 1,
            prezzo_unitario: v.prezzo_unitario || "",
            iva_pct: v.iva_pct != null ? v.iva_pct : 22,
            subtotale: calcolaSubtotale(v),
          }))
        : [{ ...EMPTY_VOCE }],
    };
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // Carica prossimo numero per i nuovi
  useEffect(() => {
    if (!isNew) return;
    apiFetch("/preventivi/prossimo-numero")
      .then((data) => {
        if (data.numero) set("numero_preventivo", data.numero);
      })
      .catch(() => {});
  }, [isNew]);

  const totali = calcolaTotali(form.voci);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        imponibile: totali.imponibile,
        iva_totale: totali.iva,
        totale: totali.totale,
      };
      const result = isNew
        ? await apiFetch("/preventivi", { method: "POST", body: payload })
        : await apiFetch(`/preventivi/${preventivo.id}`, { method: "PUT", body: payload });
      onSave(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold text-gray-900">
            {isNew ? "Nuovo Preventivo" : `Modifica Preventivo ${preventivo.numero_preventivo || ""}`}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && <div className="bg-red-50 text-red-700 rounded-lg px-4 py-2 text-sm">{error}</div>}

          {/* Intestazione */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Numero preventivo</label>
              <input
                value={form.numero_preventivo}
                onChange={(e) => set("numero_preventivo", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50 font-mono"
                readOnly
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Data preventivo *</label>
              <input
                type="date"
                value={form.data_preventivo}
                onChange={(e) => set("data_preventivo", e.target.value)}
                required
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Data scadenza</label>
              <input
                type="date"
                value={form.data_scadenza}
                onChange={(e) => set("data_scadenza", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-end">
              <div className="w-full bg-blue-50 rounded-lg px-3 py-2 text-center">
                <div className="text-xs text-blue-600 font-medium">Totale</div>
                <div className="text-lg font-bold text-blue-800 tabular-nums">{formatImporto(totali.totale)}</div>
              </div>
            </div>
          </div>

          {/* Candidato e Committente */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Candidato *</label>
              <CandidatoSearch
                candidati={candidati}
                value={form.candidato_id}
                onChange={(id) => set("candidato_id", id)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Committente</label>
              <CommittenteSearch
                committenti={committenti}
                value={form.committente_id}
                onChange={(id) => set("committente_id", id)}
              />
            </div>
          </div>

          {/* Voci */}
          <VociEditor
            voci={form.voci}
            onChange={(newVoci) => set("voci", newVoci)}
            listino={listino}
          />

          {/* Note */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Note interne</label>
              <textarea
                value={form.note_interne}
                onChange={(e) => set("note_interne", e.target.value)}
                rows={3}
                className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
                placeholder="Note visibili solo all'operatore..."
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Note per il cliente</label>
              <textarea
                value={form.note_cliente}
                onChange={(e) => set("note_cliente", e.target.value)}
                rows={3}
                className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
                placeholder="Note visibili nel preventivo..."
              />
            </div>
          </div>

          {/* Azioni */}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50">
              Annulla
            </button>
            <button type="submit" disabled={saving}
              className="px-6 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? "Salvataggio\u2026" : isNew ? "Crea preventivo" : "Salva modifiche"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pannello dettaglio preventivo
// ---------------------------------------------------------------------------

function DettaglioPreventivo({ preventivo, candidatiMap, committentiMap, onClose, onCambiaStato, onModifica, onDuplica, onElimina }) {
  const candidato = candidatiMap[preventivo.candidato_id];
  const candidatoLabel = candidato ? `${candidato.cognome} ${candidato.nome}` : (preventivo.candidato_id || "\u2013");
  const committente = committentiMap[preventivo.committente_id];
  const committenteLabel = committente ? (committente.ragione_sociale || `${committente.cognome || ""} ${committente.nome || ""}`) : "";

  const voci = preventivo.voci || [];
  const totali = calcolaTotali(voci);

  const [busyStato, setBusyStato] = useState("");

  async function cambiaStato(nuovoStato) {
    setBusyStato(nuovoStato);
    try {
      await onCambiaStato(preventivo.id, nuovoStato);
    } finally {
      setBusyStato("");
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b bg-gray-50">
        <div>
          <h3 className="font-bold text-gray-900">
            Preventivo {preventivo.numero_preventivo || `#${String(preventivo.id).slice(0, 8)}`}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {formatData(preventivo.data_preventivo)}
            {preventivo.data_scadenza && ` \u2014 Scade: ${formatData(preventivo.data_scadenza)}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${statoChip(preventivo.stato)}`}>
            {preventivo.stato || "bozza"}
          </span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl ml-2">&times;</button>
        </div>
      </div>

      {/* Contenuto */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Intestatario */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="text-xs font-semibold text-gray-500 mb-1">Candidato</div>
            <div className="text-sm font-medium text-gray-900">{candidatoLabel}</div>
            {candidato?.codice_fiscale && (
              <div className="text-xs text-gray-400 font-mono mt-0.5">{candidato.codice_fiscale}</div>
            )}
          </div>
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="text-xs font-semibold text-gray-500 mb-1">Committente</div>
            <div className="text-sm font-medium text-gray-900">{committenteLabel || "\u2013"}</div>
            {committente?.partita_iva && (
              <div className="text-xs text-gray-400 font-mono mt-0.5">P.IVA {committente.partita_iva}</div>
            )}
          </div>
        </div>

        {/* Tabella voci */}
        <div>
          <div className="text-xs font-semibold text-gray-500 mb-2">Voci</div>
          <div className="border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Descrizione</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500">Qty</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Prezzo unit.</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500">IVA</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Subtotale</th>
                </tr>
              </thead>
              <tbody>
                {voci.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-gray-400 text-sm">Nessuna voce</td>
                  </tr>
                ) : (
                  voci.map((v, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="px-3 py-2 text-gray-800">{v.descrizione || "\u2013"}</td>
                      <td className="px-3 py-2 text-center text-gray-600">{v.quantita || 1}</td>
                      <td className="px-3 py-2 text-right text-gray-600 tabular-nums">{formatImporto(v.prezzo_unitario)}</td>
                      <td className="px-3 py-2 text-center text-gray-600">{v.iva_pct != null ? `${v.iva_pct}%` : "22%"}</td>
                      <td className="px-3 py-2 text-right font-medium text-gray-800 tabular-nums">{formatImporto(calcolaSubtotale(v))}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <div className="bg-gray-50 border-t px-4 py-3 space-y-1">
              <div className="flex justify-between text-sm text-gray-600">
                <span>Imponibile</span>
                <span className="tabular-nums">{formatImporto(preventivo.imponibile ?? totali.imponibile)}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-600">
                <span>IVA</span>
                <span className="tabular-nums">{formatImporto(preventivo.iva_totale ?? totali.iva)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-gray-900 pt-1 border-t border-gray-200">
                <span>Totale</span>
                <span className="tabular-nums">{formatImporto(preventivo.totale ?? totali.totale)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Note */}
        {(preventivo.note_interne || preventivo.note_cliente) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {preventivo.note_interne && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="text-xs font-semibold text-amber-700 mb-1">Note interne</div>
                <div className="text-sm text-gray-700 whitespace-pre-wrap">{preventivo.note_interne}</div>
              </div>
            )}
            {preventivo.note_cliente && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <div className="text-xs font-semibold text-blue-700 mb-1">Note per il cliente</div>
                <div className="text-sm text-gray-700 whitespace-pre-wrap">{preventivo.note_cliente}</div>
              </div>
            )}
          </div>
        )}

        {/* Azioni workflow */}
        <div className="space-y-3">
          <div className="text-xs font-semibold text-gray-500">Azioni</div>
          <div className="flex flex-wrap gap-2">
            {preventivo.stato === "bozza" && (
              <button
                onClick={() => cambiaStato("inviato")}
                disabled={!!busyStato}
                className="px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {busyStato === "inviato" ? "Invio\u2026" : "Invia al cliente"}
              </button>
            )}
            {(preventivo.stato === "inviato" || preventivo.stato === "bozza") && (
              <>
                <button
                  onClick={() => cambiaStato("accettato")}
                  disabled={!!busyStato}
                  className="px-4 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busyStato === "accettato" ? "Conferma\u2026" : "Segna come accettato"}
                </button>
                <button
                  onClick={() => cambiaStato("rifiutato")}
                  disabled={!!busyStato}
                  className="px-4 py-2 text-sm font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {busyStato === "rifiutato" ? "Rifiuto\u2026" : "Segna come rifiutato"}
                </button>
              </>
            )}
            <button
              onClick={() => onModifica(preventivo)}
              className="px-4 py-2 text-sm font-medium text-gray-700 border rounded-lg hover:bg-gray-50"
            >
              Modifica
            </button>
            <button
              onClick={() => onDuplica(preventivo)}
              className="px-4 py-2 text-sm font-medium text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-50"
            >
              Duplica
            </button>
            <button
              onClick={() => {
                if (window.confirm("Eliminare questo preventivo?")) onElimina(preventivo.id);
              }}
              className="px-4 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
            >
              Elimina
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagina principale
// ---------------------------------------------------------------------------

export default function PreventiviPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const [rows, setRows] = useState([]);
  const [candidati, setCandidati] = useState([]);
  const [committenti, setCommittenti] = useState([]);
  const [listino, setListino] = useState([]);
  const [stats, setStats] = useState(null);
  const [fetchError, setFetchError] = useState("");

  const [panel, setPanel] = useState(null);   // { mode: "detail"|"form", row? }
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(null);    // { mode: "new"|"edit"|"duplicate", preventivo? }

  const [filters, setFilters] = useState({
    search: "",
    stato: "",
    dataFrom: "",
    dataTo: "",
  });

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    async function init() {
      const session = await checkSession();
      if (!session.ok) { if (!cancelled) router.replace("/login"); return; }
      if (!cancelled) { setUser(session.autoscuola); setLoading(false); }
    }
    init();
    return () => { cancelled = true; };
  }, [router]);

  // ---------------------------------------------------------------------------
  // Caricamento dati
  // ---------------------------------------------------------------------------
  const loadPreventivi = useCallback(async () => {
    setFetchError("");
    try {
      const params = new URLSearchParams();
      if (filters.stato) params.set("stato", filters.stato);
      if (filters.dataFrom) params.set("data_da", filters.dataFrom);
      if (filters.dataTo) params.set("data_a", filters.dataTo);
      const base = getApiBase();
      const res = await fetch(`${base}/api/preventivi?${params}`, {
        headers: authHeaders(), cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(Array.isArray(data) ? data : (data.data || []));
    } catch (e) {
      setFetchError(e.message || "Errore caricamento preventivi");
    }
  }, [filters.stato, filters.dataFrom, filters.dataTo]);

  const loadStats = useCallback(async () => {
    try {
      const data = await apiFetch("/preventivi/statistiche");
      setStats(data);
    } catch { /* non critico */ }
  }, []);

  const loadCandidati = useCallback(async () => {
    try {
      const base = getApiBase();
      const res = await fetch(`${base}/api/candidati-api`, { headers: authHeaders(), cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setCandidati(Array.isArray(data) ? data : []);
    } catch { /* non critico */ }
  }, []);

  const loadCommittenti = useCallback(async () => {
    try {
      const result = await apiFetch("/committenti?attivo=true");
      setCommittenti(result.data || (Array.isArray(result) ? result : []));
    } catch { /* non critico */ }
  }, []);

  const loadListino = useCallback(async () => {
    try {
      const result = await apiFetch("/listino?attivo=true");
      setListino(result.data || (Array.isArray(result) ? result : []));
    } catch { /* non critico */ }
  }, []);

  useEffect(() => {
    if (!loading) {
      loadPreventivi();
      loadStats();
      loadCandidati();
      loadCommittenti();
      loadListino();
    }
  }, [loading, loadPreventivi, loadStats, loadCandidati, loadCommittenti, loadListino]);

  // Mappe lookup
  const candidatiMap = useMemo(() => {
    const m = {};
    candidati.forEach((c) => { m[c.id] = c; });
    return m;
  }, [candidati]);

  const committentiMap = useMemo(() => {
    const m = {};
    committenti.forEach((c) => { m[c.id] = c; });
    return m;
  }, [committenti]);

  // ---------------------------------------------------------------------------
  // Filtri client-side
  // ---------------------------------------------------------------------------
  const filtered = useMemo(() => {
    const search = filters.search.trim().toUpperCase();
    return rows
      .map((r) => {
        const cand = candidatiMap[r.candidato_id];
        const candLabel = cand ? `${cand.cognome} ${cand.nome}` : (r.candidato_id || "");
        const comm = committentiMap[r.committente_id];
        const commLabel = comm ? (comm.ragione_sociale || "") : "";
        return { ...r, _candidatoLabel: candLabel, _committenteLabel: commLabel };
      })
      .filter((r) => {
        if (search) {
          const hay = [r._candidatoLabel, r._committenteLabel, r.numero_preventivo, r.stato]
            .join(" ").toUpperCase();
          if (!hay.includes(search)) return false;
        }
        return true;
      });
  }, [rows, filters.search, candidatiMap, committentiMap]);

  // ---------------------------------------------------------------------------
  // Azioni
  // ---------------------------------------------------------------------------
  function handleSelectRow(r) {
    if (selected?.id === r.id && panel?.mode === "detail") {
      setSelected(null); setPanel(null);
    } else {
      setSelected(r); setPanel({ mode: "detail" });
    }
  }

  function handleNuovo() {
    setModal({ mode: "new" });
  }

  function handleModifica(p) {
    setModal({ mode: "edit", preventivo: p });
  }

  function handleDuplica(p) {
    const dup = { ...p };
    delete dup.id;
    delete dup.numero_preventivo;
    delete dup.created_at;
    delete dup.updated_at;
    dup.stato = "bozza";
    dup.data_preventivo = new Date().toISOString().slice(0, 10);
    setModal({ mode: "duplicate", preventivo: dup });
  }

  async function handleCambiaStato(id, nuovoStato) {
    try {
      await apiFetch(`/preventivi/${id}/stato`, { method: "PATCH", body: { stato: nuovoStato } });
      await loadPreventivi();
      await loadStats();
      // Aggiorna il dettaglio se ancora selezionato
      if (selected?.id === id) {
        setSelected((prev) => prev ? { ...prev, stato: nuovoStato } : null);
      }
    } catch (e) {
      alert(`Errore cambio stato: ${e.message}`);
    }
  }

  async function handleElimina(id) {
    try {
      await apiFetch(`/preventivi/${id}`, { method: "DELETE" });
      setRows((prev) => prev.filter((r) => r.id !== id));
      if (selected?.id === id) { setSelected(null); setPanel(null); }
      loadStats();
    } catch (e) {
      alert(`Errore eliminazione: ${e.message}`);
    }
  }

  function handleSaveModal(saved) {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === saved.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = saved; return n; }
      return [saved, ...prev];
    });
    setModal(null);
    loadStats();
    if (selected?.id === saved.id) {
      setSelected(saved);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-slate-600">Caricamento...</p>
      </div>
    );
  }

  const showPanel = panel !== null;

  // Statistiche locali di fallback
  const totPreventivi = filtered.length;
  const valoreTotale = filtered.reduce((s, r) => s + (parseFloat(r.totale) || 0), 0);
  const accettati = filtered.filter((r) => r.stato === "accettato").length;
  const rifiutati = filtered.filter((r) => r.stato === "rifiutato").length;
  const totConclusi = accettati + rifiutati;
  const tassoConversione = totConclusi > 0 ? Math.round((accettati / totConclusi) * 100) : 0;

  return (
    <ModernAppShell
      title="Preventivi"
      subtitle="Gestione preventivi e offerte per i candidati"
      activeKey="preventivi"
      user={user}
    >
      {/* Statistiche */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <div className="bg-white border rounded-xl p-4 text-center shadow-sm">
          <div className="text-2xl font-bold text-gray-800">{stats?.totale ?? totPreventivi}</div>
          <div className="text-xs text-gray-500 mt-1">Totale preventivi</div>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center shadow-sm">
          <div className="text-2xl font-bold text-blue-700">
            {formatImporto(stats?.valore_totale ?? valoreTotale)}
          </div>
          <div className="text-xs text-gray-500 mt-1">Valore totale</div>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center shadow-sm">
          <div className="text-2xl font-bold text-emerald-700">
            {stats?.tasso_conversione ?? tassoConversione}%
          </div>
          <div className="text-xs text-gray-500 mt-1">Tasso conversione</div>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center shadow-sm">
          <div className="flex items-center justify-center gap-3">
            <div>
              <div className="text-lg font-bold text-emerald-700">{stats?.accettati ?? accettati}</div>
              <div className="text-[10px] text-emerald-600">Accettati</div>
            </div>
            <div className="text-gray-300">|</div>
            <div>
              <div className="text-lg font-bold text-red-600">{stats?.rifiutati ?? rifiutati}</div>
              <div className="text-[10px] text-red-500">Rifiutati</div>
            </div>
          </div>
          <div className="text-xs text-gray-500 mt-1">Accettati vs Rifiutati</div>
        </div>
      </div>

      <div className="flex h-[calc(100vh-260px)] gap-4">
        {/* -- COLONNA SINISTRA -- */}
        <div className={`flex flex-col ${showPanel ? "w-1/2" : "w-full"} transition-all duration-200`}>

          {/* Filtri */}
          <div className="mb-3 flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="Cerca candidato, numero..."
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-indigo-400 focus:outline-none w-48"
            />
            <select
              value={filters.stato}
              onChange={(e) => setFilters((f) => ({ ...f, stato: e.target.value }))}
              className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none"
            >
              {STATI.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <input
              type="date"
              value={filters.dataFrom}
              onChange={(e) => setFilters((f) => ({ ...f, dataFrom: e.target.value }))}
              className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none"
              title="Data da"
            />
            <input
              type="date"
              value={filters.dataTo}
              onChange={(e) => setFilters((f) => ({ ...f, dataTo: e.target.value }))}
              className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none"
              title="Data a"
            />
            <button
              onClick={() => { loadPreventivi(); loadStats(); }}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Aggiorna
            </button>
            <button
              onClick={handleNuovo}
              className="h-9 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
            >
              + Nuovo
            </button>
            <button
              onClick={() => exportCSV(filtered)}
              disabled={filtered.length === 0}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-40"
              title="Esporta preventivi filtrati come CSV"
            >
              CSV
            </button>
          </div>

          {/* Conteggio */}
          <div className="mb-2 flex items-center gap-4 text-sm text-slate-500">
            <span>{filtered.length} preventivi</span>
            <span className="font-semibold text-slate-700">
              Valore: {valoreTotale.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}
            </span>
          </div>

          {fetchError && (
            <div className="mb-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {fetchError}
            </div>
          )}

          {/* Tabella */}
          <div className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Numero</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Data</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Candidato / Committente</th>
                  <th className="px-3 py-2 text-center font-semibold text-slate-600">Voci</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-600">Totale</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Stato</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      Nessun preventivo trovato
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => {
                    const isSelected = selected?.id === r.id;
                    return (
                      <tr
                        key={r.id}
                        onClick={() => handleSelectRow(r)}
                        className={`cursor-pointer border-b border-slate-100 transition-colors last:border-0 ${
                          isSelected ? "bg-indigo-50" : "hover:bg-slate-50"
                        }`}
                      >
                        <td className="px-3 py-2 font-mono text-sm text-slate-700 whitespace-nowrap">
                          {r.numero_preventivo || `#${String(r.id).slice(0, 8)}`}
                        </td>
                        <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                          {formatData(r.data_preventivo)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-800">{r._candidatoLabel || "\u2013"}</div>
                          {r._committenteLabel && (
                            <div className="text-xs text-slate-400">{r._committenteLabel}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center text-slate-600">
                          {r.voci?.length || 0}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800">
                          {formatImporto(r.totale)}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statoChip(r.stato)}`}>
                            {r.stato || "bozza"}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* -- COLONNA DESTRA -- */}
        {showPanel && (
          <div className="w-1/2 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            {panel.mode === "detail" && selected && (
              <DettaglioPreventivo
                preventivo={selected}
                candidatiMap={candidatiMap}
                committentiMap={committentiMap}
                onClose={() => { setSelected(null); setPanel(null); }}
                onCambiaStato={handleCambiaStato}
                onModifica={handleModifica}
                onDuplica={handleDuplica}
                onElimina={handleElimina}
              />
            )}
          </div>
        )}
      </div>

      {/* Modal crea / modifica */}
      {modal && (
        <ModalPreventivo
          preventivo={modal.mode === "edit" ? modal.preventivo : (modal.mode === "duplicate" ? modal.preventivo : null)}
          candidati={candidati}
          committenti={committenti}
          listino={listino}
          onClose={() => setModal(null)}
          onSave={handleSaveModal}
        />
      )}
    </ModernAppShell>
  );
}

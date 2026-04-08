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
import { formatData } from "../../lib/candidatoEditor";

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const TIPO_OPTIONS = [
  { value: "", label: "Tutti i tipi" },
  { value: "contanti", label: "Contanti" },
  { value: "pagoPA", label: "pagoPA" },
  { value: "satispay", label: "Satispay" },
  { value: "bonifico", label: "Bonifico" },
  { value: "POS", label: "POS / Carta" },
  { value: "scontrino", label: "Scontrino" },
];

const TIPO_FORM_OPTIONS = TIPO_OPTIONS.slice(1); // esclude "Tutti"

const ESITO_OPTIONS = [
  { value: "", label: "Tutti gli esiti" },
  { value: "completato", label: "Completato" },
  { value: "in attesa", label: "In attesa" },
  { value: "fallito", label: "Fallito" },
  { value: "rimborsato", label: "Rimborsato" },
];

const EMPTY_FORM = {
  candidato_id: "",
  candidato_label: "",
  tipo: "contanti",
  importo: "",
  causale: "",
  data_pagamento: new Date().toISOString().slice(0, 10),
  note: "",
};

function tipoChip(tipo) {
  const map = {
    contanti: "bg-emerald-100 text-emerald-800",
    pagoPA: "bg-blue-100 text-blue-800",
    satispay: "bg-orange-100 text-orange-800",
    bonifico: "bg-indigo-100 text-indigo-800",
    POS: "bg-violet-100 text-violet-800",
    scontrino: "bg-slate-100 text-slate-700",
  };
  return map[tipo] || "bg-slate-100 text-slate-700";
}

function esitoChip(esito) {
  const e = String(esito || "").toLowerCase();
  const map = {
    completato: "bg-emerald-100 text-emerald-800",
    "in attesa": "bg-amber-100 text-amber-800",
    fallito: "bg-red-100 text-red-800",
    rimborsato: "bg-sky-100 text-sky-800",
  };
  return map[e] || "bg-slate-100 text-slate-600";
}

function formatImporto(val) {
  if (val == null || val === "") return "–";
  const n = parseFloat(val);
  if (isNaN(n)) return String(val);
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

// ─── Punto 17 — Ricevuta fiscale / ricevuta di pagamento ─────────────────────

function generaRicevutaHTML(pagamento, autoscuola) {
  const data = pagamento.data_pagamento
    ? new Date(pagamento.data_pagamento).toLocaleDateString("it-IT")
    : new Date().toLocaleDateString("it-IT");
  const importo = pagamento.importo != null
    ? Number(pagamento.importo).toLocaleString("it-IT", { style: "currency", currency: "EUR" })
    : "–";
  const intestazione = autoscuola?.ragione_sociale || autoscuola?.nome || autoscuola?.codice_autoscuola || "Autoscuola";
  const indirizzo = [autoscuola?.indirizzo, autoscuola?.cap, autoscuola?.comune, autoscuola?.provincia].filter(Boolean).join(", ") || "";
  const piva = autoscuola?.partita_iva || autoscuola?.p_iva || "";
  const cf   = autoscuola?.codice_fiscale || "";
  const num  = pagamento.progressivo || pagamento.id?.toString().slice(-6) || "–";
  const candidato = pagamento._candidatoLabel || pagamento.candidato_id || "–";

  return `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8">
<title>Ricevuta ${num}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 11pt; margin: 20mm 15mm; color: #111; }
  .header { border-bottom: 2px solid #1a1a1a; padding-bottom: 10px; margin-bottom: 16px; }
  .header h1 { font-size: 18pt; margin: 0 0 4px 0; }
  .header p { margin: 2px 0; font-size: 10pt; color: #444; }
  .title { font-size: 15pt; font-weight: bold; text-align: center; margin: 14px 0; letter-spacing: 1px; }
  table { width: 100%; border-collapse: collapse; margin: 14px 0; }
  th, td { border: 1px solid #ccc; padding: 7px 10px; font-size: 11pt; }
  th { background: #f0f0f0; font-weight: bold; text-align: left; }
  .totale { text-align: right; font-size: 14pt; font-weight: bold; margin: 12px 0; }
  .firma { margin-top: 40px; display: flex; justify-content: space-between; font-size: 10pt; }
  .firma div { border-top: 1px solid #333; padding-top: 4px; width: 45%; text-align: center; }
  .note { margin-top: 14px; font-size: 9pt; color: #888; border-top: 1px solid #ddd; padding-top: 8px; }
  @media print { body { margin: 10mm; } }
</style></head><body>
<div class="header">
  <h1>${intestazione}</h1>
  ${indirizzo ? `<p>${indirizzo}</p>` : ""}
  ${piva ? `<p>P.IVA: ${piva}</p>` : ""}
  ${cf ? `<p>C.F.: ${cf}</p>` : ""}
</div>
<div class="title">RICEVUTA DI PAGAMENTO N. ${num}</div>
<table>
  <tr><th>Data</th><td>${data}</td></tr>
  <tr><th>Candidato</th><td>${candidato}</td></tr>
  <tr><th>Tipo pagamento</th><td>${pagamento.tipo || "–"}</td></tr>
  <tr><th>Causale</th><td>${pagamento.causale || "–"}</td></tr>
  ${pagamento.idtrx ? `<tr><th>ID Transazione</th><td>${pagamento.idtrx}</td></tr>` : ""}
  ${pagamento.esito ? `<tr><th>Esito</th><td>${pagamento.esito}</td></tr>` : ""}
</table>
<div class="totale">Importo ricevuto: ${importo}</div>
<div class="firma">
  <div>Data e firma candidato</div>
  <div>Timbro e firma autoscuola</div>
</div>
<div class="note">Documento non valido ai fini fiscali come fattura. Per informazioni: ${autoscuola?.email || autoscuola?.telefono || ""}</div>
<script>window.onload=()=>window.print();</script>
</body></html>`;
}

function apriRicevuta(pagamento, autoscuola) {
  const html = generaRicevutaHTML(pagamento, autoscuola);
  const w = window.open("", "_blank", "width=800,height=700");
  w.document.write(html);
  w.document.close();
}

function exportCSV(rows) {
  const headers = ["Data", "Candidato", "Tipo", "Importo", "Causale", "Esito", "ID Transazione", "Progressivo"];
  const lines = rows.map((r) => [
    r.data_pagamento ? new Date(r.data_pagamento).toLocaleDateString("it-IT") : "",
    r._candidatoLabel || r.candidato_id || "",
    r.tipo || "",
    r.importo != null ? String(r.importo).replace(".", ",") : "",
    `"${(r.causale || "").replace(/"/g, '""')}"`,
    r.esito || "",
    r.idtrx || "",
    r.progressivo || "",
  ]);
  const csv = [headers.join(";"), ...lines.map((l) => l.join(";"))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pagamenti_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Componente principale
// ---------------------------------------------------------------------------

export default function PagamentiPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const [rows, setRows] = useState([]);
  const [candidati, setCandidati] = useState([]);
  const [fetchError, setFetchError] = useState("");

  // Pannello destra: "detail" | "new" | null
  const [panel, setPanel] = useState(null); // { mode: "detail"|"new", row? }
  const [selected, setSelected] = useState(null);

  const [filters, setFilters] = useState({
    search: "",
    tipo: "",
    esito: "",
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
  const loadPagamenti = useCallback(async () => {
    setFetchError("");
    try {
      const params = new URLSearchParams();
      if (filters.tipo) params.set("tipo", filters.tipo);
      const res = await fetch(`${API_BASE}/api/pagamenti?${params}`, {
        headers: authHeaders(), cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setFetchError(e.message || "Errore caricamento pagamenti");
    }
  }, [filters.tipo]);

  const loadCandidati = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/candidati-api`, { headers: authHeaders(), cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setCandidati(Array.isArray(data) ? data : []);
    } catch { /* non critico */ }
  }, []);

  useEffect(() => {
    if (!loading) { loadPagamenti(); loadCandidati(); }
  }, [loading, loadPagamenti, loadCandidati]);

  // Mappa candidati per lookup rapido
  const candidatiMap = useMemo(() => {
    const m = {};
    candidati.forEach((c) => { m[c.id] = c; });
    return m;
  }, [candidati]);

  // ---------------------------------------------------------------------------
  // Filtri client-side
  // ---------------------------------------------------------------------------
  const filtered = useMemo(() => {
    const search = filters.search.trim().toUpperCase();
    return rows
      .map((r) => {
        const c = candidatiMap[r.candidato_id];
        const label = c ? `${c.cognome} ${c.nome}` : (r.candidato_id || "");
        return { ...r, _candidatoLabel: label };
      })
      .filter((r) => {
        if (search) {
          const hay = [r._candidatoLabel, r.causale, r.idtrx, r.progressivo, r.tipo]
            .join(" ").toUpperCase();
          if (!hay.includes(search)) return false;
        }
        if (filters.esito) {
          if (String(r.esito || "").toLowerCase() !== filters.esito) return false;
        }
        if (filters.dataFrom) {
          const d = r.data_pagamento || r.created_at || "";
          if (d && d.slice(0, 10) < filters.dataFrom) return false;
        }
        if (filters.dataTo) {
          const d = r.data_pagamento || r.created_at || "";
          if (d && d.slice(0, 10) > filters.dataTo) return false;
        }
        return true;
      });
  }, [rows, filters, candidatiMap]);

  const totaleFiltered = useMemo(() =>
    filtered.reduce((s, r) => s + (parseFloat(r.importo) || 0), 0),
    [filtered]
  );

  // ---------------------------------------------------------------------------
  // Azioni riga
  // ---------------------------------------------------------------------------
  function handleSelectRow(r) {
    if (selected?.id === r.id && panel?.mode === "detail") {
      setSelected(null); setPanel(null);
    } else {
      setSelected(r); setPanel({ mode: "detail" });
    }
  }

  function handleNuovoPagamento() {
    setSelected(null);
    setPanel({ mode: "new" });
  }

  function handlePanelClose() {
    setSelected(null); setPanel(null);
  }

  function handleResocontoGiornaliero() {
    setSelected(null);
    setPanel({ mode: "resocon" });
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

  return (
    <ModernAppShell
      title="Pagamenti"
      subtitle="Cassa, pagoPA, satispay, bonifico, POS — registrazione e storico"
      activeKey="pagamenti"
      onLogout={() => logoutSession().then(() => router.replace("/login"))}
      user={user}
    >
      <div className="flex h-[calc(100vh-120px)] gap-4">
        {/* ── COLONNA SINISTRA ── */}
        <div className={`flex flex-col ${showPanel ? "w-1/2" : "w-full"} transition-all duration-200`}>

          {/* Filtri */}
          <div className="mb-3 flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="Cerca candidato, causale, ID…"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-indigo-400 focus:outline-none w-48"
            />
            <select
              value={filters.tipo}
              onChange={(e) => setFilters((f) => ({ ...f, tipo: e.target.value }))}
              className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none"
            >
              {TIPO_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              value={filters.esito}
              onChange={(e) => setFilters((f) => ({ ...f, esito: e.target.value }))}
              className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none"
            >
              {ESITO_OPTIONS.map((o) => (
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
              onClick={loadPagamenti}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Aggiorna
            </button>
            <button
              onClick={handleNuovoPagamento}
              className="h-9 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
            >
              + Nuovo
            </button>
            <button
              onClick={() => exportCSV(filtered)}
              disabled={filtered.length === 0}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-40"
              title="Esporta storico filtrato come CSV"
            >
              ↓ CSV
            </button>
            <button
              onClick={handleResocontoGiornaliero}
              className="h-9 rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-sm font-medium text-emerald-700 shadow-sm hover:bg-emerald-100"
              title="Resoconto incasso giornaliero"
            >
              📊 Resoconto
            </button>
          </div>

          {/* Totale + conteggio */}
          <div className="mb-2 flex items-center gap-4 text-sm text-slate-500">
            <span>{filtered.length} pagamenti</span>
            <span className="font-semibold text-slate-700">
              Totale: {totaleFiltered.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}
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
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Data</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Candidato</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Tipo</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-600">Importo</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Causale</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Esito</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      Nessun pagamento trovato
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => {
                    const isSelected = selected?.id === r.id;
                    const dataStr = r.data_pagamento || r.created_at || "";
                    return (
                      <tr
                        key={r.id}
                        onClick={() => handleSelectRow(r)}
                        className={`cursor-pointer border-b border-slate-100 transition-colors last:border-0 ${
                          isSelected ? "bg-indigo-50" : "hover:bg-slate-50"
                        }`}
                      >
                        <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                          {dataStr ? formatData(dataStr.slice(0, 10)) : "–"}
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-800">{r._candidatoLabel || "–"}</div>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tipoChip(r.tipo)}`}>
                            {r.tipo || "–"}
                          </span>
                        </td>
                        <td className={`px-3 py-2 text-right font-semibold tabular-nums ${
                          parseFloat(r.importo) < 0 ? "text-red-600" : "text-slate-800"
                        }`}>
                          {formatImporto(r.importo)}
                        </td>
                        <td className="px-3 py-2 text-slate-600 max-w-40 truncate" title={r.causale}>
                          {r.causale || "–"}
                        </td>
                        <td className="px-3 py-2">
                          {r.esito ? (
                            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${esitoChip(r.esito)}`}>
                              {r.esito}
                            </span>
                          ) : (
                            <span className="text-slate-400">–</span>
                          )}
                        </td>
                        {/* Punto 17 — Ricevuta fiscale */}
                        <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => apriRicevuta(r, user)}
                            title="Genera ricevuta di pagamento (PDF/stampa)"
                            className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800 hover:bg-amber-100"
                          >
                            🧾
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── COLONNA DESTRA ── */}
        {showPanel && (
          <div className="w-1/2 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            {panel.mode === "detail" && selected && (
              <DettaglioPagamento
                row={selected}
                candidatoLabel={selected._candidatoLabel}
                onClose={handlePanelClose}
                onRefresh={() => { loadPagamenti(); handlePanelClose(); }}
              />
            )}
            {panel.mode === "new" && (
              <FormNuovoPagamento
                candidati={candidati}
                onClose={handlePanelClose}
                onSaved={() => { loadPagamenti(); handlePanelClose(); }}
              />
            )}
            {panel.mode === "resocon" && (
              <ResocontoGiornaliero
                allRows={rows}
                candidatiMap={candidatiMap}
                onClose={handlePanelClose}
              />
            )}
          </div>
        )}
      </div>
    </ModernAppShell>
  );
}

// ---------------------------------------------------------------------------
// Pannello dettaglio pagamento
// ---------------------------------------------------------------------------

function DettaglioPagamento({ row, candidatoLabel, onClose, onRefresh }) {
  const [busy, setBusy] = useState("");
  const [actionMsg, setActionMsg] = useState("");
  const [actionErr, setActionErr] = useState("");

  // Decurtazione: registra nuovo pagamento con importo negativo
  async function handleDecurtazione() {
    const importoStr = window.prompt(
      "Importo decurtazione (es. 50.00):",
      String(Math.abs(parseFloat(row.importo) || 0))
    );
    if (!importoStr) return;
    const importo = parseFloat(importoStr.replace(",", "."));
    if (isNaN(importo) || importo <= 0) {
      setActionErr("Importo non valido.");
      return;
    }
    setBusy("decurtazione");
    setActionMsg(""); setActionErr("");
    try {
      const res = await fetch(`${API_BASE}/api/pagamenti`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          candidato_id: row.candidato_id,
          tipo: row.tipo,
          importo: -importo,
          causale: `Decurtazione su pagamento ${row.id?.slice(0, 8) || ""}`,
          data_pagamento: new Date().toISOString().slice(0, 10),
          esito: "completato",
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Errore");
      setActionMsg("Decurtazione registrata.");
      onRefresh();
    } catch (e) {
      setActionErr(e.message);
    } finally {
      setBusy("");
    }
  }

  // PagoPA
  async function handlePagoPA() {
    setBusy("pagoPA"); setActionMsg(""); setActionErr("");
    try {
      const res = await fetch(`${API_BASE}/api/pagamenti/pagoPA`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ candidato_id: row.candidato_id, importo: row.importo, idtrx: row.idtrx }),
      });
      const data = await res.json();
      if (data.redirectUrl) {
        window.open(data.redirectUrl, "_blank");
      }
      setActionMsg(data.message || "Richiesta pagoPA inviata.");
    } catch (e) {
      setActionErr(e.message);
    } finally {
      setBusy("");
    }
  }

  // Satispay
  async function handleSatispay() {
    setBusy("satispay"); setActionMsg(""); setActionErr("");
    try {
      const res = await fetch(`${API_BASE}/api/pagamenti/satispay`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ candidato_id: row.candidato_id, importo: row.importo }),
      });
      const data = await res.json();
      setActionMsg(data.message || "Richiesta Satispay inviata.");
    } catch (e) {
      setActionErr(e.message);
    } finally {
      setBusy("");
    }
  }

  const dataStr = row.data_pagamento || row.created_at || "";

  const fields = [
    { label: "Data pagamento", value: dataStr ? formatData(dataStr.slice(0, 10)) : null },
    { label: "Candidato", value: candidatoLabel },
    { label: "Tipo", value: row.tipo },
    { label: "Importo", value: formatImporto(row.importo) },
    { label: "Causale", value: row.causale },
    { label: "Esito", value: row.esito },
    { label: "ID Transazione", value: row.idtrx },
    { label: "Progressivo", value: row.progressivo },
    { label: "Registrato il", value: row.created_at ? formatData(row.created_at.slice(0, 10)) : null },
  ];

  return (
    <div className="p-4">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-800">
            Pagamento {row.id ? `#${row.id.slice(0, 8)}` : ""}
          </h2>
          <p className="text-sm text-slate-500">{candidatoLabel || "—"}</p>
          <div className="mt-1 flex gap-1.5 flex-wrap">
            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tipoChip(row.tipo)}`}>
              {row.tipo || "–"}
            </span>
            {row.esito && (
              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${esitoChip(row.esito)}`}>
                {row.esito}
              </span>
            )}
          </div>
        </div>
        <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1 text-sm text-slate-500 hover:bg-slate-50">
          ✕ Chiudi
        </button>
      </div>

      {/* Dati */}
      <Section title="Dettaglio pagamento" fields={fields} />

      {/* Azioni */}
      <div className="mt-5 rounded-lg border border-violet-200 bg-violet-50 p-3">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-violet-700">Azioni</p>
        <div className="flex flex-wrap gap-2">
          {/* Decurtazione — sempre disponibile */}
          <button
            type="button"
            disabled={!!busy}
            onClick={handleDecurtazione}
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
            title="Registra un importo negativo (storno/rimborso parziale)"
          >
            {busy === "decurtazione" ? "…" : "↩ Decurtazione"}
          </button>

          {/* PagoPA */}
          {(row.tipo === "pagoPA" || !row.tipo) && (
            <button
              type="button"
              disabled={!!busy}
              onClick={handlePagoPA}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              title="Avvia/ripeti pagamento pagoPA"
            >
              {busy === "pagoPA" ? "…" : "🏦 Avvia pagoPA"}
            </button>
          )}

          {/* Satispay */}
          {(row.tipo === "satispay" || !row.tipo) && (
            <button
              type="button"
              disabled={!!busy}
              onClick={handleSatispay}
              className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
              title="Avvia pagamento Satispay"
            >
              {busy === "satispay" ? "…" : "📱 Avvia Satispay"}
            </button>
          )}
        </div>

        {actionMsg && (
          <p className="mt-2 rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-800">✅ {actionMsg}</p>
        )}
        {actionErr && (
          <p className="mt-2 rounded bg-red-100 px-2 py-1 text-xs text-red-700">❌ {actionErr}</p>
        )}
      </div>

      {/* Navigazione */}
      {row.candidato_id && (
        <div className="mt-4 flex gap-2">
          <a
            href={`/anagrafica-iscrizioni?id=${row.candidato_id}`}
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
          >
            Apri candidato in Anagrafica
          </a>
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
            Chiudi
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form nuovo pagamento
// ---------------------------------------------------------------------------

function FormNuovoPagamento({ candidati, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [candidatoSearch, setCandidatoSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  const candidatiFiltrati = useMemo(() => {
    const q = candidatoSearch.trim().toUpperCase();
    if (!q) return candidati.slice(0, 30);
    return candidati
      .filter((c) =>
        `${c.cognome} ${c.nome} ${c.codice_fiscale}`.toUpperCase().includes(q)
      )
      .slice(0, 20);
  }, [candidati, candidatoSearch]);

  function selectCandidato(c) {
    setForm((f) => ({ ...f, candidato_id: c.id, candidato_label: `${c.cognome} ${c.nome}` }));
    setCandidatoSearch(`${c.cognome} ${c.nome}`);
    setShowDropdown(false);
  }

  function setField(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.importo || isNaN(parseFloat(form.importo))) {
      setSaveErr("Importo obbligatorio e numerico.");
      return;
    }
    if (!form.tipo) {
      setSaveErr("Seleziona il tipo di pagamento.");
      return;
    }
    setSaving(true); setSaveErr("");
    try {
      const payload = {
        candidato_id: form.candidato_id || null,
        tipo: form.tipo,
        importo: parseFloat(String(form.importo).replace(",", ".")),
        causale: form.causale || null,
        data_pagamento: form.data_pagamento || new Date().toISOString().slice(0, 10),
        esito: "completato",
        note: form.note || null,
      };
      const res = await fetch(`${API_BASE}/api/pagamenti`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Errore salvataggio");
      onSaved();
    } catch (e) {
      setSaveErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800">Nuovo pagamento</h2>
        <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1 text-sm text-slate-500 hover:bg-slate-50">
          ✕ Chiudi
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        {/* Candidato — ricerca */}
        <div className="relative">
          <label className="mb-1 block text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Candidato
          </label>
          <input
            type="text"
            placeholder="Cerca per cognome, nome o CF…"
            value={candidatoSearch}
            onChange={(e) => { setCandidatoSearch(e.target.value); setShowDropdown(true); setForm((f) => ({ ...f, candidato_id: "", candidato_label: "" })); }}
            onFocus={() => setShowDropdown(true)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
          />
          {showDropdown && candidatiFiltrati.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {candidatiFiltrati.map((c) => (
                <li
                  key={c.id}
                  onMouseDown={() => selectCandidato(c)}
                  className="cursor-pointer px-3 py-2 text-sm hover:bg-indigo-50"
                >
                  <span className="font-medium">{c.cognome} {c.nome}</span>
                  <span className="ml-2 text-xs text-slate-400">{c.codice_fiscale}</span>
                </li>
              ))}
            </ul>
          )}
          {form.candidato_id && (
            <p className="mt-0.5 text-xs text-emerald-700">✓ {form.candidato_label}</p>
          )}
        </div>

        {/* Importo + Tipo */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Importo (€) <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={form.importo}
              onChange={(e) => setField("importo", e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Tipo pagamento <span className="text-red-500">*</span>
            </label>
            <select
              value={form.tipo}
              onChange={(e) => setField("tipo", e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-indigo-400 focus:outline-none"
            >
              {TIPO_FORM_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Causale */}
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Causale
          </label>
          <input
            type="text"
            placeholder="Es. Prima rata iscrizione, Foglio rosa…"
            value={form.causale}
            onChange={(e) => setField("causale", e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
          />
        </div>

        {/* Data pagamento */}
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Data pagamento
          </label>
          <input
            type="date"
            value={form.data_pagamento}
            onChange={(e) => setField("data_pagamento", e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
          />
        </div>

        {/* Note */}
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Note
          </label>
          <textarea
            rows={2}
            placeholder="Note aggiuntive…"
            value={form.note}
            onChange={(e) => setField("note", e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none resize-none"
          />
        </div>

        {saveErr && (
          <p className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            ❌ {saveErr}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? "Salvataggio…" : "Salva pagamento"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Annulla
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resoconto Giornaliero (GeCA: resocon)
// ---------------------------------------------------------------------------

function ResocontoGiornaliero({ allRows, candidatiMap, onClose }) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [data, setData] = useState(todayStr);

  const righe = useMemo(() => {
    return allRows
      .map((r) => {
        const c = candidatiMap[r.candidato_id];
        return { ...r, _label: c ? `${c.cognome} ${c.nome}` : (r.candidato_id ? r.candidato_id.slice(0, 8) + "…" : "–") };
      })
      .filter((r) => {
        const d = (r.data_pagamento || r.created_at || "").slice(0, 10);
        return d === data;
      });
  }, [allRows, candidatiMap, data]);

  const totaleGlobale = righe.reduce((s, r) => s + (parseFloat(r.importo) || 0), 0);

  // Raggruppamento per tipo
  const perTipo = useMemo(() => {
    const m = {};
    righe.forEach((r) => {
      const t = r.tipo || "altro";
      if (!m[t]) m[t] = { count: 0, totale: 0 };
      m[t].count++;
      m[t].totale += parseFloat(r.importo) || 0;
    });
    return Object.entries(m).sort((a, b) => b[1].totale - a[1].totale);
  }, [righe]);

  const tipoColors = {
    contanti: "bg-emerald-100 text-emerald-800",
    pagoPA: "bg-blue-100 text-blue-800",
    satispay: "bg-orange-100 text-orange-800",
    bonifico: "bg-indigo-100 text-indigo-800",
    POS: "bg-violet-100 text-violet-800",
    scontrino: "bg-slate-100 text-slate-700",
  };

  function handlePrint() {
    window.print();
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800">📊 Resoconto incasso</h2>
        <div className="flex items-center gap-2">
          <button onClick={handlePrint} className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm text-slate-600 hover:bg-slate-50" title="Stampa">🖨 Stampa</button>
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1 text-sm text-slate-500 hover:bg-slate-50">✕ Chiudi</button>
        </div>
      </div>

      {/* Selettore data */}
      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm font-medium text-slate-600">Data:</label>
        <input
          type="date"
          value={data}
          onChange={(e) => setData(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none"
        />
        <button onClick={() => setData(todayStr)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Oggi</button>
        <span className="text-xs text-slate-400">({righe.length} transazioni)</span>
      </div>

      {righe.length === 0 ? (
        <div className="rounded-lg bg-slate-50 border border-slate-200 py-10 text-center text-slate-400">
          Nessun pagamento registrato per il {new Date(data + "T00:00:00Z").toLocaleDateString("it-IT")}
        </div>
      ) : (
        <>
          {/* KPI per tipo */}
          <div className="mb-4 grid grid-cols-2 gap-2">
            {perTipo.map(([tipo, { count, totale }]) => (
              <div key={tipo} className={`rounded-lg border p-3 ${tipoColors[tipo] || "bg-slate-100 text-slate-700 border-slate-200"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase">{tipo}</span>
                  <span className="text-xs opacity-70">{count} trans.</span>
                </div>
                <p className="mt-1 text-xl font-bold tabular-nums">
                  {totale.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}
                </p>
              </div>
            ))}
          </div>

          {/* Totale giornaliero */}
          <div className="mb-4 rounded-xl border-2 border-indigo-300 bg-indigo-50 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-indigo-800 uppercase tracking-wide">Totale incasso giornaliero</span>
              <span className="text-2xl font-bold text-indigo-900 tabular-nums">
                {totaleGlobale.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}
              </span>
            </div>
            <p className="mt-1 text-xs text-indigo-600">
              {new Date(data + "T00:00:00Z").toLocaleDateString("it-IT", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
            </p>
          </div>

          {/* Lista dettaglio transazioni */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Dettaglio transazioni</p>
            <div className="overflow-auto max-h-[40vh] rounded-lg border border-slate-200">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="border-b border-slate-200">
                    <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Candidato</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Tipo</th>
                    <th className="px-2 py-1.5 text-right font-semibold text-slate-600">Importo</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Causale</th>
                  </tr>
                </thead>
                <tbody>
                  {righe.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="px-2 py-1.5 font-medium text-slate-800">{r._label}</td>
                      <td className="px-2 py-1.5">
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${tipoColors[r.tipo] || "bg-slate-100 text-slate-600"}`}>{r.tipo || "–"}</span>
                      </td>
                      <td className={`px-2 py-1.5 text-right font-semibold tabular-nums ${parseFloat(r.importo) < 0 ? "text-red-600" : "text-slate-800"}`}>
                        {parseFloat(r.importo || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" })}
                      </td>
                      <td className="px-2 py-1.5 text-slate-600 max-w-[120px] truncate">{r.causale || "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section helper
// ---------------------------------------------------------------------------

function Section({ title, fields }) {
  const hasValues = fields.some((f) => f.value != null && f.value !== "" && f.value !== "–");
  if (!hasValues) return null;
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      <div className="rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            {fields.map(({ label, value }) =>
              value != null && value !== "" && value !== "–" ? (
                <tr key={label} className="border-b border-slate-100 last:border-0">
                  <td className="w-40 px-3 py-1.5 text-slate-500">{label}</td>
                  <td className="px-3 py-1.5 font-medium text-slate-800">{value}</td>
                </tr>
              ) : null
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

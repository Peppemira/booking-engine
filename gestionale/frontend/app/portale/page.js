"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getApiBase, authHeaders, checkSession, logoutSession } from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";

// ─── Utility ───────────────────────────────────────────────────────────────────

function apiBase() {
  if (typeof window === "undefined") return "http://localhost:3000";
  const saved = typeof window !== "undefined" && window.localStorage?.getItem("autoscuola_api_base");
  if (saved) return saved.trim();
  return getApiBase();
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function isoToDDMMYYYY(iso) {
  if (!iso) return "";
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatDateIT(str) {
  if (!str) return "–";
  const s = String(str).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return new Date(s + "T00:00:00Z").toLocaleDateString("it-IT");
  }
  return str;
}

// ─── Export Utility ───────────────────────────────────────────────────────────

function exportCSV(intestazioni, righe, filename = "export.csv") {
  if (!righe || righe.length === 0) return;
  const sep = ";";
  const header = (intestazioni || []).map(h => `"${String(h || "").replace(/"/g, '""')}"`).join(sep);
  const rows = righe.map(r =>
    (Array.isArray(r) ? r : [r]).map(c => `"${String(c || "").replace(/"/g, '""')}"`).join(sep)
  );
  const csv = [header, ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function copyTableText(intestazioni, righe) {
  if (!righe || righe.length === 0) return;
  const sep = "\t";
  const header = (intestazioni || []).join(sep);
  const rows = righe.map(r => (Array.isArray(r) ? r : [r]).map(c => String(c || "")).join(sep));
  const text = [header, ...rows].join("\n");
  navigator.clipboard?.writeText(text).catch(() => {
    // fallback: select textarea
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  });
}

function printTable(intestazioni, righe, title = "Stampa") {
  if (!righe || righe.length === 0) return;
  const headerHtml = (intestazioni || []).map(h => `<th style="border:1px solid #ccc;padding:4px 8px;background:#f0f0f0;font-size:11px">${h || ""}</th>`).join("");
  const rowsHtml = righe.map(r => {
    const cells = (Array.isArray(r) ? r : [r]).map(c => `<td style="border:1px solid #eee;padding:3px 6px;font-size:11px">${c || "–"}</td>`).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  const html = `<!DOCTYPE html><html><head><title>${title}</title><style>body{font-family:Arial,sans-serif;margin:20px}table{border-collapse:collapse;width:100%}h2{font-size:14px;margin-bottom:10px}</style></head><body><h2>${title}</h2><table><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table></body></html>`;
  const win = window.open("", "_blank", "width=900,height=600");
  if (win) {
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 300);
  }
}

// Stampa Prenotazione – genera ricevuta prenotazione candidato (come nel portale)
function printStampaPrenotazione(candidato, sessionePairs, campiStoria, verbali) {
  const c = candidato || {};
  const cognome = c.Cognome || c.cognome || "–";
  const marca = c["Marca Operativa"] || c.marca_operativa || "–";
  const turno = c.Turno || c.turno || "–";
  const lingua = c.Lingua || c.lingua || "–";
  const autoscuola = c.Autoscuola || c.autoscuola || "–";
  const ente = c.Ente || c.ente || "–";
  const audio = c["Supporto Audio"] || c.supportoAudio || "–";
  const patente = c.Patente || c.patente || "–";
  const numDomande = c["Num. Domande"] || c.numDomande || "–";
  const esaminatore = c.Esaminatore || c.esaminatore || "–";
  const abilitazione = c.Abilitazione || c.abilitazione || "–";
  const anomalia = c["Codice Anomalia"] || c.codiceAnomalia || "–";

  // Dati sessione dai pairs
  const sp = {};
  (sessionePairs || []).forEach(p => { if (p.label && p.value && p.value !== "–") sp[p.label] = p.value; });
  const dataSessione = sp["Data Sess."] || sp["Data"] || sp["Data Sessione"] || "–";
  const localita = sp["Località"] || sp["Localita"] || "–";
  const tipoEsame = sp["Tipo Esame"] || sp["Tipo"] || "–";
  const sede = sp["Ufficio Prov."] || sp["Ufficio"] || "–";
  const stato = sp["Stato"] || sp["Seduta Stato"] || "–";
  const aula = sp["Aula"] || "–";
  const fasciaOraria = sp["Fascia Oraria"] || "–";
  const capienza = sp["Capienza Aula"] || "–";
  const numTurni = sp["Num. Turni"] || "–";

  // Campi extra dalla storia (campi aggiuntivi dal portale)
  const cs = campiStoria || {};

  // Verbali
  const verbaliHtml = (verbali && verbali.length > 0) ? (() => {
    const headers = Object.keys(verbali[0]).filter(k => !k.startsWith("_"));
    const hdr = headers.map(h => `<th style="border:1px solid #999;padding:4px 8px;background:#e8e8f0;font-size:10px;text-align:left">${h}</th>`).join("");
    const rows = verbali.map(v => {
      const cells = headers.map(h => `<td style="border:1px solid #ddd;padding:3px 6px;font-size:10px">${v[h] || "–"}</td>`).join("");
      return `<tr>${cells}</tr>`;
    }).join("");
    return `<h3 style="font-size:13px;margin:16px 0 8px;color:#333;border-bottom:1px solid #ccc;padding-bottom:4px">Storico Esami / Verbali</h3>
      <table style="border-collapse:collapse;width:100%"><thead><tr>${hdr}</tr></thead><tbody>${rows}</tbody></table>`;
  })() : "";

  const now = new Date();
  const dataStampa = now.toLocaleDateString("it-IT") + " " + now.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

  const html = `<!DOCTYPE html><html><head><title>Stampa Prenotazione - ${cognome}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #222; }
  .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 16px; }
  .header h1 { font-size: 16px; margin: 0 0 4px; color: #1a1a6e; }
  .header h2 { font-size: 13px; margin: 0; font-weight: normal; color: #555; }
  .section { margin-bottom: 14px; }
  .section-title { font-size: 13px; font-weight: bold; color: #333; border-bottom: 1px solid #ccc; padding-bottom: 3px; margin-bottom: 8px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; }
  .field { display: flex; gap: 6px; font-size: 11px; padding: 2px 0; }
  .field .label { font-weight: bold; color: #555; min-width: 130px; }
  .field .value { color: #111; }
  table { border-collapse: collapse; width: 100%; margin-top: 6px; }
  .footer { margin-top: 20px; border-top: 1px solid #ccc; padding-top: 8px; font-size: 9px; color: #999; text-align: center; }
  @media print { body { margin: 10px; } }
</style></head><body>
<div class="header">
  <h1>PRENOTAZIONE CANDIDATO - SESSIONE ESAME</h1>
  <h2>Portale dell'Automobilista – Prenotazione Esami</h2>
</div>

<div class="section">
  <div class="section-title">Dati Sessione</div>
  <div class="grid">
    <div class="field"><span class="label">Data Sessione:</span><span class="value">${dataSessione}</span></div>
    <div class="field"><span class="label">Tipo Esame:</span><span class="value">${tipoEsame}</span></div>
    <div class="field"><span class="label">Sede / Ufficio:</span><span class="value">${sede}</span></div>
    <div class="field"><span class="label">Località:</span><span class="value">${localita}</span></div>
    <div class="field"><span class="label">Aula:</span><span class="value">${aula}</span></div>
    <div class="field"><span class="label">Stato Seduta:</span><span class="value">${stato}</span></div>
    <div class="field"><span class="label">Fascia Oraria:</span><span class="value">${fasciaOraria}</span></div>
    <div class="field"><span class="label">Num. Turni:</span><span class="value">${numTurni}</span></div>
    <div class="field"><span class="label">Capienza Aula:</span><span class="value">${capienza}</span></div>
  </div>
</div>

<div class="section">
  <div class="section-title">Dati Candidato</div>
  <div class="grid">
    <div class="field"><span class="label">Cognome:</span><span class="value">${cognome}</span></div>
    <div class="field"><span class="label">Marca Operativa:</span><span class="value">${marca}</span></div>
    <div class="field"><span class="label">Autoscuola:</span><span class="value">${autoscuola}</span></div>
    <div class="field"><span class="label">Turno:</span><span class="value">${turno}</span></div>
    <div class="field"><span class="label">Lingua:</span><span class="value">${lingua}</span></div>
    <div class="field"><span class="label">Supporto Audio:</span><span class="value">${audio}</span></div>
    <div class="field"><span class="label">Ente:</span><span class="value">${ente}</span></div>
    <div class="field"><span class="label">Esaminatore:</span><span class="value">${esaminatore}</span></div>
    <div class="field"><span class="label">Num. Domande:</span><span class="value">${numDomande}</span></div>
    <div class="field"><span class="label">Patente:</span><span class="value">${patente}</span></div>
    <div class="field"><span class="label">Abilitazione:</span><span class="value">${abilitazione}</span></div>
    <div class="field"><span class="label">Codice Anomalia:</span><span class="value">${anomalia}</span></div>
  </div>
</div>

${Object.keys(cs).length > 0 ? `<div class="section">
  <div class="section-title">Dettaglio Storico (dal Portale)</div>
  <div class="grid">
    ${Object.entries(cs).filter(([k, v]) => v && String(v).trim()).map(([k, v]) => `<div class="field"><span class="label">${k}:</span><span class="value">${v}</span></div>`).join("")}
  </div>
</div>` : ""}

${verbaliHtml}

<div class="footer">
  Stampato il ${dataStampa} — Portale dell'Automobilista / Gestionale iPatente Cloud
</div>
</body></html>`;

  const win = window.open("", "_blank", "width=900,height=700");
  if (win) {
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 400);
  }
}

// ─── Costanti tab ──────────────────────────────────────────────────────────────

const TABS = [
  { key: "sessioni-quiz",      label: "Sessioni Quiz",        tipo: "SQI",    icon: "🧪" },
  { key: "sessioni-guide",     label: "Sessioni Guide/Orali", tipo: "SGOS",   icon: "🚗" },
  { key: "sessioni-cqc",       label: "Sessioni CQC",         tipo: "SCQC",   icon: "🚛" },
  { key: "sessioni-approvate", label: "Sessioni Approvate",   tipo: "SQA",    icon: "✅" },
  { key: "verbali-aperti",     label: "Verbali Aperti",       tipo: "VAC",    icon: "📋" },
  { key: "verbali-svolti",     label: "Verbali Svolti",       tipo: "VSC",    icon: "📝" },
  { key: "verbali-cqc",        label: "Verbali CQC",          tipo: "VSQ",    icon: "🚛" },
  { key: "rev-pat-svolti",     label: "Rev. Patente Svolti",  tipo: "VSR",    icon: "🔄" },
  { key: "rev-pat-annullati",  label: "Rev. Patente Annull.",  tipo: "VAR",    icon: "❌" },
  { key: "rev-cqc-svolti",     label: "Rev. CQC Svolti",      tipo: "VSRCQC", icon: "🔄" },
  { key: "rev-cqc-annullati",  label: "Rev. CQC Annull.",      tipo: "VARCQC", icon: "❌" },
  { key: "situazione",         label: "Situazione Candidati", tipo: "SIT",    icon: "👤" },
  // ── Archivio storico (rinnovi patente / medici / CQC) ──────────────────────
  { key: "archivio-storico",   label: "Archivio Storico",     tipo: "ARCH",   icon: "📚" },
];

// ─── TOOLBAR AZIONI (Seleziona, Stampa, Export, Annulla) ─────────────────────

function ToolbarAzioni({ intestazioni, righe, title, onAnnulla, selectedRow, onDettaglio, showDettaglio = false }) {
  const hasData = righe && righe.length > 0;
  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      <button onClick={() => copyTableText(intestazioni, righe)} disabled={!hasData}
        title="Copia dati negli appunti"
        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-medium text-slate-700 disabled:opacity-40 transition border border-slate-200">
        📋 Seleziona
      </button>
      <button onClick={() => printTable(intestazioni, righe, title)} disabled={!hasData}
        title="Stampa tabella"
        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-medium text-slate-700 disabled:opacity-40 transition border border-slate-200">
        🖨️ Stampa
      </button>
      <button onClick={() => exportCSV(intestazioni, righe, `${(title || "export").replace(/\s+/g, "_")}.csv`)} disabled={!hasData}
        title="Esporta in CSV"
        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-medium text-slate-700 disabled:opacity-40 transition border border-slate-200">
        📥 Export CSV
      </button>
      {showDettaglio && (
        <button onClick={onDettaglio} disabled={selectedRow === null}
          title="Visualizza dettaglio della riga selezionata"
          className="px-3 py-1.5 bg-blue-100 hover:bg-blue-200 rounded-lg text-xs font-semibold text-blue-700 disabled:opacity-40 transition border border-blue-200">
          🔍 Dettaglio
        </button>
      )}
      {onAnnulla && (
        <button onClick={onAnnulla}
          title="Reset filtri di ricerca"
          className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 rounded-lg text-xs font-medium text-amber-700 transition border border-amber-200">
          ↩️ Annulla
        </button>
      )}
    </div>
  );
}

// ─── COMPONENTE TABELLA CON SELEZIONE RIGA ──────────────────────────────────

function TabellaPortale({ intestazioni, righe, loading, error, emptyMsg = "Nessun dato trovato",
  selectable = false, selectedRow, onSelectRow, onRowDoubleClick }) {
  if (loading) return (
    <div className="flex items-center justify-center py-16 text-slate-400">
      <span className="animate-spin mr-2">⏳</span> Caricamento dal portale…
    </div>
  );
  if (error) return (
    <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
      <strong>Errore:</strong> {error}
    </div>
  );
  if (!righe || righe.length === 0) return (
    <div className="text-center py-12 text-slate-400 text-sm">{emptyMsg}</div>
  );

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200" style={{ maxHeight: "420px", overflowY: "auto" }}>
      <table className="w-full text-sm" style={{ minWidth: "max-content" }}>
        {intestazioni?.length > 0 && (
          <thead className="bg-slate-50 sticky top-0 z-10">
            <tr>
              {selectable && (
                <th className="px-2 py-2 text-center font-semibold text-slate-600 border-b border-slate-200 w-8">Sel.</th>
              )}
              {intestazioni.map((h, i) => (
                <th key={i} className="px-3 py-2 text-left font-semibold text-slate-600 whitespace-nowrap border-b border-slate-200 text-xs">
                  {h || `Col.${i+1}`}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {righe.map((riga, ri) => {
            const isSelected = selectedRow === ri;
            return (
              <tr key={ri}
                onClick={() => selectable && onSelectRow?.(ri)}
                onDoubleClick={() => onRowDoubleClick?.(ri)}
                className={`border-b border-slate-100 transition-colors cursor-pointer ${
                  isSelected ? "bg-blue-100 ring-1 ring-blue-300" : "hover:bg-blue-50/30"
                }`}>
                {selectable && (
                  <td className="px-2 py-2 text-center">
                    <input type="radio" name="table-sel" checked={isSelected} readOnly
                      className="accent-blue-600 w-3.5 h-3.5" />
                  </td>
                )}
                {Array.isArray(riga) ? riga.map((cella, ci) => (
                  <td key={ci} className="px-3 py-1.5 text-slate-700 whitespace-nowrap max-w-[200px] truncate text-xs" title={String(cella || "")}>
                    {cella || "–"}
                  </td>
                )) : (
                  <td className="px-3 py-1.5 text-slate-700 text-xs">{JSON.stringify(riga)}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── TAB PANEL (lazy mount + display:none per evitare re-login) ────────────────

function TabPanel({ active, children }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (active && !mounted) setMounted(true);
  }, [active, mounted]);
  if (!mounted) return null;
  return <div style={{ display: active ? "block" : "none" }}>{children}</div>;
}

// ─── PANNELLO SESSIONI (Quiz / Guide / CQC / Approvate) ───────────────────────

function PanelloSessioni({ tipo, label, user }) {
  const isCqc      = tipo === "SCQC";
  const isApprovate = tipo === "SQA";
  const isVerbali  = ["VAC", "VSC", "VSQ", "VSR", "VAR", "VSRCQC", "VARCQC"].includes(tipo);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sessioni, setSessioni] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);
  const defaultFilters = {
    dataDa: isVerbali ? daysAgo(90) : todayISO(),
    dataA:  isVerbali ? todayISO()  : daysFromNow(29),
    stato:  isApprovate ? "" : (isVerbali ? "" : "APERTA"),
  };
  const [filters, setFilters] = useState({ ...defaultFilters });
  const [lastSync, setLastSync] = useState(null);
  const autoLoaded = useRef(false);
  const prevStato = useRef(filters.stato);
  const caricaRef = useRef(null);

  // Dettaglio sessione (card espansa riga selezionata)
  const [dettaglioData, setDettaglioData] = useState(null);
  const [showDettaglio, setShowDettaglio] = useState(false);

  async function carica() {
    setLoading(true);
    setError("");
    setSelectedRow(null);
    setShowDettaglio(false);
    try {
      const base = apiBase();
      let endpoint, body;
      const dataDaDDMMYYYY = isoToDDMMYYYY(filters.dataDa);
      const dataADDMMYYYY  = isoToDDMMYYYY(filters.dataA);
      const isGuideApprovate = tipo === "SGOS" && filters.stato === "APPROVATA";

      if (isVerbali) {
        endpoint = `${base}/api/portal/verbali`;
        body = { tipo, dataDa: dataDaDDMMYYYY, dataA: dataADDMMYYYY };
      } else if (isCqc) {
        endpoint = `${base}/api/portal/sessioni-cqc`;
        body = { searchFilters: { dataDa: dataDaDDMMYYYY, dataA: dataADDMMYYYY, stato: filters.stato } };
      } else if (isApprovate || isGuideApprovate) {
        endpoint = `${base}/api/portal/sessioni-approvate`;
        body = { tipo: "SQA", tipoEsame: isGuideApprovate ? "G" : "", dataDa: dataDaDDMMYYYY, dataA: dataADDMMYYYY };
      } else {
        endpoint = `${base}/api/portal/sessioni-preview`;
        body = { dataDa: dataDaDDMMYYYY, dataA: dataADDMMYYYY, stato: filters.stato, tipoEsame: tipo === "SGOS" ? "SGOS" : "" };
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data?.trace?.length) console.log("[Portale] trace:", JSON.stringify(data.trace, null, 2));
      if (data?.diagnostics) console.log("[Portale] diagnostics:", data.diagnostics);
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSessioni(data);
      setLastSync(new Date().toLocaleTimeString("it-IT"));
    } catch (e) {
      setError(e.message || "Errore caricamento");
    } finally {
      setLoading(false);
    }
  }

  caricaRef.current = carica;

  useEffect(() => {
    if (!autoLoaded.current) {
      autoLoaded.current = true;
      setTimeout(() => caricaRef.current?.(), 50);
    }
  }, []);

  useEffect(() => {
    if (autoLoaded.current && prevStato.current !== filters.stato) {
      prevStato.current = filters.stato;
      caricaRef.current?.();
    }
  }, [filters.stato]);

  // ── Auto-sync state ──
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [autoSyncCountdown, setAutoSyncCountdown] = useState(60);
  const autoSyncIntervalRef = useRef(null);

  // Auto-sync: re-fetch ogni 60 secondi quando abilitato
  useEffect(() => {
    if (!autoSyncEnabled) {
      if (autoSyncIntervalRef.current) {
        clearInterval(autoSyncIntervalRef.current);
        autoSyncIntervalRef.current = null;
      }
      return;
    }

    // Countdown timer
    const countdownInterval = setInterval(() => {
      setAutoSyncCountdown(prev => {
        if (prev <= 1) {
          caricaRef.current?.();
          return 60;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(countdownInterval);
  }, [autoSyncEnabled]);

  // Costruisci intestazioni e righe uniformi
  let intestazioni = [];
  let righe = [];
  let count = 0;

  if (sessioni) {
    if (sessioni.intestazioni && sessioni.righe) {
      intestazioni = sessioni.intestazioni;
      righe = sessioni.righe;
      count = sessioni.count || righe.length;
    } else if (sessioni.intestazioni && Array.isArray(sessioni.sessioni)) {
      intestazioni = sessioni.intestazioni;
      const rows = sessioni.sessioni;
      count = sessioni.count || rows.length;
      righe = rows.map(s => {
        return [
          s.data || s.dataSessione || "–",
          s.orario || s.amPm || s.fascia || "–",
          s.aula || "–",
          s.tipoEsame || s.tipo || "–",
          s.sedutaStato || s.stato || "–",
          s.totalePosti || "–",
          s.propriePrenotazioni || "–",
          s.postiLiberi || "–",
          s.codLocalita || s.codUfficio || "–",
          s.localita || "–",
        ].slice(0, intestazioni.length);
      });
    } else if (Array.isArray(sessioni.sessioni)) {
      const rows = sessioni.sessioni;
      count = sessioni.total || rows.length;
      if (rows.length > 0) {
        intestazioni = ["Data", "Orario", "Aula", "Tipo", "Stato", "Tot.", "Pren.", "Lib.", "Ufficio", "Localita"];
        righe = rows.map(s => [
          s.data || s.dataSessione || s.dataIpotetica || "–",
          s.orario || s.amPm || s.fascia || "–",
          s.aula || "–",
          s.tipoEsame || s.tipo || s.tipoSessione || "–",
          s.sedutaStato || s.stato || s.statoSessione || "–",
          s.totalePosti || s.totale || "–",
          s.propriePrenotazioni || s.candidatiPrenotati || s.prenotati || "–",
          s.postiLiberi || s.liberi || "–",
          s.codUfficio || s.ufficio || "–",
          s.localita || "–",
        ]);
      }
    }
  }

  // Dettaglio sessione: prima cache Supabase (istantaneo), poi portale se serve
  async function openDettaglio(forceRefreshArg) {
    // Protegge dal MouseEvent passato come argomento dal click handler
    const forceRefresh = forceRefreshArg === true;

    if (selectedRow === null || !righe[selectedRow]) return;
    setShowDettaglio(true);

    const row = righe[selectedRow];
    const basicPairs = intestazioni.map((h, i) => ({
      label: h || `Campo ${i+1}`,
      value: Array.isArray(row) ? (row[i] || "–") : "–",
    }));
    setDettaglioData({ pairs: basicPairs, rowIndex: selectedRow, loading: true, turni: [], candidati: [] });

    // Costruisci rowData per lookup cache
    const rowData = {};
    intestazioni.forEach((h, i) => {
      const key = String(h || "").toLowerCase().replace(/[^a-z]/g, "");
      const val = Array.isArray(row) ? (row[i] || "") : "";
      if (key === "data") rowData.data = val;
      else if (key === "tipo") rowData.tipo = val;
      else if (key === "aula") rowData.aula = val;
      else if (key === "ufficio") rowData.ufficio = val;
      else if (key === "stato") rowData.stato = val;
      else if (key === "orario") rowData.orario = val;
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const base = apiBase();
      const res = await fetch(`${base}/api/portal/sessione-dettaglio`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          sessionIndex: selectedRow,
          dataDa: isoToDDMMYYYY(filters.dataDa),
          dataA: isoToDDMMYYYY(filters.dataA),
          stato: filters.stato || "APERTA",
          rowData,
          forceRefresh,
        }),
        signal: controller.signal,
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          const portalPairs = Object.entries(data.campi || {}).map(([label, value]) => ({
            label: label.replace(/:?\s*$/, ""),
            value: String(value || "–"),
          }));
          const campiNoti = data.campiNoti || {};
          for (const [label, value] of Object.entries(campiNoti)) {
            if (!portalPairs.some(p => p.label === label)) {
              portalPairs.push({ label, value: String(value || "–") });
            }
          }
          const turniClean = (data.turni || []).map(t => {
            const clean = {};
            Object.entries(t).forEach(([k, v]) => { if (!k.startsWith("_")) clean[k] = v; });
            return clean;
          });

          setDettaglioData({
            pairs: portalPairs.length > 0 ? portalPairs : basicPairs,
            rowIndex: selectedRow,
            loading: false,
            source: data.source || "portale",
            cachedAt: data.cachedAt || null,
            turni: turniClean,
            candidati: data.candidati || [],
            rowData,
          });
          return;
        }
      }
    } catch (err) {
      console.warn("[Portale] Dettaglio fallito:", err.name === "AbortError" ? "timeout 90s" : err.message);
    } finally {
      clearTimeout(timeout);
    }

    setDettaglioData({ pairs: basicPairs, rowIndex: selectedRow, loading: false, source: "tabella", turni: [], candidati: [] });
  }

  // ── State per azioni candidato ──
  const [selectedTurno, setSelectedTurno] = useState(null);
  const [selectedCandidato, setSelectedCandidato] = useState(null);
  const [showNuovoCandidatoForm, setShowNuovoCandidatoForm] = useState(false);
  const [nuovoCandForm, setNuovoCandForm] = useState({ codiceFoglioRosa: "", cognome: "", marcaOperativa: "" });
  const [showModificaCandidatoForm, setShowModificaCandidatoForm] = useState(false);
  const [modificaCandForm, setModificaCandForm] = useState({ lingua: "ITALIANO", supportoAudio: "NO", turno: "1" });
  const [showSostituisciCandidatoForm, setShowSostituisciCandidatoForm] = useState(false);
  const [sostituisciCandForm, setSostituisciCandForm] = useState({ codiceStatino: "", cognome: "", lingua: "ITALIANO", supportoAudio: "NO" });
  const [showStoriaView, setShowStoriaView] = useState(false);
  const [storiaData, setStoriaData] = useState(null);
  const [storiaLoading, setStoriaLoading] = useState(false);
  const [azioneLoading, setAzioneLoading] = useState(false);
  const [azioneMsg, setAzioneMsg] = useState(null);
  // ── Filtri candidati (come nel portale) ──
  const [filtroAutoscuolaCand, setFiltroAutoscuolaCand] = useState("");
  const [filtroTurnoCand, setFiltroTurnoCand] = useState("");
  // (auto-sync state moved up before its useEffect)
  // ── Verifica Pratica ──
  const [showVerificaPratica, setShowVerificaPratica] = useState(false);
  const [verificaPraticaData, setVerificaPraticaData] = useState(null);
  const [verificaPraticaLoading, setVerificaPraticaLoading] = useState(false);
  // ── PDF Viewer (in-page, no popup) ──
  const [pdfViewerUrl, setPdfViewerUrl] = useState(null);
  const [pdfViewerTitle, setPdfViewerTitle] = useState("");

  // Azione candidato: wrapper per chiamate portale
  async function eseguiAzionePortale(actionType, candidateData = {}) {
    setAzioneLoading(true);
    setAzioneMsg(null);
    const base = apiBase();
    try {
      const body = {
        sessionIndex: selectedRow,
        actionType,
        candidate: candidateData,
      };
      const res = await fetch(`${base}/api/portal/prenotazione-candidato`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        const ind = data.indicators || {};
        if (ind.containsSuccess) {
          setAzioneMsg({ type: "success", text: `Operazione "${actionType}" completata con successo!` });
        } else if (ind.containsNoSeats) {
          setAzioneMsg({ type: "error", text: "Non ci sono posti disponibili nella sessione." });
        } else if (ind.containsAlreadyBooked) {
          setAzioneMsg({ type: "warning", text: "Il candidato è già in prenotazione." });
        } else {
          setAzioneMsg({ type: "success", text: data.portalMessage || `Azione "${actionType}" eseguita.` });
        }
        // Refresh dettaglio dopo azione
        setTimeout(() => openDettaglio(true), 1500);
      } else {
        setAzioneMsg({ type: "error", text: data.error || "Operazione fallita" });
      }
    } catch (err) {
      setAzioneMsg({ type: "error", text: `Errore connessione: ${err.message}` });
    } finally {
      setAzioneLoading(false);
    }
  }

  // Prenotazione diretta (by-pass captcha, usato per NUOVO CANDIDATO veloce)
  async function prenotazioneDiretta(candidateData) {
    setAzioneLoading(true);
    setAzioneMsg(null);
    const base = apiBase();
    try {
      // Serve idVerbale dalla sessione: lo ricaviamo dal radioValue o dall'index
      const row = righe[selectedRow];
      const res = await fetch(`${base}/api/portal/prenotazione-diretta`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          idVerbale: candidateData.idVerbale || "",
          tipoSessione: candidateData.tipoSessione || "SQI",
          codiceFoglioRosa: candidateData.codiceFoglioRosa,
          cognome: candidateData.cognome,
          turnoEsaminatore: candidateData.turnoEsaminatore || "1",
          lingua: candidateData.lingua || "IT",
          audio: candidateData.audio || "N",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setAzioneMsg({ type: "success", text: "Candidato prenotato con successo!" });
        setTimeout(() => openDettaglio(true), 1500);
      } else {
        const ind = data.indicators || {};
        const msg = ind.containsNoSeats ? "Posti terminati" :
                    ind.containsBooked ? "Già prenotato" :
                    data.error || "Prenotazione fallita";
        setAzioneMsg({ type: "error", text: msg });
      }
    } catch (err) {
      setAzioneMsg({ type: "error", text: `Errore: ${err.message}` });
    } finally {
      setAzioneLoading(false);
    }
  }

  function handleNuovoCandidato() {
    setShowNuovoCandidatoForm(true);
    setNuovoCandForm({ codiceFoglioRosa: "", cognome: "", marcaOperativa: "" });
    setAzioneMsg(null);
  }

  function handleEliminaCandidato() {
    if (selectedCandidato === null) { setAzioneMsg({ type: "warning", text: "Seleziona un candidato dalla tabella" }); return; }
    if (!confirm("Sei sicuro di voler eliminare il candidato selezionato?")) return;
    const cand = dettaglioData?.candidati?.[selectedCandidato] || {};
    eseguiAzionePortale("delete", { marcaOperativa: cand["Marca Operativa"] || cand.marca_operativa || "", cognome: cand.Cognome || cand.cognome || "" });
  }

  function handleModificaCandidato() {
    if (selectedCandidato === null) { setAzioneMsg({ type: "warning", text: "Seleziona un candidato dalla tabella" }); return; }
    const cand = dettaglioData?.candidati?.[selectedCandidato] || {};
    setModificaCandForm({
      lingua: cand.Lingua || cand.lingua || "ITALIANO",
      supportoAudio: cand["Supporto Audio"] || cand.supporto_audio || "NO",
      turno: cand.Turno || cand.turno || "1",
    });
    setShowModificaCandidatoForm(true);
    setShowNuovoCandidatoForm(false);
    setShowSostituisciCandidatoForm(false);
    setAzioneMsg(null);
  }

  function handleSostituisciCandidato() {
    if (selectedCandidato === null) { setAzioneMsg({ type: "warning", text: "Seleziona un candidato dalla tabella" }); return; }
    setSostituisciCandForm({ codiceStatino: "", cognome: "", lingua: "ITALIANO", supportoAudio: "NO" });
    setShowSostituisciCandidatoForm(true);
    setShowNuovoCandidatoForm(false);
    setShowModificaCandidatoForm(false);
    setAzioneMsg(null);
  }

  async function handleStoria() {
    if (selectedCandidato === null) { setAzioneMsg({ type: "warning", text: "Seleziona un candidato dalla tabella" }); return; }
    const cand = dettaglioData?.candidati?.[selectedCandidato] || {};
    setShowStoriaView(true);
    setShowNuovoCandidatoForm(false);
    setShowModificaCandidatoForm(false);
    setShowSostituisciCandidatoForm(false);
    setStoriaLoading(true);
    setStoriaData({ candidato: cand, verbali: [] });
    setAzioneMsg(null);

    try {
      const base = apiBase();
      const res = await fetch(`${base}/api/portal/prenotazione-candidato`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          sessionIndex: selectedRow,
          actionType: "history",
          candidate: {
            marcaOperativa: cand["Marca Operativa"] || cand.marca_operativa || "",
            cognome: cand.Cognome || cand.cognome || "",
          },
        }),
      });
      const data = await res.json();
      console.log("[Storia] Risposta backend:", JSON.stringify(data, null, 2));
      if (data.success && data.storia) {
        setStoriaData({ candidato: cand, ...data.storia, _debug: data._debug });
      } else if (data.success) {
        // Se non c'è storia dal portale, mostra solo i dati del candidato
        setStoriaData({ candidato: cand, verbali: [], _debug: data._debug });
      } else {
        setAzioneMsg({ type: "error", text: data.error || "Errore nel caricamento storia" });
      }
    } catch (err) {
      setAzioneMsg({ type: "error", text: `Errore: ${err.message}` });
    } finally {
      setStoriaLoading(false);
    }
  }

  async function handleVerificaPratica() {
    if (selectedCandidato === null) { setAzioneMsg({ type: "warning", text: "Seleziona un candidato dalla tabella" }); return; }
    const cand = dettaglioData?.candidati?.[selectedCandidato] || {};
    setShowVerificaPratica(true);
    setVerificaPraticaLoading(true);
    setVerificaPraticaData(null);
    setAzioneMsg(null);

    try {
      const base = apiBase();
      const res = await fetch(`${base}/api/portal/verifica-pratica`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          marcaOperativa: cand["Marca Operativa"] || cand.marca_operativa || "",
        }),
      });
      const data = await res.json();
      if (data.success && data.pratica) {
        setVerificaPraticaData({ candidato: cand, ...data.pratica });
      } else {
        setAzioneMsg({ type: "error", text: data.error || "Errore nel caricamento pratica" });
      }
    } catch (err) {
      setAzioneMsg({ type: "error", text: `Errore: ${err.message}` });
    } finally {
      setVerificaPraticaLoading(false);
    }
  }

  // Funzione generica per richiedere documenti ufficiali dal portale
  async function handleStampaPortale(stampaType, candidateIdx) {
    try {
      setAzioneLoading(true);
      setAzioneMsg({ type: "info", text: `Caricamento documento ufficiale "${stampaType}" dal portale...` });
      const base = apiBase();
      const dataDaDDMMYYYY = isoToDDMMYYYY(filters.dataDa);
      const dataADDMMYYYY  = isoToDDMMYYYY(filters.dataA);
      const res = await fetch(`${base}/api/portal/stampa-portale`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          stampaType,
          sessionIndex: dettaglioData?.rowIndex ?? selectedRow ?? 0,
          candidateIndex: candidateIdx ?? selectedCandidato ?? -1,
          marcaOperativa: selectedCandidato !== null ? (dettaglioData?.candidati?.[selectedCandidato]?.["Marca Operativa"] || "") : "",
          dataDa: dataDaDDMMYYYY,
          dataA: dataADDMMYYYY,
          stato: filters.stato || "",
        }),
      });
      const data = await res.json();
      if (data.success && (data.pdfBase64 || data.html)) {
        if (data.pdfBase64) {
          // PDF binario: mostra in-page via iframe (evita popup blocker)
          const byteChars = atob(data.pdfBase64);
          const byteNumbers = new Uint8Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
          const blob = new Blob([byteNumbers], { type: "application/pdf" });
          const blobUrl = URL.createObjectURL(blob);
          // Rilascia eventuali URL blob precedenti
          if (pdfViewerUrl) try { URL.revokeObjectURL(pdfViewerUrl); } catch {}
          setPdfViewerUrl(blobUrl);
          setPdfViewerTitle(`Stampa ${stampaType} - ${new Date().toLocaleDateString("it-IT")}`);
        } else {
          // HTML: mostra in-page via iframe con srcdoc
          if (pdfViewerUrl) try { URL.revokeObjectURL(pdfViewerUrl); } catch {}
          const htmlBlob = new Blob([data.html], { type: "text/html;charset=utf-8" });
          const htmlUrl = URL.createObjectURL(htmlBlob);
          setPdfViewerUrl(htmlUrl);
          setPdfViewerTitle(`Stampa ${stampaType} - ${new Date().toLocaleDateString("it-IT")}`);
        }
        setAzioneMsg({ type: "success", text: `Documento "${stampaType}" pronto.` });
      } else {
        setAzioneMsg({ type: "error", text: data.error || "Documento non disponibile" });
      }
    } catch (err) {
      setAzioneMsg({ type: "error", text: `Errore stampa: ${err.message}` });
    } finally {
      setAzioneLoading(false);
    }
  }

  function handleStampaSessione() {
    handleStampaPortale("stampa");
  }

  function handleStampaCandidati() {
    handleStampaPortale("stampaCandidati");
  }

  function handleAnnulla() {
    setFilters({ ...defaultFilters });
    setSelectedRow(null);
    setShowDettaglio(false);
  }

  return (
    <div className="space-y-3 max-w-full">
      {/* ── PDF Viewer Overlay (in-page, nessun popup) ── */}
      {pdfViewerUrl && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setPdfViewerUrl(null); setPdfViewerTitle(""); } }}>
          <div className="bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-5xl" style={{ height: "90vh" }}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50 rounded-t-2xl">
              <h3 className="text-sm font-semibold text-slate-700 truncate">{pdfViewerTitle || "Documento"}</h3>
              <div className="flex items-center gap-2">
                <a href={pdfViewerUrl} download={`stampa-${pdfViewerTitle.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`}
                  className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                  Scarica PDF
                </a>
                <button onClick={() => { const w = window.open(pdfViewerUrl, "_blank"); if (!w) { const a = document.createElement("a"); a.href = pdfViewerUrl; a.target = "_blank"; document.body.appendChild(a); a.click(); document.body.removeChild(a); } }}
                  className="px-3 py-1.5 text-xs font-medium bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors">
                  Apri in nuova scheda
                </button>
                <button onClick={() => { try { URL.revokeObjectURL(pdfViewerUrl); } catch {} setPdfViewerUrl(null); setPdfViewerTitle(""); }}
                  className="px-2 py-1.5 text-slate-400 hover:text-red-500 transition-colors text-lg font-bold leading-none">
                  &#10005;
                </button>
              </div>
            </div>
            {/* PDF Embed */}
            <div className="flex-1 min-h-0">
              <iframe src={pdfViewerUrl} className="w-full h-full border-0 rounded-b-2xl" title={pdfViewerTitle || "Documento PDF"} />
            </div>
          </div>
        </div>
      )}
      {/* Filtri */}
      <div className="flex flex-wrap items-end gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Data da</label>
          <input type="date" value={filters.dataDa}
            onChange={e => setFilters(f => ({ ...f, dataDa: e.target.value }))}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Data a</label>
          <input type="date" value={filters.dataA}
            onChange={e => setFilters(f => ({ ...f, dataA: e.target.value }))}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
        {!isApprovate && !isVerbali && (
          <div>
            <label className="block text-xs text-slate-500 mb-1">Stato</label>
            <select value={filters.stato}
              onChange={e => setFilters(f => ({ ...f, stato: e.target.value }))}
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
              <option value="">Tutti</option>
              <option value="APERTA">Aperta</option>
              <option value="CHIUSA">Chiusa</option>
              <option value="APPROVATA">Approvata</option>
            </select>
          </div>
        )}
        <button onClick={carica} disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition flex items-center gap-2">
          {loading ? "⏳" : "🔍"} Ricerca
        </button>
        <button onClick={() => setAutoSyncEnabled(!autoSyncEnabled)} disabled={loading}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition flex items-center gap-2 ${
            autoSyncEnabled
              ? "bg-emerald-600 text-white hover:bg-emerald-700"
              : "bg-slate-300 text-slate-700 hover:bg-slate-400"
          }`}
          title={autoSyncEnabled ? "Auto-sync abilitato" : "Auto-sync disabilitato"}>
          🔄 Auto-sync {autoSyncEnabled && <span className="text-xs">({autoSyncCountdown}s)</span>}
        </button>
        {lastSync && <span className="text-xs text-slate-400">Ultimo sync: {lastSync}</span>}
      </div>

      {/* Contatore */}
      {sessioni && !loading && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <span className="font-semibold text-blue-700">{count}</span> sessioni trovate
          {sessioni.message && <span className="text-amber-600 ml-2">⚠️ {sessioni.message}</span>}
        </div>
      )}

      {/* Toolbar azioni */}
      <ToolbarAzioni
        intestazioni={intestazioni}
        righe={righe}
        title={label}
        onAnnulla={handleAnnulla}
        selectedRow={selectedRow}
        onDettaglio={openDettaglio}
        showDettaglio={!isApprovate}
      />

      {/* Vista dettaglio o tabella */}
      {showDettaglio && dettaglioData?.pairs ? (
        <div className="space-y-3" style={{ maxWidth: "100%" }}>

          {/* Se sta caricando dal portale, mostra solo lo spinner — niente dati locali */}
          {dettaglioData.loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
              <span className="text-sm text-slate-500 animate-pulse">Caricamento dettaglio dal portale...</span>
              <button onClick={() => { setShowDettaglio(false); setDettaglioData(null); }}
                className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded-lg text-xs font-semibold text-slate-700 transition mt-4">
                ANNULLA
              </button>
            </div>
          ) : (
          <>
          {/* Header con stato e fonte */}
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => { setShowDettaglio(false); setDettaglioData(null); }}
              className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded-lg text-xs font-semibold text-slate-700 transition">
              INDIETRO
            </button>
            <span className="text-sm font-bold text-slate-800">
              Dettaglio Sessioni Quiz Interne
            </span>
            {(() => {
              const row = righe[dettaglioData.rowIndex];
              const statoIdx = intestazioni.findIndex(h => /stato/i.test(h));
              const stato = statoIdx >= 0 && row ? String(row[statoIdx] || "").trim() : "";
              if (!stato) return null;
              const cls = /APERTA/i.test(stato) ? "bg-emerald-100 text-emerald-700" :
                         /CHIUSA/i.test(stato) ? "bg-red-100 text-red-700" :
                         /APPROVATA/i.test(stato) ? "bg-blue-100 text-blue-700" :
                         "bg-amber-100 text-amber-700";
              return <span className={`px-2 py-0.5 rounded text-xs font-bold ${cls}`}>{stato}</span>;
            })()}
            {dettaglioData.source && dettaglioData.source !== "tabella" && (
              <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 text-[10px] font-medium border border-emerald-200">
                {dettaglioData.source === "cache" ? "Da archivio locale" :
                 dettaglioData.source === "browser" ? "Dal portale (browser)" :
                 dettaglioData.source === "http" ? "Dal portale (HTTP)" : "Dal portale"}
              </span>
            )}
            {dettaglioData.source === "tabella" && (
              <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-600 text-[10px] font-medium border border-amber-200">
                Solo dati tabella
              </span>
            )}
            {dettaglioData.cachedAt && (
              <span className="text-[10px] text-slate-400">
                Aggiornato: {new Date(dettaglioData.cachedAt).toLocaleString("it-IT")}
              </span>
            )}
            <button onClick={() => openDettaglio(true)} title="Aggiorna dal portale"
              className="px-2 py-1 bg-blue-50 hover:bg-blue-100 rounded text-[10px] font-medium text-blue-600 border border-blue-200 transition">
              Aggiorna
            </button>
          </div>

          {/* Card campi dettaglio (stile portale) */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 overflow-hidden">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3">
              {dettaglioData.pairs.filter(p => p.value !== "–" && p.value !== "").map((p, i) => {
                const isHighlight = /capienza|posti|turni|esaminat|limite|orario inizio|indicatore/i.test(p.label);
                return (
                  <div key={i} className={`flex flex-col min-w-0 ${isHighlight ? "bg-blue-50 rounded-lg p-2 -m-1" : ""}`}>
                    <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider truncate">{p.label}</span>
                    <span className={`text-sm font-bold truncate ${isHighlight ? "text-blue-800" : "text-slate-800"}`} title={p.value}>{p.value}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tabella turni (come nel portale) */}
          {dettaglioData.turni && dettaglioData.turni.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-slate-700">Turni ({dettaglioData.turni.length})</h4>
              <div className="rounded-xl border border-slate-200" style={{ maxHeight: "220px", overflowX: "auto", overflowY: "auto", width: "100%" }}>
                <table className="text-xs border-collapse" style={{ minWidth: "max-content" }}>
                  <thead className="bg-slate-100 sticky top-0 z-10">
                    <tr>
                      <th className="px-2 py-2 text-center font-semibold text-slate-600 whitespace-nowrap border-b border-slate-200 w-8">Sel.</th>
                      {Object.keys(dettaglioData.turni[0]).filter(k => !k.startsWith("_")).map((h, i) => (
                        <th key={i} className="px-3 py-2 text-left font-semibold text-slate-600 whitespace-nowrap border-b border-slate-200">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dettaglioData.turni.map((turno, ti) => (
                      <tr key={ti}
                        onClick={() => setSelectedTurno(ti)}
                        className={`border-b border-slate-100 cursor-pointer transition-colors ${selectedTurno === ti ? "bg-blue-100" : "hover:bg-blue-50/30"}`}>
                        <td className="px-2 py-1.5 text-center">
                          <input type="radio" name="turnoSel" checked={selectedTurno === ti} onChange={() => setSelectedTurno(ti)} className="accent-blue-600" />
                        </td>
                        {Object.entries(turno).filter(([k]) => !k.startsWith("_")).map(([, val], vi) => (
                          <td key={vi} className="px-3 py-1.5 text-slate-700 whitespace-nowrap max-w-[400px] truncate" title={String(val || "")}>
                            {val || "–"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Messaggio risultato azione */}
          {azioneMsg && (
            <div className={`rounded-lg px-4 py-2 text-sm font-medium ${
              azioneMsg.type === "success" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
              azioneMsg.type === "warning" ? "bg-amber-50 text-amber-700 border border-amber-200" :
              "bg-red-50 text-red-700 border border-red-200"
            }`}>
              {azioneMsg.text}
              <button onClick={() => setAzioneMsg(null)} className="ml-3 text-xs opacity-60 hover:opacity-100">✕</button>
            </div>
          )}

          {/* Pulsanti azione sessione (come nel portale) */}
          <div className="flex flex-wrap gap-3 py-3 border-t border-slate-200">
            <button onClick={handleNuovoCandidato} disabled={azioneLoading}
              className="px-5 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 transition shadow-sm">
              {azioneLoading ? "⏳" : ""} NUOVO CANDIDATO
            </button>
            <button onClick={() => { /* ACQ. FILE: upload tramite portale */ setAzioneMsg({ type: "warning", text: "Funzione ACQ. FILE disponibile prossimamente" }); }}
              className="px-5 py-2.5 bg-slate-600 text-white rounded-lg text-sm font-bold hover:bg-slate-700 transition shadow-sm">
              ACQ. FILE
            </button>
            <button onClick={() => { setShowDettaglio(false); setDettaglioData(null); setSelectedCandidato(null); setSelectedTurno(null); setAzioneMsg(null); setShowNuovoCandidatoForm(false); }}
              className="px-5 py-2.5 bg-amber-500 text-white rounded-lg text-sm font-bold hover:bg-amber-600 transition shadow-sm">
              INDIETRO
            </button>
          </div>

          {/* Form NUOVO CANDIDATO (modale inline) */}
          {showNuovoCandidatoForm && (
            <div className="bg-blue-50 rounded-xl border border-blue-200 p-4 space-y-3 overflow-hidden max-w-full">
              <h4 className="text-sm font-bold text-blue-800">Inserisci Nuovo Candidato</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] text-blue-600 font-semibold mb-1">Codice Foglio Rosa *</label>
                  <input type="text" value={nuovoCandForm.codiceFoglioRosa}
                    onChange={e => setNuovoCandForm(f => ({ ...f, codiceFoglioRosa: e.target.value }))}
                    placeholder="es. ME1234567A"
                    className="w-full border border-blue-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] text-blue-600 font-semibold mb-1">Cognome *</label>
                  <input type="text" value={nuovoCandForm.cognome}
                    onChange={e => setNuovoCandForm(f => ({ ...f, cognome: e.target.value.toUpperCase() }))}
                    placeholder="ROSSI"
                    className="w-full border border-blue-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] text-blue-600 font-semibold mb-1">Marca Operativa</label>
                  <input type="text" value={nuovoCandForm.marcaOperativa}
                    onChange={e => setNuovoCandForm(f => ({ ...f, marcaOperativa: e.target.value }))}
                    placeholder="(opzionale)"
                    className="w-full border border-blue-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  disabled={azioneLoading || !nuovoCandForm.codiceFoglioRosa || !nuovoCandForm.cognome}
                  onClick={() => {
                    eseguiAzionePortale("new", {
                      codiceFoglioRosa: nuovoCandForm.codiceFoglioRosa.trim(),
                      cognome: nuovoCandForm.cognome.trim(),
                      cognomePrefix: nuovoCandForm.cognome.trim().slice(0, 3),
                      marcaOperativa: nuovoCandForm.marcaOperativa.trim(),
                      turnoEsaminatore: selectedTurno !== null && dettaglioData?.turni?.[selectedTurno] ? String(selectedTurno + 1) : "1",
                    });
                    setShowNuovoCandidatoForm(false);
                  }}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 transition">
                  {azioneLoading ? "⏳ Prenotazione..." : "CONFERMA"}
                </button>
                <button onClick={() => setShowNuovoCandidatoForm(false)}
                  className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-300 transition">
                  ANNULLA
                </button>
              </div>
            </div>
          )}

          {/* Vista STORIA CANDIDATO (come nel portale) */}
          {showStoriaView && storiaData && (() => {
            const cand = storiaData.candidato || {};
            const verbali = storiaData.verbali || [];
            const campiStoria = storiaData.campi || {};
            // Helper: cerca valore prima in campiStoria poi in candidato (con varianti chiave)
            const getField = (...keys) => {
              for (const k of keys) {
                if (campiStoria[k] && String(campiStoria[k]).trim()) return String(campiStoria[k]).trim();
              }
              for (const k of keys) {
                if (cand[k] && String(cand[k]).trim()) return String(cand[k]).trim();
              }
              return "";
            };
            // Campi ordinati come sul portale reale
            const storiaFields = [
              { label: "Codice Statino",              value: getField("Codice Statino", "codice_statino") },
              { label: "Cognome",                     value: getField("Cognome", "cognome") },
              { label: "Data Sess.",                  value: getField("Data Sess.", "Data Sess", "data_sessione") },
              { label: "Marca Operativa",             value: getField("Marca Operativa", "marca_operativa") },
              { label: "Autoscuola",                  value: getField("Autoscuola", "autoscuola") },
              { label: "Abilitazione Patente Richiesta", value: getField("Abilitazione Patente Richiesta", "Abilitazione", "Patente", "patente", "abilitazione") },
              { label: "Codice Anomalia",             value: getField("Codice Anomalia", "codice_anomalia") },
              { label: "Lingua",                      value: getField("Lingua", "lingua") },
              { label: "Supporto Audio",              value: getField("Supporto Audio", "supporto_audio") },
              { label: "Turno",                       value: getField("Turno", "turno") },
              { label: "Esaminatore",                 value: getField("Esaminatore", "esaminatore") },
            ];
            // Campi extra non nella lista fissa (da campiStoria + cand)
            const fixedKeys = new Set(storiaFields.map(f => f.label));
            const extraFields = Object.entries({ ...cand, ...campiStoria })
              .filter(([k, v]) => v && String(v).trim() !== "" && !k.startsWith("_") && !fixedKeys.has(k))
              .filter(([k]) => !["Nr", "Nr.", "Ente", "Num. Domande", "selectedIndex"].includes(k))
              .map(([k, v]) => ({ label: k, value: String(v).trim() }));
            const allFields = [...storiaFields, ...extraFields];
            return (
            <div className="bg-purple-50 rounded-xl border border-purple-200 p-4 space-y-4 overflow-hidden max-w-full">
              <div className="flex items-center gap-3">
                <h4 className="text-sm font-bold text-purple-800">Dettaglio Storico Candidato - Sessioni Quiz Interne</h4>
                {storiaLoading && <span className="text-xs text-amber-600 animate-pulse">Caricamento dal portale...</span>}
              </div>

              {/* Debug info (temporaneo) */}
              {storiaData._debug && (
                <div className="text-[10px] text-slate-400 bg-slate-50 rounded p-2 font-mono">
                  Debug: HTML {storiaData._debug.htmlLen || 0} bytes | Labels: {storiaData._debug.labelsFound || 0} | Tables: {storiaData._debug.tablesFound || 0} | Campi dal portale: {Object.keys(campiStoria).length} | Verbali: {verbali.length}
                  {storiaData._debug.reason && <span className="text-red-400"> | {storiaData._debug.reason}</span>}
                </div>
              )}

              {/* Campi dettaglio candidato - Layout form-style come il portale reale */}
              <div className="bg-white rounded-lg border border-purple-100 p-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3">
                  {allFields.filter(f => f.value).map((f) => (
                    <div key={f.label} className="flex flex-col min-w-0">
                      <label className="text-[10px] text-slate-500 font-semibold mb-0.5 truncate">{f.label}</label>
                      <div className="text-sm font-medium text-slate-800 bg-slate-100 border border-slate-200 rounded px-2 py-1.5 truncate" title={f.value}>
                        {f.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tabella Verbali - stile portale reale */}
              <div>
                <h5 className="text-sm font-bold text-purple-700 mb-2">Verbali ({verbali.length})</h5>
                {verbali.length > 0 ? (
                  <div className="rounded-lg border border-purple-200 bg-white" style={{ maxHeight: "400px", overflowX: "auto", overflowY: "auto", width: "100%" }}>
                    <table className="w-full text-xs border-collapse">
                      <thead className="bg-purple-100 sticky top-0">
                        <tr>
                          {Object.keys(verbali[0]).filter(k => !k.startsWith("_")).map((h, i) => (
                            <th key={i} className="px-3 py-2 text-left font-semibold text-purple-700 whitespace-nowrap border-b border-purple-200">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {verbali.map((v, vi) => (
                          <tr key={vi} className="border-b border-purple-100 hover:bg-purple-50/50">
                            {Object.entries(v).filter(([k]) => !k.startsWith("_")).map(([, val], ci) => (
                              <td key={ci} className="px-3 py-1.5 text-slate-700 whitespace-nowrap">{val || "–"}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : !storiaLoading ? (
                  <div className="text-center py-4 text-slate-400 text-sm bg-white rounded-lg border border-purple-100">
                    Nessun verbale trovato per questo candidato
                  </div>
                ) : (
                  <div className="text-center py-4 text-amber-600 text-sm bg-amber-50 rounded-lg border border-amber-200 animate-pulse">
                    Caricamento verbali...
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button onClick={() => handleStampaPortale("stampaPrenotazione", selectedCandidato ?? -1)}
                  className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-[11px] font-bold hover:bg-green-700 transition">
                  Stampa prenotazione
                </button>
                <button onClick={() => {
                  if (verbali.length > 0) {
                    const headers = Object.keys(verbali[0]).filter(k => !k.startsWith("_"));
                    exportCSV(headers, verbali.map(v => headers.map(h => v[h] || "")), "Verbali_Candidato.csv");
                  }
                }} disabled={verbali.length === 0}
                  className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-[11px] font-bold hover:bg-blue-600 disabled:opacity-50 transition">
                  Scarica CSV
                </button>
                <button onClick={() => {
                  if (verbali.length > 0) {
                    const headers = Object.keys(verbali[0]).filter(k => !k.startsWith("_"));
                    printTable(headers, verbali.map(v => headers.map(h => v[h] || "")), "Storia Candidato - Verbali");
                  }
                }} disabled={verbali.length === 0}
                  className="px-3 py-1.5 bg-slate-500 text-white rounded-lg text-[11px] font-bold hover:bg-slate-600 disabled:opacity-50 transition">
                  Stampa Verbali
                </button>
                <button onClick={() => copyTableText(Object.keys(verbali[0] || {}).filter(k => !k.startsWith("_")), verbali.map(v => Object.keys(verbali[0] || {}).filter(k => !k.startsWith("_")).map(h => v[h] || ""))) }
                  disabled={verbali.length === 0}
                  className="px-3 py-1.5 bg-slate-500 text-white rounded-lg text-[11px] font-bold hover:bg-slate-600 disabled:opacity-50 transition"
                  title="Copia negli appunti">
                  Copia
                </button>
                <button onClick={() => setShowStoriaView(false)}
                  className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-[11px] font-bold hover:bg-purple-700 transition">
                  Indietro
                </button>
              </div>
            </div>
            );
          })()}

          {/* Vista VERIFICA PRATICA */}
          {showVerificaPratica && (() => {
            return (
            <div className="bg-indigo-50 rounded-xl border border-indigo-200 p-4 space-y-4 overflow-hidden max-w-full">
              <div className="flex items-center gap-3">
                <button onClick={() => setShowVerificaPratica(false)}
                  className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded-lg text-xs font-semibold text-slate-700 transition">
                  INDIETRO
                </button>
                <h4 className="text-sm font-bold text-indigo-800">Verifica Stato Pratica</h4>
                {verificaPraticaLoading && <span className="text-xs text-amber-600 animate-pulse">Caricamento dal portale...</span>}
              </div>

              {verificaPraticaData && (
                <div className="bg-white rounded-lg border border-indigo-100 p-4 space-y-4">
                  {/* Candidato */}
                  <div className="border-b border-indigo-100 pb-3">
                    <h5 className="text-xs font-bold text-slate-500 uppercase mb-2">Candidato</h5>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      <div>
                        <span className="text-[10px] text-slate-400 font-semibold">Marca Operativa</span>
                        <div className="text-sm font-bold text-slate-800 bg-slate-50 rounded px-2 py-1">{verificaPraticaData.candidato?.["Marca Operativa"] || verificaPraticaData.candidato?.marca_operativa || "–"}</div>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-semibold">Cognome</span>
                        <div className="text-sm font-bold text-slate-800 bg-slate-50 rounded px-2 py-1">{verificaPraticaData.candidato?.Cognome || verificaPraticaData.candidato?.cognome || "–"}</div>
                      </div>
                    </div>
                  </div>

                  {/* Stato Pratica */}
                  <div className="border-b border-indigo-100 pb-3">
                    <h5 className="text-xs font-bold text-slate-500 uppercase mb-2">Stato Pratica</h5>
                    {verificaPraticaData.statoFoglioRosa && (
                      <div className="mb-2">
                        <span className="text-[10px] text-slate-400 font-semibold">Stato Foglio Rosa</span>
                        <div className="text-sm font-bold text-slate-800 bg-slate-50 rounded px-2 py-1">{verificaPraticaData.statoFoglioRosa}</div>
                      </div>
                    )}
                    {verificaPraticaData.statoPatente && (
                      <div>
                        <span className="text-[10px] text-slate-400 font-semibold">Stato Patente</span>
                        <div className="text-sm font-bold text-slate-800 bg-slate-50 rounded px-2 py-1">{verificaPraticaData.statoPatente}</div>
                      </div>
                    )}
                    {!verificaPraticaData.statoFoglioRosa && !verificaPraticaData.statoPatente && (
                      <div className="text-center py-3 text-slate-400 text-sm">Nessun dato disponibile</div>
                    )}
                  </div>

                  {/* Scadenze */}
                  {verificaPraticaData.scadenze && verificaPraticaData.scadenze.length > 0 && (
                    <div>
                      <h5 className="text-xs font-bold text-slate-500 uppercase mb-2">Scadenze</h5>
                      <ul className="space-y-1">
                        {verificaPraticaData.scadenze.map((scadenza, i) => (
                          <li key={i} className="text-sm text-slate-700 bg-indigo-50 rounded px-2 py-1 border border-indigo-100">
                            📅 {scadenza}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {!verificaPraticaLoading && !verificaPraticaData && (
                <div className="text-center py-6 text-slate-400 text-sm bg-white rounded-lg border border-indigo-100">
                  <div className="mb-2">⚠️</div>
                  <div>Nessun dato disponibile per questa pratica</div>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={() => setShowVerificaPratica(false)}
                  className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-[11px] font-bold hover:bg-indigo-700 transition">
                  CHIUDI
                </button>
              </div>
            </div>
            );
          })()}

          {/* Form MODIFICA CANDIDATO (come nel portale) */}
          {showModificaCandidatoForm && selectedCandidato !== null && (() => {
            const cand = dettaglioData?.candidati?.[selectedCandidato] || {};
            return (
            <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 space-y-3 overflow-hidden max-w-full">
              <h4 className="text-sm font-bold text-amber-800">Modifica Candidato - Sessioni Quiz Interne</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3">
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase">Codice Statino</span>
                  <span className="text-sm font-bold text-slate-800 bg-slate-100 rounded px-2 py-1">{cand["Marca Operativa"] || cand.marca_operativa || "–"}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase">Cognome</span>
                  <span className="text-sm font-bold text-slate-800 bg-slate-100 rounded px-2 py-1">{cand.Cognome || cand.cognome || "–"}</span>
                </div>
                <div>
                  <label className="block text-[10px] text-amber-600 font-semibold mb-1">Lingua</label>
                  <select value={modificaCandForm.lingua} onChange={e => setModificaCandForm(f => ({ ...f, lingua: e.target.value }))}
                    className="w-full border border-amber-300 rounded-lg px-2 py-1.5 text-sm bg-white">
                    <option value="ITALIANO">ITALIANO</option>
                    <option value="FRANCESE">FRANCESE</option>
                    <option value="TEDESCO">TEDESCO</option>
                    <option value="INGLESE">INGLESE</option>
                    <option value="SPAGNOLO">SPAGNOLO</option>
                    <option value="ARABO">ARABO</option>
                    <option value="CINESE">CINESE</option>
                    <option value="RUSSO">RUSSO</option>
                    <option value="RUMENO">RUMENO</option>
                    <option value="ALBANESE">ALBANESE</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-amber-600 font-semibold mb-1">Supporto Audio</label>
                  <select value={modificaCandForm.supportoAudio} onChange={e => setModificaCandForm(f => ({ ...f, supportoAudio: e.target.value }))}
                    className="w-full border border-amber-300 rounded-lg px-2 py-1.5 text-sm bg-white">
                    <option value="NO">NO</option>
                    <option value="SI">SI</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-amber-600 font-semibold mb-1">Turno</label>
                  <select value={modificaCandForm.turno} onChange={e => setModificaCandForm(f => ({ ...f, turno: e.target.value }))}
                    className="w-full border border-amber-300 rounded-lg px-2 py-1.5 text-sm bg-white">
                    {(dettaglioData?.turni || [{ Turno: "1" }]).map((t, i) => (
                      <option key={i} value={t.Turno || String(i + 1)}>{t.Turno || String(i + 1)}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase">Abilitazione</span>
                  <span className="text-sm font-bold text-slate-800 bg-slate-100 rounded px-2 py-1">{cand.Abilitazione || cand.abilitazione || "–"}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase">Autoscuola</span>
                  <span className="text-sm font-bold text-slate-800 bg-slate-100 rounded px-2 py-1">{cand.Autoscuola || cand.autoscuola || "–"}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase">Patente</span>
                  <span className="text-sm font-bold text-slate-800 bg-slate-100 rounded px-2 py-1">{cand.Patente || cand.patente || "–"}</span>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  disabled={azioneLoading}
                  onClick={() => {
                    eseguiAzionePortale("edit", {
                      marcaOperativa: cand["Marca Operativa"] || cand.marca_operativa || "",
                      cognome: cand.Cognome || cand.cognome || "",
                      lingua: modificaCandForm.lingua,
                      supportoAudio: modificaCandForm.supportoAudio,
                      turno: modificaCandForm.turno,
                    });
                    setShowModificaCandidatoForm(false);
                  }}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg text-xs font-bold hover:bg-amber-700 disabled:opacity-50 transition">
                  {azioneLoading ? "⏳ Modifica in corso..." : "MODIFICA CANDIDATO"}
                </button>
                <button onClick={() => setShowModificaCandidatoForm(false)}
                  className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-300 transition">
                  INDIETRO
                </button>
              </div>
            </div>
            );
          })()}

          {/* Form SOSTITUISCI CANDIDATO (come nel portale) */}
          {showSostituisciCandidatoForm && selectedCandidato !== null && (() => {
            const cand = dettaglioData?.candidati?.[selectedCandidato] || {};
            return (
            <div className="bg-orange-50 rounded-xl border border-orange-200 p-4 space-y-3 overflow-hidden max-w-full">
              <h4 className="text-sm font-bold text-orange-800">Sostituisci Candidato - Sessioni Quiz Interne</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3">
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase">Codice Statino attuale</span>
                  <span className="text-sm font-bold text-slate-800 bg-slate-100 rounded px-2 py-1">{cand["Marca Operativa"] || cand.marca_operativa || "–"}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase">Cognome attuale</span>
                  <span className="text-sm font-bold text-slate-800 bg-slate-100 rounded px-2 py-1">{cand.Cognome || cand.cognome || "–"}</span>
                </div>
              </div>
              <hr className="border-orange-200" />
              <h5 className="text-xs font-bold text-orange-700">Nuovo Candidato</h5>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[10px] text-orange-600 font-semibold mb-1">Codice Statino *</label>
                  <input type="text" value={sostituisciCandForm.codiceStatino}
                    onChange={e => setSostituisciCandForm(f => ({ ...f, codiceStatino: e.target.value }))}
                    className="w-full border border-orange-300 rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-[10px] text-orange-600 font-semibold mb-1">Cognome *</label>
                  <input type="text" value={sostituisciCandForm.cognome}
                    onChange={e => setSostituisciCandForm(f => ({ ...f, cognome: e.target.value.toUpperCase() }))}
                    className="w-full border border-orange-300 rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-[10px] text-orange-600 font-semibold mb-1">Lingua</label>
                  <select value={sostituisciCandForm.lingua} onChange={e => setSostituisciCandForm(f => ({ ...f, lingua: e.target.value }))}
                    className="w-full border border-orange-300 rounded-lg px-2 py-1.5 text-sm bg-white">
                    <option value="ITALIANO">ITALIANO</option>
                    <option value="FRANCESE">FRANCESE</option>
                    <option value="TEDESCO">TEDESCO</option>
                    <option value="INGLESE">INGLESE</option>
                    <option value="SPAGNOLO">SPAGNOLO</option>
                    <option value="ARABO">ARABO</option>
                    <option value="CINESE">CINESE</option>
                    <option value="RUMENO">RUMENO</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-orange-600 font-semibold mb-1">Supporto Audio</label>
                  <select value={sostituisciCandForm.supportoAudio} onChange={e => setSostituisciCandForm(f => ({ ...f, supportoAudio: e.target.value }))}
                    className="w-full border border-orange-300 rounded-lg px-2 py-1.5 text-sm bg-white">
                    <option value="NO">NO</option>
                    <option value="SI">SI</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  disabled={azioneLoading || !sostituisciCandForm.codiceStatino || !sostituisciCandForm.cognome}
                  onClick={() => {
                    eseguiAzionePortale("replace", {
                      marcaOperativa: cand["Marca Operativa"] || cand.marca_operativa || "",
                      cognome: cand.Cognome || cand.cognome || "",
                      nuovoCodiceStatino: sostituisciCandForm.codiceStatino.trim(),
                      nuovoCognome: sostituisciCandForm.cognome.trim(),
                      lingua: sostituisciCandForm.lingua,
                      supportoAudio: sostituisciCandForm.supportoAudio,
                    });
                    setShowSostituisciCandidatoForm(false);
                  }}
                  className="px-4 py-2 bg-orange-600 text-white rounded-lg text-xs font-bold hover:bg-orange-700 disabled:opacity-50 transition">
                  {azioneLoading ? "⏳ Sostituzione..." : "SOSTITUISCI"}
                </button>
                <button onClick={() => setShowSostituisciCandidatoForm(false)}
                  className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-300 transition">
                  INDIETRO
                </button>
              </div>
            </div>
            );
          })()}

          {/* Tabella candidati (come nel portale) */}
          {dettaglioData.candidati && dettaglioData.candidati.length > 0 && (() => {
            const allCands = dettaglioData.candidati;
            const candKeys = Object.keys(allCands[0] || {}).filter(k => !k.startsWith("_"));
            // Filtri candidati (come nel portale: dropdown Autoscuola + Turno)
            const autoscuoleUniche = [...new Set(allCands.map(c => c.Autoscuola || c.autoscuola || "").filter(Boolean))];
            const turniUnici = [...new Set(allCands.map(c => c.Turno || c.turno || "").filter(Boolean))];
            return (
            <div className="space-y-2">
              {(() => {
                const propri = allCands.filter(c => { const cog = String(c.Cognome || c.cognome || "").toUpperCase(); return !cog.includes("POSTO PRENOTATO") && !cog.includes("POSTO  PRENOTATO"); }).length;
                const prenotati = allCands.length - propri;
                return (
                  <h4 className="text-sm font-bold text-slate-700">
                    Candidati prenotati ({allCands.length})
                    {propri > 0 && <span className="ml-2 text-xs font-medium text-blue-600">{propri} nominativi</span>}
                    {prenotati > 0 && <span className="ml-2 text-xs font-medium text-slate-400">{prenotati} posto prenotato (altre autoscuole)</span>}
                  </h4>
                );
              })()}

              {/* Filtri candidati (come nel portale) */}
              <div className="flex flex-wrap items-end gap-3 bg-slate-50 rounded-lg p-3 border border-slate-200">
                <div>
                  <label className="block text-[10px] text-slate-500 font-semibold mb-1">Autoscuola</label>
                  <select value={filtroAutoscuolaCand} onChange={e => setFiltroAutoscuolaCand(e.target.value)}
                    className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white min-w-[140px]">
                    <option value="">Tutti</option>
                    {autoscuoleUniche.map((a, i) => <option key={i} value={a}>{a}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 font-semibold mb-1">Turno</label>
                  <select value={filtroTurnoCand} onChange={e => setFiltroTurnoCand(e.target.value)}
                    className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white min-w-[100px]">
                    <option value="">Tutti</option>
                    {turniUnici.map((t, i) => <option key={i} value={t}>{t}</option>)}
                  </select>
                </div>
                <button onClick={() => { setFiltroAutoscuolaCand(""); setFiltroTurnoCand(""); }}
                  className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition">
                  RICERCA
                </button>
              </div>

              <div className="rounded-xl border border-slate-200" style={{ maxHeight: "350px", overflowX: "auto", overflowY: "auto", width: "100%" }}>
                <table className="text-xs border-collapse" style={{ minWidth: "max-content" }}>
                  <thead className="bg-slate-100 sticky top-0 z-10">
                    <tr>
                      <th className="px-2 py-2 text-center font-semibold text-slate-600 border-b border-slate-200 w-6">Nr.</th>
                      <th className="px-2 py-2 text-center font-semibold text-slate-600 border-b border-slate-200 w-8">Sel.</th>
                      {candKeys.map((h, i) => (
                        <th key={i} className="px-3 py-2 text-left font-semibold text-slate-600 whitespace-nowrap border-b border-slate-200">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allCands
                      .filter(c => {
                        if (filtroAutoscuolaCand && (c.Autoscuola || c.autoscuola || "") !== filtroAutoscuolaCand) return false;
                        if (filtroTurnoCand && (c.Turno || c.turno || "") !== filtroTurnoCand) return false;
                        return true;
                      })
                      .map((cand, ci) => {
                        const realIdx = allCands.indexOf(cand);
                        const cognome = String(cand.Cognome || cand.cognome || "").toUpperCase();
                        const isPostoPrenotato = cognome.includes("POSTO PRENOTATO") || cognome.includes("POSTO  PRENOTATO");
                        return (
                        <tr key={realIdx}
                          onClick={() => setSelectedCandidato(realIdx)}
                          className={`border-b border-slate-100 cursor-pointer transition-colors ${
                            selectedCandidato === realIdx ? "bg-blue-100" :
                            isPostoPrenotato ? "bg-slate-50/80 hover:bg-slate-100/60" :
                            "hover:bg-blue-50/30"
                          }`}>
                          <td className="px-2 py-1.5 text-center text-slate-500 font-mono">{realIdx + 1}</td>
                          <td className="px-2 py-1.5 text-center">
                            <input type="radio" name="candidatoSel" checked={selectedCandidato === realIdx} onChange={() => setSelectedCandidato(realIdx)} className="accent-blue-600" />
                          </td>
                          {candKeys.map((k, vi) => (
                            <td key={vi} className={`px-3 py-1.5 whitespace-nowrap max-w-[200px] truncate ${isPostoPrenotato ? "text-slate-400 italic" : "text-slate-700"}`} title={String(cand[k] || "")}>
                              {cand[k] || "–"}
                            </td>
                          ))}
                        </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>

              {/* Pulsanti azioni candidato (come nel portale) */}
              <div className="flex flex-wrap gap-3 py-3 border-t border-slate-200">
                <button onClick={handleStampaSessione}
                  className="px-4 py-2 bg-slate-500 text-white rounded-lg text-sm font-bold hover:bg-slate-600 transition">
                  STAMPA
                </button>
                <button onClick={handleStampaCandidati}
                  className="px-4 py-2 bg-slate-500 text-white rounded-lg text-sm font-bold hover:bg-slate-600 transition">
                  STAMPA CANDIDATI AUTOSCUOLA
                </button>
                <button onClick={() => {
                  if (selectedCandidato === null) { setAzioneMsg({ type: "warning", text: "Seleziona un candidato dalla tabella" }); return; }
                  handleStampaPortale("stampaPrenotazione", selectedCandidato);
                }}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 transition">
                  🖨️ STAMPA PRENOTAZIONE
                </button>
                <button onClick={handleModificaCandidato} disabled={azioneLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 disabled:opacity-50 transition">
                  {azioneLoading ? "⏳" : ""} MODIFICA CANDIDATO
                </button>
                <button onClick={handleEliminaCandidato} disabled={azioneLoading}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-bold hover:bg-red-700 disabled:opacity-50 transition">
                  {azioneLoading ? "⏳" : ""} ELIMINA CANDIDATO
                </button>
                <button onClick={handleSostituisciCandidato} disabled={azioneLoading}
                  className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-bold hover:bg-orange-700 disabled:opacity-50 transition">
                  {azioneLoading ? "⏳" : ""} SOSTITUISCI CANDIDATO
                </button>
                <button onClick={handleStoria} disabled={azioneLoading || storiaLoading}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-bold hover:bg-purple-700 disabled:opacity-50 transition">
                  {storiaLoading ? "⏳" : ""} STORIA
                </button>
                <button onClick={handleVerificaPratica} disabled={azioneLoading || verificaPraticaLoading}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 transition">
                  {verificaPraticaLoading ? "⏳" : "🔍"} VERIFICA PRATICA
                </button>
                <button onClick={() => {
                  if (selectedCandidato === null) { setAzioneMsg({ type: "warning", text: "Seleziona un candidato" }); return; }
                  const cand = dettaglioData.candidati[selectedCandidato] || {};
                  const info = Object.entries(cand).filter(([k]) => !k.startsWith("_")).map(([k,v]) => `${k}: ${v}`).join("\n");
                  alert(`Dettaglio Candidato #${selectedCandidato + 1}\n\n${info}`);
                }}
                  className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-bold hover:bg-teal-700 transition">
                  DETTAGLIO
                </button>
              </div>
            </div>
            );
          })()}

          {/* Se non ci sono candidati, mostra sezione vuota con pulsanti base */}
          {(!dettaglioData.candidati || dettaglioData.candidati.length === 0) && !dettaglioData.loading && dettaglioData.source !== "tabella" && (
            <div className="space-y-2">
              <div className="text-center py-6 text-slate-400 text-sm border rounded-xl bg-slate-50">
                Nessun candidato prenotato in questa sessione
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={handleStampaSessione}
                  className="px-3 py-1.5 bg-slate-500 text-white rounded-lg text-[11px] font-bold hover:bg-slate-600 transition">
                  STAMPA
                </button>
              </div>
            </div>
          )}

          <ToolbarAzioni
            intestazioni={dettaglioData.pairs.map(p => p.label)}
            righe={[dettaglioData.pairs.map(p => p.value)]}
            title={`Dettaglio ${label}`}
          />
          </>
          )}
        </div>
      ) : (
        <TabellaPortale
          intestazioni={intestazioni}
          righe={righe}
          loading={loading}
          error={error}
          emptyMsg={sessioni ? "Nessuna sessione nel periodo selezionato" : "Caricamento in corso…"}
          selectable={true}
          selectedRow={selectedRow}
          onSelectRow={setSelectedRow}
          onRowDoubleClick={(ri) => { setSelectedRow(ri); setTimeout(openDettaglio, 50); }}
        />
      )}
    </div>
  );
}

// ─── PANNELLO VERBALI ──────────────────────────────────────────────────────────

function PanelloVerbali({ tipo, label }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [risultato, setRisultato] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);

  // Dettaglio verbale
  const [dettaglioView, setDettaglioView] = useState(false);
  const [dettaglioData, setDettaglioData] = useState(null);

  // Modalità: "archivio" (default, DB locale completo) oppure "portale" (live, max 7gg)
  const [modalita, setModalita] = useState("archivio");

  // Filtri
  const MAX_VERBALI_DAYS = 7;
  const [filters, setFilters] = useState({ dataFrom: "", dataTo: "" });
  const [lastSync, setLastSync] = useState(null);
  const [dateWarning, setDateWarning] = useState("");
  const autoLoaded = useRef(false);

  // Filtri avanzati
  const [tipoEsame, setTipoEsame] = useState("");
  const [fasciaOraria, setFasciaOraria] = useState("");
  const [numeroVerbale, setNumeroVerbale] = useState("");
  const [codiceLocalita, setCodiceLocalita] = useState("");
  const [codEsaminatore, setCodEsaminatore] = useState("");
  const [annoVerbale, setAnnoVerbale] = useState("");
  const [statoVerbale, setStatoVerbale] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Archivio locale
  const [archivioData, setArchivioData] = useState([]);
  const [archivioTotal, setArchivioTotal] = useState(0);
  const [archivioStats, setArchivioStats] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);

  // Auto-sync
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(null);
  const [syncLog, setSyncLog] = useState([]);
  const syncAbort = useRef(null);

  function validateAndSetDates(newFilters) {
    if (modalita === "archivio") {
      setDateWarning("");
      return newFilters;
    }
    const from = new Date(newFilters.dataFrom);
    const to = new Date(newFilters.dataTo);
    const diffDays = Math.round((to - from) / 86400000);
    if (diffDays < 0) {
      setDateWarning("La data 'Da' non può essere successiva alla data 'A'");
      return newFilters;
    }
    if (diffDays >= MAX_VERBALI_DAYS) {
      setDateWarning(`Il portale ammette massimo ${MAX_VERBALI_DAYS} giorni. Range ridotto automaticamente.`);
      const correctedFrom = new Date(to);
      correctedFrom.setDate(correctedFrom.getDate() - (MAX_VERBALI_DAYS - 1));
      return { ...newFilters, dataFrom: correctedFrom.toISOString().slice(0, 10) };
    }
    setDateWarning("");
    return newFilters;
  }

  // ── All'apertura: carica archivio, poi (dopo) avvia auto-sync in background ──
  useEffect(() => {
    if (!autoLoaded.current) {
      autoLoaded.current = true;
      // Carica subito i dati dall'archivio locale (con retry interno)
      caricaDaArchivio();
      caricaStats();
      // Avvia auto-sync DOPO un delay per non competere con il caricamento iniziale
      setTimeout(() => checkAndAutoSync(), 3000);
    }
  }, []);

  // ── Controlla stato sync e avvia auto-sync se necessario ──
  async function checkAndAutoSync() {
    try {
      const base = apiBase();
      const res = await fetch(`${base}/api/verbali-svolti/sync-status?tipo=${tipo}`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setSyncStatus(data.status);

      // Se serve aggiornamento (primo sync o dati vecchi), avvia auto-sync in background
      if (data.needsFullSync || data.needsUpdate) {
        avviaAutoSync(false);
      }
    } catch { /* silenzioso */ }
  }

  // ── Auto-sync intelligente (SSE) ──
  async function avviaAutoSync(forceFullSync = false) {
    if (syncing) return;
    setSyncing(true);
    setSyncLog([]);
    setSyncProgress(null);

    try {
      const base = apiBase();
      const res = await fetch(`${base}/api/verbali-svolti/auto-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ tipo, forceFullSync }),
      });

      await readSSEStream(res);
    } catch (e) {
      setSyncLog(prev => [...prev, { type: "error", error: e.message }]);
    } finally {
      setSyncing(false);
      // Ricarica dati dopo sync
      caricaDaArchivio();
      caricaStats();
      // Aggiorna sync status
      try {
        const base = apiBase();
        const r = await fetch(`${base}/api/verbali-svolti/sync-status?tipo=${tipo}`, { headers: authHeaders() });
        if (r.ok) { const d = await r.json(); setSyncStatus(d.status); }
      } catch {}
    }
  }

  // ── Leggi stream SSE ──
  async function readSSEStream(res) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "progress" || evt.type === "chunk_done" || evt.type === "chunk_error") {
              setSyncProgress(evt);
              setSyncLog(prev => [...prev.slice(-100), evt]);
            } else if (evt.type === "complete") {
              setSyncProgress(evt);
              setSyncLog(prev => [...prev, evt]);
            } else if (evt.type === "start" || evt.type === "info" || evt.type === "discovery") {
              setSyncProgress(evt);
              setSyncLog(prev => [...prev, evt]);
            }
          } catch { /* skip */ }
        }
      }
    }
  }

  // ── Carica da portale (live, max 7gg) ──
  async function caricaDaPortale() {
    setLoading(true);
    setError("");
    setSelectedRow(null);
    try {
      const base = apiBase();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000); // 2 min timeout
      const res = await fetch(`${base}/api/portal/verbali`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          tipo,
          dataFrom: isoToDDMMYYYY(filters.dataFrom),
          dataTo:   isoToDDMMYYYY(filters.dataTo),
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRisultato(data);
      setLastSync(new Date().toLocaleTimeString("it-IT"));

      // Salva automaticamente nel DB locale (in background)
      if (data.righe && data.righe.length > 0) {
        fetch(`${base}/api/verbali-svolti/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ dataFrom: filters.dataFrom, dataTo: filters.dataTo, tipo }),
        }).catch(() => {});
      }
    } catch (e) {
      if (e.name === "AbortError") {
        setError("Timeout: il portale non ha risposto entro 2 minuti. Riprova.");
      } else {
        setError(e.message || "Errore");
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Carica da archivio locale (nessun limite), con retry automatico ──
  async function caricaDaArchivio() {
    return caricaDaArchivioInner(3);
  }

  async function caricaDaArchivioInner(maxRetries = 1) {
    setLoading(true);
    setError("");
    setSelectedRow(null);
    let lastErr = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const base = apiBase();
        const params = new URLSearchParams();
        params.set("tipoVerbale", tipo); // VAC, VSC, VSQ — filtra per categoria verbale
        if (filters.dataFrom) params.set("dataFrom", filters.dataFrom);
        if (filters.dataTo) params.set("dataTo", filters.dataTo);
        if (tipoEsame) params.set("tipoEsame", tipoEsame);
        if (fasciaOraria) params.set("fasciaOraria", fasciaOraria);
        if (numeroVerbale) params.set("numeroVerbale", numeroVerbale);
        if (codiceLocalita) params.set("codiceLocalita", codiceLocalita);
        if (codEsaminatore) params.set("codEsaminatore", codEsaminatore);
        if (annoVerbale) params.set("annoVerbale", annoVerbale);
        if (statoVerbale) params.set("statoVerbale", statoVerbale);
        params.set("limit", "500");

        const res = await fetch(`${base}/api/verbali-svolti?${params}`, { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setArchivioData(data.data || []);
        setArchivioTotal(data.total || 0);
        setLastSync(new Date().toLocaleTimeString("it-IT"));
        setLoading(false);
        return; // successo
      } catch (e) {
        lastErr = e;
        const isTransient = /fetch failed|Failed to fetch|NetworkError|ECONNRESET/i.test(e.message);
        if (isTransient && attempt < maxRetries) {
          console.warn(`[Verbali] caricaDaArchivio tentativo ${attempt}/${maxRetries}: ${e.message}. Riprovo...`);
          await new Promise(r => setTimeout(r, 700 * attempt));
          continue;
        }
      }
    }
    setError(lastErr?.message || "Errore caricamento archivio");
    setLoading(false);
  }

  // ── Carica statistiche archivio ──
  async function caricaStats() {
    try {
      const base = apiBase();
      const res = await fetch(`${base}/api/verbali-svolti/stats?tipoVerbale=${tipo}`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setArchivioStats(data);
      }
    } catch { /* silenzioso */ }
  }

  // ── Funzione carica principale ──
  function carica() {
    if (modalita === "archivio") {
      caricaDaArchivio();
      caricaStats();
    } else {
      caricaDaPortale();
    }
  }

  // ── Helper: costruisci pairs da un record DB ──
  function buildRecordPairs(r) {
    return [
      { label: "Data Verbale", value: r.data_verbale ? new Date(r.data_verbale + "T00:00:00").toLocaleDateString("it-IT") : "–" },
      { label: "Tipo Esame", value: r.tipo_esame || "–" },
      { label: "Codice Tipo", value: r.tipo_esame_codice === "I" ? "QUIZ" : r.tipo_esame_codice === "G" ? "GUIDA" : r.tipo_esame_codice === "O" ? "ORALE" : r.tipo_esame_codice === "S" ? "SCRITTO" : (r.tipo_esame_codice || "–") },
      { label: "Fascia Oraria", value: r.fascia_oraria === "M" ? "Mattutina" : r.fascia_oraria === "P" ? "Pomeridiana" : (r.fascia_oraria || "–") },
      { label: "N. Verbale", value: r.numero_verbale != null ? String(r.numero_verbale) : "–" },
      { label: "Candidati Prenotati", value: r.candidati_prenotati != null ? String(r.candidati_prenotati) : "–" },
      { label: "Stato Verbale", value: r.stato_verbale || "–" },
      { label: "Ufficio Provinciale", value: r.ufficio_provinciale || "–" },
      { label: "Codice Località", value: r.codice_localita != null ? String(r.codice_localita) : "–" },
      { label: "Aula", value: r.aula != null ? String(r.aula) : "–" },
      { label: "Descrizione Località", value: r.desc_localita || "–" },
      { label: "Indirizzo", value: r.indirizzo || "–" },
      { label: "Anno Verbale", value: r.anno_verbale != null ? String(r.anno_verbale) : "–" },
      { label: "Cod. Esaminatore", value: r.cod_esaminatore || "–" },
      { label: "Nome Esaminatore", value: r.nome_esaminatore || "–" },
      { label: "Sincronizzato il", value: r.synced_at ? new Date(r.synced_at).toLocaleString("it-IT") : "–" },
    ];
  }

  // ── Dettaglio verbale ──
  async function openDettaglio() {
    if (selectedRow === null) return;

    if (modalita === "archivio" && archivioData[selectedRow]) {
      // Dettaglio da archivio: dati completi dal DB
      const r = archivioData[selectedRow];
      setDettaglioData({ pairs: buildRecordPairs(r), rowIndex: selectedRow, record: r, source: "archivio" });
      setDettaglioView(true);
    } else {
      // Dettaglio da portale: prima mostra i dati tabella, poi cerca nel DB locale per arricchirli
      const row = righe[selectedRow];
      if (!row) return;

      // Mostra subito i dati della tabella
      const basicPairs = intestazioni.map((h, i) => ({
        label: h || `Campo ${i + 1}`,
        value: Array.isArray(row) ? (row[i] || "–") : "–",
      }));
      setDettaglioData({ pairs: basicPairs, rowIndex: selectedRow, source: "portale", loading: true });
      setDettaglioView(true);

      // Estrai data e numero verbale dalla riga per cercare nel DB locale
      try {
        const dataVerbStr = row[1] || row[0] || ""; // Data Verb. è tipicamente colonna 1
        const verbStr = row[4] || row[3] || "";      // N. Verbale tipicamente colonna 4
        const uffProv = row[7] || row[6] || "";       // Uff. Prov. tipicamente colonna 7

        // Converti DD/MM/YYYY → YYYY-MM-DD
        let dataVerbale = "";
        const dm = String(dataVerbStr).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (dm) dataVerbale = `${dm[3]}-${dm[2]}-${dm[1]}`;

        if (dataVerbale && verbStr) {
          const base = apiBase();
          const params = new URLSearchParams({
            data_verbale: dataVerbale,
            numero_verbale: String(verbStr).trim(),
          });
          if (uffProv) params.set("ufficio_prov", String(uffProv).trim());

          const res = await fetch(`${base}/api/verbali-svolti/find?${params}`, { headers: authHeaders() });
          if (res.ok) {
            const data = await res.json();
            if (data.found && data.record) {
              // Arricchisci con i dati dal DB locale
              setDettaglioData({
                pairs: buildRecordPairs(data.record),
                rowIndex: selectedRow,
                record: data.record,
                source: "db_locale",
                loading: false,
              });
              return;
            }
          }
        }
      } catch { /* silenzioso — resta con i dati base */ }

      // Rimuovi lo stato loading se non trovato nel DB
      setDettaglioData(prev => prev ? { ...prev, loading: false, source: "portale" } : prev);
    }
  }

  function closeDettaglio() {
    setDettaglioView(false);
    setDettaglioData(null);
  }

  // ── Genera anni per dropdown ──
  const anniOptions = [];
  for (let y = new Date().getFullYear(); y >= 2006; y--) anniOptions.push(y);

  // ── Dati per la tabella ──
  const intestazioni = modalita === "portale"
    ? (risultato?.intestazioni || [])
    : ["Data Verb.", "Esame", "F.O", "Verb.", "Cand. Pren.", "Stato Verb.", "Uff. Prov.", "Loc.", "Aula", "Desc. Località", "Indirizzo"];
  const righe = modalita === "portale"
    ? (risultato?.righe || [])
    : archivioData.map(r => [
        r.data_verbale ? new Date(r.data_verbale + "T00:00:00").toLocaleDateString("it-IT") : "",
        r.tipo_esame || "",
        r.fascia_oraria || "",
        r.numero_verbale != null ? String(r.numero_verbale) : "",
        r.candidati_prenotati != null ? String(r.candidati_prenotati) : "",
        r.stato_verbale || "",
        r.ufficio_provinciale || "",
        r.codice_localita != null ? String(r.codice_localita) : "",
        r.aula != null ? String(r.aula) : "",
        r.desc_localita || "",
        r.indirizzo || "",
      ]);

  const totalCount = modalita === "portale"
    ? (risultato?.count || righe.length)
    : archivioTotal;

  function handleAnnulla() {
    setFilters(modalita === "portale" ? { dataFrom: daysAgo(6), dataTo: todayISO() } : { dataFrom: "", dataTo: "" });
    setDateWarning("");
    setSelectedRow(null);
    setDettaglioView(false);
    setDettaglioData(null);
    setTipoEsame("");
    setFasciaOraria("");
    setNumeroVerbale("");
    setCodiceLocalita("");
    setCodEsaminatore("");
    setAnnoVerbale("");
    setStatoVerbale("");
  }

  const inputCls = "border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none";
  const selectCls = "border border-slate-300 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white";

  return (
    <div className="space-y-3 max-w-full">
      {/* Barra stato sync */}
      {syncing && (
        <div className="flex items-center gap-3 p-2 bg-amber-50 rounded-lg border border-amber-300">
          <div className="w-3 h-3 rounded-full bg-amber-500 animate-pulse"></div>
          <span className="text-xs text-amber-800 font-semibold">
            {syncProgress?.type === "discovery"
              ? `Ricerca storica — verifica anno ${syncProgress.year}...`
              : syncProgress?.chunk && syncProgress?.total
                ? `Sincronizzazione ${syncProgress.chunk}/${syncProgress.total}`
                : "Sincronizzazione dal Portale in corso..."}
          </span>
          {syncProgress?.type === "info" && (
            <span className="text-xs text-amber-600">{syncProgress.message}</span>
          )}
          {syncProgress?.totalInserted > 0 && (
            <span className="text-xs text-emerald-700 font-bold ml-auto">{syncProgress.totalInserted} verbali trovati</span>
          )}
        </div>
      )}

      {/* Stato archivio */}
      {!syncing && syncStatus && (
        <div className="flex items-center gap-3 p-2 bg-emerald-50 rounded-lg border border-emerald-200">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
          <span className="text-xs text-emerald-800">
            Archivio: <strong>{archivioStats?.totaleVerbali || 0}</strong> verbali
            {archivioStats?.anni?.length > 0 && ` dal ${archivioStats.anni[archivioStats.anni.length - 1]} al ${archivioStats.anni[0]}`}
            {syncStatus.last_sync_at && ` — Ultimo sync: ${new Date(syncStatus.last_sync_at).toLocaleString("it-IT")}`}
          </span>
          <button onClick={() => avviaAutoSync(false)} disabled={syncing}
            className="ml-auto px-2 py-1 bg-emerald-600 text-white rounded text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 transition">
            Aggiorna
          </button>
          <button onClick={() => avviaAutoSync(true)} disabled={syncing}
            className="px-2 py-1 bg-amber-500 text-white rounded text-xs font-semibold hover:bg-amber-600 disabled:opacity-50 transition"
            title="Risincronizza tutto dal 2006 ad oggi">
            Sync completo
          </button>
        </div>
      )}

      {/* Prima sincronizzazione */}
      {!syncing && !syncStatus && !loading && (
        <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
          <span className="text-sm text-blue-800">
            Nessun dato nell&apos;archivio. Avvio sincronizzazione automatica dal Portale...
          </span>
        </div>
      )}

      {/* Toggle Archivio / Portale */}
      <div className="flex items-center gap-2 mb-1">
        <button onClick={() => {
          setModalita("archivio");
          setDateWarning("");
          setFilters({ dataFrom: "", dataTo: "" });
          caricaDaArchivio();
          caricaStats();
        }}
          className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${modalita === "archivio" ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-600 hover:bg-slate-300"}`}>
          Archivio Storico
        </button>
        <button onClick={() => {
          setModalita("portale");
          setDateWarning("");
          setFilters({ dataFrom: daysAgo(6), dataTo: todayISO() });
        }}
          className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${modalita === "portale" ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600 hover:bg-slate-300"}`}>
          Portale (live)
        </button>
        {modalita === "archivio" && archivioStats && archivioStats.totaleVerbali > 0 && (
          <span className="text-xs text-slate-500 ml-2">
            {archivioStats.totaleVerbali} verbali — {archivioStats.anni?.length || 0} anni
          </span>
        )}
      </div>

      {/* Filtri principali */}
      <div className="flex flex-wrap items-end gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Tipo Esame</label>
          <select value={tipoEsame} onChange={e => setTipoEsame(e.target.value)} className={selectCls}>
            <option value="">Tutti</option>
            <option value="I">QUIZ</option>
            <option value="G">GUIDA</option>
            <option value="O">ORALE</option>
            <option value="S">SCRITTO</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Data da</label>
          <input type="date" value={filters.dataFrom}
            onChange={e => setFilters(f => validateAndSetDates({ ...f, dataFrom: e.target.value }))}
            className={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Data a</label>
          <input type="date" value={filters.dataTo}
            onChange={e => setFilters(f => validateAndSetDates({ ...f, dataTo: e.target.value }))}
            className={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Fascia Oraria</label>
          <select value={fasciaOraria} onChange={e => setFasciaOraria(e.target.value)} className={selectCls}>
            <option value="">Tutte</option>
            <option value="M">Mattutina</option>
            <option value="P">Pomeridiana</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">N. Verbale</label>
          <input type="text" value={numeroVerbale} onChange={e => setNumeroVerbale(e.target.value)}
            placeholder="" className={`${inputCls} w-20`} />
        </div>

        {modalita === "portale" && <div className="text-xs text-slate-400 self-center">Max 7 giorni</div>}

        <button onClick={carica} disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition flex items-center gap-2">
          {loading ? "..." : "RICERCA"}
        </button>
        <button onClick={handleAnnulla}
          className="px-4 py-2 bg-slate-300 text-slate-700 rounded-xl text-sm font-semibold hover:bg-slate-400 transition">
          ANNULLA
        </button>

        <button onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-xs text-blue-600 underline self-center ml-1">
          {showAdvanced ? "Nascondi filtri" : "Filtri avanzati"}
        </button>
      </div>

      {/* Filtri avanzati (espandibili) */}
      {showAdvanced && (
        <div className="flex flex-wrap items-end gap-3 p-3 bg-blue-50 rounded-xl border border-blue-200">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Ufficio Prov.</label>
            <input type="text" value="" readOnly className={`${inputCls} w-14 bg-slate-100`} placeholder="ME" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Località</label>
            <input type="text" value={codiceLocalita} onChange={e => setCodiceLocalita(e.target.value)}
              placeholder="660" className={`${inputCls} w-16`} />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Cod. Esaminatore</label>
            <input type="text" value={codEsaminatore} onChange={e => setCodEsaminatore(e.target.value)}
              placeholder="" className={`${inputCls} w-20`} maxLength={3} />
          </div>
          {modalita === "archivio" && (
            <div>
              <label className="block text-xs text-slate-500 mb-1">Anno Verbale</label>
              <select value={annoVerbale} onChange={e => setAnnoVerbale(e.target.value)} className={selectCls}>
                <option value="">Tutti</option>
                {anniOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          )}
          {modalita === "archivio" && (
            <div>
              <label className="block text-xs text-slate-500 mb-1">Stato Verbale</label>
              <input type="text" value={statoVerbale} onChange={e => setStatoVerbale(e.target.value)}
                placeholder="es. SVOLTO" className={`${inputCls} w-32`} />
            </div>
          )}
        </div>
      )}

      {/* Sync log (terminale) */}
      {syncing && syncLog.length > 0 && (
        <div className="max-h-40 overflow-y-auto bg-slate-900 text-green-400 text-xs p-2 rounded-lg font-mono">
          {syncLog.slice(-25).map((evt, i) => (
            <div key={i}>
              {evt.type === "info" && <span className="text-cyan-400">{evt.message}</span>}
              {evt.type === "discovery" && (
                <span className={evt.found ? "text-green-300" : "text-slate-500"}>
                  {evt.found ? `✓` : `✗`} Anno {evt.year}: {evt.found ? "verbali trovati" : "nessun verbale"}
                </span>
              )}
              {evt.type === "start" && <span className="text-cyan-400">Download: {evt.totalChunks} blocchi ({evt.globalFrom} → {evt.globalTo})</span>}
              {evt.type === "chunk_done" && `[${evt.chunk}/${evt.total}] ${evt.from} → ${evt.to}: ${evt.found} verbali (tot: ${evt.totalInserted})`}
              {evt.type === "chunk_error" && <span className="text-red-400">[{evt.chunk}] ERRORE: {evt.error}</span>}
              {evt.type === "complete" && (
                <span className="text-yellow-300 font-bold">
                  COMPLETATO: {evt.totalInserted} verbali salvati {evt.from && `(${evt.from} → ${evt.to})`}
                </span>
              )}
              {evt.type === "progress" && `Elaborazione ${evt.from} → ${evt.to}...`}
              {evt.type === "error" && <span className="text-red-400">ERRORE: {evt.error}</span>}
            </div>
          ))}
        </div>
      )}

      {dateWarning && <div className="text-xs text-amber-600 p-1">{dateWarning}</div>}

      {/* Conteggio risultati */}
      {!loading && totalCount > 0 && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <span className="font-semibold text-blue-700">{totalCount}</span> verbali trovati
          {modalita === "portale" && risultato?.message && <span className="text-amber-600 ml-2">{risultato.message}</span>}
        </div>
      )}
      {lastSync && <span className="text-xs text-slate-400">Ultimo aggiornamento: {lastSync}</span>}

      {/* Statistiche per anno (solo archivio) */}
      {modalita === "archivio" && archivioStats && archivioStats.perAnno && Object.keys(archivioStats.perAnno).length > 0 && (
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <div className="text-xs font-semibold text-slate-500 mb-2">Riepilogo per anno</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(archivioStats.perAnno).sort((a, b) => b[0] - a[0]).map(([anno, counts]) => (
              <div key={anno} className="bg-white rounded-lg border border-slate-200 px-3 py-1.5 text-xs">
                <div className="font-bold text-slate-700">{anno}</div>
                <div className="text-slate-500">
                  {counts.totale} tot
                  {counts.quiz > 0 && <span className="text-blue-600 ml-1">Q:{counts.quiz}</span>}
                  {counts.guida > 0 && <span className="text-green-600 ml-1">G:{counts.guida}</span>}
                  {counts.orale > 0 && <span className="text-purple-600 ml-1">O:{counts.orale}</span>}
                  {counts.scritto > 0 && <span className="text-orange-600 ml-1">S:{counts.scritto}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toolbar azioni */}
      {/* Toolbar azioni */}
      {!dettaglioView && (
        <ToolbarAzioni
          intestazioni={intestazioni}
          righe={righe}
          title={label}
          onAnnulla={handleAnnulla}
          selectedRow={selectedRow}
          onDettaglio={openDettaglio}
          showDettaglio={true}
        />
      )}

      {/* Vista dettaglio */}
      {dettaglioView && dettaglioData?.pairs ? (
        <div className="space-y-3 max-w-full">
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={closeDettaglio}
              className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded-lg text-xs font-semibold text-slate-700 transition">
              ← Indietro
            </button>
            <span className="text-sm font-semibold text-slate-700">
              Dettaglio Verbale #{(dettaglioData.rowIndex || 0) + 1}
            </span>
            {dettaglioData.record?.stato_verbale && (
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                dettaglioData.record.stato_verbale === "SVOLTO" ? "bg-emerald-100 text-emerald-700" :
                dettaglioData.record.stato_verbale === "ANNULLATO" ? "bg-red-100 text-red-700" :
                "bg-amber-100 text-amber-700"
              }`}>
                {dettaglioData.record.stato_verbale}
              </span>
            )}
            {/* Indicatore fonte dati */}
            <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
              dettaglioData.source === "db_locale" || dettaglioData.source === "archivio"
                ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                : "bg-slate-50 text-slate-500 border border-slate-200"
            }`}>
              {dettaglioData.loading ? "Ricerca dati arricchiti..." :
               dettaglioData.source === "db_locale" ? "Dati da archivio locale" :
               dettaglioData.source === "archivio" ? "Dati da archivio locale" :
               "Dati dal portale"}
            </span>
          </div>

          {/* Card dettaglio con griglia */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
            {dettaglioData.pairs.filter(p => p.value !== "–" && p.value !== "").map((p, i) => (
              <div key={i} className="flex flex-col gap-0.5">
                <span className="text-xs text-slate-400 font-medium uppercase tracking-wide">{p.label}</span>
                <span className="text-sm text-slate-800 font-semibold">{p.value}</span>
              </div>
            ))}
          </div>

          {/* Toolbar per il dettaglio (copia/stampa/export) */}
          <ToolbarAzioni
            intestazioni={dettaglioData.pairs.map(p => p.label)}
            righe={[dettaglioData.pairs.map(p => p.value)]}
            title={`Dettaglio Verbale - ${label}`}
          />
        </div>
      ) : (
        <TabellaPortale
          intestazioni={intestazioni}
          righe={righe}
          loading={loading}
          error={error}
          emptyMsg={syncing
            ? "Sincronizzazione in corso... I verbali appariranno al termine."
            : (modalita === "portale"
              ? (risultato ? risultato.message || "Nessun verbale nel periodo selezionato" : "Caricamento in corso...")
              : "Nessun verbale trovato. Clicca 'Aggiorna' per sincronizzare dal Portale.")}
          selectable={true}
          selectedRow={selectedRow}
          onSelectRow={setSelectedRow}
          onRowDoubleClick={(ri) => { setSelectedRow(ri); setTimeout(openDettaglio, 50); }}
        />
      )}
    </div>
  );
}

// ─── PANNELLO SITUAZIONE CANDIDATI ─────────────────────────────────────────────

function PanelloSituazioneCandidati() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [risultato, setRisultato] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);
  const defaultFilters = { tipoConseguimento: "P", tipoProva: "T", statoCandidati: "D" };
  const [filters, setFilters] = useState({ ...defaultFilters });
  const [lastSync, setLastSync] = useState(null);
  const autoLoaded = useRef(false);

  // Vista dettaglio candidato (card espansa della riga selezionata)
  const [dettaglioView, setDettaglioView] = useState(false);
  const [dettaglioData, setDettaglioData] = useState(null);

  useEffect(() => {
    if (!autoLoaded.current) {
      autoLoaded.current = true;
      setTimeout(() => carica(), 50);
    }
  }, []);

  async function carica() {
    setLoading(true);
    setError("");
    setSelectedRow(null);
    setDettaglioView(false);
    setDettaglioData(null);
    try {
      const base = apiBase();
      const res = await fetch(`${base}/api/portal/search-results`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(filters),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRisultato(data);
      setLastSync(new Date().toLocaleTimeString("it-IT"));
    } catch (e) {
      setError(e.message || "Errore");
    } finally {
      setLoading(false);
    }
  }

  // Formato righe dai risultati
  let intestazioni = [];
  let righe = [];

  if (risultato) {
    if (risultato.intestazioni?.length && risultato.righe) {
      intestazioni = risultato.intestazioni;
      righe = risultato.righe;
    } else if (Array.isArray(risultato.results || risultato.candidates)) {
      const cands = risultato.results || risultato.candidates;
      if (cands.length > 0) {
        intestazioni = ["Cognome", "Nome", "Cod. Fiscale", "Numero Patente", "Categoria", "Stato", "Data"];
        righe = cands.map(c => [
          c.cognome || "–",
          c.nome || "–",
          c.codice_fiscale || c.codiceFiscale || "–",
          c.patente_numero || c.numeroPatente || "–",
          c.categoria_patente || c.categoria || "–",
          c.stato || "–",
          c.data_iscrizione || c.dataIscrizione || "–",
        ]);
      }
    }
  }

  // Dettaglio candidato: mostra i dati della riga selezionata in formato espanso
  // Il backend readSituazioneCandidatiListViaBrowser già aggrega tutti i candidati
  // con il flusso DETTAGLIO/INDIETRO, quindi i dati nella tabella SONO il dettaglio
  function openDettaglio() {
    if (selectedRow === null || !righe[selectedRow]) return;
    setDettaglioView(true);
    const row = righe[selectedRow];
    const pairs = intestazioni.map((h, i) => ({
      label: h || `Campo ${i+1}`,
      value: Array.isArray(row) ? (row[i] || "–") : "–",
    }));
    setDettaglioData({ pairs, rowIndex: selectedRow });
  }

  function handleAnnulla() {
    setFilters({ ...defaultFilters });
    setSelectedRow(null);
    setDettaglioView(false);
    setDettaglioData(null);
  }

  return (
    <div className="space-y-3 max-w-full">
      {/* Filtri */}
      <div className="flex flex-wrap items-end gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Tipo conseguimento</label>
          <select value={filters.tipoConseguimento}
            onChange={e => setFilters(f => ({ ...f, tipoConseguimento: e.target.value }))}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
            <option value="P">Patente</option>
            <option value="Q">CQC</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Tipo prova</label>
          <select value={filters.tipoProva}
            onChange={e => setFilters(f => ({ ...f, tipoProva: e.target.value }))}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
            {filters.statoCandidati === "P" ? (
              <>
                <option value="Q">Quiz</option>
                <option value="G">Guida</option>
                <option value="O">Orale</option>
                <option value="S">Scritto</option>
              </>
            ) : (
              <>
                <option value="T">Teoria</option>
                <option value="G">Guida</option>
              </>
            )}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Stato candidati</label>
          <select value={filters.statoCandidati}
            onChange={e => {
              const newStato = e.target.value;
              const defaultProva = newStato === "P" ? "Q" : "T";
              setFilters(f => ({ ...f, statoCandidati: newStato, tipoProva: defaultProva }));
            }}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
            <option value="D">Da prenotare</option>
            <option value="P">Prenotati</option>
          </select>
        </div>
        <button onClick={carica} disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition flex items-center gap-2">
          {loading ? "⏳" : "🔍"} Ricerca
        </button>
        {lastSync && <span className="text-xs text-slate-400">Ultimo sync: {lastSync}</span>}
      </div>

      {risultato && !loading && !dettaglioView && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <span className="font-semibold text-blue-700">{righe.length}</span> candidati trovati
          {risultato.message && <span className="text-amber-600 ml-2">{risultato.message}</span>}
        </div>
      )}

      {/* Toolbar azioni */}
      {!dettaglioView && (
        <ToolbarAzioni
          intestazioni={intestazioni}
          righe={righe}
          title="Situazione Candidati"
          onAnnulla={handleAnnulla}
          selectedRow={selectedRow}
          onDettaglio={openDettaglio}
          showDettaglio={true}
        />
      )}

      {/* Vista dettaglio o lista */}
      {dettaglioView && dettaglioData?.pairs ? (
        <div className="space-y-3 max-w-full">
          <div className="flex items-center gap-3">
            <button onClick={() => { setDettaglioView(false); setDettaglioData(null); }}
              className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded-lg text-xs font-semibold text-slate-700 transition">
              ← Indietro
            </button>
            <span className="text-sm font-semibold text-slate-700">
              Dettaglio Candidato #{(dettaglioData.rowIndex || 0) + 1}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
            {dettaglioData.pairs.map((p, i) => (
              <div key={i} className="flex flex-col">
                <span className="text-xs text-slate-500 font-medium">{p.label}</span>
                <span className="text-sm text-slate-800 font-semibold">{p.value}</span>
              </div>
            ))}
          </div>
          <ToolbarAzioni
            intestazioni={dettaglioData.pairs.map(p => p.label)}
            righe={[dettaglioData.pairs.map(p => p.value)]}
            title="Dettaglio Candidato"
          />
        </div>
      ) : (
        <TabellaPortale
          intestazioni={intestazioni}
          righe={righe}
          loading={loading}
          error={error}
          emptyMsg={risultato ? risultato.message || "Nessun candidato trovato" : "Caricamento in corso…"}
          selectable={true}
          selectedRow={selectedRow}
          onSelectRow={setSelectedRow}
          onRowDoubleClick={(ri) => { setSelectedRow(ri); setTimeout(openDettaglio, 50); }}
        />
      )}
    </div>
  );
}

// ─── STATO PORTALE / CREDENZIALI ───────────────────────────────────────────────

function StatoPortale() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  async function check() {
    setLoading(true);
    try {
      const base = apiBase();
      const res = await fetch(`${base}/api/portal/sessioni-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ dataDa: isoToDDMMYYYY(todayISO()), dataA: isoToDDMMYYYY(daysFromNow(1)), stato: "APERTA" }),
      });
      if (res.status === 401 || res.status === 403) {
        setStatus({ ok: false, msg: "Credenziali portale mancanti o non valide. Configura PORTAL_USERNAME, PORTAL_PASSWORD e PORTAL_PIN nel file .env del backend." });
      } else if (res.ok) {
        setStatus({ ok: true, msg: "Connessione al portale: attiva ✅" });
      } else {
        const d = await res.json().catch(() => ({}));
        setStatus({ ok: false, msg: d.error || `Errore HTTP ${res.status}` });
      }
    } catch (e) {
      setStatus({ ok: false, msg: e.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm">
      <button onClick={check} disabled={loading}
        className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded-lg text-slate-700 font-medium transition text-xs">
        {loading ? "⏳" : "🔌"} Test connessione
      </button>
      {status && (
        <span className={status.ok ? "text-emerald-700 font-medium" : "text-red-600"}>
          {status.msg}
        </span>
      )}
    </div>
  );
}

// ─── ARCHIVIO STORICO (rinnovi patente / medici / CQC + candidati esami) ─────
//
// Integrato nella pagina /portale come tab dedicata.
// Riutilizza gli endpoint backend:
//   POST /api/sync/archivio-storico-completo (SSE per progress)
//   GET  /api/sync/archivio-riepilogo
//   GET  /api/sync/archivio-log
//
// Fonti portale lette:
//   - ReadGestRinnAgenzia_initGestRinnAgenzia.action  (rinnovi patente)
//   - ReadGestRinnMed_initVerStatoPratHDDG.action     (rinnovi medici TT2112)
//   - ReadRichPatCqc_initRichPatCqc.action            (rinnovi/conseguimenti CQC)
//   - Read_initActionSituazioneCandidati.action       (candidati da 4 combinazioni verbali)

function formatDateTimeIT(s) {
  if (!s) return "–";
  try { return new Date(s).toLocaleString("it-IT"); }
  catch (_) { return String(s); }
}

function formatDurationMs(ms) {
  if (!ms && ms !== 0) return "–";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rs  = sec % 60;
  if (min < 60) return `${min}m ${rs}s`;
  const h = Math.floor(min / 60);
  const rm = min % 60;
  return `${h}h ${rm}m`;
}

const ARCH_TIPO_LABEL = {
  patente:   "🪪 Rinnovo Patente",
  medico:    "⚕️ Cert. Medico TT2112",
  cqc:       "🚛 Rinnovo / Emissione CQC",
  duplicato: "📋 Duplicato",
  altro:     "📌 Altro",
};

function PanelloArchivioStorico() {
  // Riepilogo dashboard
  const [riepilogo, setRiepilogo] = useState(null);
  const [loadingRiepilogo, setLoadingRiepilogo] = useState(false);
  const [runLog, setRunLog] = useState([]);
  const [loadingLog, setLoadingLog] = useState(false);

  // Form sync
  const [dataInizio, setDataInizio] = useState("2000-01-01");
  const [dataFine,   setDataFine]   = useState(todayISO());
  const [windowDays, setWindowDays] = useState(30); // MAX 31 giorni lato portale
  const [includeEsami,      setIncludeEsami]      = useState(true);
  const [includeRinnoviPat, setIncludeRinnoviPat] = useState(true);
  const [includeRinnoviMed, setIncludeRinnoviMed] = useState(true);
  const [includeRinnoviCqc, setIncludeRinnoviCqc] = useState(true);

  // Strategia A: bypass del limite 31gg via ricerca puntuale per persona
  const [includeStrategiaA,    setIncludeStrategiaA]    = useState(false);
  const [strategiaAMaxPersone, setStrategiaAMaxPersone] = useState(0);   // 0 = nessun limite
  const [strategiaADelayMs,    setStrategiaADelayMs]    = useState(400);

  // Stato sync in corso
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessages, setSyncMessages] = useState([]);
  const [syncResult, setSyncResult] = useState(null);
  const syncAbortRef = useRef(null);

  // Auto-refresh incrementale
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [autoRefreshMinutes, setAutoRefreshMinutes] = useState(5);
  const autoRefreshTimerRef = useRef(null);
  const [lastAutoRefresh, setLastAutoRefresh] = useState(null);

  const loadRiepilogo = useCallback(async () => {
    setLoadingRiepilogo(true);
    try {
      const res = await fetch(`${apiBase()}/api/sync/archivio-riepilogo`, {
        headers: authHeaders(),
        cache: "no-cache",
      });
      const data = await res.json();
      if (data.success) setRiepilogo(data.riepilogo || null);
    } catch (e) {
      console.warn("loadRiepilogo", e);
    } finally {
      setLoadingRiepilogo(false);
    }
  }, []);

  const loadLog = useCallback(async () => {
    setLoadingLog(true);
    try {
      const res = await fetch(`${apiBase()}/api/sync/archivio-log?limit=20`, {
        headers: authHeaders(),
        cache: "no-cache",
      });
      const data = await res.json();
      if (data.success) setRunLog(data.runs || []);
    } catch (e) {
      console.warn("loadLog", e);
    } finally {
      setLoadingLog(false);
    }
  }, []);

  useEffect(() => {
    loadRiepilogo();
    loadLog();
  }, [loadRiepilogo, loadLog]);

  const avviaSync = useCallback(async (opts = {}) => {
    if (syncBusy) return;
    setSyncBusy(true);
    setSyncMessages([]);
    setSyncResult(null);

    const body = {
      includeEsami,
      includeRinnoviPat,
      includeRinnoviMed,
      includeRinnoviCqc,
      includeStrategiaA,
      strategiaAMaxPersone: Number(strategiaAMaxPersone) || 0,
      strategiaADelayMs:    Number(strategiaADelayMs)    || 400,
      dataInizio,
      dataFine,
      windowDays,
      tipoSync: opts.tipoSync || "full",
      triggerSource: opts.triggerSource || "portale-tab-manuale",
      ...opts,
    };

    const addMessage = (msg) => {
      setSyncMessages((prev) => [...prev, { ts: new Date().toISOString(), ...msg }].slice(-100));
    };

    try {
      const controller = new AbortController();
      syncAbortRef.current = controller;

      const res = await fetch(`${apiBase()}/api/sync/archivio-storico-completo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...authHeaders(),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const ct = res.headers.get("content-type") || "";
      if (ct.includes("text/event-stream") && res.body) {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop();
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            try {
              const ev = JSON.parse(line.slice(5).trim());
              addMessage(ev);
              if (ev.event === "done")       setSyncResult(ev);
              else if (ev.event === "error") setSyncResult({ event: "error", message: ev.message });
            } catch (_) {}
          }
        }
      } else {
        const data = await res.json();
        addMessage({ event: "done", ...data });
        setSyncResult(data);
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        addMessage({ event: "error", message: err.message });
        setSyncResult({ event: "error", message: err.message });
      }
    } finally {
      setSyncBusy(false);
      syncAbortRef.current = null;
      loadRiepilogo();
      loadLog();
    }
  }, [
    syncBusy, includeEsami, includeRinnoviPat, includeRinnoviMed,
    includeRinnoviCqc, includeStrategiaA, strategiaAMaxPersone, strategiaADelayMs,
    dataInizio, dataFine, windowDays,
    loadRiepilogo, loadLog,
  ]);

  const cancelSync = useCallback(() => {
    if (syncAbortRef.current) {
      try { syncAbortRef.current.abort(); } catch (_) {}
    }
    setSyncBusy(false);
  }, []);

  // Auto-refresh incrementale (ogni N minuti, ultimi 7 giorni, no esami)
  useEffect(() => {
    if (autoRefreshTimerRef.current) {
      clearInterval(autoRefreshTimerRef.current);
      autoRefreshTimerRef.current = null;
    }
    if (!autoRefresh) return;

    const minutes  = Math.max(1, Number(autoRefreshMinutes) || 5);
    const interval = minutes * 60 * 1000;

    const tick = async () => {
      if (syncBusy) return;
      try {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const di = weekAgo.toISOString().slice(0, 10);

        await fetch(`${apiBase()}/api/sync/archivio-storico-completo`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            includeEsami: false,
            includeRinnoviPat: true,
            includeRinnoviMed: true,
            includeRinnoviCqc: true,
            dataInizio: di,
            dataFine: todayISO(),
            windowDays: 30,
            tipoSync: "incrementale",
            triggerSource: "portale-tab-auto",
          }),
        });
        setLastAutoRefresh(new Date().toISOString());
        loadRiepilogo();
        loadLog();
      } catch (e) {
        console.warn("auto-refresh archivio", e);
      }
    };

    autoRefreshTimerRef.current = setInterval(tick, interval);
    return () => {
      if (autoRefreshTimerRef.current) {
        clearInterval(autoRefreshTimerRef.current);
        autoRefreshTimerRef.current = null;
      }
    };
  }, [autoRefresh, autoRefreshMinutes, syncBusy, loadRiepilogo, loadLog]);

  const tipiContati = riepilogo?.rinnovi_per_tipo || {};

  return (
    <div className="space-y-4 max-w-full">
      <div>
        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          📚 Archivio Storico Portale
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Scarica e mantieni aggiornato l'archivio completo (candidati esami + rinnovi patente/medici/CQC)
          direttamente dal Portale dell'Automobilista.
        </p>
      </div>

      {/* Riepilogo cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Candidati</div>
          <div className="mt-1 text-xl font-bold text-slate-800">
            {riepilogo?.candidati_totali ?? "–"}
          </div>
          <div className="text-[10px] text-slate-400">Dall'archivio portale</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-amber-50 p-3">
          <div className="text-[10px] uppercase tracking-wide text-amber-800">Rinn. Patente</div>
          <div className="mt-1 text-xl font-bold text-amber-900">
            {tipiContati.patente ?? 0}
          </div>
          <div className="text-[10px] text-amber-700">Tutti gli stati</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-fuchsia-50 p-3">
          <div className="text-[10px] uppercase tracking-wide text-fuchsia-800">Cert. Medici</div>
          <div className="mt-1 text-xl font-bold text-fuchsia-900">
            {tipiContati.medico ?? 0}
          </div>
          <div className="text-[10px] text-fuchsia-700">TT2112</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-emerald-50 p-3">
          <div className="text-[10px] uppercase tracking-wide text-emerald-800">CQC</div>
          <div className="mt-1 text-xl font-bold text-emerald-900">
            {tipiContati.cqc ?? 0}
          </div>
          <div className="text-[10px] text-emerald-700">Rinnovi / Conseguimenti</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Ultimo sync</div>
          <div className="mt-1 text-xs font-semibold text-slate-800">
            {riepilogo?.ultimo_sync ? formatDateTimeIT(riepilogo.ultimo_sync) : "–"}
          </div>
          <div className="text-[10px] text-slate-400">
            {riepilogo?.rinnovi_totali != null ? `${riepilogo.rinnovi_totali} rinnovi totali` : "–"}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Auto-refresh</div>
          <div className="mt-1 text-xs font-semibold text-slate-800">
            {autoRefresh ? `Ogni ${autoRefreshMinutes}m` : "Off"}
          </div>
          <div className="text-[10px] text-slate-400">
            {lastAutoRefresh ? `Ultimo: ${formatDateTimeIT(lastAutoRefresh)}` : "–"}
          </div>
        </div>
      </div>

      {/* Form configurazione */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1">
            ⚙️ Configurazione sync
          </h3>
          <button
            onClick={() => { loadRiepilogo(); loadLog(); }}
            disabled={loadingRiepilogo || loadingLog}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-medium text-slate-700 disabled:opacity-40 transition border border-slate-200"
            title="Aggiorna dati dashboard"
          >
            🔄 Aggiorna
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Data inizio</label>
            <input
              type="date"
              value={dataInizio}
              onChange={(e) => setDataInizio(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-[10px] text-slate-400 mt-0.5">Default 2000-01-01 = tutto lo storico</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Data fine</label>
            <input
              type="date"
              value={dataFine}
              onChange={(e) => setDataFine(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Finestra iterazione (giorni)</label>
            <input
              type="number"
              min={1}
              max={31}
              value={windowDays}
              onChange={(e) => {
                const v = Number(e.target.value) || 30;
                setWindowDays(Math.min(Math.max(1, v), 31));
              }}
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-[10px] text-slate-400 mt-0.5">Max 31 giorni (limite del portale)</p>
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-slate-600 mb-1">Categorie da scaricare</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={includeEsami} onChange={(e) => setIncludeEsami(e.target.checked)} />
              <span>📋 Candidati da verbali esami (4 combinazioni)</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={includeRinnoviPat} onChange={(e) => setIncludeRinnoviPat(e.target.checked)} />
              <span>🪪 Rinnovi patente (tutti stati)</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={includeRinnoviMed} onChange={(e) => setIncludeRinnoviMed(e.target.checked)} />
              <span>⚕️ Rinnovi medici TT2112</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={includeRinnoviCqc} onChange={(e) => setIncludeRinnoviCqc(e.target.checked)} />
              <span>🚛 Rinnovi / Conseguimento CQC</span>
            </label>
          </div>
        </div>

        {/* Strategia A: bypass limite 31gg */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-blue-900">
            <input
              type="checkbox"
              checked={includeStrategiaA}
              onChange={(e) => setIncludeStrategiaA(e.target.checked)}
            />
            <span>🎯 Strategia A — bypass limite 31 giorni (ricerca puntuale per persona)</span>
          </label>
          <p className="text-[11px] text-blue-800 leading-snug">
            Itera i candidati in DB e cerca i rinnovi di ciascuno senza filtro data.
            Recupera anche lo storico di 10+ anni (per patenti <b>e</b> medici). Il modulo CQC
            non è disponibile per tutte le autoscuole e viene saltato automaticamente.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-blue-900 mb-1">
                Max persone (0 = tutte)
              </label>
              <input
                type="number"
                min={0}
                value={strategiaAMaxPersone}
                onChange={(e) => setStrategiaAMaxPersone(parseInt(e.target.value, 10) || 0)}
                disabled={syncBusy || !includeStrategiaA}
                className="w-full px-3 py-1.5 text-xs border border-blue-300 rounded-lg bg-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-blue-900 mb-1">
                Delay tra persone (ms)
              </label>
              <input
                type="number"
                min={0}
                step={100}
                value={strategiaADelayMs}
                onChange={(e) => setStrategiaADelayMs(parseInt(e.target.value, 10) || 400)}
                disabled={syncBusy || !includeStrategiaA}
                className="w-full px-3 py-1.5 text-xs border border-blue-300 rounded-lg bg-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            onClick={() => avviaSync({ tipoSync: "full", triggerSource: "portale-tab-manuale" })}
            disabled={syncBusy}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50"
          >
            {syncBusy ? "⏳ Sync in corso…" : "🚀 Avvia sync storico completo"}
          </button>
          <button
            onClick={() => avviaSync({
              tipoSync: "full",
              triggerSource: "portale-tab-strategia-a",
              includeEsami: false,
              includeRinnoviPat: false,
              includeRinnoviMed: false,
              includeRinnoviCqc: false,
              includeStrategiaA: true,
            })}
            disabled={syncBusy}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50"
            title="Lancia solo le fasi Strategia A (2B/3B/4B), salta le baseline. Più rapido per popolare lo storico."
          >
            🎯 Solo Strategia A (rapido)
          </button>
          {syncBusy && (
            <button
              onClick={cancelSync}
              className="px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-medium rounded-lg transition border border-red-200"
            >
              ⛔ Annulla
            </button>
          )}
        </div>
      </div>

      {/* Auto-refresh */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs font-medium text-amber-900">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          <span>🔴 Aggiornamento tempo reale (sync incrementale automatico)</span>
        </label>
        <span className="text-xs text-amber-800">Ogni</span>
        <input
          type="number"
          min={1}
          max={60}
          value={autoRefreshMinutes}
          onChange={(e) => setAutoRefreshMinutes(Number(e.target.value) || 5)}
          className="w-14 px-2 py-1 text-xs border border-amber-300 rounded-lg bg-white"
        />
        <span className="text-xs text-amber-800">minuti</span>
        <span className="text-[10px] text-amber-700 ml-auto">
          Scarica automaticamente solo i rinnovi più recenti (ultimi 7 giorni) per mantenere il DB allineato.
        </span>
      </div>

      {/* Log sincronizzazione (SSE) */}
      {(syncBusy || syncMessages.length > 0) && (
        <div className="rounded-xl bg-slate-900 text-slate-100 p-3 font-mono text-[11px] max-h-64 overflow-y-auto">
          <div className="font-semibold mb-1 text-emerald-400">🖥 Log sincronizzazione</div>
          {syncMessages.length === 0 && (
            <div className="text-slate-400">In attesa di dati dal server…</div>
          )}
          {syncMessages.map((m, i) => {
            const isError = m.event === "error";
            const isDone  = m.event === "done";
            return (
              <div key={i} className={isError ? "text-red-400" : (isDone ? "text-emerald-400" : "text-slate-300")}>
                <span className="text-slate-500">[{new Date(m.ts).toLocaleTimeString("it-IT")}]</span>{" "}
                <span>{m.event || "info"}</span>
                {m.fase  ? <> — <span className="text-sky-300">{m.fase}</span></>   : null}
                {m.message ? <> — {m.message}</> : null}
                {typeof m.raccolti === "number" ? <> — raccolti {m.raccolti}{m.totale ? `/${m.totale}` : ""}</> : null}
              </div>
            );
          })}
        </div>
      )}

      {syncResult && syncResult.event === "error" && (
        <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
          ❌ Errore: {syncResult.message}
        </div>
      )}
      {syncResult && syncResult.event === "done" && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 text-sm space-y-1">
          <div>✅ Sync completato.</div>
          <div className="text-xs">
            {typeof syncResult.candidati_trovati === "number" && (
              <>Candidati trovati: <b>{syncResult.candidati_trovati}</b> (nuovi <b>{syncResult.candidati_inseriti ?? 0}</b>, agg. <b>{syncResult.candidati_aggiornati ?? 0}</b>). </>
            )}
          </div>
          <div className="text-xs">
            {typeof syncResult.rinnovi_trovati === "number" && (
              <>Rinnovi trovati: <b>{syncResult.rinnovi_trovati}</b> (inseriti <b>{syncResult.rinnovi_inseriti ?? 0}</b>, aggiornati <b>{syncResult.rinnovi_aggiornati ?? 0}</b>, invariati <b>{syncResult.rinnovi_invariati ?? 0}</b>). </>
            )}
          </div>
          <div className="text-xs">
            {typeof syncResult.errori === "number" && syncResult.errori > 0 && (
              <span className="text-amber-700">⚠️ Errori: <b>{syncResult.errori}</b>. </span>
            )}
            {typeof syncResult.durationMs === "number" && (
              <>Durata: <b>{formatDurationMs(syncResult.durationMs)}</b>.</>
            )}
          </div>

          {/* Statistiche Strategia A */}
          {(syncResult.strategia_a_persone_iterate > 0 ||
            syncResult.strategia_a_medici_persone_iterate > 0 ||
            syncResult.strategia_a_cqc_persone_iterate > 0) && (
            <div className="mt-2 pt-2 border-t border-emerald-200">
              <div className="text-xs font-semibold text-blue-900 mb-1">🎯 Strategia A (bypass 31gg)</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
                <div className="rounded bg-white/70 border border-blue-100 px-2 py-1">
                  <div className="font-semibold text-blue-900">🪪 Patenti</div>
                  <div className="text-slate-700">
                    Persone: <b>{syncResult.strategia_a_persone_iterate ?? 0}</b> ·{" "}
                    Rinnovi: <b>{syncResult.strategia_a_rinnovi_trovati ?? 0}</b>
                  </div>
                </div>
                <div className="rounded bg-white/70 border border-blue-100 px-2 py-1">
                  <div className="font-semibold text-blue-900">⚕️ Medici</div>
                  <div className="text-slate-700">
                    Persone: <b>{syncResult.strategia_a_medici_persone_iterate ?? 0}</b> ·{" "}
                    Rinnovi: <b>{syncResult.strategia_a_medici_rinnovi_trovati ?? 0}</b>
                    {syncResult.strategia_a_medici_servizio_non_disponibile && (
                      <span className="ml-1 text-amber-700">(⚠️ modulo non disp.)</span>
                    )}
                  </div>
                </div>
                <div className="rounded bg-white/70 border border-blue-100 px-2 py-1">
                  <div className="font-semibold text-blue-900">🚛 CQC</div>
                  <div className="text-slate-700">
                    Persone: <b>{syncResult.strategia_a_cqc_persone_iterate ?? 0}</b> ·{" "}
                    Rinnovi: <b>{syncResult.strategia_a_cqc_rinnovi_trovati ?? 0}</b>
                    {syncResult.strategia_a_cqc_servizio_non_disponibile && (
                      <span className="ml-1 text-amber-700">(⚠️ modulo non disp.)</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Storico run */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1">
            🗒 Storico run di sincronizzazione
          </h3>
          {loadingLog && <span className="text-xs text-slate-400">Caricamento…</span>}
        </div>
        {runLog.length === 0 ? (
          <div className="text-xs text-slate-400 py-4 text-center">Nessun run ancora eseguito.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b-2 border-slate-200 text-slate-600">
                  <th className="text-left px-3 py-2">Avvio</th>
                  <th className="text-left px-3 py-2">Tipo</th>
                  <th className="text-left px-3 py-2">Origine</th>
                  <th className="text-right px-3 py-2">Durata</th>
                  <th className="text-right px-3 py-2" title="Candidati: trovati / inseriti">Candidati</th>
                  <th className="text-right px-3 py-2" title="Rinnovi: trovati / inseriti / aggiornati">Rinnovi</th>
                  <th className="text-right px-3 py-2">Err.</th>
                  <th className="text-left px-3 py-2">Esito</th>
                </tr>
              </thead>
              <tbody>
                {runLog.map((r) => {
                  const durMs = typeof r.duration_ms === "number"
                    ? r.duration_ms
                    : (r.finished_at && r.started_at
                        ? new Date(r.finished_at) - new Date(r.started_at)
                        : null);
                  return (
                    <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50" title={r.ultimo_errore || undefined}>
                      <td className="px-3 py-2">{formatDateTimeIT(r.started_at)}</td>
                      <td className="px-3 py-2">{r.tipo_sync || "–"}</td>
                      <td className="px-3 py-2 text-slate-500">{r.trigger_source || "–"}</td>
                      <td className="px-3 py-2 text-right">
                        {durMs != null ? formatDurationMs(durMs) : "–"}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-700">
                        <span title="Trovati">{r.candidati_trovati ?? 0}</span>
                        {" / "}
                        <span className="text-emerald-700 font-medium" title="Inseriti">{r.candidati_inseriti ?? 0}</span>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-700">
                        <span title="Trovati">{r.rinnovi_trovati ?? 0}</span>
                        {" / "}
                        <span className="text-emerald-700 font-medium" title="Inseriti">{r.rinnovi_inseriti ?? 0}</span>
                        {" / "}
                        <span className="text-sky-700 font-medium" title="Aggiornati">{r.rinnovi_aggiornati ?? 0}</span>
                      </td>
                      <td className={`px-3 py-2 text-right ${(r.errori ?? 0) > 0 ? "text-red-600 font-medium" : "text-slate-400"}`}>
                        {r.errori ?? 0}
                      </td>
                      <td className="px-3 py-2">
                        {r.stato === "success"
                          ? <span className="text-emerald-700">✓ OK</span>
                          : r.stato === "failed"
                            ? <span className="text-red-600">✗ Errore</span>
                            : r.stato === "running"
                              ? <span className="text-amber-700">⏳ In corso</span>
                              : <span className="text-slate-500">{r.stato || "–"}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="text-[11px] text-slate-400">
        Fonti portale lette: <code>ReadGestRinnAgenzia</code> (patente) ·{" "}
        <code>ReadGestRinnMed</code> (medici TT2112) ·{" "}
        <code>ReadRichPatCqc</code> (CQC) ·{" "}
        <code>SituazioneCandidati</code> (candidati esami).
      </div>
    </div>
  );
}

// ─── PAGINA PRINCIPALE ─────────────────────────────────────────────────────────

export default function PortalePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("sessioni-quiz");

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

  async function handleLogout() {
    await logoutSession();
    router.replace("/login");
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="text-slate-500 animate-pulse">Caricamento…</div>
      </div>
    );
  }

  return (
    <ModernAppShell
      title="Portale dell'Automobilista"
      subtitle="Sincronizzazione diretta con il Sistema Unico Prenotazione Esami"
      activeKey="portale"
      onLogout={handleLogout}
      user={user}
    >
      <div className="p-4 lg:p-6 space-y-4 max-w-full">
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Portale Automobilista</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Sessioni, verbali e situazione candidati dal portale MCTC
            </p>
          </div>
          <StatoPortale />
        </div>

        {/* Tab bar */}
        <div className="overflow-x-auto">
          <div className="flex gap-1 p-1 bg-slate-100 rounded-2xl min-w-max">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-3 py-2 rounded-xl text-xs font-medium transition whitespace-nowrap ${
                  activeTab === tab.key
                    ? "bg-white text-blue-700 shadow-sm font-semibold"
                    : "text-slate-600 hover:text-slate-800 hover:bg-white/50"
                }`}
              >
                <span className="mr-1">{tab.icon}</span>{tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Contenuto tab */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 lg:p-5 min-h-[400px] max-w-full">
          <TabPanel active={activeTab === "sessioni-quiz"}>
            <PanelloSessioni tipo="SQI" label="Sessioni Quiz Interne" user={user} />
          </TabPanel>
          <TabPanel active={activeTab === "sessioni-guide"}>
            <PanelloSessioni tipo="SGOS" label="Sessioni Guide/Orali" user={user} />
          </TabPanel>
          <TabPanel active={activeTab === "sessioni-cqc"}>
            <PanelloSessioni tipo="SCQC" label="Sessioni CQC" user={user} />
          </TabPanel>
          <TabPanel active={activeTab === "sessioni-approvate"}>
            <PanelloSessioni tipo="SQA" label="Sessioni Approvate" user={user} />
          </TabPanel>
          <TabPanel active={activeTab === "verbali-aperti"}>
            <PanelloVerbali tipo="VAC" label="Verbali Aperti Conseguimento" />
          </TabPanel>
          <TabPanel active={activeTab === "verbali-svolti"}>
            <PanelloVerbali tipo="VSC" label="Verbali Svolti Conseguimento" />
          </TabPanel>
          <TabPanel active={activeTab === "verbali-cqc"}>
            <PanelloVerbali tipo="VSQ" label="Verbali CQC" />
          </TabPanel>
          <TabPanel active={activeTab === "rev-pat-svolti"}>
            <PanelloVerbali tipo="VSR" label="Revisione Patente - Verbali Svolti" />
          </TabPanel>
          <TabPanel active={activeTab === "rev-pat-annullati"}>
            <PanelloVerbali tipo="VAR" label="Revisione Patente - Verbali Annullati" />
          </TabPanel>
          <TabPanel active={activeTab === "rev-cqc-svolti"}>
            <PanelloVerbali tipo="VSRCQC" label="Revisione CQC - Verbali Svolti" />
          </TabPanel>
          <TabPanel active={activeTab === "rev-cqc-annullati"}>
            <PanelloVerbali tipo="VARCQC" label="Revisione CQC - Verbali Annullati" />
          </TabPanel>
          <TabPanel active={activeTab === "situazione"}>
            <PanelloSituazioneCandidati />
          </TabPanel>
          <TabPanel active={activeTab === "archivio-storico"}>
            <PanelloArchivioStorico />
          </TabPanel>
        </div>

        {/* Footer */}
        <div className="text-xs text-slate-400 px-1">
          Dati caricati in tempo reale dal Portale dell'Automobilista.
          Credenziali configurabili nel file <code className="bg-slate-100 px-1 rounded">.env</code> del backend.
        </div>
      </div>
    </ModernAppShell>
  );
}

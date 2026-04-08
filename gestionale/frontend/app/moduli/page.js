"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getApiBase, authHeaders, checkSession, logoutSession } from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function apiBase() {
  if (typeof window === "undefined") return "http://localhost:3000";
  const saved = window.localStorage?.getItem("autoscuola_api_base");
  if (saved) return saved.trim();
  return getApiBase();
}

// ─── Tabs disponibili ─────────────────────────────────────────────────────────

const TABS = [
  { key: "tt2112",        label: "📋 TT2112",           desc: "Modello prenotazione esame di guida (MIT)" },
  { key: "riepilogo",     label: "👤 Scheda Candidato", desc: "Riepilogo anagrafico completo del candidato" },
  { key: "comunicazione", label: "✉️ Comunicazione",    desc: "Lettera personalizzata per il candidato" },
  { key: "foglio-rosa",   label: "🖨 Foglio Rosa",       desc: "Stampa / ristampa foglio rosa dal portale" },
];

// ─── Componente: Selezione Candidato ─────────────────────────────────────────

function SelezionaCandidato({ onSelect, selectedId }) {
  const [candidati, setCandidati] = useState([]);
  const [ricerca, setRicerca] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${apiBase()}/api/candidati-api`, { headers: authHeaders(), cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { setCandidati(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtrati = candidati.filter((c) => {
    const q = ricerca.trim().toUpperCase();
    if (!q) return true;
    return [c.cognome, c.nome, c.codice_fiscale].join(" ").toUpperCase().includes(q);
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
        <p className="text-sm font-bold text-slate-700">1. Seleziona candidato</p>
      </div>
      <div className="p-3 space-y-2">
        <input
          type="text"
          placeholder="🔍 Cerca cognome, nome, CF…"
          value={ricerca}
          onChange={(e) => setRicerca(e.target.value)}
          className="w-full h-8 rounded border border-slate-300 px-3 text-sm focus:outline-none focus:border-indigo-400"
        />
        <div className="overflow-y-auto max-h-52 rounded border border-slate-100">
          {loading ? (
            <p className="text-center py-6 text-xs text-slate-400">Caricamento...</p>
          ) : filtrati.length === 0 ? (
            <p className="text-center py-6 text-xs text-slate-400">Nessun candidato</p>
          ) : filtrati.map((c) => (
            <div
              key={c.id}
              onClick={() => onSelect(c)}
              className={`cursor-pointer flex items-center justify-between px-3 py-2 border-b border-slate-100 text-sm last:border-0 transition-colors
                ${selectedId === c.id ? "bg-indigo-50 border-l-2 border-l-indigo-500" : "hover:bg-slate-50"}`}
            >
              <div>
                <span className="font-medium text-slate-800">{c.cognome} {c.nome}</span>
                <span className="ml-2 text-xs text-slate-500 font-mono">{c.codice_fiscale || "–"}</span>
              </div>
              {c.categoria_patente && (
                <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-bold text-indigo-800">
                  {c.categoria_patente}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Componente: Pannello TT2112 ──────────────────────────────────────────────

function PannelloTT2112({ candidato, autoscuola }) {
  const [richiesta, setRichiesta] = useState({
    marca_operativa: autoscuola?.marca_operativa || "",
    codice_operatore: autoscuola?.codice_esaminatore || "",
    ufficio_operativo: autoscuola?.ufficio_mctc || "ME",
    categoria_richiesta: candidato?.categoria_patente || "B",
    categoria_disponibile: candidato?.categoria_disponibile || "",
    cambio_automatico: candidato?.cambio_automatico || false,
    tipo_pagamento: "BOLLETTINO",
    codice_pagamento: "",
    protocollo_richiesta: "",
    data_richiesta: new Date().toISOString().slice(0, 10),
    data_visita_medica: candidato?.data_visita_medica || "",
    codice_medico: candidato?.codice_iscrizione_medico || "",
    luogo_visita_medica: candidato?.luogo_visita_medica || "",
    esente_visita_cml: candidato?.esente_visita_cml || false,
    tempo_esteso_teoria: candidato?.tempo_esteso_teoria || false,
    validita_aa: 10,
    validita_mm: 0,
    id_richiesta_portale: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const campo = (k, label, tipo = "text", options = null) => (
    <div key={k}>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {tipo === "checkbox" ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!richiesta[k]}
            onChange={(e) => setRichiesta((r) => ({ ...r, [k]: e.target.checked }))}
            className="rounded"
          />
          <span className="text-slate-700">{label}</span>
        </label>
      ) : tipo === "select" ? (
        <select
          value={richiesta[k] || ""}
          onChange={(e) => setRichiesta((r) => ({ ...r, [k]: e.target.value }))}
          className="w-full h-8 rounded border border-slate-300 px-2 text-sm bg-white"
        >
          {options.map((o) => (
            <option key={typeof o === "string" ? o : o.value} value={typeof o === "string" ? o : o.value}>
              {typeof o === "string" ? o : o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={tipo}
          value={richiesta[k] || ""}
          onChange={(e) => setRichiesta((r) => ({ ...r, [k]: e.target.value }))}
          className="w-full h-8 rounded border border-slate-300 px-2 text-sm focus:outline-none focus:border-indigo-400"
        />
      )}
    </div>
  );

  async function stampa() {
    if (!candidato) return setError("Seleziona prima un candidato");
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${apiBase()}/api/moduli/genera`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ tipo: "TT2112", candidato, autoscuola, richiesta }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `TT2112_${(candidato.codice_fiscale || "").substring(0, 8)}_${new Date().toISOString().slice(0,10)}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <strong>TT2112</strong> — Modello prenotazione esame di guida MIT. Compila i dati, poi clicca
        <em> Genera PDF</em> per scaricare il modulo da consegnare alla Motorizzazione.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {campo("marca_operativa",    "Marca operativa")}
        {campo("codice_operatore",   "Codice operatore (esaminatore)")}
        {campo("ufficio_operativo",  "Ufficio MCTC")}
        {campo("categoria_richiesta", "Categoria richiesta",  "select",
          ["A1","A2","A","B","BE","C","C1","CE","D","DE","AM","CQC"])}
        {campo("categoria_disponibile", "Categoria disponibile")}
        {campo("tipo_pagamento", "Tipo pagamento", "select",
          ["BOLLETTINO","DECURTAZIONE","PAGOPA"])}
        {campo("codice_pagamento",    "Codice pagamento")}
        {campo("protocollo_richiesta","Protocollo richiesta")}
        {campo("id_richiesta_portale","ID richiesta portale")}
        {campo("data_richiesta",      "Data richiesta", "date")}
        {campo("validita_aa",         "Validità patente (anni)", "number")}
        {campo("validita_mm",         "Validità patente (mesi)", "number")}
        {campo("data_visita_medica",  "Data visita medica", "date")}
        {campo("codice_medico",       "Cod. iscrizione albo medici")}
        {campo("luogo_visita_medica", "Luogo visita medica")}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" className="rounded"
            checked={!!richiesta.cambio_automatico}
            onChange={(e) => setRichiesta((r) => ({ ...r, cambio_automatico: e.target.checked }))} />
          <span className="text-slate-700">Cambio automatico</span>
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" className="rounded"
            checked={!!richiesta.esente_visita_cml}
            onChange={(e) => setRichiesta((r) => ({ ...r, esente_visita_cml: e.target.checked }))} />
          <span className="text-slate-700">Esente visita CML</span>
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" className="rounded"
            checked={!!richiesta.tempo_esteso_teoria}
            onChange={(e) => setRichiesta((r) => ({ ...r, tempo_esteso_teoria: e.target.checked }))} />
          <span className="text-slate-700">Tempo esteso (teoria)</span>
        </label>
      </div>

      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">❌ {error}</div>
      )}

      <button
        onClick={stampa}
        disabled={busy || !candidato}
        className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {busy ? "⏳ Generazione PDF in corso..." : "📄 Genera e Scarica TT2112.pdf"}
      </button>
    </div>
  );
}

// ─── Componente: Scheda Riepilogativa ─────────────────────────────────────────

function PannelloRiepilogo({ candidato, autoscuola }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function stampa() {
    if (!candidato) return setError("Seleziona prima un candidato");
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${apiBase()}/api/moduli/genera`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ tipo: "RIEPILOGO", candidato, autoscuola }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Scheda_${(candidato.codice_fiscale || "").substring(0, 8)}_${new Date().toISOString().slice(0,10)}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
        Genera una <strong>scheda riepilogativa completa</strong> del candidato selezionato in formato PDF A4.
        Include anagrafica, dati patente, documento di identità e informazioni portale.
      </div>

      {candidato ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="font-bold text-slate-800 text-sm">{candidato.cognome} {candidato.nome}</p>
          <p className="text-xs text-slate-500 font-mono mt-1">{candidato.codice_fiscale || "–"}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3 text-xs">
            {[
              ["Categoria", candidato.categoria_patente],
              ["Stato", candidato.stato],
              ["Nascita", candidato.data_nascita],
              ["Telefono", candidato.telefono || candidato.telefono_1],
              ["Marca op.", candidato.marca_operativa],
              ["N° Patente", candidato.patente_numero],
            ].map(([k, v]) => v && (
              <div key={k} className="flex gap-1">
                <span className="text-slate-500 w-20 shrink-0">{k}</span>
                <span className="text-slate-800 font-medium">{v}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 py-8 text-center text-sm text-slate-400">
          ← Seleziona un candidato prima di procedere
        </div>
      )}

      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">❌ {error}</div>
      )}

      <button
        onClick={stampa}
        disabled={busy || !candidato}
        className="w-full rounded-xl bg-sky-600 py-3 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-50 transition-colors"
      >
        {busy ? "⏳ Generazione PDF..." : "👤 Genera Scheda Candidato.pdf"}
      </button>
    </div>
  );
}

// ─── Componente: Comunicazione ─────────────────────────────────────────────────

function PannelloComunicazione({ candidato, autoscuola }) {
  const [oggetto, setOggetto] = useState("Convocazione per esame di guida");
  const [testo, setTesto] = useState(
    `Con la presente La convochiamo presso la nostra segreteria in data __________ alle ore __________ per le pratiche relative all'esame di guida per la categoria __________.

Si ricorda di portare con sé:
- Documento di identità in corso di validità
- Codice fiscale
- Ricevuta di pagamento

Per informazioni o chiarimenti non esiti a contattarci.`
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const MODELLI = [
    { label: "Convocazione esame", oggetto: "Convocazione per esame di guida",
      testo: `Con la presente La convochiamo presso la nostra segreteria in data __________ alle ore __________ per le pratiche relative all'esame di guida per la categoria __________.\n\nSi ricorda di portare con sé:\n- Documento di identità in corso di validità\n- Codice fiscale\n- Ricevuta di pagamento\n\nPer informazioni o chiarimenti non esiti a contattarci.` },
    { label: "Scadenza foglio rosa", oggetto: "Avviso scadenza foglio rosa",
      testo: `La informiamo che il Suo foglio rosa è prossimo alla scadenza.\n\nLa invitiamo a contattare la segreteria per procedere al rinnovo o alla prenotazione dell'esame di guida entro i termini previsti dalla normativa vigente.\n\nDecorrenza: __________\nScadenza: __________` },
    { label: "Documentazione mancante", oggetto: "Richiesta documentazione",
      testo: `La informiamo che risulta mancante la seguente documentazione necessaria per completare la Sua pratica:\n\n- __________\n- __________\n\nSi prega di consegnare i documenti richiesti entro e non oltre __________.` },
  ];

  async function stampa() {
    if (!candidato) return setError("Seleziona prima un candidato");
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${apiBase()}/api/moduli/genera`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ tipo: "COMUNICAZIONE", candidato, autoscuola, testo, oggetto }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Comunicazione_${(candidato.codice_fiscale || "").substring(0, 8)}_${new Date().toISOString().slice(0,10)}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800">
        Genera una <strong>lettera personalizzata</strong> da consegnare o inviare al candidato.
        Puoi usare uno dei modelli predefiniti oppure scrivere un testo libero.
      </div>

      {/* Modelli rapidi */}
      <div>
        <p className="text-xs font-semibold text-slate-600 mb-2">Modelli rapidi:</p>
        <div className="flex flex-wrap gap-2">
          {MODELLI.map((m) => (
            <button
              key={m.label}
              onClick={() => { setOggetto(m.oggetto); setTesto(m.testo); }}
              className="rounded border border-violet-300 bg-white px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-50"
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Oggetto</label>
        <input
          type="text"
          value={oggetto}
          onChange={(e) => setOggetto(e.target.value)}
          className="w-full h-9 rounded border border-slate-300 px-3 text-sm focus:outline-none focus:border-indigo-400"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Testo della comunicazione</label>
        <textarea
          value={testo}
          onChange={(e) => setTesto(e.target.value)}
          rows={8}
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-400 resize-y"
        />
      </div>

      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">❌ {error}</div>
      )}

      <button
        onClick={stampa}
        disabled={busy || !candidato}
        className="w-full rounded-xl bg-violet-600 py-3 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
      >
        {busy ? "⏳ Generazione PDF..." : "✉️ Genera Comunicazione.pdf"}
      </button>
    </div>
  );
}

// ─── Componente: Foglio Rosa ───────────────────────────────────────────────────

function PannelloFoglioRosa({ candidato }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function esegui(ristampa) {
    setBusy(ristampa ? "ristampa" : "stampa");
    setResult(null);
    setError("");
    try {
      const res = await fetch(`${apiBase()}/api/portal/foglio-rosa`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          token: token || candidato?.codice_foglio_rosa || "",
          ristampa,
          marca_operativa: candidato?.marca_operativa || "",
          candidato_id: candidato?.id,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Errore portale");
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        Il <strong>Foglio Rosa</strong> viene generato direttamente dal Portale dell'Automobilista.
        È necessario che la richiesta esame sia già stata accettata e che il portale sia autenticato.
      </div>

      {candidato?.codice_foglio_rosa && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-600">Codice foglio rosa nel DB: </span>
          <span className="font-mono font-bold text-slate-800">{candidato.codice_foglio_rosa}</span>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Token foglio rosa (opzionale — se già noto dalla pratica)
        </label>
        <input
          type="text"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Lascia vuoto per usare il codice dal DB"
          className="w-full h-9 rounded border border-slate-300 px-3 text-sm font-mono focus:outline-none focus:border-indigo-400"
        />
      </div>

      <div className="flex gap-3">
        <button
          disabled={!!busy || !candidato}
          onClick={() => esegui(false)}
          className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy === "stampa" ? "⏳ In corso..." : "🖨 Stampa Foglio Rosa"}
        </button>
        <button
          disabled={!!busy || !candidato}
          onClick={() => esegui(true)}
          className="flex-1 rounded-xl border-2 border-emerald-600 bg-white py-3 text-sm font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
        >
          {busy === "ristampa" ? "⏳ In corso..." : "🔄 Ristampa"}
        </button>
      </div>

      {result && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
          ✅ {result.messaggio || "Operazione completata"}
          {result.token && (
            <div className="mt-1 font-mono text-xs text-slate-600">Token: {result.token}</div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">❌ {error}</div>
      )}

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Per la gestione completa vai a{" "}
        <Link href="/fogli-rosa-patenti" className="text-indigo-600 underline font-medium">
          Fogli Rosa e Patenti →
        </Link>
      </div>
    </div>
  );
}

// ─── Pagina Principale ─────────────────────────────────────────────────────────

export default function ModuliPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tabAttivo, setTabAttivo] = useState("tt2112");
  const [candidatoSel, setCandidatoSel] = useState(null);

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

  // Dati autoscuola da env/sessione
  const autoscuola = {
    nome: user?.nome || "BLUEFOX S.R.L.",
    codice_autoscuola: user?.codice_autoscuola || "0674",
    ufficio_mctc: user?.ufficio_mctc || "ME",
    codice_esaminatore: user?.codice_esaminatore || "083",
    marca_operativa: user?.marca_operativa || "",
    email: user?.email || "",
  };

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <p className="text-slate-500 text-sm">Caricamento...</p>
    </div>
  );

  const tabCorrente = TABS.find((t) => t.key === tabAttivo);

  return (
    <ModernAppShell
      title="Moduli"
      subtitle="Generazione documenti e moduli ufficiali PDF"
      activeKey="moduli"
      onLogout={() => logoutSession().then(() => router.replace("/login"))}
      user={user}
    >
      <div className="space-y-4">

        {/* ── Intestazione ── */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Moduli e Documenti</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Genera moduli ufficiali MIT e comunicazioni in formato PDF
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/esami"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              ← Torna a Esami
            </Link>
          </div>
        </div>

        {/* ── Layout principale ── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

          {/* Colonna sinistra: seleziona candidato */}
          <div className="space-y-3">
            <SelezionaCandidato
              onSelect={setCandidatoSel}
              selectedId={candidatoSel?.id}
            />

            {/* Riepilogo candidato selezionato */}
            {candidatoSel && (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
                <p className="text-xs font-bold uppercase text-indigo-700 mb-2">✅ Candidato selezionato</p>
                <p className="font-bold text-slate-800">{candidatoSel.cognome} {candidatoSel.nome}</p>
                <p className="text-xs text-slate-600 font-mono mt-0.5">{candidatoSel.codice_fiscale || "–"}</p>
                <div className="flex gap-1 mt-2 flex-wrap">
                  {candidatoSel.categoria_patente && (
                    <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-xs font-bold text-white">
                      Cat. {candidatoSel.categoria_patente}
                    </span>
                  )}
                  {candidatoSel.stato && (
                    <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-700">
                      {candidatoSel.stato}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setCandidatoSel(null)}
                  className="mt-2 text-xs text-slate-500 hover:text-slate-700 underline"
                >
                  Deseleziona
                </button>
              </div>
            )}
          </div>

          {/* Colonna destra: tabs moduli */}
          <div className="xl:col-span-2">

            {/* Tab navigation */}
            <div className="flex gap-1 mb-4 flex-wrap">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTabAttivo(t.key)}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors
                    ${tabAttivo === t.key
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Descrizione tab */}
            {tabCorrente && (
              <p className="text-xs text-slate-500 mb-4 italic">{tabCorrente.desc}</p>
            )}

            {/* Contenuto tab */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              {tabAttivo === "tt2112" && (
                <PannelloTT2112 candidato={candidatoSel} autoscuola={autoscuola} />
              )}
              {tabAttivo === "riepilogo" && (
                <PannelloRiepilogo candidato={candidatoSel} autoscuola={autoscuola} />
              )}
              {tabAttivo === "comunicazione" && (
                <PannelloComunicazione candidato={candidatoSel} autoscuola={autoscuola} />
              )}
              {tabAttivo === "foglio-rosa" && (
                <PannelloFoglioRosa candidato={candidatoSel} />
              )}
            </div>

          </div>
        </div>

      </div>
    </ModernAppShell>
  );
}

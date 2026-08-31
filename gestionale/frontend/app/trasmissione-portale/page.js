"use client";

/**
 * Trasmissione Pratiche — Portale Automobilista
 * ==============================================
 * Equivalente GeCA frmTrasmiss + iPatente trasmettiPratica*.
 * Invia pratiche sul Portale dell'Automobilista tramite automazione Puppeteer.
 *
 * Tipi supportati:
 *   - conseguimento  → Conseguimento patente A/B/C/D/AM
 *   - cqc            → Conseguimento CQC
 *   - prima_fase     → Prima fase AM/A1/A2/A
 *   - rinnovo        → Rinnovo patente
 *   - rinnovo_medico → Rinnovo con TT2112
 *   - altro          → Duplicato / Smarrimento / Deterioramento
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getApiBase, authHeaders, checkSession, logoutSession } from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";
import { ProgressPanel } from "../../lib/ProgressPanel";

// ─── Utility ───────────────────────────────────────────────────────────────────

function apiBase() {
  if (typeof window === "undefined") return "http://localhost:3000";
  const saved = window.localStorage?.getItem("autoscuola_api_base");
  if (saved) return saved.trim();
  return getApiBase();
}

function formatDateIT(str) {
  if (!str) return "–";
  const s = String(str).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return new Date(s + "T00:00:00Z").toLocaleDateString("it-IT");
  }
  return str;
}

// ─── Costanti ──────────────────────────────────────────────────────────────────

const TIPO_TRASMISSIONE_OPTIONS = [
  { value: "", label: "Tutti i tipi" },
  { value: "conseguimento",  label: "🎓 Conseguimento (A/B/C/D/AM)" },
  { value: "cqc",            label: "🚛 Conseguimento CQC" },
  { value: "rinnovo_cqc",    label: "🔁 Rinnovo CQC" },
  { value: "prima_fase",     label: "🅰 Prima Fase (AM/A1/A2/A)" },
  { value: "rinnovo",        label: "🔄 Rinnovo Patente" },
  { value: "rinnovo_medico", label: "⚕️ Rinnovo con TT2112" },
  { value: "altro",          label: "📋 Altro (Duplicato/Smarrimento)" },
];

const STATO_BADGE = {
  pronto:                { label: "Pronto",           color: "#0ea5e9", bg: "#e0f2fe" },
  pronto_trasmissione:   { label: "Pronto",           color: "#0ea5e9", bg: "#e0f2fe" },
  da_trasmettere:        { label: "Da trasmettere",   color: "#f59e0b", bg: "#fef3c7" },
  da_creare:             { label: "Da creare",        color: "#64748b", bg: "#f1f5f9" },
  in_trasmissione:       { label: "In trasmissione…", color: "#8b5cf6", bg: "#f3e8ff" },
  trasmesso_portale:     { label: "Trasmesso ✓",      color: "#16a34a", bg: "#dcfce7" },
  trasmesso:             { label: "Trasmesso SDC ✓",  color: "#16a34a", bg: "#dcfce7" },
  errore:                { label: "Errore",            color: "#dc2626", bg: "#fee2e2" },
  approvato:             { label: "Approvato ✓",      color: "#16a34a", bg: "#dcfce7" },
  respinto:              { label: "Respinto ✗",       color: "#dc2626", bg: "#fee2e2" },
};

// ─── Mappe sigla → label (replica frmOmoni/Trasmiss.cs) ────────────────────────
// Solo sigle trasmissibili al Portale Automobilista (sottoinsieme delle 22 GeCA)
const SIGLA_LABELS = {
  IN:   "Iscrizione per esame",
  PR:   "Privatista",
  RE:   "Ripetizione esame",
  CV:   "Rinnovo / Conferma Validità",
  CM:   "Certificato Medico (TT2112)",
  "D|": "Duplicato per smarrimento",
  "Y|": "Duplicato per furto",
  "L|": "Duplicato per deterioramento",
  "S|": "Duplicato per distruzione",
  "R|": "Duplicato per variazione residenza",
  "M|": "Conversione patente estera",
  "E|": "Conversione patente militare",
  PC:   "Conseguimento CQC",
  CC:   "Rinnovo CQC",
  GA:   "Guida Accompagnata (Prima Fase)",
};

const OPERAZIONE_LABEL = {
  conseguimento:  "🎓 Conseguimento Patente",
  rinnovo:        "🔄 Rinnovo Patente",
  rinnovo_medico: "⚕️ Rinnovo con Cert. Medico",
  altro:          "📋 Duplicato / Conversione",
  cqc:            "🚛 Conseguimento CQC",
  rinn_cqc:       "🔁 Rinnovo CQC",
  prima_fase:     "🅰 Prima Fase (Foglio Rosa)",
};

// Mappa operazione candidato → tipo endpoint originale (per riuso eseguiTrasmissione)
// rinn_cqc → rinnovo_cqc, altri uguali
const OPERAZIONE_TO_TIPO_ENDPOINT = {
  conseguimento:  "conseguimento",
  rinnovo:        "rinnovo",
  rinnovo_medico: "rinnovo_medico",
  altro:          "altro",
  cqc:            "cqc",
  rinn_cqc:       "rinnovo_cqc",
  prima_fase:     "prima_fase",
};

function siglaLabel(sigla) {
  if (!sigla) return "–";
  return SIGLA_LABELS[sigla] || sigla;
}

// ─── StatoBadge ────────────────────────────────────────────────────────────────

function StatoBadge({ stato }) {
  const cfg = STATO_BADGE[stato] || { label: stato || "–", color: "#6b7280", bg: "#f3f4f6" };
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 10px",
      borderRadius: 99,
      fontSize: 12,
      fontWeight: 600,
      color: cfg.color,
      background: cfg.bg,
      whiteSpace: "nowrap",
    }}>
      {cfg.label}
    </span>
  );
}

// ─── TipoBadge ─────────────────────────────────────────────────────────────────

function TipoBadge({ tipo }) {
  const map = {
    conseguimento:  { label: "Conseguimento",  color: "#1d4ed8", bg: "#dbeafe" },
    cqc:            { label: "CQC",            color: "#92400e", bg: "#fef3c7" },
    rinnovo_cqc:    { label: "Rinnovo CQC",    color: "#78350f", bg: "#fef9c3" },
    prima_fase:     { label: "Prima Fase",     color: "#5b21b6", bg: "#ede9fe" },
    rinnovo:        { label: "Rinnovo",        color: "#0369a1", bg: "#e0f2fe" },
    rinnovo_medico: { label: "Rinnovo Medico", color: "#065f46", bg: "#d1fae5" },
    altro:          { label: "Altro",          color: "#374151", bg: "#f3f4f6" },
  };
  const cfg = map[tipo] || { label: tipo || "–", color: "#6b7280", bg: "#f3f4f6" };
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 9px",
      borderRadius: 99,
      fontSize: 12,
      fontWeight: 600,
      color: cfg.color,
      background: cfg.bg,
    }}>
      {cfg.label}
    </span>
  );
}

// ─── Modale Credenziali ────────────────────────────────────────────────────────

function ModalCredenziali({ onConfirm, onCancel, defaultValues = {} }) {
  const [creds, setCreds] = useState({
    username: defaultValues.username || "",
    password: defaultValues.password || "",
    pin:      defaultValues.pin || "",
  });
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000,
    }}>
      <div style={{
        background: "#fff", borderRadius: 12, padding: 28,
        width: 380, boxShadow: "0 8px 32px rgba(0,0,0,.18)",
      }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 700 }}>
          🔑 Credenziali Portale Automobilista
        </h3>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "#6b7280" }}>
          Inserisci le credenziali per accedere al portale. Se non inserite, verranno usate quelle salvate nelle impostazioni.
        </p>
        {[
          { key: "username", label: "Username",         type: "text"     },
          { key: "password", label: "Password",         type: "password" },
          { key: "pin",      label: "PIN (opzionale)",  type: "password" },
        ].map(({ key, label, type }) => (
          <div key={key} style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              {label}
            </label>
            <input
              type={type}
              value={creds[key]}
              onChange={(e) => setCreds((p) => ({ ...p, [key]: e.target.value }))}
              style={{
                width: "100%", padding: "8px 10px",
                border: "1px solid #d1d5db", borderRadius: 7,
                fontSize: 14, outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
        ))}
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button
            onClick={() => onConfirm(creds)}
            style={{
              flex: 1, padding: "10px 0", background: "#1d4ed8",
              color: "#fff", border: "none", borderRadius: 8,
              fontWeight: 700, fontSize: 15, cursor: "pointer",
            }}
          >
            Procedi
          </button>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: "10px 0", background: "#f3f4f6",
              color: "#374151", border: "none", borderRadius: 8,
              fontWeight: 600, fontSize: 15, cursor: "pointer",
            }}
          >
            Annulla
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modale Dettaglio / Risultato ──────────────────────────────────────────────

function ModalRisultato({ pratica, risultato, onClose }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1001,
    }}>
      <div style={{
        background: "#fff", borderRadius: 12, padding: 28,
        width: 460, maxHeight: "80vh", overflowY: "auto",
        boxShadow: "0 8px 32px rgba(0,0,0,.18)",
      }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 700 }}>
          {risultato.success ? "✅ Trasmissione riuscita" : "❌ Errore trasmissione"}
        </h3>

        {pratica && (
          <p style={{ margin: "0 0 12px", fontSize: 14, color: "#374151" }}>
            <strong>{pratica.candidates?.cognome} {pratica.candidates?.nome}</strong>
            {" — "}{pratica.tipo_trasmissione || pratica.tipo_pratica}
          </p>
        )}

        {risultato.success ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 14 }}>
            {risultato.marcaOperativa && (
              <div><strong>Marca Operativa:</strong> {risultato.marcaOperativa}</div>
            )}
            {risultato.idRichiesta && (
              <div><strong>ID Richiesta:</strong> {risultato.idRichiesta}</div>
            )}
            {risultato.codiceEstremiPagamento && (
              <div><strong>Codice Pagamento:</strong> {risultato.codiceEstremiPagamento}</div>
            )}
            {risultato.messaggioPortale && (
              <div style={{
                background: "#f0fdf4", border: "1px solid #bbf7d0",
                borderRadius: 7, padding: "10px 12px", marginTop: 6,
                fontSize: 13,
              }}>
                {risultato.messaggioPortale}
              </div>
            )}
          </div>
        ) : (
          <div style={{
            background: "#fef2f2", border: "1px solid #fecaca",
            borderRadius: 7, padding: "10px 12px",
            fontSize: 13, color: "#b91c1c",
          }}>
            {risultato.error || "Errore sconosciuto"}
          </div>
        )}

        {risultato.log && risultato.log.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 6 }}>
              LOG OPERAZIONI
            </div>
            <div style={{
              background: "#f8fafc", border: "1px solid #e2e8f0",
              borderRadius: 7, padding: "8px 10px",
              maxHeight: 160, overflowY: "auto", fontSize: 11,
              fontFamily: "monospace", color: "#374151",
              lineHeight: 1.6,
            }}>
              {risultato.log.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={onClose}
          style={{
            marginTop: 20, width: "100%", padding: "10px 0",
            background: "#f3f4f6", color: "#374151",
            border: "none", borderRadius: 8, fontWeight: 600,
            fontSize: 15, cursor: "pointer",
          }}
        >
          Chiudi
        </button>
      </div>
    </div>
  );
}

// ─── Modale CIA (certificato idoneità psicofisica) ─────────────────────────────

const UFF_SANITARIO_OPTIONS = [
  { value: "",   label: "— Seleziona —" },
  { value: "1",  label: "1 – Medico di famiglia (SSN)" },
  { value: "2",  label: "2 – Medico della Motorizzazione" },
  { value: "3",  label: "3 – Commissione medica locale" },
  { value: "4",  label: "4 – ASL / AUSL" },
  { value: "5",  label: "5 – Ospedale autorizzato" },
];

function ModalCia({ onConfirm, onCancel }) {
  const today = new Date().toISOString().slice(0, 10);
  const [cia, setCia] = useState({
    codice_cia:           "",
    ufficio_cia:          "",
    medico_data_visita:   today,
    medico_iscrizione_albo: "",
    medico_uff_sanitario:   "",
  });

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000,
    }}>
      <div style={{
        background: "#fff", borderRadius: 12, padding: 28,
        width: 440, boxShadow: "0 8px 32px rgba(0,0,0,.18)",
      }}>
        <h3 style={{ margin: "0 0 6px", fontSize: 17, fontWeight: 700 }}>
          ⚕️ Dati Certificato Idoneità (CIA)
        </h3>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "#6b7280" }}>
          Compila i campi CIA per il Rinnovo con TT2112. I campi sono opzionali se già presenti nel portale.
        </p>

        {[
          { key: "codice_cia",             label: "Codice Identificativo CIA",       type: "text",   placeholder: "es. 2024RM001234" },
          { key: "ufficio_cia",            label: "Codice Ufficio Provinciale CIA",   type: "text",   placeholder: "es. RM|" },
          { key: "medico_data_visita",     label: "Data Visita Medica",               type: "date",   placeholder: "" },
          { key: "medico_iscrizione_albo", label: "Iscrizione Albo Medico",           type: "text",   placeholder: "es. 12345" },
        ].map(({ key, label, type, placeholder }) => (
          <div key={key} style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 3, color: "#374151" }}>
              {label}
            </label>
            <input
              type={type}
              value={cia[key]}
              onChange={(e) => setCia((p) => ({ ...p, [key]: e.target.value }))}
              placeholder={placeholder}
              style={{
                width: "100%", padding: "7px 10px",
                border: "1px solid #d1d5db", borderRadius: 7,
                fontSize: 13, outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
        ))}

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 3, color: "#374151" }}>
            Tipo Ufficiale Sanitario
          </label>
          <select
            value={cia.medico_uff_sanitario}
            onChange={(e) => setCia((p) => ({ ...p, medico_uff_sanitario: e.target.value }))}
            style={{
              width: "100%", padding: "7px 10px",
              border: "1px solid #d1d5db", borderRadius: 7,
              fontSize: 13, outline: "none", boxSizing: "border-box",
              background: "#fff",
            }}
          >
            {UFF_SANITARIO_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button
            onClick={() => onConfirm(cia)}
            style={{
              flex: 1, padding: "10px 0", background: "#065f46",
              color: "#fff", border: "none", borderRadius: 8,
              fontWeight: 700, fontSize: 15, cursor: "pointer",
            }}
          >
            Avanti →
          </button>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: "10px 0", background: "#f3f4f6",
              color: "#374151", border: "none", borderRadius: 8,
              fontWeight: 600, fontSize: 15, cursor: "pointer",
            }}
          >
            Annulla
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Componente principale ─────────────────────────────────────────────────────

export default function TrasmissionePortale() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [pratiche, setPratiche] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Tab mode: "pratiche" (vista originale pratica-centric) | "candidati" (replica GeCA Trasmiss.cs)
  const [tabMode, setTabMode] = useState("candidati");

  // Filtri
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroTesto, setFiltroTesto] = useState("");
  const [filtroSigla, setFiltroSigla] = useState(""); // solo tab candidati
  const [includiTrasmessi, setIncludiTrasmessi] = useState(false);

  // Selezione (tab pratiche)
  const [selected, setSelected] = useState(new Set());

  // Candidati pronti (tab candidati)
  const [candidati, setCandidati] = useState([]);
  const [loadingCandidati, setLoadingCandidati] = useState(false);
  const [gruppiSigla, setGruppiSigla] = useState({});
  const [gruppiOperazione, setGruppiOperazione] = useState({});
  const [invioCandidatoInCorso, setInvioCandidatoInCorso] = useState({});
  const [selectedCandidati, setSelectedCandidati] = useState(new Set());

  // Modale credenziali
  const [showCredModal, setShowCredModal] = useState(false);
  // pendingAction può avere mode="pratica" (originale) o mode="candidato" (nuovo)
  const [pendingAction, setPendingAction] = useState(null);

  // Modale CIA
  const [showCiaModal, setShowCiaModal] = useState(false);
  const [ciaExtra, setCiaExtra] = useState(null);

  // Modale risultato
  const [risultato, setRisultato] = useState(null);
  const [risultatoPratica, setRisultatoPratica] = useState(null);

  // Stato invio in corso per pratica
  const [invioInCorso, setInvioInCorso] = useState({}); // { [id]: true }

  // SSE progress messages durante trasmissione
  const [progressMessages, setProgressMessages] = useState([]);
  const [progressBusy, setProgressBusy] = useState(false);

  // Rinnovabilità
  const [rinnovabilita, setRinnovabilita] = useState({}); // { [id]: { esito, messaggio } }

  // ── Auth ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    checkSession().then((u) => {
      if (!u) { router.push("/login"); return; }
      setUser(u);
    });
  }, [router]);

  // ── Carica pratiche ─────────────────────────────────────────────────────────

  const caricaPratiche = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBase()}/api/trasmiss/portale/pratiche-pronte`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPratiche(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || "Errore caricamento pratiche");
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Carica candidati pronti (tab candidato-centric) ────────────────────────
  const caricaCandidatiPronti = useCallback(async () => {
    setLoadingCandidati(true);
    setError("");
    try {
      const qs = new URLSearchParams();
      if (filtroSigla) qs.set("sigla", filtroSigla);
      if (filtroTipo)  qs.set("tipo",  filtroTipo);
      if (includiTrasmessi) qs.set("includi_trasmessi", "true");
      const url = `${apiBase()}/api/trasmiss/candidati-pronti${qs.toString() ? "?" + qs.toString() : ""}`;
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data && data.success) {
        setCandidati(Array.isArray(data.candidati) ? data.candidati : []);
        setGruppiSigla(data.gruppi || {});
        setGruppiOperazione(data.gruppi_operazione || {});
      } else {
        setCandidati([]);
        setError(data?.error || "Errore caricamento candidati pronti");
      }
    } catch (e) {
      setError(e.message || "Errore caricamento candidati pronti");
    } finally {
      setLoadingCandidati(false);
    }
  }, [filtroSigla, filtroTipo, includiTrasmessi]);

  useEffect(() => {
    if (user && tabMode === "pratiche") caricaPratiche();
  }, [user, tabMode, caricaPratiche]);

  useEffect(() => {
    if (user && tabMode === "candidati") caricaCandidatiPronti();
  }, [user, tabMode, caricaCandidatiPronti]);

  // ── Filtro pratiche ─────────────────────────────────────────────────────────

  const praticheFiltrate = pratiche.filter((p) => {
    if (filtroTipo && p.tipo_trasmissione !== filtroTipo) return false;
    if (filtroTesto) {
      const q = filtroTesto.toLowerCase();
      const nome = `${p.candidates?.cognome || ""} ${p.candidates?.nome || ""}`.toLowerCase();
      const cf   = (p.candidates?.codice_fiscale || "").toLowerCase();
      const cat  = (p.categoria_patente || "").toLowerCase();
      if (!nome.includes(q) && !cf.includes(q) && !cat.includes(q)) return false;
    }
    return true;
  });

  // ── Filtro candidati (tab candidato-centric) ────────────────────────────────
  const candidatiFiltrati = candidati.filter((c) => {
    if (filtroTesto) {
      const q = filtroTesto.toLowerCase();
      const nome = `${c.cognome || ""} ${c.nome || ""}`.toLowerCase();
      const cf   = (c.codice_fiscale || "").toLowerCase();
      const cat  = (c.categoria_richiesta || c.categoria_patente || "").toLowerCase();
      if (!nome.includes(q) && !cf.includes(q) && !cat.includes(q)) return false;
    }
    return true;
  });

  // ── Selezione ───────────────────────────────────────────────────────────────

  const toggleSelect = (id) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const toggleAll = () =>
    setSelected((prev) =>
      prev.size === praticheFiltrate.length
        ? new Set()
        : new Set(praticheFiltrate.map((p) => p.id))
    );

  const toggleSelectCandidato = (id) =>
    setSelectedCandidati((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const toggleAllCandidati = () =>
    setSelectedCandidati((prev) =>
      prev.size === candidatiFiltrati.length
        ? new Set()
        : new Set(candidatiFiltrati.map((c) => c.id))
    );

  // ── Avvia trasmissione ──────────────────────────────────────────────────────

  function avviaTrasmissione(praticaId, tipo) {
    setPendingAction({ mode: "pratica", tipo, praticaIds: [praticaId] });
    if (tipo === "rinnovo_medico") {
      setCiaExtra(null);
      setShowCiaModal(true);
    } else {
      setShowCredModal(true);
    }
  }

  // Avvia trasmissione candidato-centric (replica Trasmiss.cs invio_Click)
  function avviaTrasmissioneCandidato(candidato) {
    const operazione = candidato.operazione;
    const tipoEndpoint = OPERAZIONE_TO_TIPO_ENDPOINT[operazione] || operazione;
    setPendingAction({
      mode: "candidato",
      tipo: tipoEndpoint,
      operazione,
      sigla: candidato.tipo_iscrizione_sigla,
      candidatoIds: [candidato.id],
    });
    // Il flusso CIA è richiesto anche per rinnovo_medico candidato-centric
    if (operazione === "rinnovo_medico") {
      setCiaExtra(null);
      setShowCiaModal(true);
    } else {
      setShowCredModal(true);
    }
  }

  function confermaCia(extra) {
    setCiaExtra(extra);
    setShowCiaModal(false);
    setShowCredModal(true);
  }

  async function eseguiTrasmissione(credenziali) {
    setShowCredModal(false);
    if (!pendingAction) return;

    // Dispatch branch: candidato-centric vs pratica-centric
    if (pendingAction.mode === "candidato") {
      return eseguiTrasmissioneCandidato(credenziali);
    }

    const { tipo, praticaIds } = pendingAction;
    setPendingAction(null);

    // Mappa tipo → endpoint
    const endpointMap = {
      conseguimento:  "conseguimento",
      cqc:            "cqc",
      rinnovo_cqc:    "rinnovo-cqc",
      prima_fase:     "prima-fase",
      rinnovo:        "rinnovo",
      rinnovo_medico: "rinnovo-medico",
      altro:          "altro",
    };

    const endpoint = endpointMap[tipo] || tipo.replace("_", "-");

    setProgressMessages([]);
    setProgressBusy(true);

    for (const praticaId of praticaIds) {
      setInvioInCorso((p) => ({ ...p, [praticaId]: true }));
      try {
        const base = apiBase();
        const url = `${base}/api/trasmiss/portale/${endpoint}`;
        const tok = typeof window !== "undefined" ? localStorage.getItem("autoscuola_token") : null;
        const fetchHeaders = {
          "Accept": "text/event-stream",
          "Content-Type": "application/json",
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        };
        const res = await fetch(url, {
          method: "POST",
          headers: fetchHeaders,
          body: JSON.stringify({ pratica_id: praticaId, credenziali, ...(ciaExtra ? { extra: ciaExtra } : {}) }),
        });

        let data = null;
        if (res.headers.get("content-type")?.includes("text/event-stream")) {
          // SSE streaming
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
                  const ev = JSON.parse(line.slice(6));
                  if (ev.event === "progress" || ev.event === "start") {
                    if (ev.message) setProgressMessages((m) => [...m, ev.message]);
                  } else if (ev.event === "done") {
                    data = ev;
                  }
                } catch (_) {}
              }
            }
          }
        } else {
          data = await res.json();
        }

        if (!data) data = { success: false, error: "Nessuna risposta dal server" };

        const praticaObj = pratiche.find((p) => p.id === praticaId);
        setRisultatoPratica(praticaObj);
        setRisultato(data);

        setPratiche((prev) =>
          prev.map((p) =>
            p.id === praticaId
              ? {
                  ...p,
                  stato_pratica: data.success ? "trasmesso_portale" : p.stato_pratica,
                  marca_operativa: data.marcaOperativa || p.marca_operativa,
                  id_richiesta_portale: data.idRichiesta || p.id_richiesta_portale,
                }
              : p
          )
        );
      } catch (e) {
        setRisultato({ success: false, error: e.message });
      } finally {
        setInvioInCorso((p) => ({ ...p, [praticaId]: false }));
      }
    }
    setProgressBusy(false);
  }

  // ── Esegui trasmissione candidato-centric (replica GeCA Trasmiss.cs invio_Click) ──
  async function eseguiTrasmissioneCandidato(credenziali) {
    if (!pendingAction || pendingAction.mode !== "candidato") return;

    const { candidatoIds, operazione, sigla } = pendingAction;
    setPendingAction(null);

    setProgressMessages([
      `▶ Avvio trasmissione ${operazione} (sigla ${sigla}) per ${candidatoIds.length} candidato/i`,
    ]);
    setProgressBusy(true);

    for (const candidatoId of candidatoIds) {
      setInvioCandidatoInCorso((p) => ({ ...p, [candidatoId]: true }));
      try {
        const base = apiBase();
        const url = `${base}/api/trasmiss/trasmetti-candidato`;
        const tok = typeof window !== "undefined" ? localStorage.getItem("autoscuola_token") : null;
        const fetchHeaders = {
          "Content-Type": "application/json",
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        };

        setProgressMessages((m) => [
          ...m,
          `→ Invio candidato ${candidatoId}…`,
        ]);

        const res = await fetch(url, {
          method: "POST",
          headers: fetchHeaders,
          body: JSON.stringify({
            candidato_id: candidatoId,
            sigla,
            credenziali,
            ...(ciaExtra ? { extra: ciaExtra } : {}),
          }),
        });

        let data = null;
        try {
          data = await res.json();
        } catch (_) {
          data = { success: false, error: `HTTP ${res.status}` };
        }

        if (!data) data = { success: false, error: "Nessuna risposta dal server" };

        // Mostra risultato in modale
        const candidatoObj = candidati.find((c) => c.id === candidatoId);
        setRisultatoPratica({
          candidates: candidatoObj,
          tipo_trasmissione: operazione,
          tipo_pratica: operazione,
        });
        setRisultato(data);

        // Aggiorna lista candidati con lo stato trasmesso
        setCandidati((prev) =>
          prev.map((c) =>
            c.id === candidatoId
              ? {
                  ...c,
                  trasmesso: data.success ? true : c.trasmesso,
                  stato_pratica: data.success ? "trasmesso_portale" : c.stato_pratica,
                  marca_operativa: data.marcaOperativa || c.marca_operativa,
                  id_richiesta_portale: data.idRichiesta || c.id_richiesta_portale,
                  pratica_id: data.pratica_id || c.pratica_id,
                  ultimo_errore_portale: data.success ? null : (data.error || c.ultimo_errore_portale),
                }
              : c
          )
        );

        if (data.log && Array.isArray(data.log)) {
          setProgressMessages((m) => [...m, ...data.log.slice(-20)]);
        }
        setProgressMessages((m) => [
          ...m,
          data.success
            ? `✓ Trasmissione OK (marca ${data.marcaOperativa || "–"})`
            : `✗ Errore: ${data.error || "sconosciuto"}`,
        ]);
      } catch (e) {
        setRisultato({ success: false, error: e.message });
        setProgressMessages((m) => [...m, `✗ Eccezione: ${e.message}`]);
      } finally {
        setInvioCandidatoInCorso((p) => ({ ...p, [candidatoId]: false }));
      }
    }
    setProgressBusy(false);
    setCiaExtra(null);
  }

  // Trasmissione massiva candidati selezionati
  function avviaTrasmissioneMassivaCandidati() {
    if (selectedCandidati.size === 0) {
      alert("Nessun candidato selezionato");
      return;
    }
    // Raggruppa per operazione — serve un giro separato per ognuna
    const candidatiSelezionati = candidatiFiltrati.filter((c) => selectedCandidati.has(c.id));
    const operazioniUniche = [...new Set(candidatiSelezionati.map((c) => c.operazione))];

    if (operazioniUniche.length > 1) {
      const ok = confirm(
        `I ${candidatiSelezionati.length} candidati selezionati hanno operazioni diverse (${operazioniUniche.join(", ")}).\n\n` +
        "Vuoi procedere comunque? Verranno trasmessi uno ad uno."
      );
      if (!ok) return;
    }

    // Usa l'operazione del primo candidato per CIA (rinnovo_medico)
    const firstOp = candidatiSelezionati[0].operazione;
    const firstSigla = candidatiSelezionati[0].tipo_iscrizione_sigla;

    setPendingAction({
      mode: "candidato",
      tipo: OPERAZIONE_TO_TIPO_ENDPOINT[firstOp] || firstOp,
      operazione: firstOp,
      sigla: firstSigla,
      candidatoIds: candidatiSelezionati.map((c) => c.id),
    });

    if (firstOp === "rinnovo_medico") {
      setCiaExtra(null);
      setShowCiaModal(true);
    } else {
      setShowCredModal(true);
    }
  }

  // ── Verifica rinnovabilità ──────────────────────────────────────────────────

  async function verificaRinnovabilita(praticaId) {
    setRinnovabilita((p) => ({ ...p, [praticaId]: { loading: true } }));
    try {
      const res = await fetch(`${apiBase()}/api/trasmiss/portale/rinnovabilita`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ pratica_id: praticaId }),
      });
      const data = await res.json();
      setRinnovabilita((p) => ({
        ...p,
        [praticaId]: { loading: false, ...data },
      }));
    } catch (e) {
      setRinnovabilita((p) => ({ ...p, [praticaId]: { loading: false, error: e.message } }));
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!user) return null;

  return (
    <ModernAppShell user={user} onLogout={() => { logoutSession(); router.push("/login"); }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 16px 60px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
              🏛️ Trasmissione Pratiche — Portale Automobilista
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 14, color: "#6b7280" }}>
              Trasmissione automatica pratiche sul Portale dell&apos;Automobilista
            </p>
          </div>
          <button
            onClick={() => tabMode === "pratiche" ? caricaPratiche() : caricaCandidatiPronti()}
            style={{
              padding: "8px 18px", background: "#f3f4f6",
              border: "1px solid #d1d5db", borderRadius: 8,
              fontSize: 14, cursor: "pointer", fontWeight: 600,
            }}
          >
            🔄 Aggiorna
          </button>
        </div>

        {/* Tab switcher: Pratiche / Candidati */}
        <div style={{
          display: "flex", gap: 0, marginBottom: 18,
          borderBottom: "2px solid #e5e7eb",
        }}>
          <button
            onClick={() => setTabMode("candidati")}
            style={{
              padding: "10px 22px",
              background: tabMode === "candidati" ? "#fff" : "transparent",
              border: "none",
              borderBottom: tabMode === "candidati" ? "3px solid #1d4ed8" : "3px solid transparent",
              marginBottom: -2,
              color: tabMode === "candidati" ? "#1d4ed8" : "#6b7280",
              fontSize: 14, fontWeight: 700, cursor: "pointer",
              transition: "all .15s",
            }}
          >
            👤 Candidati Pronti
            {candidati.length > 0 && (
              <span style={{
                marginLeft: 8,
                background: tabMode === "candidati" ? "#dbeafe" : "#f3f4f6",
                color: tabMode === "candidati" ? "#1d4ed8" : "#6b7280",
                borderRadius: 99,
                padding: "1px 8px",
                fontSize: 12,
                fontWeight: 700,
              }}>
                {candidati.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTabMode("pratiche")}
            style={{
              padding: "10px 22px",
              background: tabMode === "pratiche" ? "#fff" : "transparent",
              border: "none",
              borderBottom: tabMode === "pratiche" ? "3px solid #1d4ed8" : "3px solid transparent",
              marginBottom: -2,
              color: tabMode === "pratiche" ? "#1d4ed8" : "#6b7280",
              fontSize: 14, fontWeight: 700, cursor: "pointer",
              transition: "all .15s",
            }}
          >
            📄 Pratiche (vista legacy)
            {pratiche.length > 0 && (
              <span style={{
                marginLeft: 8,
                background: tabMode === "pratiche" ? "#dbeafe" : "#f3f4f6",
                color: tabMode === "pratiche" ? "#1d4ed8" : "#6b7280",
                borderRadius: 99,
                padding: "1px 8px",
                fontSize: 12,
                fontWeight: 700,
              }}>
                {pratiche.length}
              </span>
            )}
          </button>
        </div>

        {/* Errore */}
        {error && (
          <div style={{
            background: "#fef2f2", border: "1px solid #fecaca",
            borderRadius: 8, padding: "12px 16px", marginBottom: 16,
            color: "#b91c1c", fontSize: 14,
          }}>
            {error}
          </div>
        )}

        {/* Progress panel SSE — trasmissione in corso */}
        {(progressBusy || progressMessages.length > 0) && (
          <div style={{ marginBottom: 16 }}>
            <ProgressPanel
              messages={progressMessages}
              busy={progressBusy}
              error=""
              title="Puppeteer — Trasmissione portale"
              maxHeight="180px"
            />
          </div>
        )}

        {/* Filtri */}
        <div style={{
          display: "flex", gap: 10, marginBottom: 16,
          flexWrap: "wrap",
        }}>
          <input
            type="text"
            placeholder="🔍 Cerca candidato, CF, categoria…"
            value={filtroTesto}
            onChange={(e) => setFiltroTesto(e.target.value)}
            style={{
              flex: 1, minWidth: 220,
              padding: "9px 12px",
              border: "1px solid #d1d5db", borderRadius: 8,
              fontSize: 14, outline: "none",
            }}
          />
          <select
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value)}
            style={{
              padding: "9px 12px", minWidth: 200,
              border: "1px solid #d1d5db", borderRadius: 8,
              fontSize: 14, background: "#fff", outline: "none",
            }}
          >
            {TIPO_TRASMISSIONE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {tabMode === "candidati" && (
            <>
              <select
                value={filtroSigla}
                onChange={(e) => setFiltroSigla(e.target.value)}
                style={{
                  padding: "9px 12px", minWidth: 220,
                  border: "1px solid #d1d5db", borderRadius: 8,
                  fontSize: 14, background: "#fff", outline: "none",
                }}
                title="Filtra per sigla tipo iscrizione"
              >
                <option value="">Tutte le sigle</option>
                {Object.entries(SIGLA_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {k} — {v}
                  </option>
                ))}
              </select>
              <label style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "9px 12px", fontSize: 13, fontWeight: 600,
                color: "#374151", cursor: "pointer",
                background: "#f9fafb", border: "1px solid #d1d5db", borderRadius: 8,
              }}>
                <input
                  type="checkbox"
                  checked={includiTrasmessi}
                  onChange={(e) => setIncludiTrasmessi(e.target.checked)}
                  style={{ cursor: "pointer" }}
                />
                Includi trasmessi
              </label>
            </>
          )}
        </div>

        {/* Conta pratiche/candidati */}
        <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {tabMode === "pratiche" ? (
            <>
              <span>{loading ? "Caricamento…" : `${praticheFiltrate.length} pratiche`}</span>
              {selected.size > 0 && (
                <span style={{ color: "#1d4ed8", fontWeight: 600 }}>
                  {selected.size} selezionate
                </span>
              )}
            </>
          ) : (
            <>
              <span>{loadingCandidati ? "Caricamento…" : `${candidatiFiltrati.length} candidati`}</span>
              {selectedCandidati.size > 0 && (
                <span style={{ color: "#1d4ed8", fontWeight: 600 }}>
                  {selectedCandidati.size} selezionati
                </span>
              )}
              {Object.keys(gruppiOperazione).length > 0 && (
                <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
                  {Object.entries(gruppiOperazione).map(([op, n]) => (
                    <span
                      key={op}
                      style={{
                        padding: "2px 10px",
                        background: "#eef2ff",
                        color: "#4338ca",
                        borderRadius: 99,
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {OPERAZIONE_LABEL[op] || op}: {n}
                    </span>
                  ))}
                </span>
              )}
              {selectedCandidati.size > 0 && (
                <button
                  onClick={avviaTrasmissioneMassivaCandidati}
                  style={{
                    marginLeft: "auto",
                    padding: "6px 14px",
                    background: "#1d4ed8",
                    color: "#fff",
                    border: "none",
                    borderRadius: 7,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  📤 Trasmetti selezionati ({selectedCandidati.size})
                </button>
              )}
            </>
          )}
        </div>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* TAB PRATICHE — vista legacy pratica-centric                          */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {tabMode === "pratiche" && (loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "#6b7280", fontSize: 14 }}>
            Caricamento pratiche…
          </div>
        ) : praticheFiltrate.length === 0 ? (
          <div style={{
            textAlign: "center", padding: 48,
            border: "2px dashed #e5e7eb", borderRadius: 12,
            color: "#9ca3af",
          }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📭</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Nessuna pratica da trasmettere</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              Le pratiche pronte per la trasmissione appariranno qui
            </div>
          </div>
        ) : (
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
            {/* Header tabella */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "36px 1fr 110px 100px 120px 120px 180px",
              background: "#f9fafb",
              padding: "10px 14px",
              borderBottom: "1px solid #e5e7eb",
              fontSize: 12, fontWeight: 700, color: "#6b7280",
              gap: 8,
            }}>
              <div>
                <input
                  type="checkbox"
                  checked={selected.size === praticheFiltrate.length && praticheFiltrate.length > 0}
                  onChange={toggleAll}
                  style={{ cursor: "pointer" }}
                />
              </div>
              <div>CANDIDATO</div>
              <div>TIPO</div>
              <div>CATEGORIA</div>
              <div>STATO</div>
              <div>MARCA</div>
              <div>AZIONI</div>
            </div>

            {/* Righe */}
            {praticheFiltrate.map((p) => {
              const isInCorso = invioInCorso[p.id];
              const rin       = rinnovabilita[p.id];

              return (
                <div
                  key={p.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "36px 1fr 110px 100px 120px 120px 180px",
                    padding: "12px 14px",
                    borderBottom: "1px solid #f3f4f6",
                    alignItems: "center",
                    gap: 8,
                    background: selected.has(p.id) ? "#eff6ff" : "transparent",
                    transition: "background .12s",
                  }}
                >
                  {/* Checkbox */}
                  <div>
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                      style={{ cursor: "pointer" }}
                    />
                  </div>

                  {/* Candidato */}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {p.candidates?.cognome} {p.candidates?.nome}
                    </div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>
                      {p.candidates?.codice_fiscale}
                      {p.data_iscrizione && (
                        <span style={{ marginLeft: 8 }}>
                          Iscr. {formatDateIT(p.data_iscrizione)}
                        </span>
                      )}
                    </div>
                    {rin && !rin.loading && (
                      <div style={{
                        marginTop: 3, fontSize: 11,
                        color: rin.rinnovabile ? "#16a34a" : rin.error ? "#dc2626" : "#f59e0b",
                        fontWeight: 600,
                      }}>
                        {rin.rinnovabile
                          ? "✓ Rinnovabile"
                          : rin.error
                            ? `✗ ${rin.error}`
                            : rin.messaggio || "Non rinnovabile"}
                      </div>
                    )}
                    {rin?.loading && (
                      <div style={{ marginTop: 3, fontSize: 11, color: "#8b5cf6" }}>
                        Verifica in corso…
                      </div>
                    )}
                  </div>

                  {/* Tipo */}
                  <div>
                    <TipoBadge tipo={p.tipo_trasmissione || p.tipo_pratica} />
                  </div>

                  {/* Categoria */}
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {p.categoria_patente || p.categoria || "–"}
                  </div>

                  {/* Stato */}
                  <div>
                    <StatoBadge stato={p.stato_pratica || p.stato} />
                  </div>

                  {/* Marca */}
                  <div style={{ fontSize: 12, color: "#374151", fontFamily: "monospace" }}>
                    {p.marca_operativa || "–"}
                    {p.id_richiesta_portale && (
                      <div style={{ fontSize: 11, color: "#6b7280" }}>
                        ID: {p.id_richiesta_portale}
                      </div>
                    )}
                  </div>

                  {/* Azioni */}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {/* Pulsante trasmetti */}
                    {(p.stato_pratica === "trasmesso_portale" || p.stato_pratica === "trasmesso") ? (
                      <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>
                        ✓ Trasmessa
                      </span>
                    ) : (
                      <button
                        onClick={() => avviaTrasmissione(p.id, p.tipo_trasmissione || "conseguimento")}
                        disabled={isInCorso}
                        style={{
                          padding: "5px 10px",
                          background: isInCorso ? "#e5e7eb" : "#1d4ed8",
                          color: isInCorso ? "#9ca3af" : "#fff",
                          border: "none", borderRadius: 6,
                          fontSize: 12, fontWeight: 600,
                          cursor: isInCorso ? "not-allowed" : "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {isInCorso ? "⏳ Invio…" : "📤 Trasmetti"}
                      </button>
                    )}

                    {/* Verifica rinnovabilità per pratiche rinnovo */}
                    {(p.tipo_trasmissione === "rinnovo" || p.tipo_trasmissione === "rinnovo_medico") && (
                      <button
                        onClick={() => verificaRinnovabilita(p.id)}
                        disabled={rin?.loading}
                        style={{
                          padding: "5px 8px",
                          background: "#f0fdf4",
                          color: "#16a34a",
                          border: "1px solid #bbf7d0",
                          borderRadius: 6,
                          fontSize: 11, fontWeight: 600,
                          cursor: rin?.loading ? "not-allowed" : "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {rin?.loading ? "⏳" : "🔍 Verifica"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* TAB CANDIDATI — vista candidato-centric (replica GeCA Trasmiss.cs)   */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {tabMode === "candidati" && (loadingCandidati ? (
          <div style={{ textAlign: "center", padding: 40, color: "#6b7280", fontSize: 14 }}>
            Caricamento candidati pronti…
          </div>
        ) : candidatiFiltrati.length === 0 ? (
          <div style={{
            textAlign: "center", padding: 48,
            border: "2px dashed #e5e7eb", borderRadius: 12,
            color: "#9ca3af",
          }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>👤</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Nessun candidato pronto per la trasmissione</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              I candidati iscritti con sigla trasmissibile appariranno qui.<br/>
              Sigle trasmissibili: IN, PR, RE, CV, CM, D|, Y|, L|, S|, R|, M|, E|, PC, CC, GA
            </div>
          </div>
        ) : (
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
            {/* Header tabella candidati */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "36px 1.4fr 120px 180px 100px 130px 170px",
              background: "#f9fafb",
              padding: "10px 14px",
              borderBottom: "1px solid #e5e7eb",
              fontSize: 11, fontWeight: 700, color: "#6b7280",
              gap: 8,
              letterSpacing: ".3px",
            }}>
              <div>
                <input
                  type="checkbox"
                  checked={selectedCandidati.size === candidatiFiltrati.length && candidatiFiltrati.length > 0}
                  onChange={toggleAllCandidati}
                  style={{ cursor: "pointer" }}
                />
              </div>
              <div>CANDIDATO</div>
              <div>SIGLA</div>
              <div>OPERAZIONE</div>
              <div>CATEGORIA</div>
              <div>STATO</div>
              <div>AZIONI</div>
            </div>

            {/* Righe candidati */}
            {candidatiFiltrati.map((c) => {
              const isInCorso = invioCandidatoInCorso[c.id];
              const isSelected = selectedCandidati.has(c.id);

              return (
                <div
                  key={c.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "36px 1.4fr 120px 180px 100px 130px 170px",
                    padding: "12px 14px",
                    borderBottom: "1px solid #f3f4f6",
                    alignItems: "center",
                    gap: 8,
                    background: isSelected ? "#eff6ff" : (c.trasmesso ? "#f0fdf4" : "transparent"),
                    transition: "background .12s",
                  }}
                >
                  {/* Checkbox */}
                  <div>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectCandidato(c.id)}
                      disabled={c.trasmesso}
                      style={{ cursor: c.trasmesso ? "not-allowed" : "pointer" }}
                    />
                  </div>

                  {/* Candidato */}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {c.cognome} {c.nome}
                    </div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>
                      {c.codice_fiscale}
                      {c.telefono && (
                        <span style={{ marginLeft: 8 }}>
                          📞 {c.telefono}
                        </span>
                      )}
                    </div>
                    {c.data_iscrizione && (
                      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
                        Iscr. {formatDateIT(c.data_iscrizione)}
                      </div>
                    )}
                    {c.ultimo_errore_portale && !c.trasmesso && (
                      <div style={{
                        fontSize: 11, color: "#dc2626",
                        marginTop: 3, fontWeight: 600,
                      }}>
                        ⚠ {c.ultimo_errore_portale}
                      </div>
                    )}
                  </div>

                  {/* Sigla */}
                  <div>
                    <span
                      title={siglaLabel(c.tipo_iscrizione_sigla)}
                      style={{
                        display: "inline-block",
                        padding: "2px 9px",
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#4338ca",
                        background: "#eef2ff",
                        fontFamily: "monospace",
                      }}
                    >
                      {c.tipo_iscrizione_sigla || "–"}
                    </span>
                  </div>

                  {/* Operazione */}
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>
                    {OPERAZIONE_LABEL[c.operazione] || c.operazione_label || c.operazione || "–"}
                  </div>

                  {/* Categoria */}
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {c.categoria_richiesta || c.categoria_patente || "–"}
                  </div>

                  {/* Stato */}
                  <div>
                    <StatoBadge stato={c.stato_pratica} />
                    {c.marca_operativa && (
                      <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2, fontFamily: "monospace" }}>
                        {c.marca_operativa}
                      </div>
                    )}
                  </div>

                  {/* Azioni */}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {c.trasmesso ? (
                      <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>
                        ✓ Trasmesso
                      </span>
                    ) : (
                      <button
                        onClick={() => avviaTrasmissioneCandidato(c)}
                        disabled={isInCorso}
                        style={{
                          padding: "5px 12px",
                          background: isInCorso ? "#e5e7eb" : "#1d4ed8",
                          color: isInCorso ? "#9ca3af" : "#fff",
                          border: "none", borderRadius: 6,
                          fontSize: 12, fontWeight: 600,
                          cursor: isInCorso ? "not-allowed" : "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {isInCorso ? "⏳ Invio…" : "📤 Trasmetti"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {/* Legenda stati */}
        <div style={{
          marginTop: 28, padding: "14px 18px",
          background: "#f9fafb", border: "1px solid #e5e7eb",
          borderRadius: 10, fontSize: 12,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 8, color: "#374151" }}>
            ℹ️ Note operative
          </div>
          <ul style={{ margin: 0, paddingLeft: 20, color: "#6b7280", lineHeight: 1.8 }}>
            {tabMode === "candidati" ? (
              <>
                <li><strong>Vista Candidati</strong> — replica il flusso GeCA Trasmiss.cs: si parte dall&apos;iscrizione candidato, la pratica viene creata al volo sul Portale.</li>
                <li>La sigla <code>tipo_iscrizione</code> determina automaticamente l&apos;operazione (conseguimento/rinnovo/duplicato/CQC/...).</li>
                <li>Sigle non trasmissibili (PN, RP, CQ, CK, CA, EG, AD, PI, PP) sono filtrate automaticamente.</li>
                <li>Puoi selezionare più candidati e usare &quot;Trasmetti selezionati&quot; per invio massivo (GeCA btnMASSIVO).</li>
                <li>Il certificato medico (CM → rinnovo_medico) richiede i dati CIA TT2112 prima della trasmissione.</li>
              </>
            ) : (
              <>
                <li>La trasmissione apre un browser Puppeteer in background e compila il form sul Portale dell&apos;Automobilista.</li>
                <li>I campi anagrafici vengono compilati automaticamente dai dati del candidato su Supabase.</li>
                <li>Per i comuni/province è necessario che i codici ISTAT siano presenti nell&apos;anagrafica del candidato.</li>
                <li>I rinnovi richiedono che la patente sia rinnovabile (verifica preventiva consigliata).</li>
                <li>Dopo la trasmissione, la marca operativa e l&apos;ID richiesta vengono salvati automaticamente.</li>
              </>
            )}
          </ul>
        </div>
      </div>

      {/* Modale CIA (rinnovo medico) */}
      {showCiaModal && (
        <ModalCia
          onConfirm={confermaCia}
          onCancel={() => { setShowCiaModal(false); setPendingAction(null); }}
        />
      )}

      {/* Modale credenziali */}
      {showCredModal && (
        <ModalCredenziali
          onConfirm={eseguiTrasmissione}
          onCancel={() => { setShowCredModal(false); setPendingAction(null); }}
        />
      )}

      {/* Modale risultato */}
      {risultato && (
        <ModalRisultato
          pratica={risultatoPratica}
          risultato={risultato}
          onClose={() => { setRisultato(null); setRisultatoPratica(null); }}
        />
      )}
    </ModernAppShell>
  );
}

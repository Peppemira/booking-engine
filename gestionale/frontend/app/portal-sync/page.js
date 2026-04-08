"use client";

/**
 * Portal Sync — Lettura dati dal Portale Automobilista
 * =====================================================
 * Dashboard per leggere e sincronizzare dati dal portale:
 *   - Dati patente posseduta (Punto 9)
 *   - Esiti esami svolti (Punto 10)
 *   - Esami candidato prenotati (Punto 11)
 *   - Rinnovi attivi (Punto 12)
 *   - Ricevuta sostitutiva (Punto 7)
 *   - Certificato medico TT2112 (Punto 8)
 *   - Sync completo candidato (Punto 13)
 *   - Allievi prenotati (Punto 14)
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getApiBase, authHeaders, checkSession, logoutSession } from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";

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

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ─── Tab definitions ────────────────────────────────────────────────────────

const TABS = [
  { key: "patente",        label: "🪪 Patente",          desc: "Dati patente posseduta" },
  { key: "esami-svolti",   label: "📝 Esiti Esami",      desc: "Verbali svolti (quiz/guida)" },
  { key: "esami-candidato",label: "👤 Esami Candidato",  desc: "Prenotazioni per candidato" },
  { key: "rinnovi",        label: "🔄 Rinnovi Attivi",   desc: "Rinnovi patente in corso" },
  { key: "ricevuta",       label: "📄 Ricevuta Sost.",   desc: "Ricevuta sostitutiva" },
  { key: "tt2112",         label: "⚕️ TT2112",           desc: "Certificato medico" },
  { key: "sync",           label: "🔁 Sync Candidato",   desc: "Sync completo dati" },
  { key: "allievi",        label: "👥 Allievi",          desc: "Allievi prenotati" },
  { key: "anomalie",       label: "⚠️ Anomalie",         desc: "Pratiche bloccate / con problemi" },
];

// ─── Generic fetch helper ────────────────────────────────────────────────────

async function apiFetch(path) {
  const res  = await fetch(`${apiBase()}/api/portal-sync/${path}`, { headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

// ─── ResultTable ─────────────────────────────────────────────────────────────

function ResultTable({ columns, rows, emptyMsg = "Nessun risultato" }) {
  if (!rows || rows.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 28, color: "#9ca3af", fontSize: 14 }}>
        {emptyMsg}
      </div>
    );
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{
        width: "100%", borderCollapse: "collapse",
        fontSize: 13,
      }}>
        <thead>
          <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
            {columns.map((c) => (
              <th key={c.key} style={{
                padding: "8px 12px", textAlign: "left",
                fontWeight: 700, color: "#374151", whiteSpace: "nowrap",
              }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #f3f4f6", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
              {columns.map((c) => (
                <td key={c.key} style={{ padding: "8px 12px", color: "#374151" }}>
                  {c.render ? c.render(row) : (row[c.key] ?? "–")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── ErrorBox ────────────────────────────────────────────────────────────────

function ErrorBox({ msg }) {
  if (!msg) return null;
  return (
    <div style={{
      background: "#fef2f2", border: "1px solid #fecaca",
      borderRadius: 7, padding: "10px 14px",
      color: "#b91c1c", fontSize: 13, marginTop: 10,
    }}>
      {msg}
    </div>
  );
}

// ─── Loading ─────────────────────────────────────────────────────────────────

function Loading() {
  return (
    <div style={{ textAlign: "center", padding: 30, color: "#6b7280", fontSize: 14 }}>
      ⏳ Caricamento dal portale…
    </div>
  );
}

// ─── Tab: Patente Posseduta ───────────────────────────────────────────────────

function TabPatente() {
  const [numeroPatente, setNumeroPatente] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");
  const [dati, setDati]     = useState(null);

  async function cerca() {
    if (!numeroPatente.trim()) return;
    setLoading(true); setError(""); setDati(null);
    try {
      const d = await apiFetch(`patente-posseduta?numeroPatente=${encodeURIComponent(numeroPatente.trim())}`);
      setDati(d);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <input
          type="text"
          placeholder="Numero patente (es. AA1234567B)"
          value={numeroPatente}
          onChange={(e) => setNumeroPatente(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && cerca()}
          style={{ flex: 1, padding: "9px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14 }}
        />
        <button
          onClick={cerca} disabled={loading}
          style={{ padding: "9px 20px", background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}
        >
          🔍 Cerca
        </button>
      </div>
      <ErrorBox msg={error} />
      {loading && <Loading />}
      {dati && !loading && (
        <div style={{ background: "#f9fafb", borderRadius: 8, padding: 16, fontSize: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 20px" }}>
            {[
              ["Numero Patente",  dati.numero_patente],
              ["Tipo",           dati.tipo_patente],
              ["Data Rilascio",  dati.data_rilascio],
              ["Data Scadenza",  dati.data_scadenza],
              ["Ufficio Rilascio", dati.ufficio_rilascio],
              ["Provincia",      dati.provincia_rilascio],
            ].map(([label, value]) => (
              <div key={label}>
                <span style={{ color: "#6b7280", fontSize: 12 }}>{label}</span><br />
                <strong>{value || "–"}</strong>
              </div>
            ))}
          </div>
          {dati.categorie?.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Categorie abilitate</div>
              <ResultTable
                columns={[
                  { key: "categoria",        label: "Categoria" },
                  { key: "data_abilitazione",label: "Data abilitazione" },
                  { key: "data_scadenza",    label: "Scadenza" },
                ]}
                rows={dati.categorie}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Esiti Esami Svolti ──────────────────────────────────────────────────

function TabEsamiSvolti() {
  const [tipo, setTipo]     = useState("quiz");
  const [dal, setDal]       = useState(daysAgo(30));
  const [al, setAl]         = useState(todayISO());
  const [withCand, setWithCand] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [sessioni, setSessioni] = useState([]);
  const [expanded, setExpanded] = useState(null);
  // Stato salvataggio per indice sessione: { [i]: "idle" | "saving" | "ok" | "err" }
  const [saveState, setSaveState] = useState({});

  async function cerca() {
    setLoading(true); setError(""); setSessioni([]); setSaveState({});
    try {
      const q = new URLSearchParams({ tipo, dataInizio: dal, dataFine: al, withCandidati: "1" });
      const d = await apiFetch(`esami-svolti?${q}`);
      setSessioni(Array.isArray(d) ? d : []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function salvaSessione(s, i) {
    if (!s.candidati?.length) return;
    setSaveState((prev) => ({ ...prev, [i]: "saving" }));
    try {
      const res = await fetch(`${apiBase()}/api/portal-sync/salva-esiti-esame`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ sessione: { ...s, tipo }, candidati: s.candidati }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSaveState((prev) => ({ ...prev, [i]: `ok:${data.salvati ?? s.candidati.length}` }));
    } catch (e) {
      setSaveState((prev) => ({ ...prev, [i]: `err:${e.message}` }));
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)}
          style={{ padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 14 }}>
          <option value="quiz">Quiz (teoria)</option>
          <option value="guida">Guida (pratica)</option>
          <option value="scritto">Scritto</option>
        </select>
        <input type="date" value={dal} onChange={(e) => setDal(e.target.value)}
          style={{ padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 14 }} />
        <span style={{ fontSize: 13, color: "#6b7280" }}>→</span>
        <input type="date" value={al} onChange={(e) => setAl(e.target.value)}
          style={{ padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 14 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13 }}>
          <input type="checkbox" checked={withCand} onChange={(e) => setWithCand(e.target.checked)} />
          Con candidati
        </label>
        <button onClick={cerca} disabled={loading}
          style={{ padding: "8px 18px", background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 7, fontWeight: 700, cursor: "pointer" }}>
          🔍 Cerca
        </button>
      </div>
      <ErrorBox msg={error} />
      {loading && <Loading />}
      {!loading && sessioni.length === 0 && !error && <div style={{ color: "#9ca3af", fontSize: 13, padding: 10 }}>Nessun verbale trovato</div>}
      {sessioni.map((s, i) => {
        const st = saveState[i] || "idle";
        const isSaving = st === "saving";
        const isOk = st.startsWith("ok:");
        const isErr = st.startsWith("err:");
        const salvati = isOk ? st.split(":")[1] : null;
        const errMsg  = isErr ? st.slice(4) : null;
        return (
          <div key={i} style={{ border: "1px solid #e5e7eb", borderRadius: 8, marginBottom: 8, overflow: "hidden" }}>
            <div
              style={{ padding: "10px 14px", background: "#f9fafb", display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <div style={{ cursor: "pointer", flex: 1 }} onClick={() => setExpanded(expanded === i ? null : i)}>
                <strong>{s.data_verbale || s.n_verbale}</strong>
                <span style={{ marginLeft: 12, color: "#6b7280", fontSize: 12 }}>{s.descrizione}</span>
                <span style={{ marginLeft: 12, color: "#374151", fontSize: 12 }}>— {s.localita}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "#6b7280" }}>{s.cand_pren} candidati</span>
                {/* Punto 11 — Bottone Salva su Supabase */}
                {s.candidati?.length > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); salvaSessione(s, i); }}
                    disabled={isSaving || isOk}
                    title="Salva esiti su Supabase (tabella esiti_esami)"
                    style={{
                      padding: "3px 10px", fontSize: 12, fontWeight: 600, cursor: isSaving || isOk ? "default" : "pointer",
                      background: isOk ? "#dcfce7" : isErr ? "#fee2e2" : "#f0fdf4",
                      color: isOk ? "#15803d" : isErr ? "#dc2626" : "#166534",
                      border: `1px solid ${isOk ? "#86efac" : isErr ? "#fca5a5" : "#86efac"}`,
                      borderRadius: 6, opacity: isSaving ? 0.7 : 1,
                    }}
                  >
                    {isSaving ? "⏳ Salvataggio…" : isOk ? `✅ Salvati ${salvati}` : isErr ? `❌ ${errMsg}` : "💾 Salva su Supabase"}
                  </button>
                )}
                <span style={{ cursor: "pointer" }} onClick={() => setExpanded(expanded === i ? null : i)}>{expanded === i ? "▲" : "▼"}</span>
              </div>
            </div>
            {expanded === i && s.candidati?.length > 0 && (
              <ResultTable
                columns={[
                  { key: "marca_operativa", label: "Marca Op." },
                  { key: "cognome",         label: "Cognome" },
                  { key: "nome",            label: "Nome" },
                  { key: "abilitazione",    label: "Abilit." },
                  { key: "esito_esame",     label: "Esito",
                    render: (r) => (
                      <span style={{
                        color: /IDONEO|PASS/i.test(r.esito_esame) ? "#16a34a" : /NON/i.test(r.esito_esame) ? "#dc2626" : "#374151",
                        fontWeight: 700,
                      }}>
                        {r.esito_esame || "–"}
                      </span>
                    )
                  },
                  { key: "stato_presente",  label: "Presenza" },
                ]}
                rows={s.candidati}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Tab: Esami Candidato ─────────────────────────────────────────────────────

function TabEsamiCandidato() {
  const [cf, setCf]       = useState("");
  const [cognome, setCognome] = useState("");
  const [tipo, setTipo]   = useState("SGOS");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [esami, setEsami] = useState([]);

  async function cerca() {
    setLoading(true); setError(""); setEsami([]);
    try {
      const q = new URLSearchParams({ cf, cognome, tipo });
      const d = await apiFetch(`esami-candidato?${q}`);
      setEsami(Array.isArray(d) ? d : []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        <input type="text" placeholder="Codice fiscale" value={cf} onChange={(e) => setCf(e.target.value)}
          style={{ width: 180, padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 14 }} />
        <input type="text" placeholder="Cognome" value={cognome} onChange={(e) => setCognome(e.target.value)}
          style={{ width: 150, padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 14 }} />
        <select value={tipo} onChange={(e) => setTipo(e.target.value)}
          style={{ padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 14 }}>
          <option value="SQI">Quiz (SQI)</option>
          <option value="SGOS">Guida/Orale (SGOS)</option>
          <option value="SCQC">CQC (SCQC)</option>
          <option value="SQA">Approvate (SQA)</option>
        </select>
        <button onClick={cerca} disabled={loading}
          style={{ padding: "8px 18px", background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 7, fontWeight: 700, cursor: "pointer" }}>
          🔍 Cerca
        </button>
      </div>
      <ErrorBox msg={error} />
      {loading && <Loading />}
      <ResultTable
        columns={[
          { key: "data_esame",     label: "Data" },
          { key: "cognome",        label: "Cognome" },
          { key: "nome",           label: "Nome" },
          { key: "marca_operativa",label: "Marca Op." },
          { key: "descrizione",    label: "Descrizione" },
          { key: "localita",       label: "Sede" },
          { key: "stato",          label: "Stato" },
        ]}
        rows={esami}
        emptyMsg="Inserire codice fiscale o cognome e cliccare Cerca"
      />
    </div>
  );
}

// ─── Tab: Rinnovi Attivi ──────────────────────────────────────────────────────

function TabRinnovi() {
  const [dal, setDal]   = useState(daysAgo(30));
  const [al, setAl]     = useState(todayISO());
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [rinnovi, setRinnovi] = useState([]);
  const [expanded, setExpanded] = useState(null);

  async function cerca() {
    setLoading(true); setError(""); setRinnovi([]);
    try {
      const q = new URLSearchParams({ dataInizio: dal, dataFine: al });
      const d = await apiFetch(`rinnovi-attivi?${q}`);
      setRinnovi(Array.isArray(d) ? d : []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <input type="date" value={dal} onChange={(e) => setDal(e.target.value)}
          style={{ padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 14 }} />
        <span style={{ color: "#6b7280" }}>→</span>
        <input type="date" value={al} onChange={(e) => setAl(e.target.value)}
          style={{ padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 14 }} />
        <button onClick={cerca} disabled={loading}
          style={{ padding: "8px 18px", background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 7, fontWeight: 700, cursor: "pointer" }}>
          🔍 Cerca
        </button>
      </div>
      <ErrorBox msg={error} />
      {loading && <Loading />}
      {rinnovi.map((r, i) => (
        <div key={i} style={{ border: "1px solid #e5e7eb", borderRadius: 8, marginBottom: 6, overflow: "hidden" }}>
          <div onClick={() => setExpanded(expanded === i ? null : i)}
            style={{ padding: "10px 14px", cursor: "pointer", background: "#f9fafb", display: "flex", justifyContent: "space-between" }}>
            <strong>{r.cognome} {r.nome}</strong>
            <span style={{ fontSize: 12, color: "#6b7280" }}>
              {r.marca_operativa} — {r.patente} — {r.data_inserimento}
            </span>
          </div>
          {expanded === i && r.dettaglio && (
            <div style={{ padding: "10px 14px", fontSize: 13, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>
              {Object.entries(r.dettaglio).filter(([, v]) => v).map(([k, v]) => (
                <div key={k}>
                  <span style={{ color: "#6b7280", textTransform: "capitalize" }}>{k.replace(/_/g, " ")}: </span>
                  <strong>{v}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {!loading && rinnovi.length === 0 && !error && (
        <div style={{ color: "#9ca3af", fontSize: 13, padding: 10 }}>Nessun rinnovo trovato nel periodo</div>
      )}
    </div>
  );
}

// ─── Tab: Ricevuta Sostitutiva ────────────────────────────────────────────────

function TabRicevuta() {
  const [cf, setCf]         = useState("");
  const [cognome, setCognome] = useState("");
  const [patente, setPatente] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [ricevute, setRicevute] = useState([]);

  // Generazione nuova ricevuta
  const today = new Date().toLocaleDateString("it-IT");
  const [genForm, setGenForm] = useState({
    cf: "", cognome: "", nome: "", numeroPatente: "",
    tipoDocumento: "F", dataRilascio: today,
  });
  const [genBusy, setGenBusy] = useState(false);
  const [genResult, setGenResult] = useState(null);
  const [genErr, setGenErr]   = useState("");

  async function cerca() {
    setLoading(true); setError(""); setRicevute([]);
    try {
      const q = new URLSearchParams({ cf, cognome, numeroPatente: patente });
      const d = await apiFetch(`ricevuta-sostitutiva?${q}`);
      setRicevute(Array.isArray(d) ? d : []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function genera() {
    if (!genForm.cf && !genForm.cognome) { setGenErr("CF o cognome obbligatorio"); return; }
    setGenBusy(true); setGenErr(""); setGenResult(null);
    try {
      const tok = typeof window !== "undefined" ? localStorage.getItem("autoscuola_token") : null;
      const res = await fetch(`${apiBase()}/api/portal-sync/ricevuta-sostitutiva`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        },
        body: JSON.stringify(genForm),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      setGenResult(data);
    } catch (e) { setGenErr(e.message); }
    finally { setGenBusy(false); }
  }

  return (
    <div>
      {/* Ricerca */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <input type="text" placeholder="Codice fiscale" value={cf} onChange={(e) => setCf(e.target.value)}
          style={{ width: 180, padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 14 }} />
        <input type="text" placeholder="Cognome" value={cognome} onChange={(e) => setCognome(e.target.value)}
          style={{ width: 150, padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 14 }} />
        <input type="text" placeholder="Numero patente" value={patente} onChange={(e) => setPatente(e.target.value)}
          style={{ width: 160, padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 14 }} />
        <button onClick={cerca} disabled={loading}
          style={{ padding: "8px 18px", background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 7, fontWeight: 700, cursor: "pointer" }}>
          🔍 Cerca
        </button>
      </div>
      <ErrorBox msg={error} />
      {loading && <Loading />}
      <ResultTable
        columns={[
          { key: "numero_ricevuta", label: "N° Ricevuta" },
          { key: "cognome",         label: "Cognome" },
          { key: "nome",            label: "Nome" },
          { key: "data_rilascio",   label: "Data Rilascio" },
          { key: "data_scadenza",   label: "Scadenza" },
          { key: "tipo_documento",  label: "Tipo" },
        ]}
        rows={ricevute}
        emptyMsg="Inserire dati e cliccare Cerca"
      />

      {/* Generazione nuova ricevuta */}
      <div style={{
        marginTop: 24, padding: "16px 18px",
        border: "1px solid #e0f2fe", borderRadius: 10, background: "#f0f9ff",
      }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12, color: "#0369a1" }}>
          ➕ Genera Nuova Ricevuta Sostitutiva
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
          {[
            { key: "cf",            label: "Codice Fiscale", type: "text" },
            { key: "cognome",       label: "Cognome *",      type: "text" },
            { key: "nome",          label: "Nome",           type: "text" },
            { key: "numeroPatente", label: "N° Patente / F.R.", type: "text" },
            { key: "dataRilascio",  label: "Data rilascio (gg/mm/aaaa)", type: "text" },
          ].map(({ key, label, type }) => (
            <div key={key}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 3, color: "#374151" }}>{label}</label>
              <input
                type={type}
                value={genForm[key]}
                onChange={(e) => setGenForm((p) => ({ ...p, [key]: e.target.value }))}
                style={{ width: "100%", padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, boxSizing: "border-box" }}
              />
            </div>
          ))}
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 3, color: "#374151" }}>Tipo documento</label>
            <select
              value={genForm.tipoDocumento}
              onChange={(e) => setGenForm((p) => ({ ...p, tipoDocumento: e.target.value }))}
              style={{ width: "100%", padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, boxSizing: "border-box", background: "#fff" }}
            >
              <option value="F">F – Foglio Rosa</option>
              <option value="P">P – Patente</option>
            </select>
          </div>
        </div>
        {genErr && <ErrorBox msg={genErr} />}
        {genResult && (
          <div style={{ marginBottom: 10, padding: "8px 12px", background: genResult.success ? "#f0fdf4" : "#fef2f2", border: `1px solid ${genResult.success ? "#bbf7d0" : "#fecaca"}`, borderRadius: 7, fontSize: 13 }}>
            {genResult.success
              ? `✅ ${genResult.messaggio}${genResult.numero_ricevuta ? ` — N° ${genResult.numero_ricevuta}` : ""}`
              : `❌ ${genResult.messaggio}`}
          </div>
        )}
        <button
          onClick={genera}
          disabled={genBusy}
          style={{ padding: "8px 20px", background: "#0369a1", color: "#fff", border: "none", borderRadius: 7, fontWeight: 700, fontSize: 14, cursor: genBusy ? "not-allowed" : "pointer", opacity: genBusy ? 0.7 : 1 }}
        >
          {genBusy ? "Generazione in corso…" : "📄 Genera Ricevuta"}
        </button>
      </div>
    </div>
  );
}

// ─── Tab: TT2112 ─────────────────────────────────────────────────────────────

function TabTT2112() {
  const [protocollo, setProtocollo] = useState("");
  const [prg, setPrg]               = useState("");
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");
  const [risultati, setRisultati]   = useState([]);

  async function cerca() {
    setLoading(true); setError(""); setRisultati([]);
    try {
      const q = new URLSearchParams({ protocollo, prgRicCerMed: prg });
      const d = await apiFetch(`certificato-medico?${q}`);
      setRisultati(Array.isArray(d) ? d : []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <input type="text" placeholder="Protocollo certificato" value={protocollo}
          onChange={(e) => setProtocollo(e.target.value)}
          style={{ width: 220, padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 14 }} />
        <input type="text" placeholder="Progressivo ricerca" value={prg}
          onChange={(e) => setPrg(e.target.value)}
          style={{ width: 180, padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 14 }} />
        <button onClick={cerca} disabled={loading}
          style={{ padding: "8px 18px", background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 7, fontWeight: 700, cursor: "pointer" }}>
          🔍 Cerca
        </button>
      </div>
      <ErrorBox msg={error} />
      {loading && <Loading />}
      <ResultTable
        columns={[
          { key: "progressivo",   label: "Progressivo" },
          { key: "protocollo",    label: "Protocollo" },
          { key: "cognome",       label: "Cognome" },
          { key: "nome",          label: "Nome" },
          { key: "codice_fiscale",label: "Codice Fiscale" },
          { key: "data_visita",   label: "Data Visita" },
          { key: "medico",        label: "Medico" },
          { key: "idoneita",      label: "Idoneità" },
        ]}
        rows={risultati}
        emptyMsg="Inserire protocollo o progressivo e cliccare Cerca"
      />
    </div>
  );
}

// ─── Tab: Sync Candidato ──────────────────────────────────────────────────────

function TabSync() {
  const [cf, setCf]       = useState("");
  const [patente, setPatente] = useState("");
  const [cognome, setCognome] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [dati, setDati]       = useState(null);

  async function eseguiSync() {
    setLoading(true); setError(""); setDati(null);
    try {
      const q = new URLSearchParams({ cf, numeroPatente: patente, cognome });
      const d = await apiFetch(`sync-candidato?${q}`);
      setDati(d);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 12px" }}>
        Recupera tutti i dati disponibili sul portale per un candidato: dati patente, ricevuta sostitutiva, dati form medico.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <input type="text" placeholder="Codice fiscale" value={cf} onChange={(e) => setCf(e.target.value)}
          style={{ width: 200, padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 14 }} />
        <input type="text" placeholder="Numero patente" value={patente} onChange={(e) => setPatente(e.target.value)}
          style={{ width: 180, padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 14 }} />
        <input type="text" placeholder="Cognome" value={cognome} onChange={(e) => setCognome(e.target.value)}
          style={{ width: 150, padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 14 }} />
        <button onClick={eseguiSync} disabled={loading}
          style={{ padding: "8px 18px", background: "#8b5cf6", color: "#fff", border: "none", borderRadius: 7, fontWeight: 700, cursor: "pointer" }}>
          🔁 Sync
        </button>
      </div>
      <ErrorBox msg={error} />
      {loading && <Loading />}
      {dati && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 14 }}>
          {dati.patente && (
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>🪪 Dati Patente</div>
              <div><strong>Numero:</strong> {dati.patente.numero_patente || "–"}</div>
              <div><strong>Rilascio:</strong> {dati.patente.data_rilascio || "–"} — <strong>Scadenza:</strong> {dati.patente.data_scadenza || "–"}</div>
              <div><strong>Ufficio:</strong> {dati.patente.ufficio_rilascio || "–"}</div>
            </div>
          )}
          {dati.ricevute?.length > 0 && (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>📄 Ricevute Sostitutive</div>
              <ResultTable
                columns={[
                  { key: "numero_ricevuta", label: "N° Ricevuta" },
                  { key: "data_rilascio",   label: "Rilascio" },
                  { key: "data_scadenza",   label: "Scadenza" },
                  { key: "tipo_documento",  label: "Tipo" },
                ]}
                rows={dati.ricevute}
              />
            </div>
          )}
          {dati.datiForm && Object.keys(dati.datiForm).filter((k) => dati.datiForm[k]).length > 0 && (
            <div style={{ background: "#fefce8", border: "1px solid #fef08a", borderRadius: 8, padding: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>⚕️ Dati Medico</div>
              {Object.entries(dati.datiForm).filter(([, v]) => v).map(([k, v]) => (
                <div key={k}><strong>{k.replace(/_/g, " ")}:</strong> {v}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Allievi Prenotati ───────────────────────────────────────────────────

function TabAllievi() {
  const [tipo, setTipo]         = useState("SQI");
  const [autoscuola, setAutoscuola] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [allievi, setAllievi]   = useState([]);

  async function carica() {
    setLoading(true); setError(""); setAllievi([]);
    try {
      const q = new URLSearchParams({ tipo, codiceAutoscuola: autoscuola });
      const d = await apiFetch(`allievi-prenotati?${q}`);
      setAllievi(Array.isArray(d) ? d : []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)}
          style={{ padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 14 }}>
          <option value="SQI">Quiz (SQI)</option>
          <option value="SGOS">Guida/Orale (SGOS)</option>
          <option value="SQA">Approvate (SQA)</option>
          <option value="SCQC">CQC (SCQC)</option>
        </select>
        <input type="text" placeholder="Codice autoscuola (es. 0674)" value={autoscuola}
          onChange={(e) => setAutoscuola(e.target.value)}
          style={{ width: 180, padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 14 }} />
        <button onClick={carica} disabled={loading}
          style={{ padding: "8px 18px", background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 7, fontWeight: 700, cursor: "pointer" }}>
          📥 Carica
        </button>
      </div>
      <ErrorBox msg={error} />
      {loading && <Loading />}
      <ResultTable
        columns={[
          { key: "cognome",        label: "Cognome" },
          { key: "nome",           label: "Nome" },
          { key: "marca_operativa",label: "Marca Op." },
          { key: "sessione_data",  label: "Data sessione" },
          { key: "stato",          label: "Stato" },
          { key: "localita",       label: "Sede" },
        ]}
        rows={allievi}
        emptyMsg="Selezionare il tipo sessione e cliccare Carica"
      />
    </div>
  );
}

// ─── Tab: Anomalie portale ────────────────────────────────────────────────────

function TabAnomalie() {
  const [dal, setDal]       = useState(daysAgo(90));
  const [al, setAl]         = useState(todayISO());
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");
  const [anomalie, setAnomalie] = useState([]);

  async function cerca() {
    setLoading(true); setError(""); setAnomalie([]);
    try {
      const q = new URLSearchParams({ dataInizio: dal, dataFine: al });
      const d = await apiFetch(`anomalie?${q}`);
      setAnomalie(Array.isArray(d.anomalie) ? d.anomalie : []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  const coloreBadge = (stato) => {
    if (!stato) return "#6b7280";
    const s = stato.toUpperCase();
    if (s.includes("BLOCCAT")) return "#dc2626";
    if (s.includes("ANOMAL"))  return "#d97706";
    return "#374151";
  };

  return (
    <div>
      {/* Intestazione */}
      <div style={{ marginBottom: 10, padding: "8px 12px", background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 8, fontSize: 13, color: "#92400e" }}>
        ⚠️ Mostra le pratiche bloccate o con anomalie sul Portale Automobilista (equivalente iPatente: Gestione Anomalie).
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        <label style={{ fontSize: 13, color: "#374151" }}>Dal</label>
        <input type="date" value={dal} onChange={(e) => setDal(e.target.value)}
          style={{ padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 14 }} />
        <label style={{ fontSize: 13, color: "#374151" }}>al</label>
        <input type="date" value={al} onChange={(e) => setAl(e.target.value)}
          style={{ padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 14 }} />
        <button onClick={cerca} disabled={loading}
          style={{ padding: "8px 18px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 7, fontWeight: 700, cursor: "pointer" }}>
          🔍 Cerca anomalie
        </button>
        {anomalie.length > 0 && (
          <span style={{ fontSize: 13, fontWeight: 700, color: "#dc2626" }}>
            {anomalie.length} anomali{anomalie.length === 1 ? "a" : "e"} trovat{anomalie.length === 1 ? "a" : "e"}
          </span>
        )}
      </div>
      <ErrorBox msg={error} />
      {loading && <Loading />}
      {!loading && anomalie.length === 0 && !error && (
        <div style={{ color: "#9ca3af", fontSize: 13, padding: 10 }}>
          Nessuna anomalia trovata nel periodo selezionato.
        </div>
      )}
      {anomalie.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#fee2e2", borderBottom: "2px solid #fca5a5" }}>
                {["Marca Op.", "Cognome", "Nome", "Tipo Richiesta", "Cod. Anomalia", "Descrizione Anomalia", "Data Ins.", "Stato"].map((h) => (
                  <th key={h} style={{ padding: "6px 10px", textAlign: "left", fontWeight: 700, color: "#991b1b", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {anomalie.map((a, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #fde8e8", background: i % 2 === 0 ? "#fff" : "#fef9f9" }}>
                  <td style={{ padding: "5px 10px", fontFamily: "monospace", fontWeight: 700 }}>{a.marca_operativa || "–"}</td>
                  <td style={{ padding: "5px 10px" }}>{a.cognome || "–"}</td>
                  <td style={{ padding: "5px 10px" }}>{a.nome || "–"}</td>
                  <td style={{ padding: "5px 10px" }}>{a.tipo_richiesta || "–"}</td>
                  <td style={{ padding: "5px 10px", fontFamily: "monospace", color: "#d97706", fontWeight: 700 }}>{a.codice_anomalia || "–"}</td>
                  <td style={{ padding: "5px 10px", maxWidth: 280, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{a.descrizione_anomalia || "–"}</td>
                  <td style={{ padding: "5px 10px", whiteSpace: "nowrap" }}>{a.data_inserimento || "–"}</td>
                  <td style={{ padding: "5px 10px" }}>
                    <span style={{ padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 700, background: "#fef3c7", color: coloreBadge(a.stato) }}>
                      {a.stato || "ANOMALIA"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const TAB_COMPONENTS = {
  "patente":        TabPatente,
  "esami-svolti":   TabEsamiSvolti,
  "esami-candidato":TabEsamiCandidato,
  "rinnovi":        TabRinnovi,
  "ricevuta":       TabRicevuta,
  "tt2112":         TabTT2112,
  "sync":           TabSync,
  "allievi":        TabAllievi,
  "anomalie":       TabAnomalie,
};

export default function PortalSync() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState("patente");

  useEffect(() => {
    checkSession().then((u) => {
      if (!u) { router.push("/login"); return; }
      setUser(u);
    });
  }, [router]);

  if (!user) return null;

  const TabContent = TAB_COMPONENTS[activeTab] || (() => null);

  return (
    <ModernAppShell user={user} onLogout={() => { logoutSession(); router.push("/login"); }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 16px 60px" }}>

        <div style={{ marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
            🌐 Lettura Dati — Portale Automobilista
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "#6b7280" }}>
            Leggi e sincronizza dati dal Portale dell&apos;Automobilista
          </p>
        </div>

        {/* Tab bar */}
        <div style={{
          display: "flex", gap: 4, flexWrap: "wrap",
          borderBottom: "2px solid #e5e7eb", marginBottom: 20,
        }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={{
                padding: "8px 14px",
                border: "none",
                background: "transparent",
                borderBottom: activeTab === t.key ? "3px solid #1d4ed8" : "3px solid transparent",
                color: activeTab === t.key ? "#1d4ed8" : "#6b7280",
                fontWeight: activeTab === t.key ? 700 : 500,
                fontSize: 13,
                cursor: "pointer",
                marginBottom: -2,
                whiteSpace: "nowrap",
              }}
              title={t.desc}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div>
          <TabContent />
        </div>
      </div>
    </ModernAppShell>
  );
}

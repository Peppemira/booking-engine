"use client";
/**
 * Guida Accompagnata (AA) — Punto 23
 * Foglio rosa: registrazione guide AA con validazione vincoli età.
 * - Candidato: min 17 anni
 * - Accompagnatore: min 25 anni, patente B da almeno 10 anni
 */

import { useState, useEffect, useCallback } from "react";

function getApiBase() {
  if (typeof window !== "undefined") {
    return window.location.hostname === "localhost"
      ? "http://localhost:3000/api"
      : "/api";
  }
  return "/api";
}

function authHeader() {
  const token = (typeof window !== "undefined")
    ? (localStorage.getItem("token") || sessionStorage.getItem("token") || "")
    : "";
  return { Authorization: `Bearer ${token}` };
}

function calcEta(dataNascita) {
  if (!dataNascita) return null;
  const oggi = new Date();
  const n = new Date(dataNascita);
  return Math.floor((oggi - n) / (1000 * 60 * 60 * 24 * 365.25));
}

function calcAnniPatente(dataPatente) {
  if (!dataPatente) return null;
  const oggi = new Date();
  return ((oggi - new Date(dataPatente)) / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1);
}

function stampaFoglioRosa(guida, autoscuola, warnings) {
  if (!guida) return;
  const c = guida.candidates || {};
  const fmt = (d) => d ? new Date(d).toLocaleDateString("it-IT") : "—";

  const warningHtml = warnings && warnings.length > 0
    ? `<div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:12px 16px;margin:16px 0">
        <strong style="color:#991b1b">⚠️ Avvisi requisiti:</strong>
        <ul style="margin:8px 0 0;padding-left:20px;color:#991b1b">${warnings.map(w => `<li>${w}</li>`).join("")}</ul>
      </div>` : "";

  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8"/>
  <title>Foglio Rosa AA — ${c.cognome || ""} ${c.nome || ""}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 30px; font-size: 13px; color: #222; }
    h1 { font-size: 18px; text-align: center; margin: 0 0 4px; }
    .sottotitolo { text-align: center; font-size: 12px; color: #6b7280; margin-bottom: 20px; }
    .header { text-align: center; border-bottom: 2px solid #1e40af; padding-bottom: 12px; margin-bottom: 20px; }
    .autoscuola { font-size: 14px; font-weight: 700; color: #1e40af; }
    .badge-aa { display: inline-block; background: #fbbf24; color: #78350f; padding: 3px 14px; border-radius: 20px; font-weight: 700; font-size: 14px; margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th { background: #1e40af; color: #fff; padding: 7px 10px; text-align: left; font-size: 12px; }
    td { padding: 7px 10px; border: 1px solid #e5e7eb; }
    td.label { background: #f9fafb; font-weight: 600; width: 35%; }
    .sezione { font-size: 13px; font-weight: 700; color: #1e40af; border-bottom: 1px solid #bfdbfe; padding-bottom: 4px; margin: 16px 0 8px; }
    .firma-box { margin-top: 30px; display: flex; gap: 30px; }
    .firma { flex: 1; border-top: 1px solid #6b7280; padding-top: 6px; text-align: center; font-size: 11px; color: #6b7280; }
    @media print { button { display: none; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="autoscuola">${autoscuola || "AUTOSCUOLA"}</div>
    <h1>FOGLIO ROSA — GUIDA ACCOMPAGNATA</h1>
    <div class="badge-aa">AA — Art. 122 C.d.S.</div>
    <div class="sottotitolo">Data guida: ${fmt(guida.data_guida)} | Foglio n. ${guida.foglio_rosa_numero || "—"}</div>
  </div>

  ${warningHtml}

  <div class="sezione">CANDIDATO</div>
  <table>
    <tr><td class="label">Cognome e Nome</td><td>${c.cognome || "—"} ${c.nome || ""}</td><td class="label">Codice Fiscale</td><td>${c.codice_fiscale || "—"}</td></tr>
    <tr><td class="label">Data di Nascita</td><td>${fmt(c.data_nascita)}</td><td class="label">Categoria Patente</td><td>${c.categoria_patente || "B"}</td></tr>
  </table>

  <div class="sezione">ACCOMPAGNATORE</div>
  <table>
    <tr><td class="label">Cognome e Nome</td><td>${guida.accompagnatore_cognome || "—"} ${guida.accompagnatore_nome || ""}</td></tr>
    <tr><td class="label">Data di Nascita</td><td>${fmt(guida.accompagnatore_data_nascita)}</td></tr>
    <tr><td class="label">N° Patente</td><td>${guida.accompagnatore_patente_n || "—"}</td><td class="label">Data rilascio patente</td><td>${fmt(guida.accompagnatore_patente_data)}</td></tr>
  </table>

  <div class="sezione">DETTAGLI SEDUTA</div>
  <table>
    <tr><td class="label">Data guida</td><td>${fmt(guida.data_guida)}</td><td class="label">Orario</td><td>${guida.ora_inizio || "—"} – ${guida.ora_fine || "—"}</td></tr>
    <tr><td class="label">Istruttore supervisore</td><td>${guida.istruttore || "—"}</td><td class="label">Km percorsi</td><td>${guida.km != null ? guida.km + " km" : "—"}</td></tr>
    <tr><td class="label">Percorso</td><td colspan="3">${guida.percorso || "—"}</td></tr>
    <tr><td class="label">Note</td><td colspan="3">${guida.note || "—"}</td></tr>
  </table>

  <div class="sezione">REQUISITI LEGALI (Art. 122 C.d.S.)</div>
  <table>
    <tr><td style="background:#f0fdf4;color:#166534">✅ Candidato deve avere almeno 17 anni</td></tr>
    <tr><td style="background:#f0fdf4;color:#166534">✅ Accompagnatore deve avere almeno 25 anni</td></tr>
    <tr><td style="background:#f0fdf4;color:#166534">✅ Accompagnatore deve possedere patente B da almeno 10 anni</td></tr>
    <tr><td style="background:#f0fdf4;color:#166534">✅ Il veicolo deve essere coperto da polizza assicurativa specifica per GA</td></tr>
  </table>

  <div class="firma-box">
    <div class="firma">Firma del Candidato</div>
    <div class="firma">Firma dell'Accompagnatore</div>
    <div class="firma">Timbro e Firma Autoscuola</div>
  </div>

  <script>window.print();</script>
</body>
</html>`;

  const w = window.open("", "_blank", "width=900,height=700");
  w.document.write(html);
  w.document.close();
}

const EMPTY = {
  candidate_id: "", data_guida: new Date().toISOString().slice(0, 10),
  ora_inizio: "", ora_fine: "", istruttore: "",
  percorso: "", km: "", note: "",
  accompagnatore_cognome: "", accompagnatore_nome: "",
  accompagnatore_data_nascita: "", accompagnatore_patente_n: "",
  accompagnatore_patente_data: "", foglio_rosa_numero: "",
};

function FormAA({ candidati, onSave, onCancel, busy, err }) {
  const [form, setForm] = useState({ ...EMPTY });

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  const etaCandidato = form.candidate_id
    ? calcEta(candidati.find(c => String(c.id) === String(form.candidate_id))?.data_nascita)
    : null;
  const etaAccomp = calcEta(form.accompagnatore_data_nascita);
  const anniPatente = calcAnniPatente(form.accompagnatore_patente_data);

  const warns = [];
  if (etaCandidato !== null && etaCandidato < 17) warns.push(`Candidato ha ${etaCandidato} anni (min. 17)`);
  if (etaAccomp !== null && etaAccomp < 25) warns.push(`Accompagnatore ha ${etaAccomp} anni (min. 25)`);
  if (anniPatente !== null && parseFloat(anniPatente) < 10) warns.push(`Patente accompagnatore da ${anniPatente} anni (min. 10)`);

  const inputStyle = { width: "100%", padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, boxSizing: "border-box" };
  const label = { display: "block", fontWeight: 600, fontSize: 13, color: "#374151", marginBottom: 3 };

  return (
    <form onSubmit={e => { e.preventDefault(); onSave({ ...form, tipo_guida: "AA" }); }} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {err && <div style={{ background: "#fee2e2", color: "#991b1b", padding: 10, borderRadius: 6 }}>{err}</div>}

      {warns.length > 0 && (
        <div style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 8, padding: "10px 14px" }}>
          <strong style={{ color: "#92400e" }}>⚠️ Avvisi requisiti:</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "#92400e", fontSize: 13 }}>
            {warns.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={label}>Candidato *</label>
          <select style={inputStyle} required value={form.candidate_id} onChange={e => set("candidate_id", e.target.value)}>
            <option value="">— seleziona candidato —</option>
            {candidati.map(c => {
              const eta = calcEta(c.data_nascita);
              return <option key={c.id} value={c.id}>{c.cognome} {c.nome}{eta ? ` (${eta}a)` : ""}</option>;
            })}
          </select>
          {etaCandidato !== null && (
            <span style={{ fontSize: 12, color: etaCandidato >= 17 ? "#166534" : "#991b1b" }}>
              {etaCandidato >= 17 ? "✅" : "❌"} Età: {etaCandidato} anni
            </span>
          )}
        </div>

        <div>
          <label style={label}>Data guida *</label>
          <input type="date" style={inputStyle} required value={form.data_guida} onChange={e => set("data_guida", e.target.value)} />
        </div>
        <div>
          <label style={label}>N° foglio rosa</label>
          <input style={inputStyle} value={form.foglio_rosa_numero} onChange={e => set("foglio_rosa_numero", e.target.value)} placeholder="es. FR-001" />
        </div>
        <div>
          <label style={label}>Ora inizio</label>
          <input type="time" style={inputStyle} value={form.ora_inizio} onChange={e => set("ora_inizio", e.target.value)} />
        </div>
        <div>
          <label style={label}>Ora fine</label>
          <input type="time" style={inputStyle} value={form.ora_fine} onChange={e => set("ora_fine", e.target.value)} />
        </div>
        <div>
          <label style={label}>Istruttore supervisore</label>
          <input style={inputStyle} value={form.istruttore} onChange={e => set("istruttore", e.target.value)} />
        </div>
        <div>
          <label style={label}>Km percorsi</label>
          <input type="number" step="0.1" style={inputStyle} value={form.km} onChange={e => set("km", e.target.value)} />
        </div>
      </div>

      <div style={{ background: "#fef9c3", border: "1px solid #fde68a", borderRadius: 8, padding: "14px 16px" }}>
        <div style={{ fontWeight: 700, color: "#78350f", marginBottom: 10, fontSize: 14 }}>👤 Dati Accompagnatore</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={label}>Cognome *</label>
            <input style={inputStyle} required value={form.accompagnatore_cognome} onChange={e => set("accompagnatore_cognome", e.target.value)} />
          </div>
          <div>
            <label style={label}>Nome *</label>
            <input style={inputStyle} required value={form.accompagnatore_nome} onChange={e => set("accompagnatore_nome", e.target.value)} />
          </div>
          <div>
            <label style={label}>Data di nascita *</label>
            <input type="date" style={inputStyle} required value={form.accompagnatore_data_nascita} onChange={e => set("accompagnatore_data_nascita", e.target.value)} />
            {etaAccomp !== null && (
              <span style={{ fontSize: 12, color: etaAccomp >= 25 ? "#166534" : "#991b1b" }}>
                {etaAccomp >= 25 ? "✅" : "❌"} Età: {etaAccomp} anni
              </span>
            )}
          </div>
          <div>
            <label style={label}>N° patente</label>
            <input style={inputStyle} value={form.accompagnatore_patente_n} onChange={e => set("accompagnatore_patente_n", e.target.value.toUpperCase())} />
          </div>
          <div>
            <label style={label}>Data rilascio patente</label>
            <input type="date" style={inputStyle} value={form.accompagnatore_patente_data} onChange={e => set("accompagnatore_patente_data", e.target.value)} />
            {anniPatente !== null && (
              <span style={{ fontSize: 12, color: parseFloat(anniPatente) >= 10 ? "#166534" : "#991b1b" }}>
                {parseFloat(anniPatente) >= 10 ? "✅" : "❌"} Anni patente: {anniPatente}
              </span>
            )}
          </div>
        </div>
      </div>

      <div>
        <label style={label}>Percorso</label>
        <input style={inputStyle} value={form.percorso} onChange={e => set("percorso", e.target.value)} placeholder="es. Via Roma → Piazza Garibaldi → SS1" />
      </div>
      <div>
        <label style={label}>Note</label>
        <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={form.note} onChange={e => set("note", e.target.value)} />
      </div>

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button type="button" onClick={onCancel} style={{ padding: "8px 22px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb", cursor: "pointer" }}>Annulla</button>
        <button type="submit" disabled={busy} style={{ padding: "8px 22px", borderRadius: 6, border: "none", background: busy ? "#93c5fd" : "#2563eb", color: "#fff", fontWeight: 600, cursor: busy ? "default" : "pointer" }}>
          {busy ? "Salvataggio…" : "💾 Salva seduta AA"}
        </button>
      </div>
    </form>
  );
}

export default function GuidaAccompagnataPage() {
  const [guide, setGuide]       = useState([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [err, setErr]           = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  const [formErr, setFormErr]   = useState("");
  const [candidati, setCandidati] = useState([]);
  const [user, setUser]         = useState(null);
  const [page, setPage]         = useState(0);
  const [foglioModal, setFoglioModal] = useState(null);
  const [foglioData, setFoglioData]   = useState(null);
  const [foglioLoading, setFoglioLoading] = useState(false);
  const LIMIT = 20;
  const apiBase = getApiBase();

  useEffect(() => {
    fetch(`${apiBase}/auth/me`, { headers: authHeader() })
      .then(r => r.ok ? r.json() : null).then(d => d && setUser(d)).catch(() => {});
    fetch(`${apiBase}/candidati`, { headers: authHeader() })
      .then(r => r.json()).then(d => setCandidati(Array.isArray(d) ? d : (d.data || []))).catch(() => {});
  }, [apiBase]);

  const load = useCallback(async (p = 0) => {
    setLoading(true); setErr("");
    try {
      const r = await fetch(`${apiBase}/guide/accompagnate?limit=${LIMIT}&offset=${p * LIMIT}`, { headers: authHeader() });
      if (!r.ok) throw new Error(await r.text());
      const json = await r.json();
      setGuide(json.data || []);
      setTotal(json.total || 0);
      setPage(p);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [apiBase]);

  useEffect(() => { load(0); }, [load]);

  async function handleSave(form) {
    setFormBusy(true); setFormErr("");
    try {
      const r = await fetch(`${apiBase}/guide`, {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error(await r.text());
      setShowForm(false);
      await load(0);
    } catch (e) { setFormErr(e.message); }
    finally { setFormBusy(false); }
  }

  async function apriFoglioRosa(guida) {
    setFoglioModal(guida);
    setFoglioLoading(true); setFoglioData(null);
    try {
      const r = await fetch(`${apiBase}/guide/${guida.id}/foglio-rosa`, { headers: authHeader() });
      if (!r.ok) throw new Error(await r.text());
      setFoglioData(await r.json());
    } catch (e) { alert("Errore: " + e.message); setFoglioModal(null); }
    finally { setFoglioLoading(false); }
  }

  const nomeAutoscuola = user?.nome_autoscuola || user?.ragione_sociale || "Autoscuola";

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#111827" }}>🟡 Guida Accompagnata (AA)</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>Art. 122 C.d.S. — Candidato min. 17 anni · Accompagnatore min. 25 anni e patente B da ≥10 anni</p>
        </div>
        <button
          onClick={() => { setFormErr(""); setShowForm(true); }}
          style={{ padding: "9px 20px", background: "#d97706", color: "#fff", border: "none", borderRadius: 7, fontWeight: 600, cursor: "pointer", fontSize: 14 }}
        >
          + Nuova seduta AA
        </button>
      </div>

      {err && <div style={{ background: "#fee2e2", color: "#991b1b", padding: 12, borderRadius: 8, marginBottom: 16 }}>❌ {err}</div>}

      {/* Form modale */}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 28, maxWidth: 680, width: "95%", maxHeight: "92vh", overflowY: "auto" }}>
            <h2 style={{ margin: "0 0 18px", fontSize: 18 }}>🟡 Nuova seduta Guida Accompagnata</h2>
            <FormAA candidati={candidati} onSave={handleSave} onCancel={() => setShowForm(false)} busy={formBusy} err={formErr} />
          </div>
        </div>
      )}

      {/* Modale foglio rosa */}
      {foglioModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1001 }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, maxWidth: 460, width: "92%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ margin: 0 }}>🟡 Foglio Rosa AA</h3>
              <button onClick={() => setFoglioModal(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}>✕</button>
            </div>
            {foglioLoading && <div style={{ textAlign: "center", padding: 20, color: "#6b7280" }}>Caricamento…</div>}
            {foglioData && (
              <>
                {foglioData.warnings && foglioData.warnings.length > 0 && (
                  <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", marginBottom: 14 }}>
                    <strong style={{ color: "#991b1b" }}>⚠️ Requisiti non soddisfatti:</strong>
                    <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "#991b1b", fontSize: 13 }}>
                      {foglioData.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}
                {(!foglioData.warnings || foglioData.warnings.length === 0) && (
                  <div style={{ background: "#dcfce7", border: "1px solid #86efac", borderRadius: 8, padding: "10px 14px", marginBottom: 14, color: "#166534", fontWeight: 600 }}>
                    ✅ Tutti i requisiti sono soddisfatti.
                  </div>
                )}
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button onClick={() => setFoglioModal(null)} style={{ padding: "8px 18px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb", cursor: "pointer" }}>Chiudi</button>
                  <button
                    onClick={() => stampaFoglioRosa(foglioData.guida, nomeAutoscuola, foglioData.warnings)}
                    style={{ padding: "8px 18px", borderRadius: 6, border: "none", background: "#d97706", color: "#fff", fontWeight: 600, cursor: "pointer" }}
                  >
                    🖨️ Stampa foglio rosa
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Tabella */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 50, color: "#6b7280" }}>Caricamento guide accompagnate…</div>
      ) : guide.length === 0 ? (
        <div style={{ textAlign: "center", padding: 50 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🟡</div>
          <div style={{ color: "#9ca3af", fontSize: 15 }}>Nessuna seduta di guida accompagnata registrata.</div>
          <button onClick={() => setShowForm(true)} style={{ marginTop: 16, padding: "9px 22px", background: "#d97706", color: "#fff", border: "none", borderRadius: 7, fontWeight: 600, cursor: "pointer" }}>
            + Registra la prima seduta AA
          </button>
        </div>
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ background: "#fef3c7", borderBottom: "2px solid #fbbf24" }}>
                  <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#78350f" }}>Data</th>
                  <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#78350f" }}>Candidato</th>
                  <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#78350f" }}>Accompagnatore</th>
                  <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#78350f" }}>Istruttore</th>
                  <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#78350f" }}>Km / Orario</th>
                  <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#78350f" }}>Foglio n°</th>
                  <th style={{ padding: "10px 12px", textAlign: "center", fontWeight: 600, color: "#78350f" }}>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {guide.map((g, i) => {
                  const cand = g.candidates;
                  const etaCand = cand?.data_nascita ? calcEta(cand.data_nascita) : null;
                  const etaAcc  = g.accompagnatore_data_nascita ? calcEta(g.accompagnatore_data_nascita) : null;
                  const anniP   = g.accompagnatore_patente_data ? calcAnniPatente(g.accompagnatore_patente_data) : null;
                  const ok = (etaCand === null || etaCand >= 17) && (etaAcc === null || etaAcc >= 25) && (anniP === null || parseFloat(anniP) >= 10);

                  return (
                    <tr key={g.id || i} style={{ borderBottom: "1px solid #f3f4f6", background: i % 2 === 0 ? "#fff" : "#fffbeb" }}>
                      <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                        {g.data_guida || "—"}
                        {!ok && <span title="Requisiti non soddisfatti" style={{ marginLeft: 4 }}>⚠️</span>}
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        <div style={{ fontWeight: 600 }}>{cand ? `${cand.cognome} ${cand.nome}` : g.candidate_id || "—"}</div>
                        {etaCand !== null && <div style={{ fontSize: 11, color: etaCand >= 17 ? "#166534" : "#991b1b" }}>{etaCand >= 17 ? "✅" : "❌"} {etaCand} anni</div>}
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        <div>{g.accompagnatore_cognome ? `${g.accompagnatore_cognome} ${g.accompagnatore_nome || ""}` : "—"}</div>
                        {etaAcc !== null && <div style={{ fontSize: 11, color: etaAcc >= 25 ? "#166534" : "#991b1b" }}>{etaAcc >= 25 ? "✅" : "❌"} {etaAcc}a</div>}
                        {anniP !== null && <div style={{ fontSize: 11, color: parseFloat(anniP) >= 10 ? "#166534" : "#991b1b" }}>Pat. {anniP}a {parseFloat(anniP) >= 10 ? "✅" : "❌"}</div>}
                      </td>
                      <td style={{ padding: "8px 12px", color: "#6b7280" }}>{g.istruttore || "—"}</td>
                      <td style={{ padding: "8px 12px" }}>
                        {g.km != null ? <div>{g.km} km</div> : null}
                        {g.ora_inizio ? <div style={{ fontSize: 12, color: "#6b7280" }}>{g.ora_inizio}–{g.ora_fine || "?"}</div> : null}
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        {g.foglio_rosa_numero
                          ? <span style={{ background: "#fef3c7", color: "#92400e", padding: "2px 8px", borderRadius: 9999, fontSize: 12, fontWeight: 600 }}>{g.foglio_rosa_numero}</span>
                          : <span style={{ color: "#9ca3af", fontSize: 12 }}>—</span>}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>
                        <button
                          onClick={() => apriFoglioRosa(g)}
                          style={{ padding: "5px 12px", borderRadius: 5, border: "1px solid #fbbf24", background: "#fef3c7", color: "#78350f", cursor: "pointer", fontSize: 13 }}
                        >
                          🟡 Foglio Rosa
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {total > LIMIT && (
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14 }}>
              <button onClick={() => load(page - 1)} disabled={page === 0 || loading} style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb", cursor: page === 0 ? "default" : "pointer" }}>← Prec</button>
              <span style={{ alignSelf: "center", fontSize: 13, color: "#6b7280" }}>Pag. {page + 1} / {Math.ceil(total / LIMIT)}</span>
              <button onClick={() => load(page + 1)} disabled={(page + 1) * LIMIT >= total || loading} style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb", cursor: (page + 1) * LIMIT >= total ? "default" : "pointer" }}>Succ →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

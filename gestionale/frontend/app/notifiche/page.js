"use client";
/**
 * Pagina Notifiche Candidati — Punto 21
 * Invio manuale, bulk, storico notifiche.
 */

import { useState, useEffect, useCallback } from "react";
import { getApiBase, authHeaders } from "../../lib/authClient";

function getApiURL() {
  const base = getApiBase();
  return base.endsWith("/api") ? base : `${base}/api`;
}

const ESITOCOLOR = {
  inviata: { bg: "#dcfce7", color: "#166534", label: "✅ Inviata" },
  errore:  { bg: "#fee2e2", color: "#991b1b", label: "❌ Errore" },
};

// ─── Modal invio singolo ────────────────────────────────────────────────────
function ModalInviaNotifica({ apiBase, candidati, preselected, onClose, onSuccess }) {
  const [templates, setTemplates]   = useState([]);
  const [templateKey, setTemplateKey] = useState("");
  const [candidatoId, setCandidatoId] = useState(preselected?.id || "");
  const [email, setEmail]           = useState(preselected?.email_contatto || preselected?.email || "");
  const [vars, setVars]             = useState({});
  const [note, setNote]             = useState("");
  const [busy, setBusy]             = useState(false);
  const [err, setErr]               = useState("");
  const [ok, setOk]                 = useState(false);

  useEffect(() => {
    fetch(`${apiBase}/notifiche/templates`, { headers: authHeaders() })
      .then(r => r.json()).then(setTemplates).catch(() => {});
  }, [apiBase]);

  function handleCandidatoChange(id) {
    setCandidatoId(id);
    const c = candidati.find(x => String(x.id) === String(id));
    if (c) setEmail(c.email_contatto || c.email || "");
  }

  async function handleSend(e) {
    e.preventDefault();
    if (!templateKey) return setErr("Seleziona un template");
    if (!email.trim()) return setErr("Email mancante");
    setBusy(true); setErr(""); setOk(false);
    try {
      const r = await fetch(`${apiBase}/notifiche/invia`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ candidato_id: candidatoId, email_destinatario: email.trim(), template_key: templateKey, vars, note }),
      });
      if (!r.ok) throw new Error(await r.text());
      setOk(true);
      onSuccess && setTimeout(onSuccess, 1200);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const inputStyle = { width: "100%", padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, boxSizing: "border-box" };
  const labelStyle = { display: "block", fontWeight: 600, fontSize: 13, color: "#374151", marginBottom: 3 };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 28, maxWidth: 540, width: "95%", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>📧 Invia Notifica</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>
        {ok && <div style={{ background: "#dcfce7", color: "#166534", padding: 12, borderRadius: 8, marginBottom: 14, fontWeight: 600 }}>✅ Notifica inviata!</div>}
        {err && <div style={{ background: "#fee2e2", color: "#991b1b", padding: 10, borderRadius: 6, marginBottom: 14 }}>❌ {err}</div>}
        <form onSubmit={handleSend} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={labelStyle}>Candidato</label>
            <select style={inputStyle} value={candidatoId} onChange={e => handleCandidatoChange(e.target.value)}>
              <option value="">— seleziona candidato —</option>
              {candidati.map(c => (
                <option key={c.id} value={c.id}>{c.cognome} {c.nome}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Email destinatario *</label>
            <input style={inputStyle} type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="candidato@email.it" />
          </div>
          <div>
            <label style={labelStyle}>Template *</label>
            <select style={inputStyle} value={templateKey} onChange={e => setTemplateKey(e.target.value)} required>
              <option value="">— seleziona template —</option>
              {templates.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          {templateKey === "messaggio_libero" && (
            <div>
              <label style={labelStyle}>Testo messaggio</label>
              <textarea
                style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
                value={vars.testo || ""}
                onChange={e => setVars(v => ({ ...v, testo: e.target.value }))}
                placeholder="Scrivi qui il tuo messaggio…"
              />
            </div>
          )}
          {(templateKey === "esame_prenotato" || templateKey === "esito_esame") && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={labelStyle}>Data esame</label>
                <input type="date" style={inputStyle} value={vars.data_esame || ""} onChange={e => setVars(v => ({ ...v, data_esame: e.target.value }))} />
              </div>
              {templateKey === "esame_prenotato" && (
                <div>
                  <label style={labelStyle}>Sede</label>
                  <input style={inputStyle} value={vars.sede || ""} onChange={e => setVars(v => ({ ...v, sede: e.target.value }))} />
                </div>
              )}
              {templateKey === "esito_esame" && (
                <div>
                  <label style={labelStyle}>Esito</label>
                  <select style={inputStyle} value={vars.esito || ""} onChange={e => setVars(v => ({ ...v, esito: e.target.value }))}>
                    <option value="">—</option>
                    <option value="idoneo">Idoneo ✅</option>
                    <option value="non idoneo">Non idoneo ❌</option>
                  </select>
                </div>
              )}
            </div>
          )}
          {templateKey === "scadenza_documento" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={labelStyle}>Tipo documento</label>
                <input style={inputStyle} value={vars.tipo_documento || ""} onChange={e => setVars(v => ({ ...v, tipo_documento: e.target.value }))} placeholder="es. Patente, CQC…" />
              </div>
              <div>
                <label style={labelStyle}>Data scadenza</label>
                <input type="date" style={inputStyle} value={vars.data_scadenza || ""} onChange={e => setVars(v => ({ ...v, data_scadenza: e.target.value }))} />
              </div>
            </div>
          )}
          {templateKey === "pagamento_ricevuto" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={labelStyle}>Importo (€)</label>
                <input type="number" step="0.01" style={inputStyle} value={vars.importo || ""} onChange={e => setVars(v => ({ ...v, importo: e.target.value }))} />
              </div>
              <div>
                <label style={labelStyle}>Causale</label>
                <input style={inputStyle} value={vars.causale || ""} onChange={e => setVars(v => ({ ...v, causale: e.target.value }))} />
              </div>
              <div>
                <label style={labelStyle}>Data pagamento</label>
                <input type="date" style={inputStyle} value={vars.data_pagamento || ""} onChange={e => setVars(v => ({ ...v, data_pagamento: e.target.value }))} />
              </div>
            </div>
          )}
          <div>
            <label style={labelStyle}>Note interne</label>
            <input style={inputStyle} value={note} onChange={e => setNote(e.target.value)} placeholder="Facoltativo — solo uso interno" />
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{ padding: "8px 22px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb", cursor: "pointer" }}>Annulla</button>
            <button type="submit" disabled={busy} style={{ padding: "8px 22px", borderRadius: 6, border: "none", background: busy ? "#93c5fd" : "#2563eb", color: "#fff", fontWeight: 600, cursor: busy ? "default" : "pointer" }}>
              {busy ? "Invio…" : "📧 Invia"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Pannello storico ────────────────────────────────────────────────────────
function PannelloStorico({ apiBase }) {
  const [storico, setStorico]   = useState([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(0);
  const [loading, setLoading]   = useState(false);
  const [err, setErr]           = useState("");
  const LIMIT = 25;

  const load = useCallback(async (p = 0) => {
    setLoading(true); setErr("");
    try {
      const r = await fetch(`${apiBase}/notifiche/storico-globale?limit=${LIMIT}&offset=${p * LIMIT}`, { headers: authHeaders() });
      if (!r.ok) throw new Error(await r.text());
      const json = await r.json();
      setStorico(json.data || []);
      setTotal(json.total || 0);
      setPage(p);
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [apiBase]);

  useEffect(() => { load(0); }, [load]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: "#6b7280" }}>{total} notifiche totali</span>
        <button onClick={() => load(page)} style={{ padding: "5px 14px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb", cursor: "pointer", fontSize: 13 }}>🔄 Aggiorna</button>
      </div>
      {err && <div style={{ background: "#fee2e2", color: "#991b1b", padding: 10, borderRadius: 6, marginBottom: 12 }}>❌ {err}</div>}
      {loading ? (
        <div style={{ textAlign: "center", padding: 30, color: "#6b7280" }}>Caricamento…</div>
      ) : storico.length === 0 ? (
        <div style={{ textAlign: "center", padding: 30, color: "#9ca3af" }}>Nessuna notifica inviata ancora.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                <th style={{ padding: "8px 12px", textAlign: "left" }}>Data</th>
                <th style={{ padding: "8px 12px", textAlign: "left" }}>Destinatario</th>
                <th style={{ padding: "8px 12px", textAlign: "left" }}>Tipo</th>
                <th style={{ padding: "8px 12px", textAlign: "left" }}>Oggetto</th>
                <th style={{ padding: "8px 12px", textAlign: "left" }}>Esito</th>
                <th style={{ padding: "8px 12px", textAlign: "left" }}>Note</th>
              </tr>
            </thead>
            <tbody>
              {storico.map((n, i) => {
                const esitoInfo = ESITOCOLOR[n.esito] || { bg: "#f3f4f6", color: "#374151", label: n.esito || "—" };
                return (
                  <tr key={n.id || i} style={{ borderBottom: "1px solid #f3f4f6", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <td style={{ padding: "7px 12px", whiteSpace: "nowrap" }}>
                      {n.created_at ? new Date(n.created_at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                    </td>
                    <td style={{ padding: "7px 12px" }}>{n.destinatario || "—"}</td>
                    <td style={{ padding: "7px 12px" }}>
                      <span style={{ background: "#ede9fe", color: "#4338ca", padding: "2px 8px", borderRadius: 9999, fontSize: 11, fontWeight: 600 }}>
                        {n.tipo || "—"}
                      </span>
                    </td>
                    <td style={{ padding: "7px 12px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.oggetto || "—"}</td>
                    <td style={{ padding: "7px 12px" }}>
                      <span style={{ background: esitoInfo.bg, color: esitoInfo.color, padding: "2px 8px", borderRadius: 9999, fontSize: 11, fontWeight: 600 }}>
                        {esitoInfo.label}
                      </span>
                      {n.errore && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 2 }}>{n.errore.slice(0, 60)}</div>}
                    </td>
                    <td style={{ padding: "7px 12px", color: "#6b7280", fontSize: 12 }}>{n.note || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {total > LIMIT && (
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14 }}>
          <button onClick={() => load(page - 1)} disabled={page === 0 || loading}
            style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb", cursor: page === 0 ? "default" : "pointer" }}>
            ← Prec
          </button>
          <span style={{ alignSelf: "center", fontSize: 13, color: "#6b7280" }}>Pag. {page + 1} / {Math.ceil(total / LIMIT)}</span>
          <button onClick={() => load(page + 1)} disabled={(page + 1) * LIMIT >= total || loading}
            style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb", cursor: (page + 1) * LIMIT >= total ? "default" : "pointer" }}>
            Succ →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────
export default function NotifichePage() {
  const [tab, setTab]             = useState("invia");
  const [candidati, setCandidati] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [refresh, setRefresh]     = useState(0);
  const apiBase = getApiURL();

  useEffect(() => {
    fetch(`${apiBase}/candidati`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => setCandidati(Array.isArray(d) ? d : (d.data || [])))
      .catch(() => {});
  }, [apiBase]);

  const TABS = [
    { key: "invia",   label: "📧 Invia Notifica" },
    { key: "storico", label: "📋 Storico" },
  ];

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#111827" }}>🔔 Notifiche Candidati</h1>
        <button
          onClick={() => setShowModal(true)}
          style={{ padding: "9px 20px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 7, fontWeight: 600, cursor: "pointer", fontSize: 14 }}
        >
          + Nuova Notifica
        </button>
      </div>

      {/* Info provider */}
      <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: "10px 16px", marginBottom: 20, fontSize: 13, color: "#0369a1" }}>
        💡 Provider email attivo: <strong>BREVO / SENDGRID / MAILGUN</strong> (configura via variabili <code>BREVO_API_KEY</code>, <code>SENDGRID_API_KEY</code> o <code>MAILGUN_API_KEY</code>+<code>MAILGUN_DOMAIN</code> nel file <code>.env</code> del backend).
        Se nessun provider è configurato, le notifiche vengono registrate nel log del server (modalità stub).
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: "2px solid #e5e7eb", marginBottom: 24 }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              padding: "10px 22px", border: "none", background: "none", cursor: "pointer",
              fontWeight: tab === t.key ? 700 : 400,
              color: tab === t.key ? "#2563eb" : "#6b7280",
              borderBottom: tab === t.key ? "3px solid #2563eb" : "3px solid transparent",
              fontSize: 14, marginBottom: -2,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "invia" && (
        <div>
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 24 }}>
            <h2 style={{ margin: "0 0 16px", fontSize: 16 }}>📤 Invio manuale</h2>
            <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 20px" }}>
              Seleziona un candidato dalla lista, scegli il template e compila i campi necessari.
              Usa il pulsante <strong>+ Nuova Notifica</strong> in alto a destra.
            </p>

            <h3 style={{ margin: "20px 0 12px", fontSize: 14, color: "#374151" }}>Template disponibili:</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
              {[
                { key: "esame_prenotato",   icon: "📅", label: "Esame prenotato",       desc: "Conferma prenotazione esame" },
                { key: "esito_esame",        icon: "📊", label: "Esito esame",            desc: "Idoneo o non idoneo" },
                { key: "scadenza_documento", icon: "⚠️", label: "Scadenza documento",    desc: "Promemoria scadenza" },
                { key: "pagamento_ricevuto", icon: "💰", label: "Pagamento ricevuto",    desc: "Conferma pagamento" },
                { key: "messaggio_libero",   icon: "✉️", label: "Messaggio libero",      desc: "Testo personalizzato" },
              ].map(t => (
                <div
                  key={t.key}
                  onClick={() => setShowModal(true)}
                  style={{
                    padding: 16, border: "1px solid #e5e7eb", borderRadius: 8, cursor: "pointer",
                    background: "#f9fafb", transition: "border-color 0.15s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "#2563eb"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "#e5e7eb"}
                >
                  <div style={{ fontSize: 24, marginBottom: 6 }}>{t.icon}</div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "#111827" }}>{t.label}</div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 3 }}>{t.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "storico" && (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 24 }}>
          <PannelloStorico key={refresh} apiBase={apiBase} />
        </div>
      )}

      {showModal && (
        <ModalInviaNotifica
          apiBase={apiBase}
          candidati={candidati}
          preselected={null}
          onClose={() => setShowModal(false)}
          onSuccess={() => { setShowModal(false); setRefresh(r => r + 1); setTab("storico"); }}
        />
      )}
    </div>
  );
}

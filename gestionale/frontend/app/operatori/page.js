"use client";
/**
 * Gestione Operatori per Sede — Punto 24
 * CRUD operatori con ruoli: admin | operatore | segreteria | istruttore
 */

import { useState, useEffect, useCallback } from "react";
import { getApiBase, authHeaders } from "../../lib/authClient";

function getApiURL() {
  const base = getApiBase();
  return base.endsWith("/api") ? base : `${base}/api`;
}

const RUOLI = [
  { key: "admin",      label: "👑 Admin",      desc: "Accesso completo, gestione operatori",    color: "#fef3c7", text: "#92400e" },
  { key: "operatore",  label: "🖥️ Operatore",  desc: "Gestione candidati, pagamenti, prenotazioni", color: "#dbeafe", text: "#1e40af" },
  { key: "segreteria", label: "📋 Segreteria",  desc: "Consultazione, agenda, prenotazioni",    color: "#d1fae5", text: "#065f46" },
  { key: "istruttore", label: "🚗 Istruttore",  desc: "Solo le proprie guide e candidati",      color: "#ede9fe", text: "#4338ca" },
];

function ruoloInfo(ruolo) {
  return RUOLI.find(r => r.key === ruolo) || { label: ruolo, color: "#f3f4f6", text: "#374151" };
}

const EMPTY_FORM = {
  cognome: "", nome: "", email: "", password: "", ruolo: "operatore", telefono: "", attivo: true,
};

function FormOperatore({ initial, onSave, onCancel, busy, err }) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...(initial || {}) });
  const isEdit = !!initial?.id;

  useEffect(() => { setForm({ ...EMPTY_FORM, ...(initial || {}) }); }, [initial]);
  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  const inputStyle = { width: "100%", padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, boxSizing: "border-box" };
  const label = { display: "block", fontWeight: 600, fontSize: 13, color: "#374151", marginBottom: 3 };

  return (
    <form onSubmit={e => { e.preventDefault(); onSave(form); }} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 20px" }}>
      {err && <div style={{ gridColumn: "1/-1", background: "#fee2e2", color: "#991b1b", padding: 10, borderRadius: 6 }}>❌ {err}</div>}
      <div>
        <label style={label}>Cognome *</label>
        <input style={inputStyle} required value={form.cognome} onChange={e => set("cognome", e.target.value)} />
      </div>
      <div>
        <label style={label}>Nome *</label>
        <input style={inputStyle} required value={form.nome} onChange={e => set("nome", e.target.value)} />
      </div>
      <div>
        <label style={label}>Email *</label>
        <input type="email" style={inputStyle} required value={form.email} onChange={e => set("email", e.target.value)} disabled={isEdit} />
        {isEdit && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>Email non modificabile</div>}
      </div>
      <div>
        <label style={label}>Telefono</label>
        <input style={inputStyle} value={form.telefono || ""} onChange={e => set("telefono", e.target.value)} />
      </div>
      <div>
        <label style={label}>{isEdit ? "Nuova password (lascia vuoto per non cambiare)" : "Password *"}</label>
        <input type="password" style={inputStyle} required={!isEdit} value={form.password || ""} onChange={e => set("password", e.target.value)} placeholder={isEdit ? "••••••••" : ""} />
      </div>
      <div>
        <label style={label}>Ruolo *</label>
        <select style={inputStyle} required value={form.ruolo} onChange={e => set("ruolo", e.target.value)}>
          {RUOLI.map(r => <option key={r.key} value={r.key}>{r.label} — {r.desc}</option>)}
        </select>
      </div>
      {isEdit && (
        <div style={{ gridColumn: "1/-1" }}>
          <label style={{ ...label, marginBottom: 0 }}>
            <input type="checkbox" checked={!!form.attivo} onChange={e => set("attivo", e.target.checked)} style={{ marginRight: 6 }} />
            Operatore attivo
          </label>
        </div>
      )}
      {/* Anteprima ruolo selezionato */}
      {form.ruolo && (
        <div style={{ gridColumn: "1/-1" }}>
          {(() => { const ri = ruoloInfo(form.ruolo); return (
            <div style={{ background: ri.color, color: ri.text, padding: "8px 14px", borderRadius: 8, fontSize: 13 }}>
              <strong>{ri.label}</strong> — {ri.desc}
            </div>
          ); })()}
        </div>
      )}
      <div style={{ gridColumn: "1/-1", display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
        <button type="button" onClick={onCancel} style={{ padding: "8px 22px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb", cursor: "pointer" }}>Annulla</button>
        <button type="submit" disabled={busy} style={{ padding: "8px 22px", borderRadius: 6, border: "none", background: busy ? "#93c5fd" : "#2563eb", color: "#fff", fontWeight: 600, cursor: busy ? "default" : "pointer" }}>
          {busy ? "Salvataggio…" : "💾 Salva"}
        </button>
      </div>
    </form>
  );
}

export default function OperatoriPage() {
  const [operatori, setOperatori]   = useState([]);
  const [total, setTotal]           = useState(0);
  const [loading, setLoading]       = useState(true);
  const [err, setErr]               = useState("");
  const [showForm, setShowForm]     = useState(false);
  const [editing, setEditing]       = useState(null);
  const [formBusy, setFormBusy]     = useState(false);
  const [formErr, setFormErr]       = useState("");
  const [filtroRuolo, setFiltroRuolo] = useState("tutti");
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [search, setSearch]         = useState("");
  const apiBase = getApiURL();

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const r = await fetch(`${apiBase}/operatori`, { headers: authHeaders() });
      if (!r.ok) throw new Error(await r.text());
      const json = await r.json();
      setOperatori(Array.isArray(json) ? json : (json.data || []));
      setTotal(json.total || 0);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [apiBase]);

  useEffect(() => { load(); }, [load]);

  async function handleSave(form) {
    setFormBusy(true); setFormErr("");
    try {
      const isEdit = !!editing?.id;
      const url    = isEdit ? `${apiBase}/operatori/${editing.id}` : `${apiBase}/operatori`;
      const method = isEdit ? "PUT" : "POST";
      // In modifica, se password è vuota non la mandiamo
      const body = { ...form };
      if (isEdit && !body.password) delete body.password;
      const r = await fetch(url, {
        method,
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      setShowForm(false); setEditing(null);
      await load();
    } catch (e) { setFormErr(e.message); }
    finally { setFormBusy(false); }
  }

  async function handleDelete(id) {
    try {
      const r = await fetch(`${apiBase}/operatori/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!r.ok) throw new Error(await r.text());
      setDeleteConfirm(null);
      await load();
    } catch (e) { alert("Errore: " + e.message); }
  }

  const filtered = operatori.filter(op => {
    const matchSearch = !search.trim() || `${op.cognome} ${op.nome} ${op.email}`.toLowerCase().includes(search.toLowerCase());
    const matchRuolo  = filtroRuolo === "tutti" || op.ruolo === filtroRuolo;
    return matchSearch && matchRuolo;
  });

  // Conteggi per ruolo
  const contatori = RUOLI.reduce((acc, r) => {
    acc[r.key] = operatori.filter(o => o.ruolo === r.key).length;
    return acc;
  }, {});

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#111827" }}>👥 Operatori per Sede</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>Gestione accessi e ruoli del personale della tua autoscuola</p>
        </div>
        <button
          onClick={() => { setEditing(null); setFormErr(""); setShowForm(true); }}
          style={{ padding: "9px 20px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 7, fontWeight: 600, cursor: "pointer", fontSize: 14 }}
        >
          + Nuovo Operatore
        </button>
      </div>

      {/* Riepilogo ruoli */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 20 }}>
        {RUOLI.map(r => (
          <div
            key={r.key}
            onClick={() => setFiltroRuolo(filtroRuolo === r.key ? "tutti" : r.key)}
            style={{
              background: r.color, color: r.text, padding: "14px 16px", borderRadius: 8, cursor: "pointer",
              border: filtroRuolo === r.key ? `2px solid ${r.text}` : "2px solid transparent",
              transition: "border-color 0.15s",
            }}
          >
            <div style={{ fontSize: 20, marginBottom: 4 }}>{r.label.split(" ")[0]}</div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{contatori[r.key] || 0}</div>
            <div style={{ fontSize: 12, marginTop: 2 }}>{r.label.split(" ").slice(1).join(" ")}</div>
          </div>
        ))}
      </div>

      {/* Filtri */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="🔍 Cerca per nome, cognome, email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: "8px 14px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, minWidth: 250 }}
        />
        <button
          onClick={() => setFiltroRuolo("tutti")}
          style={{ padding: "7px 16px", borderRadius: 6, border: filtroRuolo === "tutti" ? "2px solid #2563eb" : "1px solid #d1d5db", background: filtroRuolo === "tutti" ? "#dbeafe" : "#fff", color: filtroRuolo === "tutti" ? "#1e40af" : "#374151", fontWeight: filtroRuolo === "tutti" ? 600 : 400, cursor: "pointer", fontSize: 13 }}
        >
          Tutti
        </button>
        <span style={{ marginLeft: "auto", fontSize: 13, color: "#6b7280" }}>{filtered.length} operatori</span>
      </div>

      {err && <div style={{ background: "#fee2e2", color: "#991b1b", padding: 12, borderRadius: 8, marginBottom: 16 }}>❌ {err}</div>}

      {/* Form modale */}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 28, maxWidth: 640, width: "95%", maxHeight: "92vh", overflowY: "auto" }}>
            <h2 style={{ margin: "0 0 18px", fontSize: 18 }}>
              {editing?.id ? "✏️ Modifica Operatore" : "➕ Nuovo Operatore"}
            </h2>
            <FormOperatore initial={editing} onSave={handleSave} onCancel={() => { setShowForm(false); setEditing(null); }} busy={formBusy} err={formErr} />
          </div>
        </div>
      )}

      {/* Conferma eliminazione */}
      {deleteConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1001 }}>
          <div style={{ background: "#fff", borderRadius: 10, padding: 24, maxWidth: 380, width: "90%", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
            <p style={{ margin: "0 0 18px", fontSize: 15 }}>
              Eliminare l'operatore <strong>{deleteConfirm.cognome} {deleteConfirm.nome}</strong>?<br />
              <span style={{ fontSize: 12, color: "#6b7280" }}>{deleteConfirm.email}</span>
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ padding: "8px 22px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb", cursor: "pointer" }}>Annulla</button>
              <button onClick={() => handleDelete(deleteConfirm.id)} style={{ padding: "8px 22px", borderRadius: 6, border: "none", background: "#ef4444", color: "#fff", fontWeight: 600, cursor: "pointer" }}>Elimina</button>
            </div>
          </div>
        </div>
      )}

      {/* Tabella */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 50, color: "#6b7280" }}>Caricamento operatori…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 50 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>👥</div>
          <div style={{ color: "#9ca3af", fontSize: 15 }}>
            {operatori.length === 0 ? "Nessun operatore registrato. Crea il primo account!" : "Nessun risultato per i filtri selezionati."}
          </div>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600 }}>Operatore</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600 }}>Email</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600 }}>Ruolo</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600 }}>Ultimo accesso</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600 }}>Stato</th>
                <th style={{ padding: "10px 14px", textAlign: "center", fontWeight: 600 }}>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((op, i) => {
                const ri = ruoloInfo(op.ruolo);
                return (
                  <tr key={op.id} style={{ borderBottom: "1px solid #f3f4f6", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ fontWeight: 600, color: "#111827" }}>{op.cognome} {op.nome}</div>
                      {op.telefono && <div style={{ fontSize: 12, color: "#6b7280" }}>📞 {op.telefono}</div>}
                    </td>
                    <td style={{ padding: "10px 14px", color: "#374151" }}>{op.email}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ background: ri.color, color: ri.text, padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                        {ri.label}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 12, color: "#6b7280" }}>
                      {op.ultimo_accesso
                        ? new Date(op.ultimo_accesso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })
                        : "Mai"}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      {op.attivo !== false
                        ? <span style={{ background: "#dcfce7", color: "#166534", padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>● Attivo</span>
                        : <span style={{ background: "#f3f4f6", color: "#6b7280", padding: "3px 10px", borderRadius: 20, fontSize: 12 }}>○ Sospeso</span>}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "center", whiteSpace: "nowrap" }}>
                      <button
                        onClick={() => { setEditing(op); setFormErr(""); setShowForm(true); }}
                        style={{ marginRight: 6, padding: "5px 12px", borderRadius: 5, border: "1px solid #93c5fd", background: "#dbeafe", color: "#1e40af", cursor: "pointer", fontSize: 13 }}
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(op)}
                        style={{ padding: "5px 12px", borderRadius: 5, border: "1px solid #fca5a5", background: "#fee2e2", color: "#991b1b", cursor: "pointer", fontSize: 13 }}
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legenda permessi */}
      <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: "16px 20px", marginTop: 24 }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 14, color: "#0369a1" }}>ℹ️ Permessi per ruolo</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          {RUOLI.map(r => (
            <div key={r.key} style={{ background: r.color, color: r.text, padding: "10px 14px", borderRadius: 8 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{r.label}</div>
              <div style={{ fontSize: 12 }}>{r.desc}</div>
            </div>
          ))}
        </div>
        <p style={{ margin: "12px 0 0", fontSize: 12, color: "#0369a1" }}>
          💡 Il titolare dell'autoscuola (login principale) ha sempre accesso completo a prescindere dal ruolo.
          Gli operatori accedono tramite <strong>POST /api/operatori/login</strong> con email e password.
        </p>
      </div>
    </div>
  );
}

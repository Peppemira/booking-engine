"use client";
/**
 * Pagina Gestione Istruttori — Punto 20
 * CRUD istruttori con qualifiche, orari, tab guide assegnate.
 */

import { useState, useEffect, useCallback } from "react";
import { getApiBase, authHeaders } from "../../lib/authClient";

function getApiURL() {
  const base = getApiBase();
  return base.endsWith("/api") ? base : `${base}/api`;
}

const QUALIFICHE_OPTIONS = ["B", "A", "A1", "A2", "C", "D", "BE", "CE", "CQC", "ADR", "CAP"];

const EMPTY_FORM = {
  cognome: "",
  nome: "",
  codice_fiscale: "",
  data_nascita: "",
  email: "",
  telefono: "",
  qualifiche: [],
  data_abilitazione: "",
  numero_patente: "",
  orari_disponibilita: "",
  note: "",
  attivo: true,
};

function Badge({ label, color = "blue" }) {
  const colors = {
    blue: "background:#dbeafe;color:#1e40af",
    green: "background:#dcfce7;color:#166534",
    gray: "background:#f3f4f6;color:#374151",
    red: "background:#fee2e2;color:#991b1b",
  };
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 9999,
      fontSize: 11,
      fontWeight: 600,
      margin: "0 2px 2px 0",
      ...(Object.fromEntries((colors[color] || colors.gray).split(";").map(s => s.split(":"))))
    }}>
      {label}
    </span>
  );
}

function FormIstruttore({ initial, onSave, onCancel, busy }) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...(initial || {}) });

  useEffect(() => {
    setForm({ ...EMPTY_FORM, ...(initial || {}) });
  }, [initial]);

  function set(k, v) {
    setForm(f => ({ ...f, [k]: v }));
  }

  function toggleQualifica(q) {
    setForm(f => {
      const cur = Array.isArray(f.qualifiche) ? f.qualifiche : [];
      return { ...f, qualifiche: cur.includes(q) ? cur.filter(x => x !== q) : [...cur, q] };
    });
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSave(form);
  }

  const inputStyle = {
    width: "100%",
    padding: "7px 10px",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    fontSize: 14,
    boxSizing: "border-box",
  };

  const labelStyle = { fontWeight: 600, fontSize: 13, color: "#374151", marginBottom: 3, display: "block" };

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 20px" }}>
      <div>
        <label style={labelStyle}>Cognome *</label>
        <input style={inputStyle} required value={form.cognome} onChange={e => set("cognome", e.target.value)} />
      </div>
      <div>
        <label style={labelStyle}>Nome *</label>
        <input style={inputStyle} required value={form.nome} onChange={e => set("nome", e.target.value)} />
      </div>
      <div>
        <label style={labelStyle}>Codice Fiscale</label>
        <input style={inputStyle} value={form.codice_fiscale || ""} onChange={e => set("codice_fiscale", e.target.value.toUpperCase())} maxLength={16} />
      </div>
      <div>
        <label style={labelStyle}>Data di nascita</label>
        <input type="date" style={inputStyle} value={form.data_nascita || ""} onChange={e => set("data_nascita", e.target.value)} />
      </div>
      <div>
        <label style={labelStyle}>Email</label>
        <input type="email" style={inputStyle} value={form.email || ""} onChange={e => set("email", e.target.value)} />
      </div>
      <div>
        <label style={labelStyle}>Telefono</label>
        <input style={inputStyle} value={form.telefono || ""} onChange={e => set("telefono", e.target.value)} />
      </div>
      <div>
        <label style={labelStyle}>N° Patente</label>
        <input style={inputStyle} value={form.numero_patente || ""} onChange={e => set("numero_patente", e.target.value.toUpperCase())} />
      </div>
      <div>
        <label style={labelStyle}>Data Abilitazione</label>
        <input type="date" style={inputStyle} value={form.data_abilitazione || ""} onChange={e => set("data_abilitazione", e.target.value)} />
      </div>

      <div style={{ gridColumn: "1 / -1" }}>
        <label style={labelStyle}>Qualifiche abilitate</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {QUALIFICHE_OPTIONS.map(q => {
            const cur = Array.isArray(form.qualifiche) ? form.qualifiche : [];
            const sel = cur.includes(q);
            return (
              <button
                key={q}
                type="button"
                onClick={() => toggleQualifica(q)}
                style={{
                  padding: "5px 14px",
                  borderRadius: 20,
                  border: sel ? "2px solid #2563eb" : "2px solid #d1d5db",
                  background: sel ? "#dbeafe" : "#fff",
                  color: sel ? "#1e40af" : "#6b7280",
                  fontWeight: sel ? 700 : 400,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                {q}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ gridColumn: "1 / -1" }}>
        <label style={labelStyle}>Orari disponibilità (es. Lun-Ven 8-18, Sab 8-13)</label>
        <input
          style={inputStyle}
          value={form.orari_disponibilita || ""}
          onChange={e => set("orari_disponibilita", e.target.value)}
          placeholder="es. Lun-Ven 8:00-18:00, Sab 8:00-13:00"
        />
      </div>

      <div style={{ gridColumn: "1 / -1" }}>
        <label style={labelStyle}>Note</label>
        <textarea
          style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
          value={form.note || ""}
          onChange={e => set("note", e.target.value)}
        />
      </div>

      <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 10 }}>
        <label style={{ ...labelStyle, marginBottom: 0 }}>
          <input
            type="checkbox"
            checked={!!form.attivo}
            onChange={e => set("attivo", e.target.checked)}
            style={{ marginRight: 6 }}
          />
          Istruttore attivo
        </label>
      </div>

      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
        <button
          type="button"
          onClick={onCancel}
          style={{ padding: "8px 22px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb", cursor: "pointer" }}
        >
          Annulla
        </button>
        <button
          type="submit"
          disabled={busy}
          style={{
            padding: "8px 22px",
            borderRadius: 6,
            border: "none",
            background: busy ? "#93c5fd" : "#2563eb",
            color: "#fff",
            fontWeight: 600,
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy ? "Salvataggio…" : "💾 Salva"}
        </button>
      </div>
    </form>
  );
}

function ModalGuide({ istruttore, apiBase, onClose }) {
  const [guide, setGuide] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [page, setPage] = useState(0);
  const LIMIT = 20;

  const load = useCallback(async (p = 0) => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch(`${apiBase}/istruttori/${istruttore.id}/guide?limit=${LIMIT}&offset=${p * LIMIT}`, {
        headers: authHeaders(),
      });
      if (!r.ok) throw new Error(await r.text());
      const json = await r.json();
      setGuide(json.data || json || []);
      setPage(p);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiBase, istruttore.id]);

  useEffect(() => { load(0); }, [load]);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 28, maxWidth: 780, width: "95%", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>
            🚗 Guide — {istruttore.cognome} {istruttore.nome}
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>
        {loading && <div style={{ color: "#6b7280", textAlign: "center", padding: 20 }}>Caricamento…</div>}
        {err && <div style={{ color: "#ef4444", padding: 10 }}>❌ {err}</div>}
        {!loading && !err && (
          <div style={{ overflowY: "auto", flex: 1 }}>
            {guide.length === 0 ? (
              <div style={{ color: "#9ca3af", textAlign: "center", padding: 30 }}>Nessuna guida registrata per questo istruttore.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f3f4f6" }}>
                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Data</th>
                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Candidato</th>
                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Tipo</th>
                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Durata</th>
                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Esito</th>
                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {guide.map((g, i) => (
                    <tr key={g.id || i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "7px 12px" }}>{g.data_guida ? g.data_guida.slice(0, 10) : "—"}</td>
                      <td style={{ padding: "7px 12px" }}>
                        {g.candidates
                          ? `${g.candidates.cognome || ""} ${g.candidates.nome || ""}`.trim()
                          : g.candidate_id || "—"}
                      </td>
                      <td style={{ padding: "7px 12px" }}>{g.tipo_guida || "—"}</td>
                      <td style={{ padding: "7px 12px" }}>{g.durata_minuti ? `${g.durata_minuti} min` : "—"}</td>
                      <td style={{ padding: "7px 12px" }}>
                        {g.esito === "superata" ? "✅ Superata"
                          : g.esito === "non_superata" ? "❌ Non superata"
                          : g.esito || "—"}
                      </td>
                      <td style={{ padding: "7px 12px", color: "#6b7280" }}>{g.note || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
          <button
            onClick={() => load(page - 1)}
            disabled={page === 0 || loading}
            style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb", cursor: page === 0 ? "default" : "pointer" }}
          >
            ← Prec
          </button>
          <span style={{ alignSelf: "center", fontSize: 13, color: "#6b7280" }}>Pag. {page + 1}</span>
          <button
            onClick={() => load(page + 1)}
            disabled={guide.length < LIMIT || loading}
            style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb", cursor: guide.length < LIMIT ? "default" : "pointer" }}
          >
            Succ →
          </button>
        </div>
      </div>
    </div>
  );
}

export default function IstruttoriPage() {
  const [istruttori, setIstruttori] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [filtroAttivi, setFiltroAttivi] = useState("attivi");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formBusy, setFormBusy] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [guideModal, setGuideModal] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const apiBase = getApiURL();

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch(`${apiBase}/istruttori`, {
        headers: authHeaders(),
      });
      if (!r.ok) throw new Error(await r.text());
      const json = await r.json();
      setIstruttori(Array.isArray(json) ? json : (json.data || []));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => { load(); }, [load]);

  async function handleSave(form) {
    setFormBusy(true);
    setFormErr("");
    try {
      const isEdit = !!editing?.id;
      const url = isEdit ? `${apiBase}/istruttori/${editing.id}` : `${apiBase}/istruttori`;
      const method = isEdit ? "PUT" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(form),
      });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(txt);
      }
      setShowForm(false);
      setEditing(null);
      await load();
    } catch (e) {
      setFormErr(e.message);
    } finally {
      setFormBusy(false);
    }
  }

  async function handleDelete(id) {
    try {
      const r = await fetch(`${apiBase}/istruttori/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!r.ok) throw new Error(await r.text());
      setDeleteConfirm(null);
      await load();
    } catch (e) {
      alert("Errore eliminazione: " + e.message);
    }
  }

  const filtered = istruttori.filter(ist => {
    const matchSearch = search.trim() === ""
      || `${ist.cognome} ${ist.nome} ${ist.codice_fiscale || ""}`.toLowerCase().includes(search.toLowerCase());
    const matchAttivo = filtroAttivi === "tutti"
      || (filtroAttivi === "attivi" && ist.attivo !== false)
      || (filtroAttivi === "inattivi" && ist.attivo === false);
    return matchSearch && matchAttivo;
  });

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#111827" }}>
          👨‍🏫 Gestione Istruttori
        </h1>
        <button
          onClick={() => { setEditing(null); setFormErr(""); setShowForm(true); }}
          style={{
            padding: "9px 20px",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 7,
            fontWeight: 600,
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          + Nuovo Istruttore
        </button>
      </div>

      {/* Filtri */}
      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="🔍 Cerca per cognome, nome, CF…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            padding: "8px 14px",
            border: "1px solid #d1d5db",
            borderRadius: 6,
            fontSize: 14,
            minWidth: 260,
          }}
        />
        {["attivi", "inattivi", "tutti"].map(f => (
          <button
            key={f}
            onClick={() => setFiltroAttivi(f)}
            style={{
              padding: "7px 16px",
              borderRadius: 6,
              border: filtroAttivi === f ? "2px solid #2563eb" : "1px solid #d1d5db",
              background: filtroAttivi === f ? "#dbeafe" : "#fff",
              color: filtroAttivi === f ? "#1e40af" : "#374151",
              fontWeight: filtroAttivi === f ? 600 : 400,
              cursor: "pointer",
              fontSize: 13,
              textTransform: "capitalize",
            }}
          >
            {f}
          </button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 13, color: "#6b7280" }}>
          {filtered.length} istruttore{filtered.length !== 1 ? "i" : ""}
        </span>
      </div>

      {/* Errore */}
      {err && <div style={{ background: "#fee2e2", color: "#991b1b", padding: 12, borderRadius: 8, marginBottom: 16 }}>❌ {err}</div>}

      {/* Form modale creazione/modifica */}
      {showForm && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
        }}>
          <div style={{
            background: "#fff", borderRadius: 12, padding: 28,
            maxWidth: 700, width: "95%", maxHeight: "90vh", overflowY: "auto",
          }}>
            <h2 style={{ margin: "0 0 20px", fontSize: 18 }}>
              {editing?.id ? "✏️ Modifica Istruttore" : "➕ Nuovo Istruttore"}
            </h2>
            {formErr && <div style={{ background: "#fee2e2", color: "#991b1b", padding: 10, borderRadius: 6, marginBottom: 14 }}>{formErr}</div>}
            <FormIstruttore
              initial={editing}
              onSave={handleSave}
              onCancel={() => { setShowForm(false); setEditing(null); }}
              busy={formBusy}
            />
          </div>
        </div>
      )}

      {/* Modale conferma eliminazione */}
      {deleteConfirm && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1001,
        }}>
          <div style={{ background: "#fff", borderRadius: 10, padding: 24, maxWidth: 380, width: "90%", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
            <p style={{ margin: "0 0 18px", fontSize: 15 }}>
              Eliminare <strong>{deleteConfirm.cognome} {deleteConfirm.nome}</strong>?<br />
              <span style={{ fontSize: 13, color: "#6b7280" }}>L'operazione non è reversibile.</span>
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button
                onClick={() => setDeleteConfirm(null)}
                style={{ padding: "8px 22px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb", cursor: "pointer" }}
              >
                Annulla
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm.id)}
                style={{ padding: "8px 22px", borderRadius: 6, border: "none", background: "#ef4444", color: "#fff", fontWeight: 600, cursor: "pointer" }}
              >
                Elimina
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale guide */}
      {guideModal && (
        <ModalGuide
          istruttore={guideModal}
          apiBase={apiBase}
          onClose={() => setGuideModal(null)}
        />
      )}

      {/* Tabella */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#6b7280" }}>Caricamento istruttori…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>
          {istruttori.length === 0 ? "Nessun istruttore registrato. Creane uno!" : "Nessun risultato per i filtri selezionati."}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#374151" }}>Istruttore</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#374151" }}>Contatti</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#374151" }}>Qualifiche</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#374151" }}>Orari</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#374151" }}>Stato</th>
                <th style={{ padding: "10px 14px", textAlign: "center", fontWeight: 600, color: "#374151" }}>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ist, i) => {
                const qualifiche = Array.isArray(ist.qualifiche) ? ist.qualifiche : [];
                return (
                  <tr
                    key={ist.id}
                    style={{
                      borderBottom: "1px solid #f3f4f6",
                      background: i % 2 === 0 ? "#fff" : "#fafafa",
                    }}
                  >
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ fontWeight: 600, color: "#111827" }}>{ist.cognome} {ist.nome}</div>
                      {ist.codice_fiscale && <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>{ist.codice_fiscale}</div>}
                      {ist.numero_patente && <div style={{ fontSize: 12, color: "#6b7280" }}>Pat. {ist.numero_patente}</div>}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      {ist.email && <div style={{ fontSize: 13 }}>✉️ {ist.email}</div>}
                      {ist.telefono && <div style={{ fontSize: 13 }}>📞 {ist.telefono}</div>}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      {qualifiche.length === 0
                        ? <span style={{ color: "#9ca3af", fontSize: 12 }}>—</span>
                        : qualifiche.map(q => <Badge key={q} label={q} color="blue" />)
                      }
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 12, color: "#6b7280", maxWidth: 160 }}>
                      {ist.orari_disponibilita || "—"}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      {ist.attivo !== false
                        ? <span style={{ background: "#dcfce7", color: "#166534", padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>● Attivo</span>
                        : <span style={{ background: "#f3f4f6", color: "#6b7280", padding: "3px 10px", borderRadius: 20, fontSize: 12 }}>○ Inattivo</span>
                      }
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "center", whiteSpace: "nowrap" }}>
                      <button
                        title="Vedi guide assegnate"
                        onClick={() => setGuideModal(ist)}
                        style={{ marginRight: 6, padding: "5px 12px", borderRadius: 5, border: "1px solid #a5b4fc", background: "#ede9fe", color: "#4338ca", cursor: "pointer", fontSize: 13 }}
                      >
                        🚗 Guide
                      </button>
                      <button
                        title="Modifica"
                        onClick={() => { setEditing(ist); setFormErr(""); setShowForm(true); }}
                        style={{ marginRight: 6, padding: "5px 12px", borderRadius: 5, border: "1px solid #93c5fd", background: "#dbeafe", color: "#1e40af", cursor: "pointer", fontSize: 13 }}
                      >
                        ✏️
                      </button>
                      <button
                        title="Elimina"
                        onClick={() => setDeleteConfirm(ist)}
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
    </div>
  );
}

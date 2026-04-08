"use client";
/**
 * Pagina Rendiconto Cassa Giornaliero — Punto 22
 * Riepilogo pagamenti del giorno con stampa.
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

function fmt(n) {
  return Number(n || 0).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtData(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function stampaRendiconto(rendiconto, nomeAutoscuola) {
  if (!rendiconto) return;
  const { data, totale, count, pagamenti, per_metodo, per_causale } = rendiconto;

  const righeTabella = (pagamenti || []).map(p => `
    <tr>
      <td>${fmtData(p.created_at)}</td>
      <td>${p.candidates ? (p.candidates.cognome + " " + p.candidates.nome) : (p.candidato_id || "—")}</td>
      <td>${p.causale || p.tipo || "—"}</td>
      <td>${p.metodo || "—"}</td>
      <td style="text-align:right;font-weight:600">€ ${fmt(p.importo)}</td>
    </tr>`).join("");

  const righeMetodo = (per_metodo || []).map(m => `
    <tr>
      <td><strong>${m.metodo}</strong></td>
      <td style="text-align:center">${m.count}</td>
      <td style="text-align:right;font-weight:700">€ ${fmt(m.totale)}</td>
    </tr>`).join("");

  const righecausale = (per_causale || []).map(c => `
    <tr>
      <td>${c.causale}</td>
      <td style="text-align:center">${c.count}</td>
      <td style="text-align:right">€ ${fmt(c.totale)}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8"/>
  <title>Rendiconto Cassa ${data}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 30px; font-size: 13px; color: #222; }
    h1 { font-size: 20px; margin: 0; }
    h2 { font-size: 15px; margin: 20px 0 8px; color: #1e40af; border-bottom: 1px solid #bfdbfe; padding-bottom: 4px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; border-bottom: 2px solid #1e40af; padding-bottom: 12px; }
    .totale-box { background: #dbeafe; border: 1px solid #93c5fd; border-radius: 8px; padding: 14px 24px; text-align: center; }
    .totale-label { font-size: 12px; color: #1e40af; }
    .totale-val { font-size: 26px; font-weight: 700; color: #1e3a8a; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th { background: #1e40af; color: #fff; padding: 7px 10px; text-align: left; font-size: 12px; }
    td { padding: 6px 10px; border-bottom: 1px solid #e5e7eb; }
    tr:nth-child(even) td { background: #f8fafc; }
    .firma { margin-top: 40px; display: flex; justify-content: space-between; }
    .firma div { border-top: 1px solid #6b7280; padding-top: 6px; min-width: 200px; text-align: center; font-size: 12px; color: #6b7280; }
    @media print { button { display: none; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>RENDICONTO CASSA GIORNALIERO</h1>
      <div>${nomeAutoscuola || "Autoscuola"}</div>
      <div style="color:#6b7280;font-size:12px">Data: <strong>${data}</strong> — ${count} operazioni</div>
    </div>
    <div class="totale-box">
      <div class="totale-label">TOTALE INCASSATO</div>
      <div class="totale-val">€ ${fmt(totale)}</div>
    </div>
  </div>

  <h2>Riepilogo per metodo di pagamento</h2>
  <table>
    <thead><tr><th>Metodo</th><th style="text-align:center">N°</th><th style="text-align:right">Totale</th></tr></thead>
    <tbody>${righeMetodo || "<tr><td colspan=3>Nessun dato</td></tr>"}</tbody>
  </table>

  <h2>Riepilogo per causale</h2>
  <table>
    <thead><tr><th>Causale</th><th style="text-align:center">N°</th><th style="text-align:right">Totale</th></tr></thead>
    <tbody>${righecausale || "<tr><td colspan=3>Nessun dato</td></tr>"}</tbody>
  </table>

  <h2>Dettaglio operazioni</h2>
  <table>
    <thead><tr><th>Ora</th><th>Candidato</th><th>Causale</th><th>Metodo</th><th style="text-align:right">Importo</th></tr></thead>
    <tbody>${righeTabella || "<tr><td colspan=5 style='text-align:center;color:#9ca3af'>Nessun pagamento in questa giornata</td></tr>"}</tbody>
    <tfoot>
      <tr style="background:#1e40af;color:#fff">
        <td colspan="4" style="font-weight:700;padding:8px 10px">TOTALE</td>
        <td style="text-align:right;font-weight:700;padding:8px 10px">€ ${fmt(totale)}</td>
      </tr>
    </tfoot>
  </table>

  <div class="firma">
    <div>Firma cassiere / responsabile</div>
    <div>Firma direttore</div>
  </div>

  <script>window.print();</script>
</body>
</html>`;

  const w = window.open("", "_blank", "width=900,height=700");
  w.document.write(html);
  w.document.close();
}

export default function RendicontoPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [data, setData]             = useState(today);
  const [rendiconto, setRendiconto] = useState(null);
  const [loading, setLoading]       = useState(false);
  const [err, setErr]               = useState("");
  const [user, setUser]             = useState(null);
  const apiBase = getApiBase();

  useEffect(() => {
    fetch(`${apiBase}/auth/me`, { headers: authHeader() })
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setUser(d))
      .catch(() => {});
  }, [apiBase]);

  const carica = useCallback(async (d) => {
    setLoading(true); setErr(""); setRendiconto(null);
    try {
      const r = await fetch(`${apiBase}/pagamenti/rendiconto?data=${d}`, { headers: authHeader() });
      if (!r.ok) throw new Error(await r.text());
      setRendiconto(await r.json());
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [apiBase]);

  useEffect(() => { carica(today); }, []);

  function handleDataChange(e) {
    setData(e.target.value);
    carica(e.target.value);
  }

  const METODO_COLORS = {
    contanti:   { bg: "#dcfce7", color: "#166534", icon: "💵" },
    pagoPA:     { bg: "#dbeafe", color: "#1e40af", icon: "🏛️" },
    satispay:   { bg: "#fef3c7", color: "#92400e", icon: "📱" },
    carta:      { bg: "#ede9fe", color: "#4338ca", icon: "💳" },
    "non specificato": { bg: "#f3f4f6", color: "#374151", icon: "❓" },
  };

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#111827" }}>💰 Rendiconto Cassa Giornaliero</h1>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            type="date"
            value={data}
            onChange={handleDataChange}
            style={{ padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }}
          />
          <button
            onClick={() => carica(data)}
            style={{ padding: "8px 16px", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer", fontSize: 14 }}
          >
            🔄 Aggiorna
          </button>
          <button
            onClick={() => stampaRendiconto(rendiconto, user?.nome_autoscuola || user?.ragione_sociale || "")}
            disabled={!rendiconto}
            style={{
              padding: "8px 18px", background: rendiconto ? "#1e40af" : "#9ca3af", color: "#fff",
              border: "none", borderRadius: 6, fontWeight: 600, cursor: rendiconto ? "pointer" : "default", fontSize: 14,
            }}
          >
            🖨️ Stampa
          </button>
        </div>
      </div>

      {err && <div style={{ background: "#fee2e2", color: "#991b1b", padding: 12, borderRadius: 8, marginBottom: 16 }}>❌ {err}</div>}

      {loading && (
        <div style={{ textAlign: "center", padding: 60, color: "#6b7280" }}>Caricamento rendiconto…</div>
      )}

      {!loading && rendiconto && (
        <>
          {/* Totale */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
            <div style={{ background: "#1e40af", color: "#fff", borderRadius: 10, padding: 20, textAlign: "center" }}>
              <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 4 }}>TOTALE INCASSATO</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>€ {fmt(rendiconto.totale)}</div>
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{rendiconto.count} operazioni</div>
            </div>
            {(rendiconto.per_metodo || []).map(m => {
              const mc = METODO_COLORS[m.metodo] || METODO_COLORS["non specificato"];
              return (
                <div key={m.metodo} style={{ background: mc.bg, color: mc.color, borderRadius: 10, padding: 20, textAlign: "center" }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{mc.icon}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, textTransform: "capitalize" }}>{m.metodo}</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>€ {fmt(m.totale)}</div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>{m.count} op.</div>
                </div>
              );
            })}
          </div>

          {/* Riepilogo per causale */}
          {(rendiconto.per_causale || []).length > 0 && (
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 20, marginBottom: 20 }}>
              <h2 style={{ margin: "0 0 14px", fontSize: 16, color: "#1e40af" }}>📊 Riepilogo per causale</h2>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Causale</th>
                    <th style={{ padding: "8px 12px", textAlign: "center" }}>N° operazioni</th>
                    <th style={{ padding: "8px 12px", textAlign: "right" }}>Totale</th>
                  </tr>
                </thead>
                <tbody>
                  {rendiconto.per_causale.map((c, i) => (
                    <tr key={c.causale} style={{ borderBottom: "1px solid #f3f4f6", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                      <td style={{ padding: "8px 12px", fontWeight: 500 }}>{c.causale}</td>
                      <td style={{ padding: "8px 12px", textAlign: "center", color: "#6b7280" }}>{c.count}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: "#1e40af" }}>€ {fmt(c.totale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Dettaglio operazioni */}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 20 }}>
            <h2 style={{ margin: "0 0 14px", fontSize: 16, color: "#1e40af" }}>
              🧾 Dettaglio operazioni — {data}
            </h2>
            {(rendiconto.pagamenti || []).length === 0 ? (
              <div style={{ textAlign: "center", padding: 30, color: "#9ca3af" }}>
                Nessun pagamento registrato in questa giornata.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                      <th style={{ padding: "8px 12px", textAlign: "left" }}>Orario</th>
                      <th style={{ padding: "8px 12px", textAlign: "left" }}>Candidato</th>
                      <th style={{ padding: "8px 12px", textAlign: "left" }}>Causale</th>
                      <th style={{ padding: "8px 12px", textAlign: "left" }}>Metodo</th>
                      <th style={{ padding: "8px 12px", textAlign: "right" }}>Importo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rendiconto.pagamenti.map((p, i) => {
                      const mc = METODO_COLORS[p.metodo] || METODO_COLORS["non specificato"];
                      return (
                        <tr key={p.id || i} style={{ borderBottom: "1px solid #f3f4f6", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                          <td style={{ padding: "7px 12px", whiteSpace: "nowrap", color: "#6b7280" }}>
                            {p.created_at ? new Date(p.created_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "—"}
                          </td>
                          <td style={{ padding: "7px 12px" }}>
                            {p.candidates
                              ? `${p.candidates.cognome || ""} ${p.candidates.nome || ""}`.trim()
                              : p.candidato_id || "—"}
                          </td>
                          <td style={{ padding: "7px 12px" }}>{p.causale || p.tipo || "—"}</td>
                          <td style={{ padding: "7px 12px" }}>
                            <span style={{ background: mc.bg, color: mc.color, padding: "2px 8px", borderRadius: 9999, fontSize: 11, fontWeight: 600 }}>
                              {mc.icon} {p.metodo || "—"}
                            </span>
                          </td>
                          <td style={{ padding: "7px 12px", textAlign: "right", fontWeight: 700, color: "#1e40af" }}>
                            € {fmt(p.importo)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: "#1e40af", color: "#fff" }}>
                      <td colSpan={4} style={{ padding: "10px 12px", fontWeight: 700 }}>TOTALE GIORNATA</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, fontSize: 15 }}>€ {fmt(rendiconto.totale)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

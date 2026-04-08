"use client";

/**
 * /visite-mediche — Gestione Visite Mediche
 * Prenotazione, monitoraggio e gestione delle visite mediche per i candidati.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  getApiBase,
  authHeaders,
  checkSession,
  logoutSession,
} from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";

// ---------------------------------------------------------------------------
// Helper API
// ---------------------------------------------------------------------------

function apiBase() {
  return getApiBase();
}

async function apiFetch(path, opts = {}) {
  const base = apiBase();
  const res = await fetch(`${base}/api${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const STATI = [
  { value: "prenotata",  label: "Prenotata",  color: "bg-blue-100 text-blue-700" },
  { value: "confermata", label: "Confermata", color: "bg-green-100 text-green-700" },
  { value: "completata", label: "Completata", color: "bg-gray-100 text-gray-700" },
  { value: "annullata",  label: "Annullata",  color: "bg-red-100 text-red-700" },
  { value: "no_show",    label: "No Show",    color: "bg-amber-100 text-amber-700" },
];

const TIPI_VISITA = [
  { value: "prima_visita", label: "Prima visita" },
  { value: "rinnovo",      label: "Rinnovo" },
  { value: "cml",          label: "CML" },
  { value: "cqc",          label: "CQC" },
  { value: "altro",        label: "Altro" },
];

const ESITI = [
  { value: "",            label: "— nessun esito —" },
  { value: "IDONEO",      label: "Idoneo" },
  { value: "NON_IDONEO",  label: "Non idoneo" },
  { value: "SOSPESO",     label: "Sospeso" },
  { value: "DA_RIVEDERE", label: "Da rivedere" },
];

const EMPTY_FORM = {
  candidato_id: "",
  data_visita: "",
  ora_inizio: "",
  ora_fine: "",
  medico: "",
  luogo: "",
  tipo_visita: "prima_visita",
  stato: "prenotata",
  esito: "",
  note: "",
};

// ---------------------------------------------------------------------------
// Utilita
// ---------------------------------------------------------------------------

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("it-IT");
}

function fmtTime(t) {
  if (!t) return "—";
  // Gestisce sia "HH:MM" sia "HH:MM:SS"
  return String(t).slice(0, 5);
}

function statoChip(stato) {
  const s = STATI.find((x) => x.value === stato);
  return s ? s.color : "bg-slate-100 text-slate-600";
}

function statoLabel(stato) {
  const s = STATI.find((x) => x.value === stato);
  return s ? s.label : stato || "—";
}

function tipoLabel(tipo) {
  const t = TIPI_VISITA.find((x) => x.value === tipo);
  return t ? t.label : tipo || "—";
}

function esitoChip(esito) {
  if (!esito) return "";
  const map = {
    IDONEO: "bg-emerald-100 text-emerald-800",
    NON_IDONEO: "bg-red-100 text-red-800",
    SOSPESO: "bg-amber-100 text-amber-800",
    DA_RIVEDERE: "bg-orange-100 text-orange-800",
  };
  return map[esito] || "bg-slate-100 text-slate-600";
}

function esitoLabel(esito) {
  const e = ESITI.find((x) => x.value === esito);
  return e ? e.label : esito || "";
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Export CSV
// ---------------------------------------------------------------------------

function exportCSV(rows, candidatiMap) {
  const headers = [
    "Data",
    "Ora Inizio",
    "Ora Fine",
    "Candidato",
    "Medico",
    "Luogo",
    "Tipo Visita",
    "Stato",
    "Esito",
    "Note",
  ];
  const lines = rows.map((r) => {
    const c = candidatiMap[r.candidato_id];
    const candidatoLabel = c ? `${c.cognome} ${c.nome}` : r.candidato_id || "";
    return [
      r.data_visita ? new Date(r.data_visita).toLocaleDateString("it-IT") : "",
      fmtTime(r.ora_inizio),
      fmtTime(r.ora_fine),
      `"${candidatoLabel.replace(/"/g, '""')}"`,
      `"${(r.medico || "").replace(/"/g, '""')}"`,
      `"${(r.luogo || "").replace(/"/g, '""')}"`,
      tipoLabel(r.tipo_visita),
      statoLabel(r.stato),
      esitoLabel(r.esito),
      `"${(r.note || "").replace(/"/g, '""')}"`,
    ];
  });
  const csv = [headers.join(";"), ...lines.map((l) => l.join(";"))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `visite_mediche_${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Modal Visita
// ---------------------------------------------------------------------------

function ModalVisita({ visita, candidati, onClose, onSave }) {
  const isNew = !visita?.id;
  const [form, setForm] = useState(
    isNew
      ? { ...EMPTY_FORM, data_visita: todayISO() }
      : {
          candidato_id: visita.candidato_id || "",
          data_visita: visita.data_visita
            ? String(visita.data_visita).slice(0, 10)
            : "",
          ora_inizio: visita.ora_inizio || "",
          ora_fine: visita.ora_fine || "",
          medico: visita.medico || "",
          luogo: visita.luogo || "",
          tipo_visita: visita.tipo_visita || "prima_visita",
          stato: visita.stato || "prenotata",
          esito: visita.esito || "",
          note: visita.note || "",
        }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body = {
        ...form,
        candidato_id: form.candidato_id || null,
        esito: form.stato === "completata" ? form.esito || null : null,
      };
      const result = isNew
        ? await apiFetch("/visite-mediche", { method: "POST", body })
        : await apiFetch(`/visite-mediche/${visita.id}`, {
            method: "PUT",
            body,
          });
      onSave(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-900">
            {isNew ? "Nuova Visita Medica" : "Modifica Visita Medica"}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-2xl"
          >
            x
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 rounded-lg px-4 py-2 text-sm">
              {error}
            </div>
          )}

          {/* Candidato */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">
              Candidato *
            </label>
            <select
              value={form.candidato_id}
              onChange={(e) => set("candidato_id", e.target.value)}
              required
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">— seleziona candidato —</option>
              {(candidati || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.cognome} {c.nome}
                  {c.codice_fiscale ? ` — ${c.codice_fiscale}` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Data e orari */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">
                Data visita *
              </label>
              <input
                type="date"
                value={form.data_visita}
                onChange={(e) => set("data_visita", e.target.value)}
                required
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">
                Ora inizio
              </label>
              <input
                type="time"
                value={form.ora_inizio}
                onChange={(e) => set("ora_inizio", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">
                Ora fine
              </label>
              <input
                type="time"
                value={form.ora_fine}
                onChange={(e) => set("ora_fine", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* Medico e Luogo */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">
                Medico
              </label>
              <input
                type="text"
                value={form.medico}
                onChange={(e) => set("medico", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="es. Dott. Rossi"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">
                Luogo
              </label>
              <input
                type="text"
                value={form.luogo}
                onChange={(e) => set("luogo", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="es. ASL Roma 1"
              />
            </div>
          </div>

          {/* Tipo visita e Stato */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">
                Tipo visita
              </label>
              <select
                value={form.tipo_visita}
                onChange={(e) => set("tipo_visita", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                {TIPI_VISITA.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">
                Stato
              </label>
              <select
                value={form.stato}
                onChange={(e) => set("stato", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                {STATI.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Esito — solo se completata */}
          {form.stato === "completata" && (
            <div className="bg-emerald-50 rounded-xl p-4">
              <label className="block text-xs font-semibold text-emerald-700 mb-1">
                Esito visita
              </label>
              <select
                value={form.esito}
                onChange={(e) => set("esito", e.target.value)}
                className="w-full border border-emerald-200 rounded-lg px-3 py-2 text-sm bg-white"
              >
                {ESITI.map((es) => (
                  <option key={es.value} value={es.value}>
                    {es.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Note */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">
              Note
            </label>
            <textarea
              value={form.note || ""}
              onChange={(e) => set("note", e.target.value)}
              rows={3}
              className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
              placeholder="Annotazioni aggiuntive..."
            />
          </div>

          {/* Azioni */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving
                ? "Salvataggio..."
                : isNew
                ? "Crea visita"
                : "Salva modifiche"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagina principale
// ---------------------------------------------------------------------------

export default function VisiteMedichePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const [visite, setVisite] = useState([]);
  const [candidati, setCandidati] = useState([]);
  const [stats, setStats] = useState({
    totale: 0,
    prossime_7gg: 0,
    completate: 0,
    idonei: 0,
  });
  const [fetchError, setFetchError] = useState("");

  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(null); // null | "new" | visita object

  const [filters, setFilters] = useState({
    data_da: "",
    data_a: "",
    stato: "",
    tipo_visita: "",
    medico: "",
  });

  // ─── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function init() {
      const session = await checkSession();
      if (!session.ok) {
        if (!cancelled) router.replace("/login");
        return;
      }
      if (!cancelled) {
        setUser(session.autoscuola);
        setLoading(false);
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // ─── Caricamento dati ──────────────────────────────────────────────────────
  const loadVisite = useCallback(async () => {
    setFetchError("");
    try {
      const params = new URLSearchParams();
      if (filters.data_da) params.set("data_da", filters.data_da);
      if (filters.data_a) params.set("data_a", filters.data_a);
      if (filters.stato) params.set("stato", filters.stato);
      if (filters.tipo_visita) params.set("tipo_visita", filters.tipo_visita);
      const data = await apiFetch(`/visite-mediche?${params}`);
      setVisite(Array.isArray(data) ? data : data.data || []);
    } catch (e) {
      setFetchError(e.message || "Errore caricamento visite mediche");
    }
  }, [filters.data_da, filters.data_a, filters.stato, filters.tipo_visita]);

  const loadCandidati = useCallback(async () => {
    try {
      const data = await apiFetch(
        "/candidati-api?limit=500&fields=id,cognome,nome,codice_fiscale"
      );
      setCandidati(Array.isArray(data) ? data : data.data || []);
    } catch {
      /* non critico */
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const data = await apiFetch("/visite-mediche/statistiche");
      setStats({
        totale: data.totale || 0,
        prossime_7gg: data.prossime_7gg || 0,
        completate: data.completate || 0,
        idonei: data.idonei || 0,
      });
    } catch {
      /* non critico */
    }
  }, []);

  useEffect(() => {
    if (!loading) {
      loadVisite();
      loadCandidati();
      loadStats();
    }
  }, [loading, loadVisite, loadCandidati, loadStats]);

  // ─── Mappa candidati ──────────────────────────────────────────────────────
  const candidatiMap = useMemo(() => {
    const m = {};
    candidati.forEach((c) => {
      m[c.id] = c;
    });
    return m;
  }, [candidati]);

  // ─── Filtro client-side (medico) ──────────────────────────────────────────
  const filtered = useMemo(() => {
    const medicoQ = filters.medico.trim().toLowerCase();
    return visite
      .map((v) => {
        const c = candidatiMap[v.candidato_id];
        const label = c ? `${c.cognome} ${c.nome}` : v.candidato_id || "";
        return { ...v, _candidatoLabel: label };
      })
      .filter((v) => {
        if (medicoQ) {
          if (!(v.medico || "").toLowerCase().includes(medicoQ)) return false;
        }
        return true;
      });
  }, [visite, filters.medico, candidatiMap]);

  // ─── Azioni ───────────────────────────────────────────────────────────────
  function handleSelectRow(v) {
    setSelected(selected?.id === v.id ? null : v);
  }

  function handleSave(saved) {
    setVisite((prev) => {
      const idx = prev.findIndex((x) => x.id === saved.id);
      if (idx >= 0) {
        const n = [...prev];
        n[idx] = saved;
        return n;
      }
      return [saved, ...prev];
    });
    setModal(null);
    loadStats();
  }

  async function handleDelete(visita) {
    if (!window.confirm(`Eliminare la visita del ${fmtDate(visita.data_visita)}?`))
      return;
    try {
      await apiFetch(`/visite-mediche/${visita.id}`, { method: "DELETE" });
      setVisite((prev) => prev.filter((x) => x.id !== visita.id));
      if (selected?.id === visita.id) setSelected(null);
      loadStats();
    } catch (e) {
      setFetchError(e.message);
    }
  }

  async function handleCambiaStato(visita, nuovoStato) {
    try {
      const result = await apiFetch(`/visite-mediche/${visita.id}`, {
        method: "PUT",
        body: { ...visita, stato: nuovoStato },
      });
      setVisite((prev) =>
        prev.map((x) => (x.id === result.id ? { ...x, ...result } : x))
      );
      loadStats();
    } catch (e) {
      setFetchError(e.message);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-slate-600">Caricamento...</p>
      </div>
    );
  }

  return (
    <ModernAppShell
      title="Visite Mediche"
      subtitle="Prenotazione, monitoraggio e gestione visite mediche candidati"
      activeKey="visite-mediche"
      onLogout={() => logoutSession().then(() => router.replace("/login"))}
      user={user}
    >
      {/* ── Statistiche ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-indigo-700">{stats.totale}</div>
          <div className="text-xs text-indigo-600">Totale visite</div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-blue-700">
            {stats.prossime_7gg}
          </div>
          <div className="text-xs text-blue-600">Prossimi 7 giorni</div>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-gray-700">
            {stats.completate}
          </div>
          <div className="text-xs text-gray-600">Completate</div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-emerald-700">{stats.idonei}</div>
          <div className="text-xs text-emerald-600">Idonei</div>
        </div>
      </div>

      {/* ── Filtri ─────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border p-4 mb-4">
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="date"
            value={filters.data_da}
            onChange={(e) =>
              setFilters((f) => ({ ...f, data_da: e.target.value }))
            }
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none"
            title="Data da"
          />
          <input
            type="date"
            value={filters.data_a}
            onChange={(e) =>
              setFilters((f) => ({ ...f, data_a: e.target.value }))
            }
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none"
            title="Data a"
          />
          <select
            value={filters.stato}
            onChange={(e) =>
              setFilters((f) => ({ ...f, stato: e.target.value }))
            }
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none"
          >
            <option value="">Tutti gli stati</option>
            {STATI.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            value={filters.tipo_visita}
            onChange={(e) =>
              setFilters((f) => ({ ...f, tipo_visita: e.target.value }))
            }
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none"
          >
            <option value="">Tutti i tipi</option>
            {TIPI_VISITA.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Medico..."
            value={filters.medico}
            onChange={(e) =>
              setFilters((f) => ({ ...f, medico: e.target.value }))
            }
            className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-indigo-400 focus:outline-none w-40"
          />

          <button
            onClick={loadVisite}
            className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Aggiorna
          </button>
          <button
            onClick={() => {
              setSelected(null);
              setModal("new");
            }}
            className="h-9 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            + Nuova Visita
          </button>
          <button
            onClick={() => exportCSV(filtered, candidatiMap)}
            disabled={filtered.length === 0}
            className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-40"
            title="Esporta come CSV"
          >
            CSV
          </button>
        </div>
      </div>

      {/* ── Conteggio ──────────────────────────────────────────────────────── */}
      <div className="mb-2 flex items-center gap-4 text-sm text-slate-500">
        <span>{filtered.length} visite</span>
      </div>

      {fetchError && (
        <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex justify-between">
          <span>{fetchError}</span>
          <button
            onClick={() => setFetchError("")}
            className="font-bold ml-2"
          >
            x
          </button>
        </div>
      )}

      {/* ── Tabella ────────────────────────────────────────────────────────── */}
      <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr className="border-b border-slate-200">
              <th className="px-3 py-2 text-left font-semibold text-slate-600">
                Data
              </th>
              <th className="px-3 py-2 text-left font-semibold text-slate-600">
                Ora
              </th>
              <th className="px-3 py-2 text-left font-semibold text-slate-600">
                Candidato
              </th>
              <th className="px-3 py-2 text-left font-semibold text-slate-600">
                Medico
              </th>
              <th className="px-3 py-2 text-left font-semibold text-slate-600">
                Luogo
              </th>
              <th className="px-3 py-2 text-left font-semibold text-slate-600">
                Tipo
              </th>
              <th className="px-3 py-2 text-left font-semibold text-slate-600">
                Stato
              </th>
              <th className="px-3 py-2 text-left font-semibold text-slate-600">
                Esito
              </th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="py-12 text-center text-slate-400"
                >
                  Nessuna visita medica trovata
                </td>
              </tr>
            ) : (
              filtered.map((v) => {
                const isSelected = selected?.id === v.id;
                return (
                  <tr
                    key={v.id}
                    onClick={() => handleSelectRow(v)}
                    className={`cursor-pointer border-b border-slate-100 transition-colors last:border-0 ${
                      isSelected ? "bg-indigo-50" : "hover:bg-slate-50"
                    }`}
                  >
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                      {v.data_visita
                        ? fmtDate(v.data_visita)
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                      {fmtTime(v.ora_inizio)}
                      {v.ora_fine ? ` - ${fmtTime(v.ora_fine)}` : ""}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">
                        {v._candidatoLabel || "—"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {v.medico || "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-600 max-w-40 truncate" title={v.luogo}>
                      {v.luogo || "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                      {tipoLabel(v.tipo_visita)}
                    </td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={v.stato}
                        onChange={(e) => handleCambiaStato(v, e.target.value)}
                        className={`text-xs px-2 py-1 rounded-full font-semibold border-0 cursor-pointer ${statoChip(
                          v.stato
                        )}`}
                      >
                        {STATI.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {v.esito ? (
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${esitoChip(
                            v.esito
                          )}`}
                        >
                          {esitoLabel(v.esito)}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td
                      className="px-2 py-1.5 whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => setModal(v)}
                        title="Modifica"
                        className="rounded border border-blue-300 bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700 hover:bg-blue-100 mr-1"
                      >
                        Modifica
                      </button>
                      <button
                        onClick={() => handleDelete(v)}
                        title="Elimina"
                        className="rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-xs text-red-700 hover:bg-red-100"
                      >
                        Elimina
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <div className="text-center mt-4 text-xs text-gray-400">
          {filtered.length} visit{filtered.length === 1 ? "a" : "e"} mostrat
          {filtered.length === 1 ? "a" : "e"}
        </div>
      )}

      {/* ── Modal ──────────────────────────────────────────────────────────── */}
      {modal && (
        <ModalVisita
          visita={modal === "new" ? null : modal}
          candidati={candidati}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
    </ModernAppShell>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ModernAppShell from "../../ModernAppShell";
import { API_BASE, authHeaders, checkSession, logoutSession } from "../../../lib/authClient";

function extractPatenteData(row = {}) {
  const anagrafica = row?.raw_portale?.anagrafica || {};
  return {
    numero_patente_posseduta: anagrafica.numero_patente_posseduta || "",
    ente_rilascio_patente: anagrafica.ente_rilascio_patente || "",
    rilasciata_il_patente: anagrafica.rilasciata_il_patente || "",
    scade_il_patente: anagrafica.scade_il_patente || "",
  };
}

function toInputDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const text = String(value).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
  }
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function FogliRosaPatentiPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Caricamento...");
  const [rows, setRows] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    nome: "",
    cognome: "",
    categoria_patente: "B",
    patente_numero: "B",
    numero_patente_posseduta: "",
    ente_rilascio_patente: "",
    rilasciata_il_patente: "",
    scade_il_patente: "",
  });

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const session = await checkSession();
      if (!session.ok) {
        if (!cancelled) router.replace("/login");
        return;
      }

      if (!cancelled) {
        setReady(true);
        await loadRows();
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onLogout() {
    await logoutSession();
    router.replace("/login");
  }

  async function loadRows() {
    setStatus("Caricamento pratiche foglio rosa...");
    try {
      const res = await fetch(`${API_BASE}/api/candidates`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !Array.isArray(data)) throw new Error(data.error || "Errore caricamento pratiche");
      setRows(data);
      setStatus(`Pratiche caricate: ${data.length}`);
    } catch (error) {
      setStatus(`Errore: ${error.message}`);
    }
  }

  const filtered = useMemo(() => {
    const q = String(query || "").toLowerCase().trim();
    if (!q) return rows;
    return rows.filter((row) => {
      const text = [
        row.nome,
        row.cognome,
        row.categoria_patente,
        row.patente_numero,
        row?.raw_portale?.anagrafica?.numero_patente_posseduta,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return text.includes(q);
    });
  }, [rows, query]);

  const selectedRow = useMemo(() => rows.find((item) => item.id === selectedId) || null, [rows, selectedId]);

  function resetForm() {
    setForm({
      nome: "",
      cognome: "",
      categoria_patente: "B",
      patente_numero: "B",
      numero_patente_posseduta: "",
      ente_rilascio_patente: "",
      rilasciata_il_patente: "",
      scade_il_patente: "",
    });
    setSelectedId(null);
  }

  function onSelectRow(row) {
    const patente = extractPatenteData(row);
    setSelectedId(row.id);
    setForm({
      nome: row.nome || "",
      cognome: row.cognome || "",
      categoria_patente: row.categoria_patente || "B",
      patente_numero: row.patente_numero || "B",
      numero_patente_posseduta: patente.numero_patente_posseduta || "",
      ente_rilascio_patente: patente.ente_rilascio_patente || "",
      rilasciata_il_patente: toInputDate(patente.rilasciata_il_patente),
      scade_il_patente: toInputDate(patente.scade_il_patente),
    });
  }

  function buildPayload() {
    return {
      nome: String(form.nome || "").trim(),
      cognome: String(form.cognome || "").trim(),
      categoria_patente: String(form.categoria_patente || "B").trim(),
      patente_numero: String(form.patente_numero || "B").trim(),
      raw_portale: {
        anagrafica: {
          numero_patente_posseduta: String(form.numero_patente_posseduta || "").trim(),
          ente_rilascio_patente: String(form.ente_rilascio_patente || "").trim(),
          rilasciata_il_patente: String(form.rilasciata_il_patente || "").trim() || null,
          scade_il_patente: String(form.scade_il_patente || "").trim() || null,
        },
      },
    };
  }

  async function onCreate() {
    const payload = buildPayload();
    if (!payload.nome || !payload.cognome) {
      setStatus("Nome e cognome sono obbligatori");
      return;
    }

    setSaving(true);
    setStatus("Creazione pratica in corso...");
    try {
      const res = await fetch(`${API_BASE}/api/candidates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Errore creazione pratica");
      await loadRows();
      resetForm();
      setStatus("Pratica creata");
    } catch (error) {
      setStatus(`Errore: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function onSave() {
    if (!selectedId) {
      setStatus("Seleziona una pratica dalla tabella");
      return;
    }

    const payload = buildPayload();
    if (!payload.nome || !payload.cognome) {
      setStatus("Nome e cognome sono obbligatori");
      return;
    }

    setSaving(true);
    setStatus("Salvataggio modifiche in corso...");
    try {
      const res = await fetch(`${API_BASE}/api/candidates/${selectedId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Errore salvataggio pratica");
      await loadRows();
      setStatus("Modifiche salvate");
    } catch (error) {
      setStatus(`Errore: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!selectedId) {
      setStatus("Seleziona una pratica dalla tabella");
      return;
    }

    const ok = typeof window !== "undefined" ? window.confirm("Eliminare la pratica selezionata?") : false;
    if (!ok) return;

    setSaving(true);
    setStatus("Eliminazione in corso...");
    try {
      const res = await fetch(`${API_BASE}/api/candidates/${selectedId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Errore eliminazione pratica");
      await loadRows();
      resetForm();
      setStatus("Pratica eliminata");
    } catch (error) {
      setStatus(`Errore: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-100 p-6">
        <main className="mx-auto max-w-5xl rounded-xl bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-700">Verifica sessione...</p>
        </main>
      </div>
    );
  }

  return (
    <ModernAppShell
      title="Fogli Rosa e Patenti"
      subtitle="Gestione pratiche patente"
      activeKey="fogli-rosa-patenti"
      onLogout={onLogout}
    >
      <h2 className="text-3xl font-black text-slate-900">Fogli Rosa e Patenti</h2>
      <p className="mt-1 text-sm text-slate-500">Modulo operativo per creare, aggiornare e consultare pratiche.</p>

      <div className="mt-5 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <input
            className="rounded-xl border border-slate-300 bg-white p-2.5"
            placeholder="Nome"
            value={form.nome}
            onChange={(e) => setForm((prev) => ({ ...prev, nome: e.target.value }))}
          />
          <input
            className="rounded-xl border border-slate-300 bg-white p-2.5"
            placeholder="Cognome"
            value={form.cognome}
            onChange={(e) => setForm((prev) => ({ ...prev, cognome: e.target.value }))}
          />
          <input
            className="rounded-xl border border-slate-300 bg-white p-2.5"
            placeholder="Categoria pratica"
            value={form.categoria_patente}
            onChange={(e) => setForm((prev) => ({ ...prev, categoria_patente: e.target.value }))}
          />
          <input
            className="rounded-xl border border-slate-300 bg-white p-2.5"
            placeholder="Patente richiesta"
            value={form.patente_numero}
            onChange={(e) => setForm((prev) => ({ ...prev, patente_numero: e.target.value }))}
          />
          <input
            className="rounded-xl border border-slate-300 bg-white p-2.5"
            placeholder="Numero patente posseduta"
            value={form.numero_patente_posseduta}
            onChange={(e) => setForm((prev) => ({ ...prev, numero_patente_posseduta: e.target.value }))}
          />
          <input
            className="rounded-xl border border-slate-300 bg-white p-2.5"
            placeholder="Ente rilascio"
            value={form.ente_rilascio_patente}
            onChange={(e) => setForm((prev) => ({ ...prev, ente_rilascio_patente: e.target.value }))}
          />
          <input
            className="rounded-xl border border-slate-300 bg-white p-2.5"
            type="date"
            value={form.rilasciata_il_patente}
            onChange={(e) => setForm((prev) => ({ ...prev, rilasciata_il_patente: e.target.value }))}
          />
          <input
            className="rounded-xl border border-slate-300 bg-white p-2.5"
            type="date"
            value={form.scade_il_patente}
            onChange={(e) => setForm((prev) => ({ ...prev, scade_il_patente: e.target.value }))}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={onCreate}
            disabled={saving}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
          >
            Nuova pratica
          </button>
          <button
            onClick={onSave}
            disabled={saving || !selectedId}
            className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-600 disabled:opacity-60"
          >
            Salva modifiche
          </button>
          <button
            onClick={onDelete}
            disabled={saving || !selectedId}
            className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-60"
          >
            Elimina
          </button>
          <button
            onClick={resetForm}
            disabled={saving}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
          >
            Pulisci
          </button>
        </div>

        <p className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-700">{status}</p>
      </div>

      <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-slate-900">Archivio pratiche</h3>
          <input
            className="w-full max-w-sm rounded-xl border border-slate-300 bg-white p-2"
            placeholder="Cerca per nome, cognome, categoria, patente..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="mt-3 max-h-104 overflow-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="p-2 text-left">Cognome</th>
                <th className="p-2 text-left">Nome</th>
                <th className="p-2 text-left">Categoria pratica</th>
                <th className="p-2 text-left">Patente richiesta</th>
                <th className="p-2 text-left">N. patente posseduta</th>
                <th className="p-2 text-left">Scadenza</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const patente = extractPatenteData(row);
                const selected = selectedId === row.id;
                return (
                  <tr
                    key={row.id}
                    onClick={() => onSelectRow(row)}
                    className={`cursor-pointer border-t ${selected ? "bg-emerald-100" : "hover:bg-slate-50"}`}
                  >
                    <td className="p-2">{row.cognome || "-"}</td>
                    <td className="p-2">{row.nome || "-"}</td>
                    <td className="p-2">{row.categoria_patente || "-"}</td>
                    <td className="p-2">{row.patente_numero || "-"}</td>
                    <td className="p-2">{patente.numero_patente_posseduta || "-"}</td>
                    <td className="p-2">{patente.scade_il_patente ? toInputDate(patente.scade_il_patente) : "-"}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr className="border-t">
                  <td className="p-3 text-slate-500" colSpan={6}>Nessuna pratica disponibile.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedRow && (
        <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <p className="text-sm text-slate-700">
            Pratica selezionata: <strong>{selectedRow.cognome} {selectedRow.nome}</strong>
          </p>
        </div>
      )}
    </ModernAppShell>
  );
}

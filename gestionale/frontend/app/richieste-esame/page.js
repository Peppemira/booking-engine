"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, authHeaders, checkSession, logoutSession } from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";

function paymentActionMeta(action) {
  const normalized = String(action || "").toLowerCase();
  if (normalized === "decurtazione") return { label: "Decurtazione", className: "bg-amber-100 text-amber-800" };
  if (normalized === "pagopa") return { label: "PagoPA", className: "bg-blue-100 text-blue-800" };
  if (normalized === "ritenta") return { label: "Ritenta", className: "bg-violet-100 text-violet-800" };
  if (normalized === "recupero_credito") return { label: "Recupero credito", className: "bg-emerald-100 text-emerald-800" };
  return { label: action || "-", className: "bg-slate-100 text-slate-700" };
}

function paymentStatusMeta(status) {
  const normalized = String(status || "").toLowerCase();
  if (["ok", "success", "succeeded", "completato"].includes(normalized)) {
    return { label: status || "ok", className: "bg-emerald-100 text-emerald-800" };
  }
  if (["error", "errore", "failed", "ko"].includes(normalized)) {
    return { label: status || "errore", className: "bg-rose-100 text-rose-800" };
  }
  return { label: status || "-", className: "bg-slate-100 text-slate-700" };
}

export default function RichiesteEsamePage() {
  const router = useRouter();
  const [rows, setRows] = useState([]);
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [historyFilters, setHistoryFilters] = useState({
    from: "",
    to: "",
    action: "all",
    operator: "",
  });
  const [historySort, setHistorySort] = useState({
    field: "at",
    direction: "desc",
  });
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(20);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({
    nome: "",
    cognome: "",
    data: "",
    categoria: "",
    ora: "",
    luogo: "",
  });
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Caricamento...");
  const [filters, setFilters] = useState({
    testo: "",
    dataDa: "",
    dataA: "",
  });
  const [form, setForm] = useState({
    nome: "",
    cognome: "",
    data: "",
    categoria: "B",
    ora: "",
    luogo: "",
  });

  useEffect(() => {
    let cancelled = false;

    async function verifyAndLoad() {
      const session = await checkSession();
      if (!session.ok) {
        if (!cancelled) router.replace("/login");
        return;
      }

      if (!cancelled) {
        setReady(true);
        load();
      }
    }

    verifyAndLoad();
    return () => {
      cancelled = true;
    };
  }, [router]);

  function normalizeDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  async function onLogout() {
    await logoutSession();
    router.replace("/login");
  }

  async function load() {
    try {
      const params = new URLSearchParams({
        type: "payment-action",
        limit: "20",
      });

      if (historyFilters.from) params.set("from", historyFilters.from);
      if (historyFilters.to) params.set("to", historyFilters.to);
      if (historyFilters.action && historyFilters.action !== "all") params.set("action", historyFilters.action);
      if (historyFilters.operator) params.set("operator", historyFilters.operator);

      const [rowsRes, historyRes] = await Promise.all([
        fetch(`${API_BASE}/api/prenotazioni`, {
          headers: authHeaders(),
        }),
        fetch(`${API_BASE}/api/import-history?${params.toString()}`, {
          headers: authHeaders(),
        }),
      ]);

      const data = await rowsRes.json();
      const historyData = await historyRes.json().catch(() => ({ success: true, history: [] }));

      if (!rowsRes.ok || !Array.isArray(data)) {
        throw new Error(data.error || "Errore caricamento richieste esame");
      }
      setRows(data);
      setPaymentHistory(Array.isArray(historyData?.history) ? historyData.history : []);
      setStatus(`Richieste caricate: ${data.length}`);
    } catch (error) {
      setStatus(`Errore: ${error.message}`);
    }
  }

  async function exportHistoryCsv() {
    try {
      const params = new URLSearchParams({
        type: "payment-action",
        format: "csv",
      });

      if (historyFilters.from) params.set("from", historyFilters.from);
      if (historyFilters.to) params.set("to", historyFilters.to);
      if (historyFilters.action && historyFilters.action !== "all") params.set("action", historyFilters.action);
      if (historyFilters.operator) params.set("operator", historyFilters.operator);

      const res = await fetch(`${API_BASE}/api/import-history/export?${params.toString()}`, {
        headers: authHeaders(),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || "Errore export CSV");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `storico-pagamenti-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      setStatus("Export CSV storico pagamenti completato");
    } catch (error) {
      setStatus(`Errore: ${error.message}`);
    }
  }

  async function onCreate() {
    setStatus("Invio richiesta esame in corso...");
    try {
      const res = await fetch(`${API_BASE}/api/prenota-esame`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Errore creazione richiesta esame");
      }

      setForm({
        nome: "",
        cognome: "",
        data: "",
        categoria: "B",
        ora: "",
        luogo: "",
      });

      await load();
      setStatus("Richiesta esame creata con successo");
    } catch (error) {
      setStatus(`Errore: ${error.message}`);
    }
  }

  function startEdit(row) {
    setEditingId(row.id);
    setEditForm({
      nome: row.nome || "",
      cognome: row.cognome || "",
      data: normalizeDate(row.data || row.data_prenotazione || row.created_at) || "",
      categoria: row.categoria || "B",
      ora: row.ora || "",
      luogo: row.luogo || "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm({
      nome: "",
      cognome: "",
      data: "",
      categoria: "",
      ora: "",
      luogo: "",
    });
  }

  async function saveEdit(id) {
    setStatus("Salvataggio modifica in corso...");
    try {
      const res = await fetch(`${API_BASE}/api/prenotazioni/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Errore modifica richiesta");
      }

      setStatus("Richiesta aggiornata con successo");
      cancelEdit();
      await load();
    } catch (error) {
      setStatus(`Errore: ${error.message}`);
    }
  }

  async function deleteRow(id) {
    setStatus("Annullamento richiesta in corso...");
    try {
      const res = await fetch(`${API_BASE}/api/prenotazioni/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Errore annullamento richiesta");
      }

      setStatus("Richiesta annullata con successo");
      if (editingId === id) {
        cancelEdit();
      }
      await load();
    } catch (error) {
      setStatus(`Errore: ${error.message}`);
    }
  }

  async function paymentAction(id, action) {
    setStatus(`Operazione pagamento '${action}' in corso...`);
    try {
      const res = await fetch(`${API_BASE}/api/prenotazioni/${id}/payment-action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ action }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Errore operazione pagamento");
      }

      setStatus(`Pagamento aggiornato: ${data.esito || data.paymentStatus || "ok"}`);
      await load();
    } catch (error) {
      setStatus(`Errore: ${error.message}`);
    }
  }

  const filtered = useMemo(() => {
    const search = String(filters.testo || "").toLowerCase().trim();
    const from = filters.dataDa || "";
    const to = filters.dataA || "";

    return rows.filter((row) => {
      const fullText = `${row.nome || ""} ${row.cognome || ""} ${row.categoria || ""} ${row.esito || ""}`.toLowerCase();
      const rowDate = normalizeDate(row.data || row.data_prenotazione || row.created_at);

      if (search && !fullText.includes(search)) return false;
      if (from && rowDate && rowDate < from) return false;
      if (to && rowDate && rowDate > to) return false;
      return true;
    });
  }, [rows, filters]);

  const paymentSummary = useMemo(() => {
    const actionCounts = {
      decurtazione: 0,
      pagopa: 0,
      ritenta: 0,
      recupero_credito: 0,
      altro: 0,
    };
    const statusCounts = {
      ok: 0,
      errore: 0,
      altro: 0,
    };

    for (const entry of paymentHistory) {
      const action = String(entry?.criteria?.action || "").toLowerCase();
      if (action in actionCounts) actionCounts[action] += 1;
      else actionCounts.altro += 1;

      const status = String(entry?.status || "").toLowerCase();
      if (["ok", "success", "succeeded", "completato"].includes(status)) statusCounts.ok += 1;
      else if (["error", "errore", "failed", "ko"].includes(status)) statusCounts.errore += 1;
      else statusCounts.altro += 1;
    }

    return { actionCounts, statusCounts, total: paymentHistory.length };
  }, [paymentHistory]);

  const sortedPaymentHistory = useMemo(() => {
    const list = [...paymentHistory];
    const directionFactor = historySort.direction === "asc" ? 1 : -1;

    list.sort((a, b) => {
      if (historySort.field === "at") {
        const av = new Date(a?.at || 0).getTime();
        const bv = new Date(b?.at || 0).getTime();
        return (av - bv) * directionFactor;
      }

      if (historySort.field === "action") {
        const av = String(a?.criteria?.action || "").toLowerCase();
        const bv = String(b?.criteria?.action || "").toLowerCase();
        return av.localeCompare(bv) * directionFactor;
      }

      if (historySort.field === "status") {
        const av = String(a?.status || "").toLowerCase();
        const bv = String(b?.status || "").toLowerCase();
        return av.localeCompare(bv) * directionFactor;
      }

      return 0;
    });

    return list;
  }, [paymentHistory, historySort]);

  const historyTotalPages = useMemo(() => {
    return Math.max(1, Math.ceil(sortedPaymentHistory.length / historyPageSize));
  }, [sortedPaymentHistory.length, historyPageSize]);

  const pagedPaymentHistory = useMemo(() => {
    const start = (historyPage - 1) * historyPageSize;
    return sortedPaymentHistory.slice(start, start + historyPageSize);
  }, [sortedPaymentHistory, historyPage, historyPageSize]);

  function toggleHistorySort(field) {
    setHistorySort((prev) => {
      if (prev.field === field) {
        return {
          field,
          direction: prev.direction === "asc" ? "desc" : "asc",
        };
      }
      return {
        field,
        direction: "asc",
      };
    });
  }

  function sortIcon(field) {
    if (historySort.field !== field) return "↕";
    return historySort.direction === "asc" ? "↑" : "↓";
  }

  useEffect(() => {
    setHistoryPage(1);
  }, [historyFilters, historySort, historyPageSize]);

  useEffect(() => {
    if (historyPage > historyTotalPages) {
      setHistoryPage(historyTotalPages);
    }
  }, [historyPage, historyTotalPages]);

  useEffect(() => {
    if (ready) {
      load();
    }
  }, [historyFilters]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-100 p-6">
        <main className="mx-auto max-w-6xl rounded-xl bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-700">Verifica sessione...</p>
        </main>
      </div>
    );
  }

  return (
    <ModernAppShell
      title="Richieste Esame"
      subtitle="Gestione richieste, pagamenti e storico operazioni"
      activeKey="richieste-esame"
      onLogout={onLogout}
    >
      <h2 className="text-3xl font-black text-slate-900" title="Gestione richieste esame patente">Richieste Esame</h2>
      <p className="mt-1 text-sm text-slate-500">Inserimento, ricerca, modifica e gestione pagamenti.</p>

        <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-base font-semibold" title="Inserisci una nuova richiesta esame">Nuova richiesta esame</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <input className="rounded-xl border border-slate-300 bg-white p-2.5" placeholder="Nome" title="Nome candidato" value={form.nome} onChange={(e) => setForm((prev) => ({ ...prev, nome: e.target.value }))} />
            <input className="rounded-xl border border-slate-300 bg-white p-2.5" placeholder="Cognome" title="Cognome candidato" value={form.cognome} onChange={(e) => setForm((prev) => ({ ...prev, cognome: e.target.value }))} />
            <input className="rounded-xl border border-slate-300 bg-white p-2.5" type="date" title="Data richiesta/esame" value={form.data} onChange={(e) => setForm((prev) => ({ ...prev, data: e.target.value }))} />
            <input className="rounded-xl border border-slate-300 bg-white p-2.5" placeholder="Categoria" title="Categoria patente (es. B, A2, C)" value={form.categoria} onChange={(e) => setForm((prev) => ({ ...prev, categoria: e.target.value }))} />
            <input className="rounded-xl border border-slate-300 bg-white p-2.5" placeholder="Ora" title="Ora (opzionale)" value={form.ora} onChange={(e) => setForm((prev) => ({ ...prev, ora: e.target.value }))} />
            <input className="rounded-xl border border-slate-300 bg-white p-2.5" placeholder="Luogo" title="Sede UMC o luogo esame (opzionale)" value={form.luogo} onChange={(e) => setForm((prev) => ({ ...prev, luogo: e.target.value }))} />
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={onCreate} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500" title="Crea richiesta esame">Crea richiesta</button>
            <button onClick={load} className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-600" title="Ricarica elenco richieste">Aggiorna elenco</button>
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-base font-semibold" title="Filtri di ricerca richieste">Ricerca richieste</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <input className="rounded-xl border border-slate-300 bg-white p-2.5" placeholder="Cerca per nome, cognome, categoria, stato" title="Filtro testuale" value={filters.testo} onChange={(e) => setFilters((prev) => ({ ...prev, testo: e.target.value }))} />
            <input className="rounded-xl border border-slate-300 bg-white p-2.5" type="date" title="Data da" value={filters.dataDa} onChange={(e) => setFilters((prev) => ({ ...prev, dataDa: e.target.value }))} />
            <input className="rounded-xl border border-slate-300 bg-white p-2.5" type="date" title="Data a" value={filters.dataA} onChange={(e) => setFilters((prev) => ({ ...prev, dataA: e.target.value }))} />
          </div>
        </div>

        <p className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-700" title="Stato operazioni richieste esame">{status}</p>

        <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold" title="Storico operazioni pagamento/ritenta/recupero credito">Storico azioni pagamento</h2>
            <div className="flex gap-2">
              <button onClick={load} className="rounded-xl bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-600" title="Aggiorna storico azioni pagamento">
                Aggiorna storico
              </button>
              <button onClick={exportHistoryCsv} className="rounded-xl bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-600" title="Esporta storico pagamenti in CSV con filtri attivi">
                Export CSV
              </button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-700">
            <span className="font-medium">Legenda:</span>
            <span className="rounded px-2 py-1 bg-amber-100 text-amber-800">Decurtazione</span>
            <span className="rounded px-2 py-1 bg-blue-100 text-blue-800">PagoPA</span>
            <span className="rounded px-2 py-1 bg-violet-100 text-violet-800">Ritenta</span>
            <span className="rounded px-2 py-1 bg-emerald-100 text-emerald-800">Recupero credito / OK</span>
            <span className="rounded px-2 py-1 bg-rose-100 text-rose-800">Errore</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-700">
            <span className="font-medium">Totale:</span>
            <span className="rounded px-2 py-1 bg-slate-200 text-slate-800">{paymentSummary.total}</span>
            <span className="font-medium ml-2">Azioni:</span>
            <span className="rounded px-2 py-1 bg-amber-100 text-amber-800">Decurtazione: {paymentSummary.actionCounts.decurtazione}</span>
            <span className="rounded px-2 py-1 bg-blue-100 text-blue-800">PagoPA: {paymentSummary.actionCounts.pagopa}</span>
            <span className="rounded px-2 py-1 bg-violet-100 text-violet-800">Ritenta: {paymentSummary.actionCounts.ritenta}</span>
            <span className="rounded px-2 py-1 bg-emerald-100 text-emerald-800">Recupero credito: {paymentSummary.actionCounts.recupero_credito}</span>
            <span className="rounded px-2 py-1 bg-slate-100 text-slate-700">Altro: {paymentSummary.actionCounts.altro}</span>
            <span className="font-medium ml-2">Stato:</span>
            <span className="rounded px-2 py-1 bg-emerald-100 text-emerald-800">OK: {paymentSummary.statusCounts.ok}</span>
            <span className="rounded px-2 py-1 bg-rose-100 text-rose-800">Errore: {paymentSummary.statusCounts.errore}</span>
            <span className="rounded px-2 py-1 bg-slate-100 text-slate-700">Altro: {paymentSummary.statusCounts.altro}</span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
            <input
              className="rounded-xl border border-slate-300 bg-white p-2"
              type="date"
              title="Data minima storico pagamenti"
              value={historyFilters.from}
              onChange={(e) => setHistoryFilters((prev) => ({ ...prev, from: e.target.value }))}
            />
            <input
              className="rounded-xl border border-slate-300 bg-white p-2"
              type="date"
              title="Data massima storico pagamenti"
              value={historyFilters.to}
              onChange={(e) => setHistoryFilters((prev) => ({ ...prev, to: e.target.value }))}
            />
            <select
              className="rounded-xl border border-slate-300 bg-white p-2"
              title="Filtro azione pagamento"
              value={historyFilters.action}
              onChange={(e) => setHistoryFilters((prev) => ({ ...prev, action: e.target.value }))}
            >
              <option value="all">Tutte le azioni</option>
              <option value="decurtazione">Decurtazione</option>
              <option value="pagopa">PagoPA</option>
              <option value="ritenta">Ritenta</option>
              <option value="recupero_credito">Recupero credito</option>
            </select>
            <input
              className="rounded-xl border border-slate-300 bg-white p-2"
              placeholder="Filtra per operatore (email/nome)"
              title="Filtro operatore nello storico pagamenti"
              value={historyFilters.operator}
              onChange={(e) => setHistoryFilters((prev) => ({ ...prev, operator: e.target.value }))}
            />
          </div>
          <div className="mt-3 max-h-88 overflow-auto overflow-y-auto rounded-2xl bg-white ring-1 ring-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100">
                <tr>
                  <th className="p-2 text-left">
                    <button className="font-medium hover:underline" onClick={() => toggleHistorySort("at")} title="Ordina per data/ora">
                      Data/Ora {sortIcon("at")}
                    </button>
                  </th>
                  <th className="p-2 text-left">
                    <button className="font-medium hover:underline" onClick={() => toggleHistorySort("action")} title="Ordina per azione pagamento">
                      Azione {sortIcon("action")}
                    </button>
                  </th>
                  <th className="p-2 text-left">ID</th>
                  <th className="p-2 text-left">
                    <button className="font-medium hover:underline" onClick={() => toggleHistorySort("status")} title="Ordina per stato operazione">
                      Stato {sortIcon("status")}
                    </button>
                  </th>
                  <th className="p-2 text-left">Operatore</th>
                  <th className="p-2 text-left">Messaggio</th>
                </tr>
              </thead>
              <tbody>
                {pagedPaymentHistory.map((entry) => {
                  const action = paymentActionMeta(entry.criteria?.action);
                  const statusMeta = paymentStatusMeta(entry.status);
                  return (
                    <tr key={entry.id} className="border-t">
                      <td className="p-2">{entry.at ? new Date(entry.at).toLocaleString("it-IT") : "-"}</td>
                      <td className="p-2">
                        <span className={`rounded px-2 py-1 text-xs font-medium ${action.className}`}>{action.label}</span>
                      </td>
                      <td className="p-2">{entry.criteria?.id || "-"}</td>
                      <td className="p-2">
                        <span className={`rounded px-2 py-1 text-xs font-medium ${statusMeta.className}`}>{statusMeta.label}</span>
                      </td>
                      <td className="p-2">{entry.criteria?.actor?.email || "-"}</td>
                      <td className="p-2">{entry.message || "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
            <div className="flex items-center gap-2">
              <span>Righe per pagina:</span>
              <select
                className="rounded-xl border border-slate-300 p-1"
                value={historyPageSize}
                onChange={(e) => setHistoryPageSize(Number(e.target.value) || 20)}
                title="Numero righe per pagina nello storico"
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="rounded-xl border border-slate-300 px-2 py-1 disabled:opacity-50"
                onClick={() => setHistoryPage((prev) => Math.max(1, prev - 1))}
                disabled={historyPage <= 1}
                title="Pagina precedente"
              >
                ← Precedente
              </button>
              <span>
                Pagina {historyPage} / {historyTotalPages}
              </span>
              <button
                className="rounded-xl border border-slate-300 px-2 py-1 disabled:opacity-50"
                onClick={() => setHistoryPage((prev) => Math.min(historyTotalPages, prev + 1))}
                disabled={historyPage >= historyTotalPages}
                title="Pagina successiva"
              >
                Successiva →
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 max-h-88 overflow-auto overflow-y-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="p-2 text-left" title="Nome candidato">Nome</th>
                <th className="p-2 text-left" title="Cognome candidato">Cognome</th>
                <th className="p-2 text-left" title="Data richiesta o prenotazione">Data</th>
                <th className="p-2 text-left" title="Categoria patente">Categoria</th>
                <th className="p-2 text-left" title="Esito/stato richiesta">Stato</th>
                <th className="p-2 text-left" title="Stato pagamento richiesta">Pagamento</th>
                <th className="p-2 text-left" title="Ora eventuale">Ora</th>
                <th className="p-2 text-left" title="Luogo eventuale">Luogo</th>
                <th className="p-2 text-left" title="Azioni disponibili">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const isEditing = editingId === row.id;
                return (
                  <tr key={row.id} className="border-t">
                    <td className="p-2">
                      {isEditing ? (
                        <input className="w-full rounded border p-1" value={editForm.nome} onChange={(e) => setEditForm((prev) => ({ ...prev, nome: e.target.value }))} />
                      ) : (row.nome || "-")}
                    </td>
                    <td className="p-2">
                      {isEditing ? (
                        <input className="w-full rounded border p-1" value={editForm.cognome} onChange={(e) => setEditForm((prev) => ({ ...prev, cognome: e.target.value }))} />
                      ) : (row.cognome || "-")}
                    </td>
                    <td className="p-2">
                      {isEditing ? (
                        <input className="w-full rounded border p-1" type="date" value={editForm.data} onChange={(e) => setEditForm((prev) => ({ ...prev, data: e.target.value }))} />
                      ) : (normalizeDate(row.data || row.data_prenotazione || row.created_at) || "-")}
                    </td>
                    <td className="p-2">
                      {isEditing ? (
                        <input className="w-full rounded border p-1" value={editForm.categoria} onChange={(e) => setEditForm((prev) => ({ ...prev, categoria: e.target.value }))} />
                      ) : (row.categoria || "-")}
                    </td>
                    <td className="p-2">{row.esito || "inviata"}</td>
                    <td className="p-2">{row.payment_status || "-"}</td>
                    <td className="p-2">
                      {isEditing ? (
                        <input className="w-full rounded border p-1" value={editForm.ora} onChange={(e) => setEditForm((prev) => ({ ...prev, ora: e.target.value }))} />
                      ) : (row.ora || "-")}
                    </td>
                    <td className="p-2">
                      {isEditing ? (
                        <input className="w-full rounded border p-1" value={editForm.luogo} onChange={(e) => setEditForm((prev) => ({ ...prev, luogo: e.target.value }))} />
                      ) : (row.luogo || "-")}
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        {isEditing ? (
                          <>
                            <button className="rounded bg-violet-600 px-2 py-1 text-xs text-white" onClick={() => saveEdit(row.id)} title="Salva modifiche richiesta">Salva</button>
                            <button className="rounded bg-slate-600 px-2 py-1 text-xs text-white" onClick={cancelEdit} title="Annulla modifica">Chiudi</button>
                          </>
                        ) : (
                          <button className="rounded bg-violet-600 px-2 py-1 text-xs text-white" onClick={() => startEdit(row)} title="Modifica questa richiesta">Modifica</button>
                        )}
                        <button className="rounded bg-emerald-600 px-2 py-1 text-xs text-white" onClick={() => paymentAction(row.id, "decurtazione")} title="Imposta pagamento con decurtazione credito">Decurtazione</button>
                        <button className="rounded bg-sky-600 px-2 py-1 text-xs text-white" onClick={() => paymentAction(row.id, "pagopa")} title="Imposta pagamento con PagoPA">PagoPA</button>
                        <button className="rounded bg-amber-600 px-2 py-1 text-xs text-white" onClick={() => paymentAction(row.id, "ritenta")} title="Ritenta pagamento">Ritenta</button>
                        <button className="rounded bg-emerald-700 px-2 py-1 text-xs text-white" onClick={() => paymentAction(row.id, "recupero_credito")} title="Esegui recupero credito">Recupero credito</button>
                        <button className="rounded bg-rose-600 px-2 py-1 text-xs text-white" onClick={() => deleteRow(row.id)} title="Annulla questa richiesta">Annulla</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
    </ModernAppShell>
  );
}

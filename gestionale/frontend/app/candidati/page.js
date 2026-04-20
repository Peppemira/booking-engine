"use client";

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import CodiceFiscale from "codice-fiscale-js";
import {
  API_BASE,
  authHeaders,
  checkSession,
  logoutSession,
} from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";
import {
  buildEmptyEditor,
  extractExtendedEditor,
  formatData,
  mapCandidateForSave,
  PATENTE_RICHIESTA_OPTIONS,
  TIPO_DOCUMENTO_OPTIONS,
  TIPO_ISCRIZIONE_OPTIONS,
} from "../../lib/candidatoEditor";
import { exportCSV } from "../../lib/exportTable";
import SendLinkPopover from "../../lib/SendLinkPopover";

/** URL servizio scanner locale (architettura 2 componenti: Gestionale Web ↔ Scanner Service localhost ↔ TWAIN/WIA) */
const SCANNER_SERVICE_URL = process.env.NEXT_PUBLIC_SCANNER_SERVICE_URL || "http://localhost:5001";

/** Opzioni filtro Tipo Iscrizione (GeCA: TIPO ISCRIZIONE dropdown) */
const TIPO_ISCRIZIONE_FILTER_OPTIONS = [
  "TUTTI",
  "RILASCI PER ESAME",
  "CONFERME VALIDITA'",
  "CERTIFICATI MEDICI",
  "DUPLICATI PATENTE",
  "CONVERSIONI PATENTE",
  "PATENTE C.Q.C.",
  "C.Q.C. CARD",
  "ARCHIVIO DATI",
  "ESERCITAZIONI GUIDE",
  "RECUPERI PUNTI",
  "PERMESSI INTERNAZ.",
  "GUIDE ACCOMPAGNATE",
  "CORSI C.Q.C.",
  "PERMESSI PROVVISORI",
  "PATENTE NAUTICA",
  "CORSI A.D.R.",
  "C.Q.C. REVISIONE",
  "INTERNO",
  "PRIVATISTA",
  "REVISIONE",
];

const PATENTE_FILTER_OPTIONS = ["TUTTE", ...PATENTE_RICHIESTA_OPTIONS];

function CandidatiPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  // Spostato in alto: selectedRow è usato in useCallback più sotto, va dichiarato prima
  // (TDZ fix per ReferenceError 'Cannot access selectedRow before initialization').
  const selectedRow = useMemo(
    () => rows.find((r) => r.id === selectedId) || null,
    [rows, selectedId]
  );
  const [editMode, setEditMode] = useState("none");
  const [editor, setEditor] = useState(() => buildEmptyEditor("B"));
  const [editorBaseRawPortale, setEditorBaseRawPortale] = useState({});
  const tipoFromUrl = searchParams.get("tipo_iscrizione");
  const initialTipo = tipoFromUrl && TIPO_ISCRIZIONE_FILTER_OPTIONS.includes(tipoFromUrl) ? tipoFromUrl : "TUTTI";
  const [filters, setFilters] = useState({
    cognome: "",
    nome: "",
    codice_fiscale: "",
    categoria_patente: "TUTTE",
    archivio: "ATTUALE",
    codice_autoscuola: "",
    tipo_iscrizione: initialTipo,
  });
  const [syncScope, setSyncScope] = useState("attuale");
  const [syncArchivioBusy, setSyncArchivioBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [spostaArchivioBusy, setSpostaArchivioBusy] = useState(false);
  const [showRecuperoModal, setShowRecuperoModal] = useState(false);
  const [recuperoBusy, setRecuperoBusy] = useState(false);
  const [recuperoForm, setRecuperoForm] = useState({ codiceAutoscuola: "", cognome: "", numeroPatente: "", protocolloCertificatoMedico: "", marcaOperativa: "" });
  const [showNuovaIscrizioneModal, setShowNuovaIscrizioneModal] = useState(false);
  const [showSchedaModal, setShowSchedaModal] = useState(false);
  const [schedaData, setSchedaData] = useState(null);
  // Storico quiz (Punto 15)
  const [showQuizModal, setShowQuizModal] = useState(false);
  const [quizData, setQuizData]   = useState(null);
  const [quizBusy, setQuizBusy]   = useState(false);
  const [quizErr, setQuizErr]     = useState("");
  const [schedaBusy, setSchedaBusy] = useState(false);
  const [schedaErr, setSchedaErr] = useState("");
  // Sync archivio completo (replica iPatente)
  const [syncCompletoBusy, setSyncCompletoBusy] = useState(false);
  const [syncCompletoLog, setSyncCompletoLog] = useState("");
  // Foto e firma portale
  const [fotoFirmaBusy, setFotoFirmaBusy] = useState(false);
  const [fotoFirmaMsg, setFotoFirmaMsg] = useState("");
  // Sync singolo candidato dal portale
  const [syncCandBusy, setSyncCandBusy] = useState(false);
  const [syncCandMsg, setSyncCandMsg] = useState("");

  // Calcolo automatico codice fiscale da cognome, nome, data nascita, sesso, comune e provincia (2 car).
  useEffect(() => {
    if (editMode !== "edit" && editMode !== "create") return;
    const cog = String(editor.cognome || "").trim().toUpperCase();
    const nom = String(editor.nome || "").trim().toUpperCase();
    const dn = editor.data_nascita;
    const sess = editor.sesso === "F" || editor.sesso === "M" ? editor.sesso : null;
    const com = String(editor.comune_nascita || "").trim() || "Roma";
    const prov = String(editor.prov_nascita || "").trim().toUpperCase().slice(0, 2) || "RM";
    if (!cog || !nom || !dn || !sess) return;
    const match = dn.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return;
    const [, y, m, d] = match;
    const day = parseInt(d, 10);
    const month = parseInt(m, 10);
    const year = parseInt(y, 10);
    if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900) return;
    try {
      const cfObj = new CodiceFiscale({
        surname: cog,
        name: nom,
        gender: sess,
        day,
        month,
        year,
        birthplace: com,
        birthplaceProvincia: prov,
      });
      const computed = cfObj && (cfObj.cf || (cfObj.toString && cfObj.toString()));
      if (computed && /^[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]$/.test(computed)) {
        setEditor((prev) => (prev.codice_fiscale === computed ? prev : { ...prev, codice_fiscale: computed }));
      }
    } catch (_) {}
  }, [editor.cognome, editor.nome, editor.data_nascita, editor.sesso, editor.comune_nascita, editor.prov_nascita, editMode]);

  const loadCandidates = useCallback(async (archivioOverride) => {
    setStatus("Caricamento...");
    try {
      const archivio = String(archivioOverride ?? filters.archivio ?? "ATTUALE").toUpperCase();
      const q = new URLSearchParams();
      if (archivio && archivio !== "ENTRAMBI") q.set("archivio", archivio);
      const res = await fetch(`${API_BASE}/api/candidates?${q}`, {
        cache: "no-store",
        headers: { ...authHeaders(), "Cache-Control": "no-cache" },
      });
      const data = await res.json();
      if (!res.ok || !Array.isArray(data)) throw new Error(data?.error || "Errore caricamento");
      setRows(data);
      setStatus(`Candidati: ${data.length}`);
      return data;
    } catch (e) {
      setStatus(`Errore: ${e.message}`);
      return [];
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- archivio passato come argomento quando serve
  }, []);

  const onAggiornaDaPortale = useCallback(async () => {
    if (syncArchivioBusy) return;
    const codiceAutoscuola = String(user?.codice_autoscuola || filters.codice_autoscuola || "").trim();
    if (!codiceAutoscuola) {
      setStatus("Codice autoscuola mancante: inserirlo nel campo «Cod. autoscuola» sotto oppure in Impostazioni autoscuola.");
      return;
    }
    const statuses = syncScope === "entrambi"
      ? ["attivi", "passati"]
      : syncScope === "storico"
        ? ["passati"]
        : ["attivi"];
    setSyncArchivioBusy(true);
    setStatus(`Aggiornamento da portale in corso (${statuses.join(" + ")}) per codice ${codiceAutoscuola}...`);
    try {
      let aggregate = { imported: 0, selected: 0, parsed: 0, errors: 0 };
      for (const statoFiltro of statuses) {
        const res = await fetch(`${API_BASE}/api/portal/import-archivio`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ codiceAutoscuola, statoFiltro }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) throw new Error(data?.error || `Import ${statoFiltro} non riuscito`);
        aggregate.imported += Number(data?.imported ?? 0);
        aggregate.selected += Number(data?.selected ?? 0);
        aggregate.parsed += Number(data?.parsed ?? 0);
        aggregate.errors += Array.isArray(data?.errors) ? data.errors.length : 0;
      }
      await loadCandidates();
      setStatus(
        `Archivio aggiornato da portale: ${aggregate.imported} importati, ${aggregate.selected} selezionati, ${aggregate.parsed} letti, ${aggregate.errors} errori.`
      );
    } catch (e) {
      const msg = String(e?.message || e || "").toLowerCase();
      const fuoriOrario =
        msg.includes("err_connection_reset") ||
        msg.includes("err_connection_refused") ||
        msg.includes("err_connection_closed") ||
        msg.includes("failed to fetch") ||
        msg.includes("network error") ||
        msg.includes("timeout") ||
        msg.includes("portalelautomobilista") ||
        msg.includes("ilportaledellautomobilista");
      setStatus(
        fuoriOrario
          ? "Il portale dell’automobilista non è raggiungibile (fuori orario di servizio o indisponibile). Riprova in orario lavorativo."
          : `Errore aggiornamento da portale: ${e?.message || e}`
      );
    } finally {
      setSyncArchivioBusy(false);
    }
  }, [user?.codice_autoscuola, filters.codice_autoscuola, syncScope, syncArchivioBusy, loadCandidates]);

  /** Sync archivio completo via SSE: replica iPatente — tutti i candidati inclusi storici + scheda + foto/firma */
  const onSyncCompletoPortale = useCallback(async () => {
    if (syncCompletoBusy) return;
    setSyncCompletoBusy(true);
    setSyncCompletoLog("Avvio sync completo...");
    try {
      const res = await fetch(`${API_BASE}/api/sync/archivio-completo`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...authHeaders() },
        body: JSON.stringify({
          idAutAg: user?.codice_autoscuola || filters.codice_autoscuola || "",
          codUfficioMctc: user?.ufficio_mctc || "",
          fetchDettaglio: true,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("text/event-stream")) {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop();
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            try {
              const ev = JSON.parse(line.slice(5).trim());
              if (ev.event === "progress") {
                setSyncCompletoLog(`${ev.fase}: ${ev.completati}/${ev.totale} (${ev.errori} err)`);
              } else if (ev.event === "done") {
                setSyncCompletoLog(`✅ Completato: ${ev.found} candidati, ${ev.errors} errori`);
                await loadCandidates();
              } else if (ev.event === "error") {
                setSyncCompletoLog(`❌ ${ev.message}`);
              }
            } catch (_) {}
          }
        }
      } else {
        const data = await res.json();
        setSyncCompletoLog(`✅ ${data.found} candidati, ${data.errors} errori`);
        await loadCandidates();
      }
    } catch (e) {
      setSyncCompletoLog(`❌ ${e.message}`);
    } finally {
      setSyncCompletoBusy(false);
    }
  }, [syncCompletoBusy, user, filters.codice_autoscuola, loadCandidates]);

  /** Recupera foto e firma dal portale per il candidato selezionato */
  const onRecuperaFotoFirma = useCallback(async () => {
    if (!selectedRow || fotoFirmaBusy) return;
    const marcaOperativa = selectedRow.marca_operativa || selectedRow.raw_portale?.marcaOperativa;
    if (!marcaOperativa) {
      setFotoFirmaMsg("Marca operativa non disponibile per questo candidato");
      return;
    }
    setFotoFirmaBusy(true);
    setFotoFirmaMsg("Recupero foto e firma dal portale...");
    try {
      const res = await fetch(`${API_BASE}/api/sync/foto-firma`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ marcaOperativa, candidateId: selectedRow.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Errore");
      setFotoFirmaMsg(
        `✅ ${data.foto_url ? "Foto salvata" : "Foto non disponibile"} | ${data.firma_url ? "Firma salvata" : "Firma non disponibile"}`
      );
      await loadCandidates();
    } catch (e) {
      setFotoFirmaMsg(`❌ ${e.message}`);
    } finally {
      setFotoFirmaBusy(false);
    }
  }, [selectedRow, fotoFirmaBusy, loadCandidates]);

  /** Punto 10 — Sincronizza dati candidato dal Portale Automobilista (patente, ricevute, dati medici) */
  const onSincronizzaPortale = useCallback(async () => {
    if (!selectedRow || syncCandBusy) return;
    const cf = selectedRow.codice_fiscale || "";
    if (!cf) { setSyncCandMsg("❌ Codice fiscale mancante"); return; }
    setSyncCandBusy(true);
    setSyncCandMsg("⏳ Sincronizzazione in corso…");
    try {
      const params = new URLSearchParams({ cf, candidato_id: selectedRow.id });
      const res  = await fetch(`${API_BASE}/api/portal-sync/sync-candidato?${params}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const parts = [];
      if (data.patente?.numero_patente) parts.push(`Patente ${data.patente.numero_patente}`);
      if ((data.ricevute || []).length) parts.push(`${data.ricevute.length} ricevut${data.ricevute.length === 1 ? "a" : "e"}`);
      setSyncCandMsg(`✅ ${parts.length ? parts.join(" · ") : "Dati aggiornati"}`);
      await loadCandidates();
    } catch (e) {
      setSyncCandMsg(`❌ ${e.message}`);
    } finally {
      setSyncCandBusy(false);
    }
  }, [selectedRow, syncCandBusy, loadCandidates]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      const session = await checkSession();
      if (!session.ok) {
        if (!cancelled) router.replace("/login");
        return;
      }
      if (!cancelled) setUser(session.autoscuola);
      if (!cancelled && session.autoscuola?.codice_autoscuola)
        setFilters((prev) => (prev.codice_autoscuola ? prev : { ...prev, codice_autoscuola: String(session.autoscuola.codice_autoscuola || "").trim() }));
      if (!cancelled) await loadCandidates();
      if (!cancelled) setLoading(false);
    }
    init();
    return () => { cancelled = true; };
  }, [router, loadCandidates]);


  const filtered = useMemo(() => {
    const autosc = String(filters.codice_autoscuola || "").trim();
    const cog = String(filters.cognome || "").toLowerCase().trim();
    const nom = String(filters.nome || "").toLowerCase().trim();
    const cf = String(filters.codice_fiscale || "").toLowerCase().trim();
    const cat = String(filters.categoria_patente || "").trim();
    const tipoIscr = String(filters.tipo_iscrizione || "").trim();
    return rows.filter((row) => {
      if (autosc && String(row.codice_autoscuola || "").trim() !== autosc) return false;
      if (cog && !String(row.cognome || "").toLowerCase().includes(cog)) return false;
      if (nom && !String(row.nome || "").toLowerCase().includes(nom)) return false;
      if (cf && !String(row.codice_fiscale || "").toLowerCase().includes(cf)) return false;
      if (cat && cat !== "TUTTE" && String(row.categoria_patente || "").trim() !== cat) return false;
      const richiesta = String(row.stato_richiesta || row.stato || row.raw_portale?.anagrafica?.stato_richiesta || "").trim();
      if (tipoIscr && tipoIscr !== "TUTTI" && !richiesta.toUpperCase().includes(tipoIscr.toUpperCase())) return false;
      return true;
    });
  }, [rows, filters]);

  const onArchivioChange = (value) => {
    onFilterChange("archivio", value);
    setSelectedIds(new Set());
    loadCandidates(value);
  };

  async function onSpostaArchivio(storico) {
    const ids = Array.from(selectedIds);
    if (!ids.length) {
      setStatus("Seleziona almeno un candidato dalla tabella (checkbox).");
      return;
    }
    setSpostaArchivioBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/candidates/sposta-archivio`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ ids, storico }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || "Operazione non riuscita");
      setSelectedIds(new Set());
      setStatus(storico ? "Spostati in Archivio Storico." : "Ripristinati in Archivio Attuale.");
      await loadCandidates(filters.archivio);
    } catch (e) {
      setStatus(`Errore: ${e?.message || e}`);
    } finally {
      setSpostaArchivioBusy(false);
    }
  }

  function toggleSelected(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }


  const homonyms = useMemo(() => {
    if (!selectedRow) return [];
    const cog = String(selectedRow.cognome || "").trim().toUpperCase();
    const nom = String(selectedRow.nome || "").trim().toUpperCase();
    const cf = String(selectedRow.codice_fiscale || "").trim().toUpperCase();
    return rows.filter((row) => {
      if (row.id === selectedId) return false;
      const sameName = cog && nom && String(row.cognome || "").toUpperCase() === cog && String(row.nome || "").toUpperCase() === nom;
      const sameCf = cf && String(row.codice_fiscale || "").trim().toUpperCase() === cf;
      return sameName || sameCf;
    });
  }, [rows, selectedId, selectedRow]);

  const etaAnni = useMemo(() => {
    if (!editor.data_nascita) return "";
    const birth = new Date(editor.data_nascita);
    if (Number.isNaN(birth.getTime())) return "";
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--;
    return String(age);
  }, [editor.data_nascita]);

  function onFilterChange(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function onNuovoCandidato() {
    setEditor({ ...buildEmptyEditor("B"), data_iscrizione: new Date().toISOString().slice(0, 10), codice_autoscuola: user?.codice_autoscuola || "" });
    setEditorBaseRawPortale({});
    setSelectedId(null);
    setShowNuovaIscrizioneModal(true);
  }

  function onModifica() {
    if (!selectedRow) {
      setStatus("Seleziona un candidato");
      return;
    }
    setEditor({ ...buildEmptyEditor(selectedRow.categoria_patente || "B"), ...extractExtendedEditor(selectedRow) });
    setEditorBaseRawPortale(selectedRow.raw_portale || {});
    setEditMode("edit");
  }

  function onAnnullaDettaglio() {
    setEditMode("none");
  }

  async function onSalvaDettaglio() {
    const payload = mapCandidateForSave(editor, editorBaseRawPortale);
    if (!payload.nome || !payload.cognome) {
      setStatus("Nome e cognome obbligatori");
      return;
    }
    setStatus("Salvataggio...");
    try {
      if (editMode === "create") {
        const res = await fetch(`${API_BASE}/api/candidates`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || "Errore creazione");
        setStatus("Candidato creato");
      } else if (selectedId) {
        const res = await fetch(`${API_BASE}/api/candidates/${selectedId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || "Errore modifica");
        setStatus("Modifiche salvate");
      }
      setEditMode("none");
      await loadCandidates();
    } catch (e) {
      setStatus(`Errore: ${e.message}`);
    }
  }

  async function onElimina() {
    if (!selectedRow) {
      setStatus("Seleziona un candidato");
      return;
    }
    if (!typeof window || !window.confirm(`Eliminare ${selectedRow.cognome} ${selectedRow.nome}?`)) return;
    setStatus("Eliminazione...");
    try {
      const res = await fetch(`${API_BASE}/api/candidates/${selectedRow.id}`, { method: "DELETE", headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Errore eliminazione");
      setSelectedId(null);
      setEditMode("none");
      await loadCandidates();
      setStatus("Candidato eliminato");
    } catch (e) {
      setStatus(`Errore: ${e.message}`);
    }
  }

  function onRowDoubleClick(row) {
    setSelectedId(row.id);
    setEditor({ ...buildEmptyEditor(row.categoria_patente || "B"), ...extractExtendedEditor(row) });
    setEditorBaseRawPortale(row.raw_portale || {});
    setEditMode("edit");
  }

  async function onAvviaRecuperoDati() {
    const cod = String(recuperoForm.codiceAutoscuola || user?.codice_autoscuola || "").trim();
    const cog = String(recuperoForm.cognome || "").trim();
    const numPat = String(recuperoForm.numeroPatente || "").trim();
    if (!cod || !cog || !numPat) {
      setStatus("Inserire Autoscuola, Cognome e Num. Patente per il recupero dati.");
      return;
    }
    setRecuperoBusy(true);
    setStatus("Recupero dati dal portale in corso...");
    try {
      const res = await fetch(`${API_BASE}/api/portal/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          codiceAutoscuola: cod,
          cognome: cog,
          numeroPatente: numPat,
          protocolloCertificatoMedico: String(recuperoForm.protocolloCertificatoMedico || "").trim() || undefined,
          marcaOperativa: String(recuperoForm.marcaOperativa || "").trim() || undefined,
          autoSelectForBooking: false,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Recupero dati non riuscito");
      const result = data.result;
      if (result) {
        setEditor({ ...buildEmptyEditor(result.categoria_patente || "B"), ...extractExtendedEditor(result) });
        setEditorBaseRawPortale(result.raw_portale || {});
        setSelectedId(result.id);
        setEditMode("edit");
        setShowRecuperoModal(false);
        setStatus("Dati recuperati dal portale e form aggiornato.");
        await loadCandidates();
      } else {
        setStatus("Recupero completato ma nessun candidato restituito.");
      }
    } catch (e) {
      setStatus(`Errore recupero dati: ${e.message}`);
    } finally {
      setRecuperoBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-slate-600">Caricamento...</p>
      </div>
    );
  }

  return (
    <ModernAppShell
      title="Candidati"
      subtitle="Anagrafica e iscrizioni. Portale: codice autoscuola, archivio attivi/storico."
      activeKey="candidati"
      onLogout={() => logoutSession().then(() => router.replace("/login"))}
      user={user}
    >
      <div className="space-y-2">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Gestionale Candidati</h2>
          <p className="mt-0.5 text-sm text-slate-600">Anagrafica e iscrizioni. Portale: codice autoscuola, archivio attivi/storico.</p>
        </div>

        {/* Filtro Ricerca Archivio – card con bordi e ombra */}
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow">
          <h3 className="text-sm font-bold text-slate-900">Filtro Ricerca Archivio</h3>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
            <div>
              <label className="block text-[10px] font-bold uppercase leading-tight text-slate-600">AUTOSC.</label>
              <input
                className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
                placeholder="TUTTE o codice (es. 0674)"
                value={filters.codice_autoscuola}
                onChange={(e) => onFilterChange("codice_autoscuola", e.target.value)}
                title="Codice autoscuola: vuoto = tutte, altrimenti filtra e usa per sync portale"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase leading-tight text-slate-600">COGNOME</label>
              <input
                className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
                placeholder="Cognome"
                value={filters.cognome}
                onChange={(e) => onFilterChange("cognome", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase leading-tight text-slate-600">NOME</label>
              <input
                className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
                placeholder="Nome"
                value={filters.nome}
                onChange={(e) => onFilterChange("nome", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase leading-tight text-slate-600">TIPO ISCR.</label>
              <select
                className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
                value={filters.tipo_iscrizione}
                onChange={(e) => onFilterChange("tipo_iscrizione", e.target.value)}
                title="GeCA: TIPO ISCRIZIONE"
              >
                {TIPO_ISCRIZIONE_FILTER_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase leading-tight text-slate-600">PATENTE</label>
              <select
                className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
                value={filters.categoria_patente}
                onChange={(e) => onFilterChange("categoria_patente", e.target.value)}
                title="GeCA: PATENTE (categoria)"
              >
                {PATENTE_FILTER_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase leading-tight text-slate-600">C.F.</label>
              <input
                className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
                placeholder="Codice fiscale"
                value={filters.codice_fiscale}
                onChange={(e) => onFilterChange("codice_fiscale", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase leading-tight text-slate-600">ARCHIVIO</label>
              <select
                className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
                value={filters.archivio}
                onChange={(e) => onArchivioChange(e.target.value)}
                title="GeCA: tipArch ATTUALE / STORICO / ENTRAMBI"
              >
                <option value="ATTUALE">ATTUALE</option>
                <option value="STORICO">STORICO</option>
                <option value="ENTRAMBI">ENTRAMBI</option>
              </select>
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-amber-400 px-2 py-0.5 text-xs font-bold uppercase text-white shadow-sm">{filters.archivio}</span>
            <button type="button" onClick={onNuovoCandidato} className="rounded bg-emerald-500 px-2 py-1 text-xs font-semibold text-white shadow-sm hover:bg-emerald-600">Nuovo</button>
            <button type="button" onClick={onModifica} disabled={!selectedRow} className="rounded border border-slate-300 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">Modifica</button>
            <button type="button" onClick={onAggiornaDaPortale} disabled={syncArchivioBusy} className="rounded bg-violet-600 px-2 py-1 text-xs font-semibold text-white shadow-sm hover:bg-violet-700 disabled:opacity-60" title="Aggiorna da portale">{syncArchivioBusy ? "..." : "Aggiorna portale"}</button>
            <select className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700" value={syncScope} onChange={(e) => setSyncScope(e.target.value)} title="Sync: attivi / passati / entrambi">
              <option value="attuale">Solo attivi</option>
              <option value="storico">Solo passati</option>
              <option value="entrambi">Attivi + passati</option>
            </select>
            <button
              type="button"
              onClick={onSyncCompletoPortale}
              disabled={syncCompletoBusy}
              className="rounded bg-indigo-700 px-2 py-1 text-xs font-semibold text-white shadow-sm hover:bg-indigo-600 disabled:opacity-60"
              title="Sync completo iPatente: tutti i candidati (inclusi storici) + scheda + foto/firma"
            >
              {syncCompletoBusy ? "⏳ Sync..." : "🔄 Sync completo"}
            </button>
            {syncCompletoLog && (
              <span className="text-xs text-indigo-700 font-mono">{syncCompletoLog}</span>
            )}
            <button type="button" onClick={() => setFilters((prev) => ({ ...prev, cognome: "", nome: "", codice_fiscale: "", categoria_patente: "TUTTE", tipo_iscrizione: "TUTTI" }))} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">TUTTI</button>
            <Link href="/moduli/fogli-rosa-patenti" className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100">Fogli rosa</Link>
            {/* Punto 12 — Export CSV */}
            <button
              type="button"
              disabled={rows.length === 0}
              onClick={() => exportCSV(
                rows.map((r) => ({
                  cognome:           r.cognome || "",
                  nome:              r.nome || "",
                  codice_fiscale:    r.codice_fiscale || "",
                  data_nascita:      r.data_nascita || r.raw_portale?.anagrafica?.data_nascita || "",
                  categoria_patente: r.categoria_patente || "",
                  tipo_iscrizione:   r.stato_richiesta || r.raw_portale?.anagrafica?.stato_richiesta || "",
                  stato:             r.stato || "",
                  telefono:          r.telefono || r.raw_portale?.anagrafica?.telefono_1 || "",
                  email:             r.email || r.raw_portale?.anagrafica?.email || "",
                  codice_autoscuola: r.codice_autoscuola || "",
                  numero_patente:    r.numero_patente || r.patente_numero || "",
                  codice_foglio_rosa:r.codice_foglio_rosa || "",
                  data_iscrizione:   r.data_iscrizione || r.created_at || "",
                })),
                "candidati"
              )}
              className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
              title="Esporta la lista filtrata in CSV (apribile con Excel)"
            >
              📥 Export CSV
            </button>
            <span className="ml-1 truncate rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700 max-w-50 sm:max-w-none">{status}</span>
          </div>
        </div>

        {/* frmRiepilogo - scheda riepilogativa candidato selezionato */}
        {selectedRow && editMode === "none" && (
          <div className="rounded-lg border border-indigo-200 bg-violet-50 p-2 shadow-sm">
            <div className="flex gap-3">
              {/* Foto/firma pannello destro */}
              <div className="flex flex-col items-center gap-1 shrink-0">
                {/* Foto */}
                {selectedRow.raw_portale?.foto_url ? (
                  <img
                    src={selectedRow.raw_portale.foto_url}
                    alt="Foto candidato"
                    className="rounded border border-slate-300 object-cover bg-slate-100"
                    style={{ width: 56, height: 68 }}
                  />
                ) : (
                  <div className="rounded border border-dashed border-slate-300 bg-slate-100 flex items-center justify-center text-slate-400 text-lg" style={{ width: 56, height: 68 }}>
                    👤
                  </div>
                )}
                {/* Firma */}
                {selectedRow.raw_portale?.firma_url ? (
                  <img
                    src={selectedRow.raw_portale.firma_url}
                    alt="Firma candidato"
                    className="rounded border border-slate-300 object-contain bg-white"
                    style={{ width: 56, height: 24 }}
                  />
                ) : (
                  <div className="rounded border border-dashed border-slate-300 bg-white flex items-center justify-center text-slate-300 text-xs" style={{ width: 56, height: 24 }}>
                    firma
                  </div>
                )}
                <button
                  type="button"
                  onClick={onRecuperaFotoFirma}
                  disabled={fotoFirmaBusy}
                  title="Recupera foto e firma dal portale dell'automobilista"
                  className="text-[9px] rounded bg-slate-200 px-1 py-0.5 text-slate-600 hover:bg-slate-300 disabled:opacity-50 leading-tight"
                >
                  {fotoFirmaBusy ? "⏳" : "📷 portale"}
                </button>
                {fotoFirmaMsg && <span className="text-[9px] text-slate-500 text-center leading-tight max-w-14">{fotoFirmaMsg}</span>}
              </div>

              {/* Dati e azioni */}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <span className="text-slate-600">Cognome</span><span className="font-semibold text-slate-900">{selectedRow.cognome || "–"}</span>
                  <span className="text-slate-600">Nome</span><span className="font-semibold text-slate-900">{selectedRow.nome || "–"}</span>
                  <span className="text-slate-600">C.F.</span><span className="font-semibold text-slate-900">{selectedRow.codice_fiscale || "–"}</span>
                  <span className="text-slate-600">Tel</span><span className="font-semibold text-slate-900">{selectedRow.telefono || selectedRow.raw_portale?.anagrafica?.telefono_1 || "–"}</span>
                  <span className="text-slate-600">Cat.</span><span className="font-semibold text-slate-900">{selectedRow.categoria_patente || "–"}</span>
                  {selectedRow.marca_operativa && (
                    <><span className="text-slate-600">Marca</span><span className="font-mono text-slate-800">{selectedRow.marca_operativa}</span></>
                  )}
                </div>
                <div className="mt-1.5 flex gap-1 flex-wrap">
                  <button type="button" onClick={onModifica} className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-emerald-500">Modifica</button>
                  <button
                    type="button"
                    onClick={async () => {
                      setSchedaData(null); setSchedaErr(""); setSchedaBusy(true); setShowSchedaModal(true);
                      try {
                        const res = await fetch(`${API_BASE}/api/candidati-api/${selectedRow.id}/storia`, { headers: authHeaders() });
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        setSchedaData(await res.json());
                      } catch (e) { setSchedaErr(e.message || "Errore caricamento scheda"); }
                      finally { setSchedaBusy(false); }
                    }}
                    className="rounded bg-violet-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-violet-500"
                    title="Scheda riepilogativa completa (frmRiepilogo)"
                  >
                    📋 Scheda
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setQuizData(null); setQuizErr(""); setQuizBusy(true); setShowQuizModal(true);
                      try {
                        const res = await fetch(`${API_BASE}/api/candidati-api/${selectedRow.id}/storico-quiz`, { headers: authHeaders() });
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        setQuizData(await res.json());
                      } catch (e) { setQuizErr(e.message || "Errore"); }
                      finally { setQuizBusy(false); }
                    }}
                    className="rounded bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white hover:bg-amber-400"
                    title="Storico tentativi quiz teoria e guida pratica"
                  >
                    📊 Quiz
                  </button>
                  <Link href="/documenti" className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100">Documenti</Link>
                  <Link href="/esami" className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100">Esami</Link>
                  <Link href="/pagamenti" className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100">Pagamenti</Link>
                  <Link href={`/punti-patente${selectedRow.codice_fiscale ? `?cf=${encodeURIComponent(selectedRow.codice_fiscale)}&patente=${encodeURIComponent(selectedRow.patente_numero || "")}` : ""}`} className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100" title="Saldo punti patente">🪪 Punti</Link>
                  <button
                    type="button"
                    onClick={onSincronizzaPortale}
                    disabled={syncCandBusy}
                    title="Sincronizza dati candidato dal Portale Automobilista (patente, ricevute, dati medici)"
                    className="rounded border border-cyan-300 bg-cyan-50 px-2 py-0.5 text-xs text-cyan-800 hover:bg-cyan-100 disabled:opacity-50"
                  >
                    {syncCandBusy ? "⏳" : "🔄"} Sincronizza portale
                  </button>
                  <button type="button" onClick={onElimina} className="rounded border border-red-300 bg-red-50 px-2 py-0.5 text-xs text-red-700 hover:bg-red-100">Elimina</button>
                </div>
                {syncCandMsg && (
                  <div className="mt-1 text-[11px] text-slate-600">{syncCandMsg}</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* frmOmoni - omonimi */}
        {homonyms.length > 0 && selectedRow && (
          <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
            <strong>Omonimi:</strong> {homonyms.length} record stesso cognome/nome o C.F. – verificare duplicati.
          </div>
        )}

        {/* Iscrizioni in archivio – Storico/Attuale giallo-arancio/verde */}
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-slate-700">Iscrizioni in archivio</span>
            {filters.archivio === "ATTUALE" && (
              <button type="button" onClick={() => onSpostaArchivio(true)} disabled={spostaArchivioBusy || selectedIds.size === 0} className="rounded bg-amber-400 px-2 py-0.5 text-xs font-semibold text-white shadow-sm hover:bg-amber-500 disabled:opacity-50" title="Sposta in Archivio Storico">{spostaArchivioBusy ? "..." : "Storico"}</button>
            )}
            {filters.archivio === "STORICO" && (
              <button type="button" onClick={() => onSpostaArchivio(false)} disabled={spostaArchivioBusy || selectedIds.size === 0} className="rounded bg-emerald-500 px-2 py-0.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-600 disabled:opacity-50" title="Ripristina in Archivio Attuale">{spostaArchivioBusy ? "..." : "Attuale"}</button>
            )}
            {selectedIds.size > 0 && <span className="text-xs text-slate-600">{selectedIds.size} sel.</span>}
          </div>
          <div className="mt-1.5 max-h-70 overflow-auto rounded border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 z-10 bg-slate-200">
                <tr>
                  <th className="w-8 px-1 py-1 text-left font-semibold text-slate-700">✓</th>
                  <th className="px-1 py-1 text-left font-semibold text-slate-700">AUTOS</th>
                  <th className="px-1 py-1 text-left font-semibold text-slate-700">COGNOME</th>
                  <th className="px-1 py-1 text-left font-semibold text-slate-700">NOME</th>
                  <th className="px-1 py-1 text-left font-semibold text-slate-700">NASC.</th>
                  <th className="px-1 py-1 text-left font-semibold text-slate-700">TIPO</th>
                  <th className="px-1 py-1 text-left font-semibold text-slate-700">INS.</th>
                  <th className="px-1 py-1 text-left font-semibold text-slate-700">RIC.</th>
                  <th className="px-1 py-1 text-left font-semibold text-slate-700">PAT.</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr
                    key={row.id}
                    className={`cursor-pointer border-t border-slate-100 ${selectedId === row.id ? "bg-emerald-100" : "hover:bg-slate-50"} ${selectedIds.has(row.id) ? "bg-violet-50" : ""}`}
                    onClick={() => setSelectedId(row.id)}
                    onDoubleClick={() => onRowDoubleClick(row)}
                    title="Doppio clic: modifica"
                  >
                    <td className="px-1 py-0.5" onClick={(ev) => { ev.stopPropagation(); toggleSelected(row.id); }}><input type="checkbox" checked={selectedIds.has(row.id)} onChange={() => toggleSelected(row.id)} className="h-3 w-3" /></td>
                    <td className="px-1 py-0.5">{row.codice_autoscuola || "–"}</td>
                    <td className="px-1 py-0.5">{row.cognome || "–"}</td>
                    <td className="px-1 py-0.5">{row.nome || "–"}</td>
                    <td className="px-1 py-0.5">{formatData(row.data_nascita || row.raw_portale?.anagrafica?.data_nascita)}</td>
                    <td className="px-1 py-0.5 truncate max-w-20" title={row.stato_richiesta || row.raw_portale?.anagrafica?.stato_richiesta}>{row.stato_richiesta || row.raw_portale?.anagrafica?.stato_richiesta || "–"}</td>
                    <td className="px-1 py-0.5">{formatData(row.data_iscrizione || row.created_at || row.raw_portale?.anagrafica?.data_iscrizione)}</td>
                    <td className="px-1 py-0.5">{row.stato || row.raw_portale?.anagrafica?.stato_richiesta || "–"}</td>
                    <td className="px-1 py-0.5">{row.categoria_patente || "–"}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td className="px-2 py-2 text-slate-500" colSpan={9}>Nessun candidato per i filtri impostati.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Dettaglio - pannello modifica (solo in modifica; nuova iscrizione usa il popup) */}
        {editMode === "edit" && (
          <DettaglioPanel
            editor={editor}
            setEditor={setEditor}
            editMode={editMode}
            etaAnni={etaAnni}
            onSalva={onSalvaDettaglio}
            onAnnulla={onAnnullaDettaglio}
            onOpenRecuperoDati={() => {
              setRecuperoForm((prev) => ({
                ...prev,
                codiceAutoscuola: editor.codice_autoscuola || user?.codice_autoscuola || prev.codiceAutoscuola,
                cognome: editor.cognome || prev.cognome,
                numeroPatente: editor.patente_numero || editor.numero_patente_posseduta || prev.numeroPatente,
              }));
              setShowRecuperoModal(true);
            }}
            PATENTE_RICHIESTA_OPTIONS={PATENTE_RICHIESTA_OPTIONS}
            TIPO_DOCUMENTO_OPTIONS={TIPO_DOCUMENTO_OPTIONS}
            TIPO_ISCRIZIONE_OPTIONS={TIPO_ISCRIZIONE_OPTIONS}
          />
        )}

        {/* Modal Nuova Iscrizione - campi ordinati in popup */}
        {showNuovaIscrizioneModal && (
          <NuovaIscrizioneModal
            editor={editor}
            setEditor={setEditor}
            etaAnni={etaAnni}
            onSalva={async () => {
              const payload = mapCandidateForSave(editor, editorBaseRawPortale);
              if (!payload.nome || !payload.cognome) {
                setStatus("Nome e cognome obbligatori");
                return;
              }
              setStatus("Salvataggio...");
              try {
                const res = await fetch(`${API_BASE}/api/candidates`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", ...authHeaders() },
                  body: JSON.stringify(payload),
                });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || "Errore creazione");
                setStatus("Candidato creato");
                setShowNuovaIscrizioneModal(false);
                await loadCandidates();
              } catch (e) {
                setStatus(`Errore: ${e.message}`);
              }
            }}
            onAnnulla={() => setShowNuovaIscrizioneModal(false)}
            PATENTE_RICHIESTA_OPTIONS={PATENTE_RICHIESTA_OPTIONS}
            TIPO_DOCUMENTO_OPTIONS={TIPO_DOCUMENTO_OPTIONS}
            TIPO_ISCRIZIONE_OPTIONS={TIPO_ISCRIZIONE_OPTIONS}
          />
        )}

        {/* frmRiepilogo – Scheda riepilogativa completa candidato */}
        {showSchedaModal && (
          <SchedaRiepilogativaModal
            busy={schedaBusy}
            err={schedaErr}
            data={schedaData}
            onClose={() => setShowSchedaModal(false)}
          />
        )}

        {/* Punto 15 — Storico quiz candidato */}
        {showQuizModal && (
          <ModalStoricoQuiz
            busy={quizBusy}
            err={quizErr}
            data={quizData}
            onClose={() => setShowQuizModal(false)}
          />
        )}

        {/* Modal Recupero Dati – stile gestionale: header viola, corpo bianco, pulsanti verde/viola */}
        {showRecuperoModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !recuperoBusy && setShowRecuperoModal(false)}>
            <div className="w-full max-w-md rounded-lg border border-violet-200 bg-white shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-violet-700 bg-violet-800 px-4 py-2">
                <div>
                  <h3 className="text-base font-bold text-white">Recupero Dati</h3>
                  <p className="text-xs text-white/80">Recupero Dati Utenti Patentati</p>
                </div>
                <button type="button" onClick={() => !recuperoBusy && setShowRecuperoModal(false)} className="rounded p-1 text-white/80 hover:text-white hover:bg-violet-700" aria-label="Chiudi">✕</button>
              </div>
              <div className="p-4 bg-white">
                <p className="text-[10px] font-bold uppercase text-slate-600 mb-1">Autoscuola da utilizzare per questa connessione</p>
                <input
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
                  placeholder="Codice autoscuola (es. 0674)"
                  value={recuperoForm.codiceAutoscuola}
                  onChange={(e) => setRecuperoForm((p) => ({ ...p, codiceAutoscuola: e.target.value }))}
                />
                <div className="mt-3 flex items-center gap-2">
                  <label className="text-[10px] font-bold uppercase text-slate-600">Cognome</label>
                  <input
                    className="flex-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
                    value={recuperoForm.cognome}
                    onChange={(e) => setRecuperoForm((p) => ({ ...p, cognome: e.target.value }))}
                  />
                </div>
                <div className="mt-2">
                  <label className="text-[10px] font-bold uppercase text-slate-600">Num. patente</label>
                  <input
                    className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
                    value={recuperoForm.numeroPatente}
                    onChange={(e) => setRecuperoForm((p) => ({ ...p, numeroPatente: e.target.value }))}
                  />
                </div>
                <div className="mt-2">
                  <label className="text-[10px] font-bold uppercase text-slate-600">Protocollo cert. medico (opz.)</label>
                  <input
                    className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
                    placeholder="Protocollo certificato medico"
                    value={recuperoForm.protocolloCertificatoMedico}
                    onChange={(e) => setRecuperoForm((p) => ({ ...p, protocolloCertificatoMedico: e.target.value }))}
                  />
                </div>
                <div className="mt-2">
                  <label className="text-[10px] font-bold uppercase text-slate-600">Marca operativa (opz.)</label>
                  <input
                    className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
                    placeholder="Marca operativa"
                    value={recuperoForm.marcaOperativa}
                    onChange={(e) => setRecuperoForm((p) => ({ ...p, marcaOperativa: e.target.value }))}
                  />
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" onClick={() => !recuperoBusy && setShowRecuperoModal(false)} className="rounded bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700">Chiudi</button>
                  <button type="button" onClick={onAvviaRecuperoDati} disabled={recuperoBusy} className="flex items-center gap-1.5 rounded bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-600 disabled:opacity-60">
                    <span className="text-sm" aria-hidden>🌐</span>
                    Avvia recupero dati
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ModernAppShell>
  );
}

/** Modal GeCA "Scansione Foto e Firma": Scanner (servizio locale) o Carica da file → anteprima → Conferma/Annulla */
function ScansioneFotoFirmaModal({ initialFoto, initialFirma, onConferma, onAnnulla }) {
  const [foto, setFoto] = useState(() => initialFoto || "");
  const [firma, setFirma] = useState(() => initialFirma || "");
  const [scannerStatus, setScannerStatus] = useState(null); // null | "online" | "offline" | "checking"
  const [scanError, setScanError] = useState("");
  const fotoFileRef = useRef(null);
  const firmaFileRef = useRef(null);
  const scanTargetRef = useRef(null); // "foto" | "firma" quando si usa il flusso scanner

  const checkScanner = useCallback(async () => {
    setScannerStatus("checking");
    setScanError("");
    try {
      const res = await fetch(`${SCANNER_SERVICE_URL}/ping`, { method: "GET", mode: "cors" });
      const data = await res.json().catch(() => ({}));
      const online = data.status === "scanner service online";
      setScannerStatus(online ? "online" : "offline");
      if (!online) setScanError("Servizio scanner non risponde. Avviare: cd scanner-service && node server.js");
      return online;
    } catch (err) {
      setScannerStatus("offline");
      setScanError("Servizio scanner non raggiungibile (localhost:5001). Usare Carica da file.");
      return false;
    }
  }, []);

  const handleFileFoto = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    if (scanTargetRef.current === "foto") {
      scanTargetRef.current = null;
      try {
        const form = new FormData();
        form.append("image", file);
        const res = await fetch(`${SCANNER_SERVICE_URL}/scan`, { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || data.message || "Errore scan");
        if (data.dataUrl) setFoto(data.dataUrl);
      } catch (err) {
        setScanError(err.message || "Errore acquisizione foto");
      }
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setFoto(reader.result || "");
    reader.readAsDataURL(file);
  }, []);

  const handleFileFirma = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    if (scanTargetRef.current === "firma") {
      scanTargetRef.current = null;
      try {
        const form = new FormData();
        form.append("image", file);
        const res = await fetch(`${SCANNER_SERVICE_URL}/scan`, { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || data.message || "Errore scan");
        if (data.dataUrl) setFirma(data.dataUrl);
      } catch (err) {
        setScanError(err.message || "Errore acquisizione firma");
      }
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setFirma(reader.result || "");
    reader.readAsDataURL(file);
  }, []);

  const acqScannerFoto = useCallback(async () => {
    const ok = await checkScanner();
    if (!ok) return;
    scanTargetRef.current = "foto";
    fotoFileRef.current?.click();
  }, [checkScanner]);

  const acqScannerFirma = useCallback(async () => {
    const ok = await checkScanner();
    if (!ok) return;
    scanTargetRef.current = "firma";
    firmaFileRef.current?.click();
  }, [checkScanner]);

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60" onClick={(e) => e.target === e.currentTarget && onAnnulla()}>
      <div className="w-full max-w-2xl max-h-[90vh] rounded-lg border border-violet-200 bg-white shadow-xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-violet-700 bg-violet-800 px-4 py-2 shrink-0">
          <h3 className="text-sm font-bold text-white">Scansione Foto e Firma</h3>
          <button type="button" onClick={onAnnulla} className="rounded p-1 text-white/80 hover:text-white hover:bg-violet-700" aria-label="Chiudi">✕</button>
        </div>
        <div className="p-4 overflow-y-auto flex-1 space-y-3 bg-slate-50">
          <p className="text-[10px] font-bold uppercase text-violet-800 text-center">Selezione dispositivo</p>
          {scanError && <p className="text-[10px] text-amber-800 bg-amber-100 rounded px-2 py-1 text-center">{scanError}</p>}
          {scannerStatus === "checking" && <p className="text-[10px] text-slate-500 text-center">Verifica servizio scanner...</p>}
          <div className="flex gap-2 flex-wrap justify-center">
            <button type="button" onClick={acqScannerFoto} disabled={scannerStatus === "checking"} className="rounded bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50" title="Acquisisci foto tramite servizio scanner (localhost)">
              Scanner FOTO
            </button>
            <button type="button" onClick={acqScannerFirma} disabled={scannerStatus === "checking"} className="rounded bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50" title="Acquisisci firma tramite servizio scanner">
              Scanner FIRMA
            </button>
            <button type="button" onClick={() => { setScanError(""); fotoFileRef.current?.click(); }} className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">
              Carica FOTO da file
            </button>
            <button type="button" onClick={() => { setScanError(""); firmaFileRef.current?.click(); }} className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">
              Carica FIRMA da file
            </button>
          </div>
          <input ref={fotoFileRef} type="file" accept="image/*" className="hidden" onChange={handleFileFoto} />
          <input ref={firmaFileRef} type="file" accept="image/*" className="hidden" onChange={handleFileFirma} />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[9px] font-bold uppercase text-slate-600 mb-1">Anteprima FOTO</p>
              <div className="rounded border border-slate-300 bg-white flex items-center justify-center overflow-hidden" style={{ width: 160, height: 192 }}>
                {foto && String(foto).startsWith("data:image/") ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={foto} alt="Foto" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[10px] text-slate-500">Nessuna foto</span>
                )}
              </div>
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase text-slate-600 mb-1">Anteprima FIRMA</p>
              <div className="rounded border border-slate-300 bg-white flex items-center justify-center overflow-hidden" style={{ width: 165, height: 33 }}>
                {firma && String(firma).startsWith("data:image/") ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={firma} alt="Firma" className="max-w-full max-h-full object-contain" />
                ) : (
                  <span className="text-[10px] text-slate-500">Nessuna firma</span>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-slate-200 bg-white shrink-0">
          <button type="button" onClick={onAnnulla} className="rounded bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-700" title="Annulla e esci">
            ANNULLA
          </button>
          <button type="button" onClick={() => onConferma(foto, firma)} className="rounded bg-emerald-500 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-600" title="Conferma e imposta in iscrizione">
            CONFERMA
          </button>
        </div>
      </div>
    </div>
  );
}

/** Popup Nuova Iscrizione: layout GeCA – Protocollo/Registro, Anagrafici a righe dense, sidebar acquisizione */
function NuovaIscrizioneModal({
  editor,
  setEditor,
  etaAnni,
  onSalva,
  onAnnulla,
  PATENTE_RICHIESTA_OPTIONS,
  TIPO_DOCUMENTO_OPTIONS,
  TIPO_ISCRIZIONE_OPTIONS,
}) {
  const set = (key, value) => setEditor((p) => ({ ...p, [key]: value }));
  const [showScansioneModal, setShowScansioneModal] = useState(false);
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const fotoInputRef = useRef(null);
  const firmaInputRef = useRef(null);
  const handleFileFoto = (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => set("foto_data_url", reader.result || "");
    reader.readAsDataURL(file);
    e.target.value = "";
  };
  const handleFileFirma = (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => set("firma_data_url", reader.result || "");
    reader.readAsDataURL(file);
    e.target.value = "";
  };
  const openScansioneModal = () => setShowScansioneModal(true);
  const closeScansioneModal = () => setShowScansioneModal(false);
  const onScansioneConferma = (fotoUrl, firmaUrl) => {
    set("foto_data_url", fotoUrl || "");
    set("firma_data_url", firmaUrl || "");
    closeScansioneModal();
  };

  const lab = "block text-[9px] font-bold text-slate-600 leading-tight";
  const inp = "w-full min-w-0 rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] text-slate-900";
  const inpNarrow = "w-12 rounded border border-slate-300 bg-white px-0.5 py-0.5 text-[11px] text-slate-900 text-center";
  const fld = (label, children, className = "") => (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <label className={lab}>{label}</label>
      {children}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-black/60" onClick={(e) => e.target === e.currentTarget && onAnnulla()}>
      <div className="w-full max-w-6xl rounded-lg border border-violet-200 bg-white shadow-xl flex flex-col overflow-hidden" style={{ maxHeight: "96vh", minHeight: "520px" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2 border-b border-violet-700 bg-violet-800 shrink-0">
          <h2 className="text-base font-bold text-white">Registra nuova iscrizione</h2>
          <button type="button" onClick={onAnnulla} className="rounded p-1 text-white/80 hover:text-white hover:bg-violet-700" aria-label="Chiudi">✕</button>
        </div>
        <div className="flex flex-1 min-h-0 p-3 overflow-hidden bg-slate-50">
          {/* Area form sinistra */}
          <div className="flex-1 min-w-0 overflow-hidden space-y-1">
            {/* Protocollo e Registro – due blocchi affiancati */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <div>
                <p className="text-[9px] font-bold uppercase text-violet-800 mb-0.5">Autoscuola e Iscrizione</p>
                <div className="grid grid-cols-3 gap-x-1 gap-y-1">
                  {fld("DATA", <input className={inp} type="date" value={editor.data_iscrizione || ""} onChange={(e) => set("data_iscrizione", e.target.value)} />)}
                  {fld("AUTOSC.", <input className={inp} value={editor.codice_autoscuola || ""} onChange={(e) => set("codice_autoscuola", e.target.value)} />)}
                  {fld("CAT.", <select className={inp} value={editor.categoria_patente || "B"} onChange={(e) => set("categoria_patente", e.target.value)}>{PATENTE_RICHIESTA_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}</select>)}
                </div>
                {fld("TIPO ISCRIZIONE", <select className={inp} value={editor.stato_richiesta || ""} onChange={(e) => set("stato_richiesta", e.target.value)}><option value="">SELEZIONA *</option>{TIPO_ISCRIZIONE_OPTIONS.filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}</select>, "mt-1")}
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase text-amber-200 mb-0.5">Protocollo e Registro</p>
                <div className="space-y-1">
                  <div className="grid grid-cols-4 gap-x-1 gap-y-1">
                    {fld("PROTOCOLLO", <input className={inp} value={editor.numero_registro || ""} onChange={(e) => set("numero_registro", e.target.value)} placeholder="N. prot." />)}
                    {fld("EMESSO IL", <input className={inp} type="date" value={editor.data_registro || ""} onChange={(e) => set("data_registro", e.target.value)} />)}
                    {fld("SCADE IL", <input className={inp} type="date" value={editor.scade_il_documento || ""} onChange={(e) => set("scade_il_documento", e.target.value)} />)}
                    {fld("N° REG.", <input className={inp} value={editor.numero_registro || ""} onChange={(e) => set("numero_registro", e.target.value)} />)}
                  </div>
                  <div className="grid grid-cols-4 gap-x-1 gap-y-1 mt-0.5">
                    {fld("DATA REGIS.", <input className={inp} type="date" value={editor.data_registro || ""} onChange={(e) => set("data_registro", e.target.value)} />)}
                    {fld("COD. CAN.", <input className={inp} maxLength={6} value={editor.patente_numero || ""} onChange={(e) => set("patente_numero", e.target.value.slice(0, 6))} />)}
                    {fld("EMISS. FOG ROSA", <input className={inp} type="date" value={editor.ppg_data_emissione || ""} onChange={(e) => set("ppg_data_emissione", e.target.value)} />)}
                    {fld("SCAD. FOG ROSA", <input className={inp} type="date" value={editor.ppg_data_scadenza || ""} onChange={(e) => set("ppg_data_scadenza", e.target.value)} />)}
                  </div>
                  {fld("STATO DELLA RICHIESTA", <input className={inp} value={editor.stato_richiesta_testo || ""} onChange={(e) => set("stato_richiesta_testo", e.target.value)} />)}
                </div>
              </div>
            </div>

            {/* Dati Anagrafici e Residenza – compatti, provincia nascita dopo luogo nascita */}
            <div>
              <p className="text-[9px] font-bold uppercase text-violet-800 mb-0">Dati Anagrafici e Residenza</p>
              <div className="space-y-0.5">
                <div className="grid grid-cols-5 gap-x-1 gap-y-0.5">
                  {fld("COGNOME", <input className={inp} maxLength={35} value={editor.cognome || ""} onChange={(e) => set("cognome", e.target.value)} />)}
                  {fld("NOME", <input className={inp} maxLength={35} value={editor.nome || ""} onChange={(e) => set("nome", e.target.value)} />)}
                  {fld("SESSO", <select className={inpNarrow} value={editor.sesso || "M"} onChange={(e) => set("sesso", e.target.value)}><option value="M">M</option><option value="F">F</option></select>)}
                  {fld("DATA NASC.", <input className={inp} type="date" value={editor.data_nascita || ""} onChange={(e) => set("data_nascita", e.target.value)} />)}
                  {fld("ETÀ", <input className={`${inpNarrow} bg-slate-100`} value={etaAnni} readOnly />)}
                </div>
                <div className="grid grid-cols-6 gap-x-1 gap-y-0.5">
                  {fld("LOCALITÀ NASCITA", <input className={inp} value={editor.comune_nascita || ""} onChange={(e) => set("comune_nascita", e.target.value)} />)}
                  {fld("PROV. NASC.", <input className={inpNarrow} maxLength={2} value={editor.prov_nascita || ""} onChange={(e) => set("prov_nascita", e.target.value.toUpperCase().slice(0, 2))} placeholder="…" />)}
                  {fld("CODICE FISCALE", <input className={`${inp} uppercase`} maxLength={16} value={editor.codice_fiscale || ""} onChange={(e) => set("codice_fiscale", e.target.value.toUpperCase().slice(0, 16))} />)}
                  {fld("CITTADINANZA", <input className={inp} value={editor.cittadinanza || "ITALIANA"} onChange={(e) => set("cittadinanza", e.target.value)} />)}
                  {fld("LOCALITÀ RESIDENZA", <input className={inp} value={editor.comune_residenza || ""} onChange={(e) => set("comune_residenza", e.target.value)} />)}
                  {fld("PROV. RES.", <input className={inpNarrow} maxLength={2} value={editor.prov_residenza || ""} onChange={(e) => set("prov_residenza", e.target.value.toUpperCase().slice(0, 2))} placeholder="…" />)}
                </div>
                <div className="grid grid-cols-6 gap-x-1 gap-y-0.5">
                  {fld("CAP", <input className="w-16 rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] text-slate-900" value={editor.cap_residenza || ""} onChange={(e) => set("cap_residenza", e.target.value)} />)}
                  {fld("TELEFONO", <input className={inp} value={editor.telefono_1 || ""} onChange={(e) => set("telefono_1", e.target.value)} />)}
                  {fld("INDIRIZZO", <input className="col-span-2 min-w-0 rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] text-slate-900" value={editor.indirizzo_residenza || ""} onChange={(e) => set("indirizzo_residenza", e.target.value)} />)}
                  {fld("N° CIVICO", <input className={inpNarrow} value={editor.numero_civico || ""} onChange={(e) => set("numero_civico", e.target.value)} />)}
                  {fld("INDIRIZZO EMAIL", <input className={inp} type="email" value={editor.email_contatto || ""} onChange={(e) => set("email_contatto", e.target.value)} />)}
                </div>
              </div>
            </div>

            {/* Documento Riconoscimento e Patente Posseduta – due colonne */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <div>
                <p className="text-[9px] font-bold uppercase text-violet-800 mb-0.5">Documento Riconoscimento</p>
                <div className="grid grid-cols-3 gap-x-1 gap-y-1">
                  {fld("TIPO DOCUMENTO", <select className={inp} value={editor.tipo_documento || ""} onChange={(e) => set("tipo_documento", e.target.value)}><option value="">SELEZIONARE -</option>{TIPO_DOCUMENTO_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}</select>)}
                  {fld("NUMERO DOCUMENTO", <input className={inp} value={editor.numero_documento || ""} onChange={(e) => set("numero_documento", e.target.value)} />)}
                  {fld("SCADE IL", <input className={inp} type="date" value={editor.scade_il_documento || ""} onChange={(e) => set("scade_il_documento", e.target.value)} />)}
                </div>
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase text-violet-800 mb-0.5">Patente Posseduta</p>
                <div className="grid grid-cols-2 gap-x-1 gap-y-1">
                  {fld("NUMERO PATENTE", <input className={inp} value={editor.numero_patente_posseduta || ""} onChange={(e) => set("numero_patente_posseduta", e.target.value)} />)}
                  {fld("SCADE IL", <input className={inp} type="date" value={editor.scade_il_patente || ""} onChange={(e) => set("scade_il_patente", e.target.value)} />)}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-1 gap-y-1">
              {fld("NOTE", <input className={inp} value={editor.note || ""} onChange={(e) => set("note", e.target.value)} placeholder="Note" />)}
              {fld("PRESENZE A2/A", <input className={inp} value={editor.presenze_a2_a || ""} onChange={(e) => set("presenze_a2_a", e.target.value)} />)}
            </div>
          </div>

          {/* Sidebar destra: Foto e Firma – stile gestionale viola/verde */}
          <div className="w-44 shrink-0 flex flex-col gap-1 pl-2 border-l border-violet-200 overflow-y-auto">
            <p className="text-[10px] font-bold uppercase text-violet-800 mb-0.5"> Foto e Firma </p>
            <div className="flex flex-col gap-0.5">
              <button type="button" onClick={openScansioneModal} className="rounded bg-violet-600 px-1.5 py-1 text-[9px] font-semibold text-white hover:bg-violet-700 w-full" title="Apri finestra acquisizione (Scanner / file)">Scanner</button>
              <Link href="/acquisizione-remota" className="rounded bg-violet-600 px-1.5 py-1 text-[9px] font-semibold text-white hover:bg-violet-700 w-full text-center block">Portale</Link>
              <Link href="/acquisizione-remota?tipo=cie" className="rounded bg-violet-600 px-1.5 py-1 text-[9px] font-semibold text-white hover:bg-violet-700 w-full text-center block">C.I. digitale</Link>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setLinkPopoverOpen((v) => !v)}
                  className="rounded bg-violet-600 px-1.5 py-1 text-[9px] font-semibold text-white hover:bg-violet-700 w-full"
                  title="Genera link e invia al candidato via Email o WhatsApp"
                >
                  📲 Invia link
                </button>
                {linkPopoverOpen && editor?.id && (
                  <SendLinkPopover
                    candidate={{
                      id: editor.id,
                      cognome: editor.cognome,
                      nome: editor.nome,
                      email: editor.email,
                      telefono: editor.telefono,
                      autoscuola_nome: "La tua autoscuola",
                    }}
                    onClose={() => setLinkPopoverOpen(false)}
                  />
                )}
              </div>
            </div>
            <input ref={fotoInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileFoto} />
            <input ref={firmaInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileFirma} />
            {/* Foto: GeCA 160×192, doppio click apre Scansione Foto e Firma */}
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] font-semibold italic text-violet-700 text-center leading-tight">Doppio click acquisizione</span>
              <div className="flex items-start gap-0.5">
                <div
                  className="rounded border-2 border-slate-300 bg-white flex flex-col items-center justify-center cursor-pointer hover:border-violet-400 shrink-0 overflow-hidden"
                  style={{ width: 80, height: 96 }}
                  onClick={openScansioneModal}
                  onDoubleClick={openScansioneModal}
                  title="Doppio click: Scansione Foto e Firma"
                >
                  {editor.foto_data_url && String(editor.foto_data_url).startsWith("data:image/") ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- data URL */
                    <img src={editor.foto_data_url} alt="Foto" className="w-full h-full object-cover" style={{ width: 80, height: 96 }} />
                  ) : (
                    <span className="text-[9px] text-slate-500 px-1 text-center">Foto</span>
                  )}
                </div>
                <button type="button" onClick={() => set("foto_data_url", "")} className="shrink-0 rounded border border-slate-300 bg-slate-100 p-0.5 hover:bg-slate-200 text-slate-600" title="Elimina foto" aria-label="Elimina foto">
                  <span className="text-red-300 text-[10px]">✕</span>
                </button>
              </div>
            </div>
            {/* Firma: GeCA 165×33, doppio click apre Scansione Foto e Firma */}
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] font-semibold italic text-violet-700 text-center leading-tight">Doppio click acquisizione</span>
              <div className="flex items-center gap-0.5">
                <div
                  className="rounded border border-slate-300 bg-white flex items-center justify-center cursor-pointer hover:border-violet-400 shrink-0 overflow-hidden"
                  style={{ width: 83, height: 17 }}
                  onClick={openScansioneModal}
                  onDoubleClick={openScansioneModal}
                  title="Doppio click: Scansione Foto e Firma"
                >
                  {editor.firma_data_url && String(editor.firma_data_url).startsWith("data:image/") ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- data URL */
                    <img src={editor.firma_data_url} alt="Firma" className="max-w-full max-h-full object-contain" />
                  ) : (
                    <span className="text-[9px] text-slate-500">Firma</span>
                  )}
                </div>
                <button type="button" onClick={() => set("firma_data_url", "")} className="shrink-0 rounded border border-slate-300 bg-slate-100 p-0.5 hover:bg-slate-200 text-slate-600" title="Elimina firma" aria-label="Elimina firma">
                  <span className="text-red-300 text-[10px]">✕</span>
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-1" />
            <button type="button" onClick={onSalva} className="rounded bg-emerald-500 py-1.5 text-[10px] font-bold text-white hover:bg-emerald-600 w-full">CONFERMA</button>
            <button type="button" onClick={onAnnulla} className="rounded bg-violet-600 py-1.5 text-[10px] font-bold text-white hover:bg-violet-700 w-full">ANNULLA</button>
          </div>
        </div>
      </div>
      {showScansioneModal && (
        <ScansioneFotoFirmaModal
          initialFoto={editor.foto_data_url}
          initialFirma={editor.firma_data_url}
          onConferma={onScansioneConferma}
          onAnnulla={closeScansioneModal}
        />
      )}
    </div>
  );
}

function DettaglioPanel({
  editor,
  setEditor,
  editMode,
  etaAnni,
  onSalva,
  onAnnulla,
  onOpenRecuperoDati,
  PATENTE_RICHIESTA_OPTIONS,
  TIPO_DOCUMENTO_OPTIONS,
  TIPO_ISCRIZIONE_OPTIONS,
}) {
  const set = (key, value) => setEditor((p) => ({ ...p, [key]: value }));
  const fotoInputRef = useRef(null);
  const firmaInputRef = useRef(null);

  const handleFileFoto = (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => set("foto_data_url", reader.result || "");
    reader.readAsDataURL(file);
    e.target.value = "";
  };
  const handleFileFirma = (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => set("firma_data_url", reader.result || "");
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // Layout compatto: label + input affiancati, etichette leggibili
  const labelCl = "shrink-0 text-[10px] font-semibold text-slate-300 whitespace-nowrap";
  const sectCl = "rounded border border-indigo-400 bg-slate-700/50 p-1";
  const rowCl = "flex flex-wrap items-center gap-x-1 gap-y-0.5";
  const fldCl = "flex items-center gap-0.5 shrink-0";
  const inputCl = "min-w-0 rounded border border-slate-500 bg-white px-1 py-0.5 text-[11px] text-slate-900";
  const provCl = "w-8 rounded border border-slate-500 bg-white px-0.5 py-0.5 text-center text-[11px] text-slate-900 uppercase";
  const dateCl = "w-24 rounded border border-slate-500 bg-white px-1 py-0.5 text-[11px] text-slate-900";
  const catCl = "w-14 rounded border border-slate-500 bg-white px-1 py-0.5 text-[11px] text-slate-900";
  const etaCl = "w-7 rounded border border-slate-500 bg-white px-0.5 py-0.5 text-center text-[11px] text-slate-900";
  const codCanCl = "w-16 rounded border border-slate-500 bg-white px-1 py-0.5 text-[11px] text-slate-900";
  const sessoCl = "w-9 rounded border border-slate-500 bg-white px-0.5 py-0.5 text-center text-[11px] text-slate-900";
  const nRegCl = "w-20 rounded border border-slate-500 bg-white px-1 py-0.5 text-[11px] text-slate-900";
  const cfCl = "w-36 rounded border border-slate-500 bg-white px-1 py-0.5 text-[11px] text-slate-900 uppercase";
  const cogNomeCl = "w-28 min-w-0 rounded border border-slate-500 bg-white px-1 py-0.5 text-[11px] text-slate-900";
  return (
    <div className="rounded-lg border-2 border-indigo-700 bg-slate-800 p-1.5 shadow-xl text-white">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
        <h3 className="text-xs font-bold text-white">{editMode === "create" ? "Nuova Iscrizione" : "Modifica"}</h3>
        <div className="flex flex-wrap gap-1">
          {typeof onOpenRecuperoDati === "function" && (
            <button type="button" onClick={onOpenRecuperoDati} className="rounded border border-amber-500 bg-amber-600/80 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-amber-500">Recupero Dati</button>
          )}
          <button type="button" onClick={onSalva} className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-emerald-500">CONFERMA</button>
          <button type="button" onClick={onAnnulla} className="rounded border border-slate-400 bg-slate-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-slate-500">ANNULLA</button>
        </div>
      </div>
      <div className="flex flex-col gap-1 lg:flex-row">
      <div className="max-h-[55vh] min-h-45 flex-1 overflow-y-auto pr-0.5">
      <div className={sectCl}>
        <p className="mb-0.5 text-[9px] font-bold uppercase text-amber-200">Iscrizione</p>
        <div className={rowCl}>
          <div className={fldCl}><label className={labelCl}>Data iscr.</label><input className={dateCl} type="date" maxLength={10} value={editor.data_iscrizione || ""} onChange={(e) => set("data_iscrizione", e.target.value)} /></div>
          <div className={fldCl}><label className={labelCl}>Autoscuola</label><input className={`${inputCl} w-20`} value={editor.codice_autoscuola || ""} onChange={(e) => set("codice_autoscuola", e.target.value)} /></div>
          <div className={fldCl}><label className={labelCl}>Tipo</label><select className={`${inputCl} w-36`} value={editor.stato_richiesta || ""} onChange={(e) => set("stato_richiesta", e.target.value)}><option value="">•</option>{TIPO_ISCRIZIONE_OPTIONS.filter(Boolean).map((opt) => (<option key={opt} value={opt}>{opt}</option>))}</select></div>
          <div className={fldCl}><label className={labelCl}>Categoria</label><select className={catCl} value={editor.categoria_patente || "B"} onChange={(e) => set("categoria_patente", e.target.value)}>{PATENTE_RICHIESTA_OPTIONS.map((opt) => (<option key={opt} value={opt}>{opt}</option>))}</select></div>
          <div className={fldCl}><label className={labelCl}>N. registro</label><input className={nRegCl} value={editor.numero_registro || ""} onChange={(e) => set("numero_registro", e.target.value)} /></div>
          <div className={fldCl}><label className={labelCl}>Data reg.</label><input className={dateCl} type="date" maxLength={10} value={editor.data_registro || ""} onChange={(e) => set("data_registro", e.target.value)} /></div>
          <div className={fldCl}><label className={labelCl}>Cod. candidato</label><input className={codCanCl} maxLength={6} value={editor.patente_numero || ""} onChange={(e) => set("patente_numero", e.target.value.slice(0, 6))} /></div>
          <div className={fldCl}><label className={labelCl}>Stato</label><input className={`${inputCl} w-24`} value={editor.stato_richiesta_testo || ""} onChange={(e) => set("stato_richiesta_testo", e.target.value)} /></div>
          <div className={fldCl}><label className={labelCl}>Fogli rosa</label><input className={dateCl} type="date" maxLength={10} value={editor.ppg_data_emissione || ""} onChange={(e) => set("ppg_data_emissione", e.target.value)} title="Emissione" /><span className="text-slate-500">→</span><input className={dateCl} type="date" maxLength={10} value={editor.ppg_data_scadenza || ""} onChange={(e) => set("ppg_data_scadenza", e.target.value)} title="Scadenza" /></div>
        </div>
      </div>

      <div className={sectCl}>
        <p className="mb-0 text-[9px] font-bold uppercase text-amber-200">Anagrafica</p>
        <div className={rowCl}>
          <div className={fldCl}><label className={labelCl}>Cognome</label><input className={cogNomeCl} maxLength={35} value={editor.cognome || ""} onChange={(e) => set("cognome", e.target.value)} /></div>
          <div className={fldCl}><label className={labelCl}>Nome</label><input className={cogNomeCl} maxLength={35} value={editor.nome || ""} onChange={(e) => set("nome", e.target.value)} /></div>
          <div className={fldCl}><label className={labelCl}>Sesso</label><select className={sessoCl} value={editor.sesso || "M"} onChange={(e) => set("sesso", e.target.value)}><option value="M">M</option><option value="F">F</option></select></div>
          <div className={fldCl}><label className={labelCl}>Data nascita</label><input className={dateCl} type="date" maxLength={10} value={editor.data_nascita || ""} onChange={(e) => set("data_nascita", e.target.value)} /></div>
          <div className={fldCl}><label className={labelCl}>Età</label><input className={etaCl} value={etaAnni} readOnly title="Da data nascita" /></div>
          <div className={fldCl}><label className={labelCl}>Luogo nascita</label><input className={`${inputCl} w-24`} value={editor.comune_nascita || ""} onChange={(e) => set("comune_nascita", e.target.value)} /></div>
          <div className={fldCl}><label className={labelCl}>Prov. nasc.</label><input className={provCl} maxLength={2} value={editor.prov_nascita || ""} onChange={(e) => set("prov_nascita", e.target.value.toUpperCase().slice(0, 2))} title="Provincia nascita" /></div>
          <div className={fldCl}><label className={labelCl}>Cod. fiscale</label><input className={cfCl} maxLength={16} value={editor.codice_fiscale || ""} onChange={(e) => set("codice_fiscale", e.target.value.toUpperCase().slice(0, 16))} title="Calcolato da anagrafica" /></div>
          <div className={fldCl}><label className={labelCl}>Cittadinanza</label><input className={`${inputCl} w-16`} value={editor.cittadinanza || "ITA"} onChange={(e) => set("cittadinanza", e.target.value)} /></div>
          <div className={fldCl}><label className={labelCl}>Residenza</label><input className={`${inputCl} w-24`} value={editor.comune_residenza || ""} onChange={(e) => set("comune_residenza", e.target.value)} /></div>
          <div className={fldCl}><label className={labelCl}>Prov. res.</label><input className={provCl} maxLength={2} value={editor.prov_residenza || ""} onChange={(e) => set("prov_residenza", e.target.value.toUpperCase().slice(0, 2))} title="Provincia residenza" /></div>
          <div className={fldCl}><label className={labelCl}>CAP</label><input className={`${inputCl} w-16`} value={editor.cap_residenza || ""} onChange={(e) => set("cap_residenza", e.target.value)} /></div>
          <div className={fldCl}><label className={labelCl}>Indirizzo</label><input className={`${inputCl} w-32`} value={editor.indirizzo_residenza || ""} onChange={(e) => set("indirizzo_residenza", e.target.value)} /></div>
          <div className={fldCl}><label className={labelCl}>N. civico</label><input className={`${inputCl} w-14`} value={editor.numero_civico || ""} onChange={(e) => set("numero_civico", e.target.value)} /></div>
          <div className={fldCl}><label className={labelCl}>Telefono</label><input className={`${inputCl} w-24`} value={editor.telefono_1 || ""} onChange={(e) => set("telefono_1", e.target.value)} /></div>
          <div className={fldCl}><label className={labelCl}>Email</label><input className={`${inputCl} w-36`} type="email" value={editor.email_contatto || ""} onChange={(e) => set("email_contatto", e.target.value)} /></div>
        </div>
      </div>

      <div className={sectCl}>
        <p className="mb-0.5 text-[9px] font-bold uppercase text-amber-200">Documento e patente</p>
        <div className={rowCl}>
          <div className={fldCl}><label className={labelCl}>Tipo doc.</label><select className={`${inputCl} w-28`} value={editor.tipo_documento || ""} onChange={(e) => set("tipo_documento", e.target.value)}><option value="">•</option>{TIPO_DOCUMENTO_OPTIONS.map((d) => (<option key={d} value={d}>{d}</option>))}</select></div>
          <div className={fldCl}><label className={labelCl}>N. documento</label><input className={`${inputCl} w-24`} value={editor.numero_documento || ""} onChange={(e) => set("numero_documento", e.target.value)} /></div>
          <div className={fldCl}><label className={labelCl}>Scad. doc.</label><input className={dateCl} type="date" maxLength={10} value={editor.scade_il_documento || ""} onChange={(e) => set("scade_il_documento", e.target.value)} /></div>
          <div className={fldCl}><label className={labelCl}>N. patente</label><input className={`${inputCl} w-24`} value={editor.numero_patente_posseduta || ""} onChange={(e) => set("numero_patente_posseduta", e.target.value)} /></div>
          <div className={fldCl}><label className={labelCl}>Scad. patente</label><input className={dateCl} type="date" maxLength={10} value={editor.scade_il_patente || ""} onChange={(e) => set("scade_il_patente", e.target.value)} /></div>
        </div>
      </div>

      <div className={sectCl}>
        <div className={rowCl}>
          <div className={fldCl}><label className={labelCl}>Note</label><input className={`${inputCl} flex-1 min-w-32`} value={editor.note || ""} onChange={(e) => set("note", e.target.value)} placeholder="Note" /></div>
          <div className={fldCl}><label className={labelCl}>Presenze A2/A</label><input className={`${inputCl} w-14`} value={editor.presenze_a2_a || ""} onChange={(e) => set("presenze_a2_a", e.target.value)} /></div>
        </div>
      </div>
      </div>

      <div className={`mt-1.5 lg:mt-0 lg:w-[180px] shrink-0 ${sectCl}`}>
        <p className="mb-1 text-[9px] font-bold uppercase text-amber-200">Foto / Firma (Scanner)</p>
        <input ref={fotoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileFoto} />
        <input ref={firmaInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileFirma} />
        <div className="space-y-1.5">
          <div>
            <div className="flex items-center justify-between gap-0.5">
              <span className={labelCl}>Foto</span>
              <div className="flex gap-0.5">
                <button type="button" onClick={() => fotoInputRef.current?.click()} className="rounded border border-slate-500 bg-slate-600 px-1 py-0.5 text-[9px] font-bold text-white hover:bg-slate-500">Scanner</button>
                <button type="button" onClick={() => fotoInputRef.current?.click()} className="rounded border border-slate-500 bg-slate-500 px-1 py-0.5 text-[9px] text-white">File</button>
                {editor.foto_data_url && <button type="button" onClick={() => set("foto_data_url", "")} className="rounded border border-red-500 bg-red-600 px-1 py-0.5 text-[9px] text-white">✕</button>}
              </div>
            </div>
            <div className="mt-0.5 flex items-center justify-center overflow-hidden rounded border border-dashed border-slate-500 bg-slate-900" style={{ width: 120, height: 144 }} onClick={() => fotoInputRef.current?.click()} title="GeCA dettaglio 120×144">
              {editor.foto_data_url && String(editor.foto_data_url).startsWith("data:image/") ? (
                // eslint-disable-next-line @next/next/no-img-element -- data URL
                <img src={editor.foto_data_url} alt="Foto" className="h-full w-full object-cover" style={{ width: 120, height: 144 }} />
              ) : <span className="text-[9px] text-slate-500">Scanner/File</span>}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between gap-0.5">
              <span className={labelCl}>Firma</span>
              <div className="flex gap-0.5">
                <button type="button" onClick={() => firmaInputRef.current?.click()} className="rounded border border-slate-500 bg-slate-600 px-1 py-0.5 text-[9px] font-bold text-white hover:bg-slate-500">Scanner</button>
                <button type="button" onClick={() => firmaInputRef.current?.click()} className="rounded border border-slate-500 bg-slate-500 px-1 py-0.5 text-[9px] text-white">File</button>
                {editor.firma_data_url && <button type="button" onClick={() => set("firma_data_url", "")} className="rounded border border-red-500 bg-red-600 px-1 py-0.5 text-[9px] text-white">✕</button>}
              </div>
            </div>
            <div className="mt-0.5 flex items-center justify-center overflow-hidden rounded border border-dashed border-slate-500 bg-slate-900" style={{ width: 165, height: 33 }} onClick={() => firmaInputRef.current?.click()} title="GeCA 165×33">
              {editor.firma_data_url && String(editor.firma_data_url).startsWith("data:image/") ? (
                // eslint-disable-next-line @next/next/no-img-element -- data URL
                <img src={editor.firma_data_url} alt="Firma" className="max-h-full max-w-full object-contain" style={{ maxWidth: 165, maxHeight: 33 }} />
              ) : <span className="text-[9px] text-slate-500">Scanner/File</span>}
            </div>
          </div>
        </div>
        <Link href="/acquisizione-remota" className="mt-1 block text-center text-[9px] text-amber-300 hover:text-amber-200">Remota</Link>
      </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SchedaRiepilogativaModal – equivalente GeCA: frmRiepilogo + esamican + accontinew + VisNote
// ---------------------------------------------------------------------------
function SchedaRiepilogativaModal({ busy, err, data, onClose }) {
  const [tab, setTab] = useState("anagrafica");

  const tabs = [
    { key: "anagrafica", label: "📋 Anagrafica" },
    { key: "esami",      label: "📅 Esami" },
    { key: "pagamenti",  label: "💰 Pagamenti" },
    { key: "documenti",  label: "📁 Documenti" },
    { key: "waitlist",   label: "⏳ Lista Attesa" },
  ];

  const c = data?.candidato || {};
  const pagamenti = data?.pagamenti || [];
  const prenotazioni = data?.prenotazioni || [];
  const documenti = data?.documenti || [];
  const waitlist = data?.waitlist || [];
  const totaleIncassato = data?.totaleIncassato ?? 0;

  function fmtData(v) {
    if (!v) return "–";
    const s = String(v).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return v;
    return new Date(s + "T00:00:00Z").toLocaleDateString("it-IT");
  }

  function fmtEur(n) {
    return Number(n || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" onClick={onClose}>
      <div
        className="w-full max-w-4xl max-h-[92vh] rounded-2xl border border-violet-300 bg-white shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-violet-700 bg-violet-800 px-5 py-3">
          <div>
            <h2 className="text-lg font-bold text-white">
              {busy ? "Caricamento scheda…" : c.cognome ? `${c.cognome} ${c.nome}` : "Scheda Candidato"}
            </h2>
            {!busy && c.codice_fiscale && (
              <p className="text-xs text-white/80">C.F.: {c.codice_fiscale} · Cat.: {c.categoria_patente || "–"} · N.reg: {c.numero_registro || "–"}</p>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-white/80 hover:bg-violet-700 hover:text-white">✕</button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-slate-200 bg-slate-50 px-3 pt-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-t-lg px-3 py-1.5 text-xs font-semibold transition ${
                tab === t.key ? "bg-white border border-b-white border-slate-200 text-violet-700 -mb-px" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {busy && <p className="text-sm text-slate-500 text-center py-8">Caricamento storia candidato…</p>}
          {err && <p className="text-sm text-red-600 text-center py-8">❌ {err}</p>}

          {!busy && !err && data && (
            <>
              {/* TAB ANAGRAFICA */}
              {tab === "anagrafica" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    {[
                      ["Cognome", c.cognome],
                      ["Nome", c.nome],
                      ["Sesso", c.sesso],
                      ["Data Nascita", fmtData(c.data_nascita)],
                      ["Luogo Nascita", c.comune_nascita ? `${c.comune_nascita} (${c.prov_nascita || "–"})` : "–"],
                      ["Codice Fiscale", c.codice_fiscale],
                      ["Cittadinanza", c.cittadinanza || "–"],
                      ["Residenza", c.comune_residenza ? `${c.indirizzo_residenza || ""} ${c.numero_civico || ""}, ${c.comune_residenza} (${c.prov_residenza || "–"}) ${c.cap_residenza || ""}`.trim() : "–"],
                      ["Telefono", c.telefono_1 || "–"],
                      ["Email", c.email_contatto || "–"],
                      ["Tipo Documento", c.tipo_documento || "–"],
                      ["N. Documento", c.numero_documento || "–"],
                      ["Scad. Documento", fmtData(c.scade_il_documento)],
                      ["N. Patente posseduta", c.numero_patente_posseduta || "–"],
                      ["Scad. Patente", fmtData(c.scade_il_patente)],
                      ["Tipo Iscrizione", c.stato_richiesta || "–"],
                      ["Categoria", c.categoria_patente || "–"],
                      ["Data Iscrizione", fmtData(c.data_iscrizione)],
                      ["N. Registro", c.numero_registro || "–"],
                      ["Codice Candidato", c.patente_numero || "–"],
                      ["Foglio Rosa emissione", fmtData(c.ppg_data_emissione)],
                      ["Foglio Rosa scadenza", fmtData(c.ppg_data_scadenza)],
                      ["Note", c.note || "–"],
                      ["Presenze A2/A", c.presenze_a2_a || "–"],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase text-slate-500">{label}</p>
                        <p className="text-sm font-medium text-slate-900">{value || "–"}</p>
                      </div>
                    ))}
                  </div>

                  {/* Foto candidato */}
                  {c.foto_data_url && String(c.foto_data_url).startsWith("data:image/") && (
                    <div className="flex gap-4 items-start pt-2">
                      <div>
                        <p className="text-[10px] font-semibold uppercase text-slate-500 mb-1">Foto</p>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={c.foto_data_url} alt="Foto candidato" className="rounded border border-slate-300 object-cover" style={{ width: 80, height: 96 }} />
                      </div>
                      {c.firma_data_url && String(c.firma_data_url).startsWith("data:image/") && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase text-slate-500 mb-1">Firma</p>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={c.firma_data_url} alt="Firma" className="rounded border border-slate-300 object-contain" style={{ maxWidth: 165, maxHeight: 33 }} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* TAB ESAMI */}
              {tab === "esami" && (
                <div>
                  <p className="text-xs text-slate-500 mb-2">Storico prenotazioni esame per questo candidato.</p>
                  {prenotazioni.length === 0 ? (
                    <p className="text-sm text-slate-500 py-4 text-center">Nessuna prenotazione trovata.</p>
                  ) : (
                    <table className="min-w-full text-xs border-collapse">
                      <thead className="bg-slate-100">
                        <tr>
                          <th className="px-2 py-2 text-left font-semibold text-slate-700">Data Esame</th>
                          <th className="px-2 py-2 text-left font-semibold text-slate-700">Tipo</th>
                          <th className="px-2 py-2 text-left font-semibold text-slate-700">Sede</th>
                          <th className="px-2 py-2 text-left font-semibold text-slate-700">Esito</th>
                          <th className="px-2 py-2 text-left font-semibold text-slate-700">Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {prenotazioni.map((p) => (
                          <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-2 py-1.5 font-medium text-slate-900">{fmtData(p.data_esame)}</td>
                            <td className="px-2 py-1.5 text-slate-700">{p.tipo_esame || "–"}</td>
                            <td className="px-2 py-1.5 text-slate-600">{p.sede_esame || "–"}</td>
                            <td className="px-2 py-1.5">
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                String(p.esito || "").toLowerCase().includes("idon")
                                  ? "bg-emerald-100 text-emerald-700"
                                  : String(p.esito || "").toLowerCase().includes("non")
                                  ? "bg-red-100 text-red-700"
                                  : "bg-slate-100 text-slate-600"
                              }`}>
                                {p.esito || "–"}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-slate-500 text-[10px]">{p.note || "–"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* TAB PAGAMENTI */}
              {tab === "pagamenti" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2">
                    <span className="text-sm font-semibold text-slate-700">Totale incassato:</span>
                    <span className="text-lg font-bold text-emerald-700">{fmtEur(totaleIncassato)}</span>
                    <span className="ml-auto text-xs text-slate-500">{pagamenti.length} pagamenti</span>
                  </div>
                  {pagamenti.length === 0 ? (
                    <p className="text-sm text-slate-500 py-4 text-center">Nessun pagamento trovato.</p>
                  ) : (
                    <table className="min-w-full text-xs border-collapse">
                      <thead className="bg-slate-100">
                        <tr>
                          <th className="px-2 py-2 text-left font-semibold text-slate-700">Data</th>
                          <th className="px-2 py-2 text-left font-semibold text-slate-700">Tipo</th>
                          <th className="px-2 py-2 text-right font-semibold text-slate-700">Importo</th>
                          <th className="px-2 py-2 text-left font-semibold text-slate-700">Causale</th>
                          <th className="px-2 py-2 text-left font-semibold text-slate-700">Esito</th>
                          <th className="px-2 py-2 text-left font-semibold text-slate-700">Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagamenti.map((p) => (
                          <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-2 py-1.5 font-medium text-slate-900 whitespace-nowrap">{fmtData(p.data_pagamento)}</td>
                            <td className="px-2 py-1.5">
                              <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">{p.tipo || "–"}</span>
                            </td>
                            <td className="px-2 py-1.5 text-right font-bold text-emerald-700">{fmtEur(p.importo)}</td>
                            <td className="px-2 py-1.5 text-slate-600 max-w-[150px] truncate">{p.causale || "–"}</td>
                            <td className="px-2 py-1.5">
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                String(p.esito || "").toLowerCase() === "completato"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : String(p.esito || "").toLowerCase() === "fallito"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-amber-100 text-amber-700"
                              }`}>
                                {p.esito || "completato"}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-slate-500 text-[10px]">{p.note || "–"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* TAB DOCUMENTI */}
              {tab === "documenti" && (
                <div>
                  <p className="text-xs text-slate-500 mb-2">Documenti archiviati per questo candidato.</p>
                  {documenti.length === 0 ? (
                    <p className="text-sm text-slate-500 py-4 text-center">Nessun documento archiviato.</p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {documenti.map((d) => (
                        <div key={d.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                          <p className="text-[10px] font-semibold uppercase text-indigo-600">{d.tipo || "–"}</p>
                          <p className="text-sm font-medium text-slate-800 truncate">{d.nome_file || "–"}</p>
                          <p className="text-[10px] text-slate-500">{d.descrizione || ""}</p>
                          <p className="mt-1 text-[10px] text-slate-400">{fmtData(d.created_at)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB LISTA ATTESA */}
              {tab === "waitlist" && (
                <div>
                  <p className="text-xs text-slate-500 mb-2">Storico voci lista attesa esami per questo candidato.</p>
                  {waitlist.length === 0 ? (
                    <p className="text-sm text-slate-500 py-4 text-center">Nessuna voce in lista attesa trovata.</p>
                  ) : (
                    <table className="min-w-full text-xs border-collapse">
                      <thead className="bg-slate-100">
                        <tr>
                          <th className="px-2 py-2 text-left font-semibold text-slate-700">Stato</th>
                          <th className="px-2 py-2 text-left font-semibold text-slate-700">Tipo Esame</th>
                          <th className="px-2 py-2 text-left font-semibold text-slate-700">Categoria</th>
                          <th className="px-2 py-2 text-left font-semibold text-slate-700">Inserito il</th>
                          <th className="px-2 py-2 text-left font-semibold text-slate-700">Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {waitlist.map((w) => (
                          <tr key={w.id} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-2 py-1.5">
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                w.status === "prenotato" ? "bg-emerald-100 text-emerald-700"
                                : w.status === "pending" ? "bg-amber-100 text-amber-700"
                                : "bg-slate-100 text-slate-600"
                              }`}>{w.status || "–"}</span>
                            </td>
                            <td className="px-2 py-1.5 text-slate-700">{w.tipo_esame || "–"}</td>
                            <td className="px-2 py-1.5 text-slate-700">{w.categoria_patente || "–"}</td>
                            <td className="px-2 py-1.5 text-slate-600 whitespace-nowrap">{fmtData(w.created_at)}</td>
                            <td className="px-2 py-1.5 text-slate-500 text-[10px]">{w.note || "–"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-xl bg-violet-700 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-600">
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Punto 15 — Modale Storico Quiz Candidato ────────────────────────────────

function ModalStoricoQuiz({ busy, err, data, onClose }) {
  const ESITO_COLOR = {
    idoneo:     { bg: "#dcfce7", color: "#15803d" },
    non_idoneo: { bg: "#fee2e2", color: "#dc2626" },
    assente:    { bg: "#fef9c3", color: "#a16207" },
    ritirato:   { bg: "#f3f4f6", color: "#6b7280" },
    sospeso:    { bg: "#e0e7ff", color: "#4338ca" },
  };

  function EsitoChip({ esito }) {
    const style = ESITO_COLOR[esito] || { bg: "#f3f4f6", color: "#374151" };
    return (
      <span style={{ padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 700,
        background: style.bg, color: style.color }}>
        {esito ? esito.replace("_", " ").toUpperCase() : "–"}
      </span>
    );
  }

  function TabellaEsiti({ rows, tipo }) {
    if (!rows || rows.length === 0)
      return <div style={{ color: "#9ca3af", fontSize: 13, padding: "8px 0" }}>Nessun tentativo registrato.</div>;
    return (
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "#f1f5f9", borderBottom: "2px solid #e2e8f0" }}>
            {["Data", "Esito", "Sede", "Sessione", "Note"].map((h) => (
              <th key={h} style={{ padding: "5px 8px", textAlign: "left", fontWeight: 700, color: "#475569" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #f1f5f9", background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
              <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>{e.data_esame ? new Date(e.data_esame).toLocaleDateString("it-IT") : "–"}</td>
              <td style={{ padding: "4px 8px" }}><EsitoChip esito={e.esito} /></td>
              <td style={{ padding: "4px 8px" }}>{e.sede_esame || "–"}</td>
              <td style={{ padding: "4px 8px", fontFamily: "monospace", fontSize: 11 }}>{e.codice_sessione || e.id_verbale_portale || "–"}</td>
              <td style={{ padding: "4px 8px", color: "#6b7280" }}>{e.note || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[85vh] rounded-xl border border-amber-200 bg-white shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="bg-amber-600 px-5 py-3 flex items-center justify-between">
          <span className="text-base font-bold text-white">
            📊 Storico Quiz — {data?.candidato?.cognome || ""} {data?.candidato?.nome || ""}
          </span>
          <button onClick={onClose} className="text-amber-100 hover:text-white text-xl font-bold leading-none">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {busy && <div className="text-center text-slate-500 py-10">⏳ Caricamento…</div>}
          {err && <div className="rounded bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">❌ {err}</div>}

          {data && !busy && (
            <>
              {/* Riepilogo */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Tentativi Quiz", value: data.totali_quiz?.tentativi ?? 0, color: "#1d4ed8" },
                  { label: "Superati Quiz",  value: data.totali_quiz?.superati ?? 0,  color: "#15803d" },
                  { label: "Tentativi Guida",value: data.totali_guida?.tentativi ?? 0,color: "#7c3aed" },
                  { label: "Superati Guida", value: data.totali_guida?.superati ?? 0, color: "#15803d" },
                ].map((c) => (
                  <div key={c.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
                    <div className="text-2xl font-bold" style={{ color: c.color }}>{c.value}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{c.label}</div>
                  </div>
                ))}
              </div>

              {/* Tentativi quiz (teoria) */}
              <div>
                <div className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">📝 Teoria (Quiz)</div>
                <TabellaEsiti rows={data.quiz} tipo="quiz" />
              </div>

              {/* Tentativi guida (pratica) */}
              <div>
                <div className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">🚗 Guida (Pratica)</div>
                <TabellaEsiti rows={data.guida} tipo="guida" />
              </div>

              {/* Prenotazioni attive */}
              {data.prenotazioni?.length > 0 && (
                <div>
                  <div className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">📅 Prenotazioni</div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "#f1f5f9", borderBottom: "2px solid #e2e8f0" }}>
                        {["Tipo", "Data", "Sede", "Esito"].map((h) => (
                          <th key={h} style={{ padding: "5px 8px", textAlign: "left", fontWeight: 700, color: "#475569" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.prenotazioni.map((p, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "4px 8px" }}>{p.tipo_esame || "–"}</td>
                          <td style={{ padding: "4px 8px" }}>{p.data_esame ? new Date(p.data_esame).toLocaleDateString("it-IT") : "–"}</td>
                          <td style={{ padding: "4px 8px" }}>{p.sede_esame || "–"}</td>
                          <td style={{ padding: "4px 8px" }}>{p.esito || "–"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 flex justify-end">
          <button onClick={onClose} className="rounded-xl bg-amber-600 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-500">
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CandidatiPageWrapper() { return <Suspense fallback={null}><CandidatiPage /></Suspense>; }

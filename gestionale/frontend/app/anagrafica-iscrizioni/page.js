"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import CodiceFiscale from "codice-fiscale-js";
import {
  API_BASE,
  authHeaders,
  checkSession,
  logoutSession,
} from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";
import ModalNuovaIscrizione from "./ModalNuovaIscrizione";
import {
  buildEmptyEditor,
  extractExtendedEditor,
  formatData,
  mapCandidateForSave,
  PATENTE_RICHIESTA_OPTIONS,
  TIPO_DOCUMENTO_OPTIONS,
  TIPO_ISCRIZIONE_OPTIONS,
} from "../../lib/candidatoEditor";

const SCANNER_SERVICE_URL =
  process.env.NEXT_PUBLIC_SCANNER_SERVICE_URL || "http://localhost:5001";

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
  "INTERNO",
  "PRIVATISTA",
  "REVISIONE",
];

const PATENTE_FILTER_OPTIONS = ["TUTTE", ...PATENTE_RICHIESTA_OPTIONS];

/** GeCA: nuovaiscr – gruppi tipo iscrizione per wizard step 1 */
const WIZARD_TIPO_GROUPS = [
  {
    label: "Conseguimento per Esame",
    color: "bg-indigo-600 hover:bg-indigo-500",
    items: [
      { label: "Interno", value: "INTERNO", desc: "Allievo interno autoscuola" },
      { label: "Privatista", value: "PRIVATISTA", desc: "Candidato privatista esterno" },
      { label: "Revisione", value: "REVISIONE", desc: "Revisione patente" },
      { label: "Rilascio per Esame (generico)", value: "Rilascio per Esami: Interno - Privatista - Revisione", desc: "Interno / privatista / revisione" },
    ],
  },
  {
    label: "Rinnovo e Duplicato",
    color: "bg-violet-600 hover:bg-violet-500",
    items: [
      { label: "Rinnovo patente", value: "Conferma di Validità (Rinnovo Patente)", desc: "Conferma validità / rinnovo" },
      { label: "Duplicato patente", value: "Duplicato per: Smarrim. - Riclassif. - Deterioram. - Altro", desc: "Rilascio per duplicato / smarrimento" },
      { label: "Conversione patente", value: "Conversione Patente: Militare - Estera", desc: "Conversione da patente militare / estera" },
    ],
  },
  {
    label: "CQC e Corsi",
    color: "bg-amber-600 hover:bg-amber-500",
    items: [
      { label: "Patente CQC", value: "Patente CQC: Utenti Italiani", desc: "Richiesta patente C.Q.C." },
      { label: "CQC Card", value: "CQC CARD: Utenti Stranieri", desc: "CQC Card per utenti stranieri" },
      { label: "Corso CQC", value: "Corso C.Q.C.", desc: "Corso C.Q.C." },
      { label: "Recupero Punti", value: "Recupero Punti", desc: "Corso recupero punti patente" },
      { label: "Corso ADR", value: "Corso A.D.R.", desc: "Corso trasporto merci pericolose A.D.R." },
    ],
  },
  {
    label: "Altre Iscrizioni",
    color: "bg-emerald-600 hover:bg-emerald-500",
    items: [
      { label: "Guida Accompagnata", value: "Guida Accompagnata", desc: "Autorizzazione guida accompagnata" },
      { label: "Certificato Medico", value: "Certificato Medico (per non iscritti)", desc: "Richiesta certificato medico" },
      { label: "Patente Nautica", value: "Patente Nautica", desc: "Patente nautica" },
      { label: "Eserc. Guida", value: "Esercitazione Guida", desc: "Esercitazione guida" },
      { label: "Archivio Dati", value: "Archivio Dati", desc: "Archivio dati" },
      { label: "Permesso Intern.", value: "Permesso Intern.le di Guida", desc: "Permesso internazionale di guida" },
      { label: "Permesso Provv.", value: "Permesso Provv. di Guida", desc: "Permesso provvisorio di guida" },
    ],
  },
];

export default function AnagraficaIscrizioniPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-slate-100"><p className="text-slate-600">Caricamento...</p></div>}>
      <AnagraficaIscrizioniInner />
    </Suspense>
  );
}

function AnagraficaIscrizioniInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [editMode, setEditMode] = useState("none"); // "none" | "edit"
  const [editor, setEditor] = useState(() => buildEmptyEditor("B"));
  const [editorBaseRawPortale, setEditorBaseRawPortale] = useState({});
  const [wizardStep, setWizardStep] = useState(0); // 0=chiuso, 1=scelta tipo, 2=form

  const tipoFromUrl = searchParams.get("tipo_iscrizione");
  const initialTipo =
    tipoFromUrl && TIPO_ISCRIZIONE_FILTER_OPTIONS.includes(tipoFromUrl)
      ? tipoFromUrl
      : "TUTTI";

  const [filters, setFilters] = useState({
    cognome: "",
    nome: "",
    codice_fiscale: "",
    categoria_patente: "TUTTE",
    archivio: "ATTUALE",
    tipo_iscrizione: initialTipo,
  });
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [spostaArchivioBusy, setSpostaArchivioBusy] = useState(false);

  // Calcolo automatico CF (GeCA: calcolato da anagrafica)
  useEffect(() => {
    if (editMode !== "edit" && wizardStep !== 2) return;
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
        setEditor((prev) =>
          prev.codice_fiscale === computed ? prev : { ...prev, codice_fiscale: computed }
        );
      }
    } catch (_) {}
  }, [editor.cognome, editor.nome, editor.data_nascita, editor.sesso, editMode, wizardStep]);

  // Carica iscritti dall'archivio della scuola guida (DB)
  const loadCandidates = useCallback(async (archivioOverride) => {
    setStatus("Caricamento archivio...");
    try {
      const archivio = String(
        archivioOverride ?? filters.archivio ?? "ATTUALE"
      ).toUpperCase();
      const q = new URLSearchParams();
      if (archivio && archivio !== "ENTRAMBI") q.set("archivio", archivio);
      const res = await fetch(`${API_BASE}/api/candidati-api?${q}`, {
        cache: "no-store",
        headers: { ...authHeaders(), "Cache-Control": "no-cache" },
      });
      const data = await res.json();
      if (!res.ok || !Array.isArray(data))
        throw new Error(data?.error || "Errore caricamento");
      setRows(data);
      setStatus(`${data.length} iscrizioni in archivio`);
      return data;
    } catch (e) {
      setStatus(`Errore: ${e.message}`);
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      const session = await checkSession();
      if (!session.ok) {
        if (!cancelled) router.replace("/login");
        return;
      }
      if (!cancelled) setUser(session.autoscuola);
      if (!cancelled) await loadCandidates();
      if (!cancelled) setLoading(false);
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [router, loadCandidates]);

  const filtered = useMemo(() => {
    const cog = String(filters.cognome || "").toLowerCase().trim();
    const nom = String(filters.nome || "").toLowerCase().trim();
    const cf = String(filters.codice_fiscale || "").toLowerCase().trim();
    const cat = String(filters.categoria_patente || "").trim();
    const tipoIscr = String(filters.tipo_iscrizione || "").trim();
    return rows.filter((row) => {
      if (cog && !String(row.cognome || "").toLowerCase().includes(cog)) return false;
      if (nom && !String(row.nome || "").toLowerCase().includes(nom)) return false;
      if (cf && !String(row.codice_fiscale || "").toLowerCase().includes(cf)) return false;
      if (cat && cat !== "TUTTE" && String(row.categoria_patente || "").trim() !== cat)
        return false;
      const richiesta = String(
        row.stato_richiesta ||
          row.stato ||
          row.raw_portale?.anagrafica?.stato_richiesta ||
          ""
      ).trim();
      if (
        tipoIscr &&
        tipoIscr !== "TUTTI" &&
        !richiesta.toUpperCase().includes(tipoIscr.toUpperCase())
      )
        return false;
      return true;
    });
  }, [rows, filters]);

  const selectedRow = useMemo(
    () => rows.find((r) => r.id === selectedId) || null,
    [rows, selectedId]
  );

  const etaAnni = useMemo(() => {
    if (!editor.data_nascita) return "";
    const birth = new Date(editor.data_nascita);
    if (Number.isNaN(birth.getTime())) return "";
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    if (
      today.getMonth() < birth.getMonth() ||
      (today.getMonth() === birth.getMonth() &&
        today.getDate() < birth.getDate())
    )
      age--;
    return String(age);
  }, [editor.data_nascita]);

  function onFilterChange(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function onArchivioChange(value) {
    setFilters((prev) => ({ ...prev, archivio: value }));
    setSelectedIds(new Set());
    loadCandidates(value);
  }

  // --- Wizard Nuova Iscrizione ---
  function onNuovaIscrizione() {
    setEditor({
      ...buildEmptyEditor("B"),
      data_iscrizione: new Date().toISOString().slice(0, 10),
      codice_autoscuola: user?.codice_autoscuola || "",
    });
    setEditorBaseRawPortale({});
    setSelectedId(null);
    setWizardStep(1);
  }

  function onWizardSelectTipo(tipo) {
    setEditor((prev) => ({ ...prev, stato_richiesta: tipo }));
    setWizardStep(2);
  }

  async function onWizardSalva() {
    const payload = mapCandidateForSave(editor, editorBaseRawPortale);
    if (!payload.nome || !payload.cognome) {
      setStatus("Nome e cognome obbligatori");
      return;
    }

    // GeCA: frmOmoni – controlla omonimi prima di salvare
    try {
      const omRes = await fetch(`${API_BASE}/api/candidati-api/omonimi`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          cognome: editor.cognome,
          nome: editor.nome,
          data_nascita: editor.data_nascita || null,
        }),
      });
      if (omRes.ok) {
        const omData = await omRes.json();
        if (omData.count > 0) {
          const nomi = omData.omonimi
            .slice(0, 3)
            .map((o) => `${o.cognome} ${o.nome} (${o.codice_fiscale || "–"})`)
            .join("\n");
          const conferma = window.confirm(
            `Attenzione: trovato ${omData.count} candidato/i con lo stesso nome:\n\n${nomi}\n\nVuoi procedere ugualmente con la nuova iscrizione?`
          );
          if (!conferma) return;
        }
      }
    } catch (_) {
      // se il controllo omonimi fallisce, procediamo comunque
    }

    setStatus("Salvataggio...");
    try {
      const res = await fetch(`${API_BASE}/api/candidati-api`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Errore creazione");
      setStatus("Iscrizione creata");
      setWizardStep(0);
      await loadCandidates(filters.archivio);
    } catch (e) {
      setStatus(`Errore: ${e.message}`);
    }
  }

  // --- Modifica esistente ---
  function onModifica() {
    if (!selectedRow) {
      setStatus("Seleziona un'iscrizione");
      return;
    }
    setEditor({
      ...buildEmptyEditor(selectedRow.categoria_patente || "B"),
      ...extractExtendedEditor(selectedRow),
    });
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
      const res = await fetch(`${API_BASE}/api/candidati-api/${selectedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Errore modifica");
      setStatus("Modifiche salvate");
      setEditMode("none");
      await loadCandidates(filters.archivio);
    } catch (e) {
      setStatus(`Errore: ${e.message}`);
    }
  }

  async function onElimina() {
    if (!selectedRow) {
      setStatus("Seleziona un'iscrizione");
      return;
    }
    if (!window.confirm(`Eliminare ${selectedRow.cognome} ${selectedRow.nome}?`)) return;
    setStatus("Eliminazione...");
    try {
      const res = await fetch(`${API_BASE}/api/candidati-api/${selectedRow.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Errore eliminazione");
      setSelectedId(null);
      setEditMode("none");
      await loadCandidates(filters.archivio);
      setStatus("Iscrizione eliminata");
    } catch (e) {
      setStatus(`Errore: ${e.message}`);
    }
  }

  function onRowDoubleClick(row) {
    setSelectedId(row.id);
    setEditor({
      ...buildEmptyEditor(row.categoria_patente || "B"),
      ...extractExtendedEditor(row),
    });
    setEditorBaseRawPortale(row.raw_portale || {});
    setEditMode("edit");
  }

  function toggleSelected(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onSpostaArchivio(storico) {
    const ids = Array.from(selectedIds);
    if (!ids.length) {
      setStatus("Seleziona almeno un'iscrizione (checkbox)");
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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-slate-600">Caricamento...</p>
      </div>
    );
  }

  return (
    <ModernAppShell
      title="Anagrafica e Iscrizioni"
      subtitle="Gestione Anagrafica – Iscrizioni Presenti in Archivio"
      activeKey="anagrafica-iscrizioni"
      onLogout={() => logoutSession().then(() => router.replace("/login"))}
      user={user}
    >
      <div className="space-y-2">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Gestione Anagrafica</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Iscrizioni Presenti in Archivio – filtri, nuova iscrizione, modifica, storico.
          </p>
        </div>

        {/* Filtro Ricerca Archivio */}
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow">
          <h3 className="text-sm font-bold text-slate-900">Filtro Ricerca Archivio</h3>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <label className="block text-[10px] font-bold uppercase leading-tight text-slate-600">
                COGNOME
              </label>
              <input
                className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
                placeholder="Cognome"
                value={filters.cognome}
                onChange={(e) => onFilterChange("cognome", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase leading-tight text-slate-600">
                NOME
              </label>
              <input
                className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
                placeholder="Nome"
                value={filters.nome}
                onChange={(e) => onFilterChange("nome", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase leading-tight text-slate-600">
                C.F.
              </label>
              <input
                className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
                placeholder="Codice fiscale"
                value={filters.codice_fiscale}
                onChange={(e) => onFilterChange("codice_fiscale", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase leading-tight text-slate-600">
                TIPO ISCR.
              </label>
              <select
                className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
                value={filters.tipo_iscrizione}
                onChange={(e) => onFilterChange("tipo_iscrizione", e.target.value)}
              >
                {TIPO_ISCRIZIONE_FILTER_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase leading-tight text-slate-600">
                PATENTE
              </label>
              <select
                className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
                value={filters.categoria_patente}
                onChange={(e) => onFilterChange("categoria_patente", e.target.value)}
              >
                {PATENTE_FILTER_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase leading-tight text-slate-600">
                ARCHIVIO
              </label>
              <select
                className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
                value={filters.archivio}
                onChange={(e) => onArchivioChange(e.target.value)}
              >
                <option value="ATTUALE">ATTUALE</option>
                <option value="STORICO">STORICO</option>
                <option value="ENTRAMBI">ENTRAMBI</option>
              </select>
            </div>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-amber-400 px-2 py-0.5 text-xs font-bold uppercase text-white shadow-sm">
              {filters.archivio}
            </span>
            <button
              type="button"
              onClick={onNuovaIscrizione}
              className="rounded bg-emerald-500 px-2 py-1 text-xs font-semibold text-white shadow-sm hover:bg-emerald-600"
            >
              + Nuova Iscrizione
            </button>
            <button
              type="button"
              onClick={onModifica}
              disabled={!selectedRow}
              className="rounded border border-slate-300 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
            >
              Modifica
            </button>
            <button
              type="button"
              onClick={onElimina}
              disabled={!selectedRow}
              className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              Elimina
            </button>
            <button
              type="button"
              onClick={() =>
                setFilters((prev) => ({
                  ...prev,
                  cognome: "",
                  nome: "",
                  codice_fiscale: "",
                  categoria_patente: "TUTTE",
                  tipo_iscrizione: "TUTTI",
                }))
              }
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              TUTTI
            </button>
            <span className="ml-1 truncate rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700 max-w-65">
              {status}
            </span>
          </div>
        </div>

        {/* Scheda candidato selezionato */}
        {selectedRow && editMode === "none" && (
          <div className="rounded-lg border border-indigo-200 bg-violet-50 p-2 shadow-sm">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="text-slate-600">Cognome</span>
              <span className="font-semibold text-slate-900">
                {selectedRow.cognome || "–"}
              </span>
              <span className="text-slate-600">Nome</span>
              <span className="font-semibold text-slate-900">{selectedRow.nome || "–"}</span>
              <span className="text-slate-600">C.F.</span>
              <span className="font-semibold text-slate-900">
                {selectedRow.codice_fiscale || "–"}
              </span>
              <span className="text-slate-600">Tel</span>
              <span className="font-semibold text-slate-900">
                {selectedRow.telefono ||
                  selectedRow.raw_portale?.anagrafica?.telefono_1 ||
                  "–"}
              </span>
              <span className="text-slate-600">Tipo</span>
              <span className="font-semibold text-slate-900 max-w-35 truncate">
                {selectedRow.stato_richiesta ||
                  selectedRow.raw_portale?.anagrafica?.stato_richiesta ||
                  "–"}
              </span>
              <span className="text-slate-600">Cat.</span>
              <span className="font-semibold text-slate-900">
                {selectedRow.categoria_patente || "–"}
              </span>
              <span className="ml-2 flex gap-1">
                <button
                  type="button"
                  onClick={onModifica}
                  className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  Modifica
                </button>
                <button
                  type="button"
                  onClick={onElimina}
                  className="rounded border border-red-300 bg-red-50 px-2 py-0.5 text-xs text-red-700 hover:bg-red-100"
                >
                  Elimina
                </button>
              </span>
            </div>
          </div>
        )}

        {/* Tabella Iscrizioni in archivio */}
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-slate-700">Iscrizioni in archivio</span>
            {filters.archivio === "ATTUALE" && (
              <button
                type="button"
                onClick={() => onSpostaArchivio(true)}
                disabled={spostaArchivioBusy || selectedIds.size === 0}
                className="rounded bg-amber-400 px-2 py-0.5 text-xs font-semibold text-white shadow-sm hover:bg-amber-500 disabled:opacity-50"
                title="Sposta selezione in Archivio Storico"
              >
                {spostaArchivioBusy ? "..." : "→ Storico"}
              </button>
            )}
            {filters.archivio === "STORICO" && (
              <button
                type="button"
                onClick={() => onSpostaArchivio(false)}
                disabled={spostaArchivioBusy || selectedIds.size === 0}
                className="rounded bg-emerald-500 px-2 py-0.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-600 disabled:opacity-50"
                title="Ripristina selezione in Archivio Attuale"
              >
                {spostaArchivioBusy ? "..." : "→ Attuale"}
              </button>
            )}
            {selectedIds.size > 0 && (
              <span className="text-xs text-slate-600">{selectedIds.size} sel.</span>
            )}
          </div>
          <div className="max-h-75 overflow-auto rounded border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 z-10 bg-slate-200">
                <tr>
                  <th className="w-8 px-1 py-1 text-left font-semibold text-slate-700">✓</th>
                  <th className="px-1 py-1 text-left font-semibold text-slate-700">COGNOME</th>
                  <th className="px-1 py-1 text-left font-semibold text-slate-700">NOME</th>
                  <th className="px-1 py-1 text-left font-semibold text-slate-700">NASC.</th>
                  <th className="px-1 py-1 text-left font-semibold text-slate-700">TIPO ISCR.</th>
                  <th className="px-1 py-1 text-left font-semibold text-slate-700">DATA ISCR.</th>
                  <th className="px-1 py-1 text-left font-semibold text-slate-700">PAT.</th>
                  <th className="px-1 py-1 text-left font-semibold text-slate-700">C.F.</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr
                    key={row.id}
                    className={`cursor-pointer border-t border-slate-100 ${
                      selectedId === row.id ? "bg-emerald-100" : "hover:bg-slate-50"
                    } ${selectedIds.has(row.id) ? "bg-violet-50" : ""}`}
                    onClick={() => setSelectedId(row.id)}
                    onDoubleClick={() => onRowDoubleClick(row)}
                    title="Doppio clic: modifica"
                  >
                    <td
                      className="px-1 py-0.5"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        toggleSelected(row.id);
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(row.id)}
                        onChange={() => toggleSelected(row.id)}
                        className="h-3 w-3"
                      />
                    </td>
                    <td className="px-1 py-0.5 font-medium">{row.cognome || "–"}</td>
                    <td className="px-1 py-0.5">{row.nome || "–"}</td>
                    <td className="px-1 py-0.5">
                      {formatData(
                        row.data_nascita || row.raw_portale?.anagrafica?.data_nascita
                      )}
                    </td>
                    <td
                      className="max-w-25 truncate px-1 py-0.5"
                      title={
                        row.stato_richiesta || row.raw_portale?.anagrafica?.stato_richiesta
                      }
                    >
                      {row.stato_richiesta ||
                        row.raw_portale?.anagrafica?.stato_richiesta ||
                        "–"}
                    </td>
                    <td className="px-1 py-0.5">
                      {formatData(
                        row.data_iscrizione ||
                          row.created_at ||
                          row.raw_portale?.anagrafica?.data_iscrizione
                      )}
                    </td>
                    <td className="px-1 py-0.5">{row.categoria_patente || "–"}</td>
                    <td className="px-1 py-0.5 font-mono text-[10px]">
                      {row.codice_fiscale || "–"}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td className="px-2 py-2 text-slate-500" colSpan={8}>
                      Nessuna iscrizione per i filtri impostati.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pannello modifica iscrizione esistente (GeCA: iscrEsame / iscrdup / etc.) */}
        {editMode === "edit" && (
          <DettaglioPanel
            editor={editor}
            setEditor={setEditor}
            etaAnni={etaAnni}
            onSalva={onSalvaDettaglio}
            onAnnulla={onAnnullaDettaglio}
            PATENTE_RICHIESTA_OPTIONS={PATENTE_RICHIESTA_OPTIONS}
            TIPO_DOCUMENTO_OPTIONS={TIPO_DOCUMENTO_OPTIONS}
            TIPO_ISCRIZIONE_OPTIONS={TIPO_ISCRIZIONE_OPTIONS}
          />
        )}

        {/* Wizard Step 1 – Scelta tipo iscrizione (GeCA: nuovaiscr) */}
        {wizardStep === 1 && (
          <WizardStep1
            onSelect={onWizardSelectTipo}
            onAnnulla={() => setWizardStep(0)}
          />
        )}

        {/* Wizard Step 2 – Modal nuova iscrizione */}
        {wizardStep === 2 && (
          <ModalNuovaIscrizione
            tipo={editor.stato_richiesta}
            onClose={() => setWizardStep(0)}
            onSalva={(result) => {
              setWizardStep(0);
              loadCandidates(filters.archivio);
            }}
          />
        )}
      </div>
    </ModernAppShell>
  );
}

// =============================================================================
// GeCA: nuovaiscr – Step 1 scelta tipo iscrizione
// =============================================================================
function WizardStep1({ onSelect, onAnnulla }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => e.target === e.currentTarget && onAnnulla()}
    >
      <div
        className="w-full max-w-2xl rounded-lg border border-violet-200 bg-white shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "92vh" }}
      >
        <div className="flex items-center justify-between border-b border-violet-700 bg-violet-800 px-4 py-2">
          <div>
            <h2 className="text-base font-bold text-white">Registra Nuova Iscrizione</h2>
            <p className="text-xs text-white/70">Seleziona il tipo di iscrizione</p>
          </div>
          <button
            type="button"
            onClick={onAnnulla}
            className="rounded p-1 text-white/80 hover:bg-violet-700 hover:text-white"
            aria-label="Chiudi"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4" style={{ maxHeight: "calc(92vh - 56px)" }}>
          {WIZARD_TIPO_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                {group.label}
              </p>
              <div className="flex flex-wrap gap-2">
                {group.items.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => onSelect(item.value)}
                    className={`rounded px-3 py-2 text-xs font-semibold text-white shadow-sm transition ${group.color}`}
                    title={item.desc}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div className="border-t border-slate-200 pt-3">
            <button
              type="button"
              onClick={onAnnulla}
              className="rounded bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
            >
              Annulla
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// GeCA: nuovaiscr Step 2 – form anagrafica completo (equivalente iscrEsame/iscrdup/iscrCorso)
// =============================================================================
function NuovaIscrizioneModal({
  editor,
  setEditor,
  etaAnni,
  onSalva,
  onAnnulla,
  onBack,
  PATENTE_RICHIESTA_OPTIONS,
  TIPO_DOCUMENTO_OPTIONS,
  TIPO_ISCRIZIONE_OPTIONS,
}) {
  const set = (key, value) => setEditor((p) => ({ ...p, [key]: value }));
  const [showScansioneModal, setShowScansioneModal] = useState(false);
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-black/60"
      onClick={(e) => e.target === e.currentTarget && onAnnulla()}
    >
      <div
        className="w-full max-w-6xl rounded-lg border border-violet-200 bg-white shadow-xl flex flex-col overflow-hidden"
        style={{ maxHeight: "96vh", minHeight: "520px" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-violet-700 bg-violet-800 shrink-0">
          <div>
            <h2 className="text-base font-bold text-white">Registra nuova iscrizione</h2>
            {editor.stato_richiesta && (
              <p className="text-xs text-amber-200">Tipo: {editor.stato_richiesta}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              className="rounded px-2 py-1 text-xs font-semibold text-white/80 hover:bg-violet-700 hover:text-white"
            >
              ← Tipo
            </button>
            <button
              type="button"
              onClick={onAnnulla}
              className="rounded p-1 text-white/80 hover:bg-violet-700 hover:text-white"
              aria-label="Chiudi"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 p-3 overflow-hidden bg-slate-50">
          {/* Form principale */}
          <div className="flex-1 min-w-0 overflow-y-auto space-y-2 pr-1">
            {/* Autoscuola e Iscrizione + Protocollo */}
            <div className="grid grid-cols-2 gap-x-3">
              <div>
                <p className="text-[9px] font-bold uppercase text-violet-800 mb-0.5">
                  Autoscuola e Iscrizione
                </p>
                <div className="grid grid-cols-3 gap-x-1 gap-y-1">
                  {fld(
                    "DATA",
                    <input
                      className={inp}
                      type="date"
                      value={editor.data_iscrizione || ""}
                      onChange={(e) => set("data_iscrizione", e.target.value)}
                    />
                  )}
                  {fld(
                    "AUTOSC.",
                    <input
                      className={inp}
                      value={editor.codice_autoscuola || ""}
                      onChange={(e) => set("codice_autoscuola", e.target.value)}
                    />
                  )}
                  {fld(
                    "CAT.",
                    <select
                      className={inp}
                      value={editor.categoria_patente || "B"}
                      onChange={(e) => set("categoria_patente", e.target.value)}
                    >
                      {PATENTE_RICHIESTA_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {fld(
                  "TIPO ISCRIZIONE",
                  <select
                    className={inp}
                    value={editor.stato_richiesta || ""}
                    onChange={(e) => set("stato_richiesta", e.target.value)}
                  >
                    <option value="">SELEZIONA *</option>
                    {TIPO_ISCRIZIONE_OPTIONS.filter(Boolean).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>,
                  "mt-1"
                )}
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase text-amber-600 mb-0.5">
                  Protocollo e Registro
                </p>
                <div className="grid grid-cols-4 gap-x-1 gap-y-1">
                  {fld(
                    "PROTOCOLLO",
                    <input
                      className={inp}
                      value={editor.numero_registro || ""}
                      onChange={(e) => set("numero_registro", e.target.value)}
                      placeholder="N. prot."
                    />
                  )}
                  {fld(
                    "DATA REGIS.",
                    <input
                      className={inp}
                      type="date"
                      value={editor.data_registro || ""}
                      onChange={(e) => set("data_registro", e.target.value)}
                    />
                  )}
                  {fld(
                    "COD. CAND.",
                    <input
                      className={inp}
                      maxLength={6}
                      value={editor.patente_numero || ""}
                      onChange={(e) => set("patente_numero", e.target.value.slice(0, 6))}
                    />
                  )}
                  {fld(
                    "STATO RIC.",
                    <input
                      className={inp}
                      value={editor.stato_richiesta_testo || ""}
                      onChange={(e) => set("stato_richiesta_testo", e.target.value)}
                    />
                  )}
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-1">
                  {fld(
                    "EMISS. FOGLIO ROSA",
                    <input
                      className={inp}
                      type="date"
                      value={editor.ppg_data_emissione || ""}
                      onChange={(e) => set("ppg_data_emissione", e.target.value)}
                    />
                  )}
                  {fld(
                    "SCAD. FOGLIO ROSA",
                    <input
                      className={inp}
                      type="date"
                      value={editor.ppg_data_scadenza || ""}
                      onChange={(e) => set("ppg_data_scadenza", e.target.value)}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Dati Anagrafici */}
            <div>
              <p className="text-[9px] font-bold uppercase text-violet-800 mb-0.5">
                Dati Anagrafici
              </p>
              <div className="space-y-1">
                <div className="grid grid-cols-5 gap-x-1">
                  {fld(
                    "COGNOME",
                    <input
                      className={inp}
                      maxLength={35}
                      value={editor.cognome || ""}
                      onChange={(e) => set("cognome", e.target.value)}
                    />
                  )}
                  {fld(
                    "NOME",
                    <input
                      className={inp}
                      maxLength={35}
                      value={editor.nome || ""}
                      onChange={(e) => set("nome", e.target.value)}
                    />
                  )}
                  {fld(
                    "SESSO",
                    <select
                      className={inpNarrow}
                      value={editor.sesso || "M"}
                      onChange={(e) => set("sesso", e.target.value)}
                    >
                      <option value="M">M</option>
                      <option value="F">F</option>
                    </select>
                  )}
                  {fld(
                    "DATA NASC.",
                    <input
                      className={inp}
                      type="date"
                      value={editor.data_nascita || ""}
                      onChange={(e) => set("data_nascita", e.target.value)}
                    />
                  )}
                  {fld(
                    "ETÀ",
                    <input
                      className={`${inpNarrow} bg-slate-100`}
                      value={etaAnni}
                      readOnly
                    />
                  )}
                </div>
                <div className="grid grid-cols-6 gap-x-1">
                  {fld(
                    "LUOGO NASCITA",
                    <input
                      className={inp}
                      value={editor.comune_nascita || ""}
                      onChange={(e) => set("comune_nascita", e.target.value)}
                    />
                  )}
                  {fld(
                    "PROV.",
                    <input
                      className={inpNarrow}
                      maxLength={2}
                      value={editor.prov_nascita || ""}
                      onChange={(e) =>
                        set("prov_nascita", e.target.value.toUpperCase().slice(0, 2))
                      }
                    />
                  )}
                  {fld(
                    "CODICE FISCALE",
                    <input
                      className={`${inp} uppercase`}
                      maxLength={16}
                      value={editor.codice_fiscale || ""}
                      onChange={(e) =>
                        set("codice_fiscale", e.target.value.toUpperCase().slice(0, 16))
                      }
                    />
                  )}
                  {fld(
                    "CITTADINANZA",
                    <input
                      className={inp}
                      value={editor.cittadinanza || "ITALIANA"}
                      onChange={(e) => set("cittadinanza", e.target.value)}
                    />
                  )}
                  {fld(
                    "COMUNE RESIDENZA",
                    <input
                      className={inp}
                      value={editor.comune_residenza || ""}
                      onChange={(e) => set("comune_residenza", e.target.value)}
                    />
                  )}
                  {fld(
                    "PROV.",
                    <input
                      className={inpNarrow}
                      maxLength={2}
                      value={editor.prov_residenza || ""}
                      onChange={(e) =>
                        set("prov_residenza", e.target.value.toUpperCase().slice(0, 2))
                      }
                    />
                  )}
                </div>
                <div className="grid grid-cols-6 gap-x-1">
                  {fld(
                    "CAP",
                    <input
                      className="w-16 rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] text-slate-900"
                      value={editor.cap_residenza || ""}
                      onChange={(e) => set("cap_residenza", e.target.value)}
                    />
                  )}
                  {fld(
                    "INDIRIZZO",
                    <input
                      className={inp}
                      value={editor.indirizzo_residenza || ""}
                      onChange={(e) => set("indirizzo_residenza", e.target.value)}
                    />
                  )}
                  {fld(
                    "N. CIV.",
                    <input
                      className={inpNarrow}
                      value={editor.numero_civico || ""}
                      onChange={(e) => set("numero_civico", e.target.value)}
                    />
                  )}
                  {fld(
                    "TELEFONO",
                    <input
                      className={inp}
                      value={editor.telefono_1 || ""}
                      onChange={(e) => set("telefono_1", e.target.value)}
                    />
                  )}
                  {fld(
                    "EMAIL",
                    <input
                      className={inp}
                      type="email"
                      value={editor.email_contatto || ""}
                      onChange={(e) => set("email_contatto", e.target.value)}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Documento e Patente */}
            <div className="grid grid-cols-2 gap-x-3">
              <div>
                <p className="text-[9px] font-bold uppercase text-violet-800 mb-0.5">
                  Documento di Riconoscimento
                </p>
                <div className="grid grid-cols-3 gap-x-1">
                  {fld(
                    "TIPO",
                    <select
                      className={inp}
                      value={editor.tipo_documento || ""}
                      onChange={(e) => set("tipo_documento", e.target.value)}
                    >
                      <option value="">SELEZIONARE –</option>
                      {TIPO_DOCUMENTO_OPTIONS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  )}
                  {fld(
                    "NUMERO",
                    <input
                      className={inp}
                      value={editor.numero_documento || ""}
                      onChange={(e) => set("numero_documento", e.target.value)}
                    />
                  )}
                  {fld(
                    "RILASCIATO IL",
                    <input
                      className={inp}
                      type="date"
                      value={editor.rilasciato_il_documento || ""}
                      onChange={(e) => set("rilasciato_il_documento", e.target.value)}
                    />
                  )}
                  {fld(
                    "SCADE IL",
                    <input
                      className={inp}
                      type="date"
                      value={editor.scade_il_documento || ""}
                      onChange={(e) => set("scade_il_documento", e.target.value)}
                    />
                  )}
                  {fld(
                    "ENTE RILASCIO",
                    <input
                      className={inp}
                      value={editor.ente_rilascio_documento || ""}
                      onChange={(e) => set("ente_rilascio_documento", e.target.value)}
                      placeholder="Comune / Questura..."
                    />,
                    "col-span-2"
                  )}
                </div>
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase text-violet-800 mb-0.5">
                  Patente Posseduta
                </p>
                <div className="grid grid-cols-2 gap-x-1">
                  {fld(
                    "NUMERO PATENTE",
                    <input
                      className={inp}
                      value={editor.numero_patente_posseduta || ""}
                      onChange={(e) => set("numero_patente_posseduta", e.target.value)}
                    />
                  )}
                  {fld(
                    "RILASCIATA IL",
                    <input
                      className={inp}
                      type="date"
                      value={editor.rilasciata_il_patente || ""}
                      onChange={(e) => set("rilasciata_il_patente", e.target.value)}
                    />
                  )}
                  {fld(
                    "SCADE IL",
                    <input
                      className={inp}
                      type="date"
                      value={editor.scade_il_patente || ""}
                      onChange={(e) => set("scade_il_patente", e.target.value)}
                    />
                  )}
                  {fld(
                    "ENTE RILASCIO",
                    <input
                      className={inp}
                      value={editor.ente_rilascio_patente || ""}
                      onChange={(e) => set("ente_rilascio_patente", e.target.value)}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Note e campi extra */}
            <div className="grid grid-cols-3 gap-x-1">
              {fld(
                "TELEFONO 2",
                <input
                  className={inp}
                  value={editor.telefono_2 || ""}
                  onChange={(e) => set("telefono_2", e.target.value)}
                />
              )}
              {fld(
                "N. FOGLIO ROSA",
                <input
                  className={inp}
                  value={editor.ppg_numero || ""}
                  onChange={(e) => set("ppg_numero", e.target.value)}
                />
              )}
              {fld(
                "DIACRITICI",
                <input
                  className={inp}
                  value={editor.diacritici || ""}
                  onChange={(e) => set("diacritici", e.target.value)}
                  placeholder="es. è,à"
                  title="Accenti nel nome/cognome"
                />
              )}
              {fld(
                "UBICAZIONE 1",
                <input
                  className={inp}
                  value={editor.ubicazione_uno || ""}
                  onChange={(e) => set("ubicazione_uno", e.target.value)}
                />
              )}
              {fld(
                "UBICAZIONE 2",
                <input
                  className={inp}
                  value={editor.ubicazione_due || ""}
                  onChange={(e) => set("ubicazione_due", e.target.value)}
                />
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-1">
              {fld(
                "NOTE",
                <input
                  className={inp}
                  value={editor.note || ""}
                  onChange={(e) => set("note", e.target.value)}
                  placeholder="Note"
                />
              )}
              {fld(
                "PRESENZE A2/A",
                <input
                  className={inp}
                  value={editor.presenze_a2_a || ""}
                  onChange={(e) => set("presenze_a2_a", e.target.value)}
                />
              )}
            </div>
          </div>

          {/* Sidebar foto / firma */}
          <div className="w-44 shrink-0 flex flex-col gap-1 pl-2 border-l border-violet-200">
            <p className="text-[10px] font-bold uppercase text-violet-800 mb-0.5">Foto e Firma</p>
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => setShowScansioneModal(true)}
                className="w-full rounded bg-violet-600 px-1.5 py-1 text-[9px] font-semibold text-white hover:bg-violet-700"
              >
                Scanner
              </button>
            </div>
            <input
              ref={fotoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileFoto}
            />
            <input
              ref={firmaInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileFirma}
            />
            {/* Foto */}
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] italic text-violet-700 text-center">
                Doppio click acquisizione
              </span>
              <div className="flex items-start gap-0.5">
                <div
                  className="rounded border-2 border-slate-300 bg-white flex items-center justify-center cursor-pointer hover:border-violet-400 shrink-0 overflow-hidden"
                  style={{ width: 80, height: 96 }}
                  onClick={() => setShowScansioneModal(true)}
                  onDoubleClick={() => setShowScansioneModal(true)}
                >
                  {editor.foto_data_url &&
                  String(editor.foto_data_url).startsWith("data:image/") ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={editor.foto_data_url}
                      alt="Foto"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-[9px] text-slate-500 px-1 text-center">Foto</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => set("foto_data_url", "")}
                  className="shrink-0 rounded border border-slate-300 bg-slate-100 p-0.5 hover:bg-slate-200"
                  aria-label="Elimina foto"
                >
                  <span className="text-red-400 text-[10px]">✕</span>
                </button>
              </div>
            </div>
            {/* Firma */}
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] italic text-violet-700 text-center">
                Doppio click acquisizione
              </span>
              <div className="flex items-center gap-0.5">
                <div
                  className="rounded border border-slate-300 bg-white flex items-center justify-center cursor-pointer hover:border-violet-400 shrink-0 overflow-hidden"
                  style={{ width: 83, height: 17 }}
                  onClick={() => setShowScansioneModal(true)}
                  onDoubleClick={() => setShowScansioneModal(true)}
                >
                  {editor.firma_data_url &&
                  String(editor.firma_data_url).startsWith("data:image/") ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={editor.firma_data_url}
                      alt="Firma"
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : (
                    <span className="text-[9px] text-slate-500">Firma</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => set("firma_data_url", "")}
                  className="shrink-0 rounded border border-slate-300 bg-slate-100 p-0.5 hover:bg-slate-200"
                  aria-label="Elimina firma"
                >
                  <span className="text-red-400 text-[10px]">✕</span>
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-2" />
            <button
              type="button"
              onClick={onSalva}
              className="w-full rounded bg-emerald-500 py-1.5 text-[10px] font-bold text-white hover:bg-emerald-600"
            >
              CONFERMA
            </button>
            <button
              type="button"
              onClick={onBack}
              className="w-full rounded border border-violet-300 bg-violet-100 py-1.5 text-[10px] font-semibold text-violet-800 hover:bg-violet-200"
            >
              ← Indietro
            </button>
            <button
              type="button"
              onClick={onAnnulla}
              className="w-full rounded bg-violet-600 py-1.5 text-[10px] font-bold text-white hover:bg-violet-700"
            >
              ANNULLA
            </button>
          </div>
        </div>
      </div>

      {showScansioneModal && (
        <ScansioneFotoFirmaModal
          initialFoto={editor.foto_data_url}
          initialFirma={editor.firma_data_url}
          onConferma={(fotoUrl, firmaUrl) => {
            set("foto_data_url", fotoUrl || "");
            set("firma_data_url", firmaUrl || "");
            setShowScansioneModal(false);
          }}
          onAnnulla={() => setShowScansioneModal(false)}
        />
      )}
    </div>
  );
}

// =============================================================================
// Pannello modifica iscrizione esistente (GeCA: iscrEsame/iscrdup in modifica)
// =============================================================================
function DettaglioPanel({
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

  const labelCl = "shrink-0 text-[10px] font-semibold text-slate-300 whitespace-nowrap";
  const sectCl = "rounded border border-indigo-400 bg-slate-700/50 p-1";
  const rowCl = "flex flex-wrap items-center gap-x-1 gap-y-0.5";
  const fldCl = "flex items-center gap-0.5 shrink-0";
  const inputCl =
    "min-w-0 rounded border border-slate-500 bg-white px-1 py-0.5 text-[11px] text-slate-900";
  const provCl =
    "w-8 rounded border border-slate-500 bg-white px-0.5 py-0.5 text-center text-[11px] text-slate-900 uppercase";
  const dateCl =
    "w-24 rounded border border-slate-500 bg-white px-1 py-0.5 text-[11px] text-slate-900";
  const catCl =
    "w-14 rounded border border-slate-500 bg-white px-1 py-0.5 text-[11px] text-slate-900";
  const etaCl =
    "w-7 rounded border border-slate-500 bg-white px-0.5 py-0.5 text-center text-[11px] text-slate-900";
  const sessoCl =
    "w-9 rounded border border-slate-500 bg-white px-0.5 py-0.5 text-center text-[11px] text-slate-900";
  const cfCl =
    "w-36 rounded border border-slate-500 bg-white px-1 py-0.5 text-[11px] text-slate-900 uppercase";
  const cogNomeCl =
    "w-28 min-w-0 rounded border border-slate-500 bg-white px-1 py-0.5 text-[11px] text-slate-900";

  return (
    <div className="rounded-lg border-2 border-indigo-700 bg-slate-800 p-1.5 shadow-xl text-white">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
        <h3 className="text-xs font-bold text-white">
          Modifica – {editor.cognome} {editor.nome}
        </h3>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={onSalva}
            className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-emerald-500"
          >
            CONFERMA
          </button>
          <button
            type="button"
            onClick={onAnnulla}
            className="rounded border border-slate-400 bg-slate-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-slate-500"
          >
            ANNULLA
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1 lg:flex-row">
        <div className="max-h-[55vh] min-h-45 flex-1 overflow-y-auto pr-0.5">
          {/* Iscrizione */}
          <div className={sectCl}>
            <p className="mb-0.5 text-[9px] font-bold uppercase text-amber-200">Iscrizione</p>
            <div className={rowCl}>
              <div className={fldCl}>
                <label className={labelCl}>Data iscr.</label>
                <input
                  className={dateCl}
                  type="date"
                  value={editor.data_iscrizione || ""}
                  onChange={(e) => set("data_iscrizione", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Autoscuola</label>
                <input
                  className={`${inputCl} w-20`}
                  value={editor.codice_autoscuola || ""}
                  onChange={(e) => set("codice_autoscuola", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Tipo</label>
                <select
                  className={`${inputCl} w-36`}
                  value={editor.stato_richiesta || ""}
                  onChange={(e) => set("stato_richiesta", e.target.value)}
                >
                  <option value="">•</option>
                  {TIPO_ISCRIZIONE_OPTIONS.filter(Boolean).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Categoria</label>
                <select
                  className={catCl}
                  value={editor.categoria_patente || "B"}
                  onChange={(e) => set("categoria_patente", e.target.value)}
                >
                  {PATENTE_RICHIESTA_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
              <div className={fldCl}>
                <label className={labelCl}>N. registro</label>
                <input
                  className={`${inputCl} w-20`}
                  value={editor.numero_registro || ""}
                  onChange={(e) => set("numero_registro", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Data reg.</label>
                <input
                  className={dateCl}
                  type="date"
                  value={editor.data_registro || ""}
                  onChange={(e) => set("data_registro", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Stato</label>
                <input
                  className={`${inputCl} w-24`}
                  value={editor.stato_richiesta_testo || ""}
                  onChange={(e) => set("stato_richiesta_testo", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Fogli rosa</label>
                <input
                  className={dateCl}
                  type="date"
                  value={editor.ppg_data_emissione || ""}
                  onChange={(e) => set("ppg_data_emissione", e.target.value)}
                  title="Emissione"
                />
                <span className="text-slate-500">→</span>
                <input
                  className={dateCl}
                  type="date"
                  value={editor.ppg_data_scadenza || ""}
                  onChange={(e) => set("ppg_data_scadenza", e.target.value)}
                  title="Scadenza"
                />
              </div>
            </div>
          </div>

          {/* Anagrafica */}
          <div className={`mt-1 ${sectCl}`}>
            <p className="mb-0.5 text-[9px] font-bold uppercase text-amber-200">Anagrafica</p>
            <div className={rowCl}>
              <div className={fldCl}>
                <label className={labelCl}>Cognome</label>
                <input
                  className={cogNomeCl}
                  maxLength={35}
                  value={editor.cognome || ""}
                  onChange={(e) => set("cognome", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Nome</label>
                <input
                  className={cogNomeCl}
                  maxLength={35}
                  value={editor.nome || ""}
                  onChange={(e) => set("nome", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Sesso</label>
                <select
                  className={sessoCl}
                  value={editor.sesso || "M"}
                  onChange={(e) => set("sesso", e.target.value)}
                >
                  <option value="M">M</option>
                  <option value="F">F</option>
                </select>
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Data nascita</label>
                <input
                  className={dateCl}
                  type="date"
                  value={editor.data_nascita || ""}
                  onChange={(e) => set("data_nascita", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Età</label>
                <input className={etaCl} value={etaAnni} readOnly />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Luogo nascita</label>
                <input
                  className={`${inputCl} w-24`}
                  value={editor.comune_nascita || ""}
                  onChange={(e) => set("comune_nascita", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Prov.</label>
                <input
                  className={provCl}
                  maxLength={2}
                  value={editor.prov_nascita || ""}
                  onChange={(e) =>
                    set("prov_nascita", e.target.value.toUpperCase().slice(0, 2))
                  }
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Cod. fiscale</label>
                <input
                  className={cfCl}
                  maxLength={16}
                  value={editor.codice_fiscale || ""}
                  onChange={(e) =>
                    set("codice_fiscale", e.target.value.toUpperCase().slice(0, 16))
                  }
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Cittadinanza</label>
                <input
                  className={`${inputCl} w-16`}
                  value={editor.cittadinanza || "ITA"}
                  onChange={(e) => set("cittadinanza", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Residenza</label>
                <input
                  className={`${inputCl} w-24`}
                  value={editor.comune_residenza || ""}
                  onChange={(e) => set("comune_residenza", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Prov.</label>
                <input
                  className={provCl}
                  maxLength={2}
                  value={editor.prov_residenza || ""}
                  onChange={(e) =>
                    set("prov_residenza", e.target.value.toUpperCase().slice(0, 2))
                  }
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>CAP</label>
                <input
                  className={`${inputCl} w-14`}
                  value={editor.cap_residenza || ""}
                  onChange={(e) => set("cap_residenza", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Indirizzo</label>
                <input
                  className={`${inputCl} w-32`}
                  value={editor.indirizzo_residenza || ""}
                  onChange={(e) => set("indirizzo_residenza", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>N. civ.</label>
                <input
                  className={`${inputCl} w-12`}
                  value={editor.numero_civico || ""}
                  onChange={(e) => set("numero_civico", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Telefono</label>
                <input
                  className={`${inputCl} w-24`}
                  value={editor.telefono_1 || ""}
                  onChange={(e) => set("telefono_1", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Email</label>
                <input
                  className={`${inputCl} w-36`}
                  type="email"
                  value={editor.email_contatto || ""}
                  onChange={(e) => set("email_contatto", e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Documento e patente */}
          <div className={`mt-1 ${sectCl}`}>
            <p className="mb-0.5 text-[9px] font-bold uppercase text-amber-200">
              Documento e patente
            </p>
            <div className={rowCl}>
              <div className={fldCl}>
                <label className={labelCl}>Tipo doc.</label>
                <select
                  className={`${inputCl} w-28`}
                  value={editor.tipo_documento || ""}
                  onChange={(e) => set("tipo_documento", e.target.value)}
                >
                  <option value="">•</option>
                  {TIPO_DOCUMENTO_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div className={fldCl}>
                <label className={labelCl}>N. documento</label>
                <input
                  className={`${inputCl} w-24`}
                  value={editor.numero_documento || ""}
                  onChange={(e) => set("numero_documento", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Scad. doc.</label>
                <input
                  className={dateCl}
                  type="date"
                  value={editor.scade_il_documento || ""}
                  onChange={(e) => set("scade_il_documento", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Rilasc. doc.</label>
                <input
                  className={dateCl}
                  type="date"
                  value={editor.rilasciato_il_documento || ""}
                  onChange={(e) => set("rilasciato_il_documento", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Ente doc.</label>
                <input
                  className={`${inputCl} w-24`}
                  value={editor.ente_rilascio_documento || ""}
                  onChange={(e) => set("ente_rilascio_documento", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>N. patente</label>
                <input
                  className={`${inputCl} w-24`}
                  value={editor.numero_patente_posseduta || ""}
                  onChange={(e) => set("numero_patente_posseduta", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Rilasc. pat.</label>
                <input
                  className={dateCl}
                  type="date"
                  value={editor.rilasciata_il_patente || ""}
                  onChange={(e) => set("rilasciata_il_patente", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Scad. patente</label>
                <input
                  className={dateCl}
                  type="date"
                  value={editor.scade_il_patente || ""}
                  onChange={(e) => set("scade_il_patente", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Ente pat.</label>
                <input
                  className={`${inputCl} w-24`}
                  value={editor.ente_rilascio_patente || ""}
                  onChange={(e) => set("ente_rilascio_patente", e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Note */}
          <div className={`mt-1 ${sectCl}`}>
            <div className={rowCl}>
              <div className={fldCl}>
                <label className={labelCl}>Telefono 2</label>
                <input
                  className={`${inputCl} w-24`}
                  value={editor.telefono_2 || ""}
                  onChange={(e) => set("telefono_2", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>N. foglio rosa</label>
                <input
                  className={`${inputCl} w-20`}
                  value={editor.ppg_numero || ""}
                  onChange={(e) => set("ppg_numero", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Ubicazione 1</label>
                <input
                  className={`${inputCl} w-24`}
                  value={editor.ubicazione_uno || ""}
                  onChange={(e) => set("ubicazione_uno", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Ubicazione 2</label>
                <input
                  className={`${inputCl} w-24`}
                  value={editor.ubicazione_due || ""}
                  onChange={(e) => set("ubicazione_due", e.target.value)}
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Diacritici</label>
                <input
                  className={`${inputCl} w-20`}
                  value={editor.diacritici || ""}
                  onChange={(e) => set("diacritici", e.target.value)}
                  placeholder="es. è,à"
                  title="Accenti nel nome/cognome"
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Note</label>
                <input
                  className={`${inputCl} flex-1 min-w-32`}
                  value={editor.note || ""}
                  onChange={(e) => set("note", e.target.value)}
                  placeholder="Note"
                />
              </div>
              <div className={fldCl}>
                <label className={labelCl}>Presenze A2/A</label>
                <input
                  className={`${inputCl} w-14`}
                  value={editor.presenze_a2_a || ""}
                  onChange={(e) => set("presenze_a2_a", e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar foto/firma */}
        <div className={`mt-1.5 lg:mt-0 lg:w-[180px] shrink-0 ${sectCl}`}>
          <p className="mb-1 text-[9px] font-bold uppercase text-amber-200">Foto / Firma</p>
          <input
            ref={fotoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileFoto}
          />
          <input
            ref={firmaInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileFirma}
          />
          <div className="space-y-1.5">
            {/* Foto */}
            <div>
              <div className="flex items-center justify-between gap-0.5 mb-0.5">
                <span className={labelCl}>Foto</span>
                <div className="flex gap-0.5">
                  <button
                    type="button"
                    onClick={() => fotoInputRef.current?.click()}
                    className="rounded border border-slate-500 bg-slate-600 px-1 py-0.5 text-[9px] font-bold text-white hover:bg-slate-500"
                  >
                    File
                  </button>
                  {editor.foto_data_url && (
                    <button
                      type="button"
                      onClick={() => set("foto_data_url", "")}
                      className="rounded border border-red-500 bg-red-600 px-1 py-0.5 text-[9px] text-white"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
              <div
                className="rounded border border-slate-500 bg-white flex items-center justify-center overflow-hidden"
                style={{ width: "100%", height: 80 }}
              >
                {editor.foto_data_url &&
                String(editor.foto_data_url).startsWith("data:image/") ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={editor.foto_data_url}
                    alt="Foto"
                    className="max-w-full max-h-full object-contain"
                  />
                ) : (
                  <span className="text-[9px] text-slate-400">Nessuna foto</span>
                )}
              </div>
            </div>
            {/* Firma */}
            <div>
              <div className="flex items-center justify-between gap-0.5 mb-0.5">
                <span className={labelCl}>Firma</span>
                <div className="flex gap-0.5">
                  <button
                    type="button"
                    onClick={() => firmaInputRef.current?.click()}
                    className="rounded border border-slate-500 bg-slate-600 px-1 py-0.5 text-[9px] font-bold text-white hover:bg-slate-500"
                  >
                    File
                  </button>
                  {editor.firma_data_url && (
                    <button
                      type="button"
                      onClick={() => set("firma_data_url", "")}
                      className="rounded border border-red-500 bg-red-600 px-1 py-0.5 text-[9px] text-white"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
              <div
                className="rounded border border-slate-500 bg-white flex items-center justify-center overflow-hidden"
                style={{ width: "100%", height: 28 }}
              >
                {editor.firma_data_url &&
                String(editor.firma_data_url).startsWith("data:image/") ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={editor.firma_data_url}
                    alt="Firma"
                    className="max-w-full max-h-full object-contain"
                  />
                ) : (
                  <span className="text-[9px] text-slate-400">Nessuna firma</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Modal Scansione Foto e Firma (GeCA: scanner TWAIN/WIA o file)
// =============================================================================
function ScansioneFotoFirmaModal({ initialFoto, initialFirma, onConferma, onAnnulla }) {
  const [foto, setFoto] = useState(() => initialFoto || "");
  const [firma, setFirma] = useState(() => initialFirma || "");
  const [scannerStatus, setScannerStatus] = useState(null);
  const [scanError, setScanError] = useState("");
  const fotoFileRef = useRef(null);
  const firmaFileRef = useRef(null);
  const scanTargetRef = useRef(null);

  const checkScanner = useCallback(async () => {
    setScannerStatus("checking");
    setScanError("");
    try {
      const res = await fetch(`${SCANNER_SERVICE_URL}/ping`, {
        method: "GET",
        mode: "cors",
      });
      const data = await res.json().catch(() => ({}));
      const online = data.status === "scanner service online";
      setScannerStatus(online ? "online" : "offline");
      if (!online)
        setScanError(
          "Servizio scanner non risponde. Avviare: cd scanner-service && node server.js"
        );
      return online;
    } catch {
      setScannerStatus("offline");
      setScanError(
        "Servizio scanner non raggiungibile (localhost:5001). Usare Carica da file."
      );
      return false;
    }
  }, []);

  const handleFileFoto = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file || !file.type.startsWith("image/")) return;
      if (scanTargetRef.current === "foto") {
        scanTargetRef.current = null;
        try {
          const form = new FormData();
          form.append("image", file);
          const res = await fetch(`${SCANNER_SERVICE_URL}/scan`, {
            method: "POST",
            body: form,
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Errore scan");
          if (data.dataUrl) setFoto(data.dataUrl);
        } catch (err) {
          setScanError(err.message || "Errore acquisizione foto");
        }
        return;
      }
      const reader = new FileReader();
      reader.onload = () => setFoto(reader.result || "");
      reader.readAsDataURL(file);
    },
    []
  );

  const handleFileFirma = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file || !file.type.startsWith("image/")) return;
      if (scanTargetRef.current === "firma") {
        scanTargetRef.current = null;
        try {
          const form = new FormData();
          form.append("image", file);
          const res = await fetch(`${SCANNER_SERVICE_URL}/scan`, {
            method: "POST",
            body: form,
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Errore scan");
          if (data.dataUrl) setFirma(data.dataUrl);
        } catch (err) {
          setScanError(err.message || "Errore acquisizione firma");
        }
        return;
      }
      const reader = new FileReader();
      reader.onload = () => setFirma(reader.result || "");
      reader.readAsDataURL(file);
    },
    []
  );

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
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/60"
      onClick={(e) => e.target === e.currentTarget && onAnnulla()}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] rounded-lg border border-violet-200 bg-white shadow-xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-violet-700 bg-violet-800 px-4 py-2 shrink-0">
          <h3 className="text-sm font-bold text-white">Scansione Foto e Firma</h3>
          <button
            type="button"
            onClick={onAnnulla}
            className="rounded p-1 text-white/80 hover:bg-violet-700 hover:text-white"
            aria-label="Chiudi"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
          <p className="text-center text-[10px] font-bold uppercase text-violet-800">
            Selezione dispositivo
          </p>
          {scanError && (
            <p className="rounded bg-amber-100 px-2 py-1 text-center text-[10px] text-amber-800">
              {scanError}
            </p>
          )}
          {scannerStatus === "checking" && (
            <p className="text-center text-[10px] text-slate-500">
              Verifica servizio scanner...
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={acqScannerFoto}
              disabled={scannerStatus === "checking"}
              className="rounded bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            >
              Scanner FOTO
            </button>
            <button
              type="button"
              onClick={acqScannerFirma}
              disabled={scannerStatus === "checking"}
              className="rounded bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            >
              Scanner FIRMA
            </button>
            <button
              type="button"
              onClick={() => {
                setScanError("");
                fotoFileRef.current?.click();
              }}
              className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Carica FOTO da file
            </button>
            <button
              type="button"
              onClick={() => {
                setScanError("");
                firmaFileRef.current?.click();
              }}
              className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Carica FIRMA da file
            </button>
          </div>
          <input
            ref={fotoFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileFoto}
          />
          <input
            ref={firmaFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileFirma}
          />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="mb-1 text-[9px] font-bold uppercase text-slate-600">
                Anteprima FOTO
              </p>
              <div
                className="flex items-center justify-center overflow-hidden rounded border border-slate-300 bg-white"
                style={{ width: 160, height: 192 }}
              >
                {foto && String(foto).startsWith("data:image/") ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={foto} alt="Foto" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[10px] text-slate-500">Nessuna foto</span>
                )}
              </div>
            </div>
            <div>
              <p className="mb-1 text-[9px] font-bold uppercase text-slate-600">
                Anteprima FIRMA
              </p>
              <div
                className="flex items-center justify-center overflow-hidden rounded border border-slate-300 bg-white"
                style={{ width: 165, height: 33 }}
              >
                {firma && String(firma).startsWith("data:image/") ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={firma}
                    alt="Firma"
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="text-[10px] text-slate-500">Nessuna firma</span>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-2 shrink-0">
          <button
            type="button"
            onClick={onAnnulla}
            className="rounded bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-700"
          >
            ANNULLA
          </button>
          <button
            type="button"
            onClick={() => onConferma(foto, firma)}
            className="rounded bg-emerald-500 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-600"
          >
            CONFERMA
          </button>
        </div>
      </div>
    </div>
  );
}

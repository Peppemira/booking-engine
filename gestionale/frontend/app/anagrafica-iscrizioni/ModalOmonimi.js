"use client";

/**
 * ModalOmonimi.js — Replica fedele di GeCA `frmOmoni.cs` (Ricerca Omonimi).
 *
 * Funziona in 2 modalita':
 *
 *  1) "search" (pulsante toolbar "Ricerca Omonimi")
 *     L'utente puo' digitare filtri cognome/nome/data nascita e cercare nel DB.
 *     Double-click (o Seleziona) su una riga -> onSelectCandidate(candidato)
 *
 *  2) "check" (chiamata dal Wizard durante il salvataggio nuova iscrizione)
 *     Viene passato un filtro iniziale (cognome+nome+data) e la modale
 *     mostra gia' i risultati. L'utente puo':
 *       - Selezionare un candidato esistente -> onSelectCandidate(candidato)
 *         (il Wizard popola l'editor con quel candidato invece di crearne uno nuovo)
 *       - "Procedi comunque" -> onProceedAnyway()
 *         (il Wizard procede con la creazione del nuovo candidato)
 *       - "Chiudi" -> onClose()
 *         (il Wizard annulla il salvataggio)
 *
 * Colonne griglia (replica GeCA frmOmoni eleIscritti):
 *   Cognome | Nome | CF | Data Nascita | Telefono | Tipo Iscrizione | Data Iscr.
 *   | Pat. Rich. | Stato Pratica | Cod. Autos.
 *
 * La trasformazione sigla -> testo descrittivo replica
 * GeCA `deleIscritti_CellFormatting`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE, authHeaders } from "../../lib/authClient";

// ── Mappa sigla -> label descrittiva (replica GeCA CellFormatting) ──────
const SIGLA_LABELS = {
  IN: "INTERNO",
  PR: "PRIVATISTA",
  RE: "REVISIONE",
  CV: "CONFERMA VALIDITA'",
  "D|": "DUPLICATO (SMARRIMENTO)",
  "Y|": "DUPLICATO (SOTTRAZIONE)",
  "L|": "DUPLICATO (RICLASSIF.)",
  "S|": "DUPLICATO (DETERIOR.)",
  "R|": "DUPLICATO (ALTRO)",
  "M|": "CONVERSIONE MILITARE",
  "E|": "CONVERSIONE ESTERA",
  PC: "PATENTE CQC",
  CC: "CQC CARD",
  CM: "CERTIFICATO MEDICO",
  GA: "GUIDA ACCOMPAGNATA",
  PN: "PATENTE NAUTICA",
  RP: "RECUPERO PUNTI",
  CQ: "CORSO CQC",
  CK: "CORSO CAP",
  CA: "CORSO ADR",
  EG: "ESERCITAZIONE GUIDA",
  AD: "ARCHIVIO DATI",
  PI: "PERMESSO INTERN.",
  PP: "PERMESSO PROVV.",
};

function siglaToLabel(sigla, fallback) {
  if (!sigla) return fallback || "";
  const s = String(sigla).trim();
  return SIGLA_LABELS[s] || fallback || s;
}

// ── Formattazione date dd/mm/yyyy ───────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return "";
  const s = String(iso).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// ── Estrae campi extra dal raw_portale se non presenti direttamente ─────
function extractExtra(row) {
  const rp = row?.raw_portale || {};
  return {
    telefono:
      row.telefono ||
      rp.anagrafica?.telefono ||
      rp.contatti?.telefono ||
      rp.telefono ||
      "",
    tipo_iscrizione_sigla:
      row.tipo_iscrizione_sigla ||
      rp.tipo_iscrizione_sigla ||
      rp.sigla ||
      "",
    tipo_iscrizione:
      row.tipo_iscrizione ||
      rp.tipo_iscrizione ||
      rp.tipo_iscrizione_label ||
      "",
    stato_iscrizione:
      row.stato_iscrizione ||
      row.stato_pratica ||
      rp.stato_iscrizione ||
      rp.stato_pratica ||
      "",
    categoria_richiesta:
      row.categoria_richiesta ||
      rp.categoria_richiesta ||
      row.categoria_patente ||
      "",
    codice_autoscuola:
      row.codice_autoscuola || rp.codice_autoscuola || "",
    data_iscrizione:
      row.data_iscrizione || rp.data_iscrizione || row.created_at || "",
  };
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {()=>void} props.onClose
 * @param {(candidato:object)=>void} [props.onSelectCandidate]
 * @param {()=>void} [props.onProceedAnyway]
 * @param {string} [props.initialCognome]
 * @param {string} [props.initialNome]
 * @param {string} [props.initialDataNascita]
 * @param {boolean} [props.autoSearchOnOpen] - se true, cerca subito all'apertura
 * @param {boolean} [props.showProceedButton] - se true, mostra "Procedi comunque"
 * @param {string} [props.title]
 */
export default function ModalOmonimi({
  open,
  onClose,
  onSelectCandidate,
  onProceedAnyway,
  initialCognome = "",
  initialNome = "",
  initialDataNascita = "",
  autoSearchOnOpen = false,
  showProceedButton = false,
  title = "Ricerca Omonimi",
}) {
  const [cognome, setCognome] = useState(initialCognome);
  const [nome, setNome] = useState(initialNome);
  const [dataNascita, setDataNascita] = useState(initialDataNascita);
  const [prefixMode, setPrefixMode] = useState(true);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Reset quando si riapre con filtri iniziali diversi
  useEffect(() => {
    if (open) {
      setCognome(initialCognome || "");
      setNome(initialNome || "");
      setDataNascita(initialDataNascita || "");
      setError("");
      setSelectedId(null);
      setRows([]);
      setHasSearched(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const doSearch = useCallback(async () => {
    setError("");
    setLoading(true);
    setHasSearched(true);
    try {
      const body = {
        cognome: (cognome || "").trim(),
        nome: (nome || "").trim(),
        data_nascita: (dataNascita || "").trim() || null,
        exact: !prefixMode,
      };
      if (!body.cognome && !body.nome) {
        setError("Inserire almeno Cognome o Nome per la ricerca.");
        setRows([]);
        setLoading(false);
        return;
      }
      const res = await fetch(`${API_BASE}/api/candidati-api/omonimi`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      const list = Array.isArray(data?.omonimi) ? data.omonimi : [];
      setRows(list);
      if (list.length === 0) {
        setError("Nessun candidato trovato con questi criteri.");
      }
    } catch (e) {
      setError(`Errore ricerca: ${e.message}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [cognome, nome, dataNascita, prefixMode]);

  // Autosearch all'apertura se richiesto
  useEffect(() => {
    if (open && autoSearchOnOpen && (initialCognome || initialNome)) {
      // Ricerca immediata con i valori iniziali (senza prefix per check wizard esatto)
      (async () => {
        setError("");
        setLoading(true);
        setHasSearched(true);
        try {
          const res = await fetch(`${API_BASE}/api/candidati-api/omonimi`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({
              cognome: initialCognome,
              nome: initialNome,
              data_nascita: initialDataNascita || null,
              exact: true,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok) {
            const list = Array.isArray(data?.omonimi) ? data.omonimi : [];
            setRows(list);
            if (list.length === 0) {
              setError("Nessun omonimo trovato.");
            }
          } else {
            setError(data?.error || `HTTP ${res.status}`);
          }
        } catch (e) {
          setError(`Errore: ${e.message}`);
        } finally {
          setLoading(false);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ESC chiude
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
      if (e.key === "Enter" && (e.target?.tagName || "") === "INPUT") {
        e.preventDefault();
        doSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, doSearch]);

  const selectedRow = useMemo(
    () => rows.find((r) => r.id === selectedId) || null,
    [rows, selectedId]
  );

  const handleSelect = useCallback(
    (row) => {
      if (!row) return;
      if (typeof onSelectCandidate === "function") {
        onSelectCandidate(row);
      }
    },
    [onSelectCandidate]
  );

  const handleRowDblClick = useCallback(
    (row) => {
      setSelectedId(row.id);
      handleSelect(row);
    },
    [handleSelect]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="flex w-full max-w-6xl max-h-[90vh] flex-col rounded-lg border border-slate-300 bg-white shadow-2xl">
        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-violet-50 px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-violet-900">{title}</span>
            {rows.length > 0 && (
              <span className="rounded-full bg-violet-200 px-2 py-0.5 text-xs font-semibold text-violet-800">
                {rows.length} {rows.length === 1 ? "risultato" : "risultati"}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
            title="Chiudi (ESC)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Filtri ── */}
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                Cognome
              </label>
              <input
                type="text"
                value={cognome}
                onChange={(e) => setCognome(e.target.value)}
                placeholder="Rossi"
                className="mt-1 w-48 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                autoFocus
              />
            </div>
            <div className="flex flex-col">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                Nome
              </label>
              <input
                type="text"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Mario"
                className="mt-1 w-48 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
            <div className="flex flex-col">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                Data Nascita
              </label>
              <input
                type="date"
                value={dataNascita}
                onChange={(e) => setDataNascita(e.target.value)}
                className="mt-1 w-40 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={prefixMode}
                onChange={(e) => setPrefixMode(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
              />
              Ricerca per prefisso
            </label>
            <button
              type="button"
              onClick={doSearch}
              disabled={loading}
              className="mb-0.5 rounded bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {loading ? "Ricerca…" : "🔎 Cerca"}
            </button>
            {hasSearched && (
              <button
                type="button"
                onClick={() => {
                  setCognome("");
                  setNome("");
                  setDataNascita("");
                  setRows([]);
                  setError("");
                  setHasSearched(false);
                  setSelectedId(null);
                }}
                className="mb-0.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Pulisci
              </button>
            )}
          </div>
        </div>

        {/* ── Body: tabella risultati ── */}
        <div className="flex-1 overflow-auto">
          {error && rows.length === 0 ? (
            <div className="flex h-full items-center justify-center p-8">
              <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {error}
              </div>
            </div>
          ) : rows.length === 0 && !hasSearched ? (
            <div className="flex h-full flex-col items-center justify-center p-8 text-slate-500">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mb-2 opacity-40"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <p className="text-sm">
                Inserire i criteri di ricerca e premere <b>Cerca</b>
              </p>
            </div>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                <tr>
                  <th className="border-b border-slate-300 px-2 py-2 text-left font-semibold">
                    Cognome
                  </th>
                  <th className="border-b border-slate-300 px-2 py-2 text-left font-semibold">
                    Nome
                  </th>
                  <th className="border-b border-slate-300 px-2 py-2 text-left font-semibold">
                    Cod. Fiscale
                  </th>
                  <th className="border-b border-slate-300 px-2 py-2 text-left font-semibold">
                    Data Nasc.
                  </th>
                  <th className="border-b border-slate-300 px-2 py-2 text-left font-semibold">
                    Telefono
                  </th>
                  <th className="border-b border-slate-300 px-2 py-2 text-left font-semibold">
                    Tipo Iscrizione
                  </th>
                  <th className="border-b border-slate-300 px-2 py-2 text-left font-semibold">
                    Data Iscr.
                  </th>
                  <th className="border-b border-slate-300 px-2 py-2 text-left font-semibold">
                    Pat. Rich.
                  </th>
                  <th className="border-b border-slate-300 px-2 py-2 text-left font-semibold">
                    Stato
                  </th>
                  <th className="border-b border-slate-300 px-2 py-2 text-left font-semibold">
                    Cod. Aut.
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const extra = extractExtra(row);
                  const isSel = row.id === selectedId;
                  return (
                    <tr
                      key={row.id}
                      onClick={() => setSelectedId(row.id)}
                      onDoubleClick={() => handleRowDblClick(row)}
                      className={`cursor-pointer border-b border-slate-100 hover:bg-violet-50 ${
                        isSel ? "bg-violet-100" : ""
                      }`}
                      title="Doppio click per selezionare"
                    >
                      <td className="px-2 py-1.5 font-medium text-slate-900">
                        {row.cognome || ""}
                      </td>
                      <td className="px-2 py-1.5 text-slate-800">
                        {row.nome || ""}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-[10px] text-slate-600">
                        {row.codice_fiscale || ""}
                      </td>
                      <td className="px-2 py-1.5 text-slate-700">
                        {fmtDate(row.data_nascita)}
                      </td>
                      <td className="px-2 py-1.5 text-slate-700">
                        {extra.telefono}
                      </td>
                      <td className="px-2 py-1.5 text-slate-800">
                        {siglaToLabel(
                          extra.tipo_iscrizione_sigla,
                          extra.tipo_iscrizione
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-slate-700">
                        {fmtDate(extra.data_iscrizione)}
                      </td>
                      <td className="px-2 py-1.5 text-slate-700">
                        {extra.categoria_richiesta}
                      </td>
                      <td className="px-2 py-1.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            /attiv/i.test(extra.stato_iscrizione)
                              ? "bg-emerald-100 text-emerald-800"
                              : /chius|archivi/i.test(extra.stato_iscrizione)
                              ? "bg-slate-200 text-slate-700"
                              : "bg-stone-100 text-stone-700"
                          }`}
                        >
                          {extra.stato_iscrizione || "—"}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 font-mono text-[10px] text-slate-600">
                        {extra.codice_autoscuola}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Footer: azioni ── */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <div className="text-xs text-slate-500">
            {selectedRow ? (
              <span>
                Selezionato:{" "}
                <b className="text-slate-800">
                  {selectedRow.cognome} {selectedRow.nome}
                </b>
              </span>
            ) : rows.length > 0 ? (
              <span>Doppio click su una riga per selezionare</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Chiudi
            </button>
            {showProceedButton && (
              <button
                type="button"
                onClick={() => {
                  if (typeof onProceedAnyway === "function") onProceedAnyway();
                }}
                className="rounded border border-amber-400 bg-amber-50 px-4 py-1.5 text-sm font-semibold text-amber-800 hover:bg-amber-100"
                title="Prosegue creando un nuovo candidato, ignorando gli omonimi"
              >
                ⚠️ Procedi comunque
              </button>
            )}
            <button
              type="button"
              onClick={() => handleSelect(selectedRow)}
              disabled={!selectedRow}
              className="rounded bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            >
              ✓ Seleziona
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

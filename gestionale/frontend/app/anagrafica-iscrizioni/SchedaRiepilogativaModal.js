"use client";

/**
 * SchedaRiepilogativaModal.js — Scheda riepilogativa candidato con 3 tab
 *
 * Replica fedele di GeCA Future `frmRiepilogo.cs` / `frmRiepilogo.Designer.cs`
 * (gruppi: autoscuola, AnaRes, GroupInt, GroupRinn, GroupDupl, GroupPatRil,
 *  GroupAbilitazioni, PanAbilit).
 *
 * Struttura:
 *   Tab 1 - Autoscuola     -> autoscuola + AnaRes + dati iscrizione + protocolli
 *   Tab 2 - Patente        -> GroupPatRil + doc riconoscimento + patente posseduta
 *                             + dati richiesta specifici (Int/Rinn/Dupl/Esame)
 *   Tab 3 - Abilitazioni   -> GroupAbilitazioni (Schema categorie AM-A-B-C-D-E)
 *
 * Stampa: via window.print() con CSS @media print dedicato.
 */

import { useState, useCallback, useMemo, useEffect } from "react";

/* ────────────────────────────────────────────────────────────────────────────
 * Utility
 * ─────────────────────────────────────────────────────────────────────────── */

const fmtDate = (d) => {
  if (!d) return "—";
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return String(d);
    return dt.toLocaleDateString("it-IT");
  } catch {
    return String(d || "—");
  }
};

const fmtStr = (s) => (s === null || s === undefined || s === "" ? "—" : String(s));

/**
 * Estrae il valore da candidato, provando prima top-level poi raw_portale.anagrafica
 */
const getField = (row, key, fallbackKeys = []) => {
  if (!row) return "";
  if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  const rawAn = row.raw_portale?.anagrafica || {};
  if (rawAn[key] !== undefined && rawAn[key] !== null && rawAn[key] !== "") return rawAn[key];
  for (const k of fallbackKeys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== "") return row[k];
    if (rawAn[k] !== undefined && rawAn[k] !== null && rawAn[k] !== "") return rawAn[k];
  }
  return "";
};

/* ────────────────────────────────────────────────────────────────────────────
 * Sub-componenti UI
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * Label + valore "readonly" stile scheda (sostituto di MyTextBox di GeCA)
 */
function Field({ label, value, className = "" }) {
  return (
    <div className={`flex flex-col ${className}`}>
      <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span className="min-h-[18px] border-b border-slate-200 pb-0.5 text-[12px] font-medium text-slate-900">
        {fmtStr(value)}
      </span>
    </div>
  );
}

/**
 * Wrapper di gruppo stile fieldset GeCA GroupBox
 */
function Group({ title, color = "violet", className = "", children }) {
  const colors = {
    violet: "border-violet-300 bg-violet-50/40",
    sky: "border-sky-300 bg-sky-50/40",
    emerald: "border-emerald-300 bg-emerald-50/40",
    amber: "border-amber-300 bg-amber-50/40",
    stone: "border-stone-300 bg-stone-50/40",
    rose: "border-rose-300 bg-rose-50/40",
  };
  const titleColors = {
    violet: "text-violet-800",
    sky: "text-sky-800",
    emerald: "text-emerald-800",
    amber: "text-amber-800",
    stone: "text-stone-800",
    rose: "text-rose-800",
  };
  return (
    <fieldset
      className={`rounded-md border-2 ${colors[color] || colors.violet} p-3 ${className}`}
    >
      <legend className={`px-2 text-xs font-bold ${titleColors[color] || titleColors.violet}`}>
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

/**
 * Riga "abilitazione" dello schema categorie (replica GeCA PanAbilit).
 * Mostra per una categoria (A1, A2, A, B, B1, BE, C, C1, CE, C1E, D, D1, DE, D1E):
 * - Checkbox "rilasciata"
 * - Data rilascio
 * - Anno annotazione (se presente)
 */
function RigaAbilitazione({ cat, rilasciata, data, ann1, ann2, ann3, ann4, ann5 }) {
  return (
    <tr className={rilasciata ? "bg-violet-50/60" : ""}>
      <td className="border border-slate-300 px-1.5 py-0.5 font-mono text-[11px] font-bold text-slate-800">
        {cat}
      </td>
      <td className="border border-slate-300 px-1.5 py-0.5 text-center text-[11px]">
        {rilasciata ? "✓" : ""}
      </td>
      <td className="border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-700">
        {fmtDate(data)}
      </td>
      <td className="border border-slate-300 px-1 py-0.5 text-center text-[10px] text-slate-600">
        {fmtStr(ann1)}
      </td>
      <td className="border border-slate-300 px-1 py-0.5 text-center text-[10px] text-slate-600">
        {fmtStr(ann2)}
      </td>
      <td className="border border-slate-300 px-1 py-0.5 text-center text-[10px] text-slate-600">
        {fmtStr(ann3)}
      </td>
      <td className="border border-slate-300 px-1 py-0.5 text-center text-[10px] text-slate-600">
        {fmtStr(ann4)}
      </td>
      <td className="border border-slate-300 px-1 py-0.5 text-center text-[10px] text-slate-600">
        {fmtStr(ann5)}
      </td>
    </tr>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Tab 1 - Autoscuola e Iscrizione (GeCA: autoscuola + AnaRes)
 * ─────────────────────────────────────────────────────────────────────────── */

function TabAutoscuola({ row }) {
  const rawAn = row?.raw_portale?.anagrafica || {};

  return (
    <div className="space-y-3">
      {/* Autoscuola (GeCA: autoscuola GroupBox) */}
      <Group title="Autoscuola e Iscrizione" color="violet">
        <div className="grid grid-cols-12 gap-2">
          <Field
            label="Codice Autoscuola"
            value={row?.codice_autoscuola || rawAn.codice_autoscuola}
            className="col-span-3"
          />
          <Field
            label="Denominazione"
            value={rawAn.denominazione_autoscuola || row?.denominazione_autoscuola}
            className="col-span-5"
          />
          <Field
            label="Data Iscrizione"
            value={fmtDate(row?.data_iscrizione || rawAn.data_iscrizione)}
            className="col-span-2"
          />
          <Field
            label="N. Iscrizione"
            value={row?.numero_iscrizione || rawAn.numero_iscrizione}
            className="col-span-2"
          />

          <Field
            label="Tipo Iscrizione"
            value={row?.tipo_iscrizione || rawAn.tipo_iscrizione}
            className="col-span-6"
          />
          <Field
            label="Sigla GeCA"
            value={row?.tipo_iscrizione_sigla || rawAn.tipo_iscrizione_sigla}
            className="col-span-2"
          />
          <Field
            label="Stato Richiesta"
            value={row?.stato_richiesta || rawAn.stato_richiesta}
            className="col-span-4"
          />

          <Field
            label="Protocollo Attuale"
            value={row?.protocollo || rawAn.protocollo}
            className="col-span-4"
          />
          <Field
            label="Protocollo Precedente"
            value={row?.protocollo_precedente || rawAn.protocollo_precedente}
            className="col-span-4"
          />
          <Field
            label="Stato Pratica"
            value={row?.stato_pratica || row?.stato_iscrizione || "—"}
            className="col-span-4"
          />
        </div>
      </Group>

      {/* Anagrafica e Residenza (GeCA: AnaRes GroupBox) */}
      <Group title="Dati Anagrafici e Residenza" color="sky">
        <div className="grid grid-cols-12 gap-2">
          <Field label="Cognome" value={row?.cognome} className="col-span-3" />
          <Field label="Nome" value={row?.nome} className="col-span-3" />
          <Field
            label="Codice Fiscale"
            value={row?.codice_fiscale}
            className="col-span-3"
          />
          <Field label="Sesso" value={row?.sesso} className="col-span-1" />
          <Field
            label="Data Nascita"
            value={fmtDate(row?.data_nascita)}
            className="col-span-2"
          />

          <Field
            label="Luogo di Nascita"
            value={row?.luogo_nascita || rawAn.luogo_nascita}
            className="col-span-4"
          />
          <Field
            label="Prov. Nascita"
            value={row?.provincia_nascita || rawAn.provincia_nascita}
            className="col-span-2"
          />
          <Field
            label="Cittadinanza"
            value={row?.cittadinanza || rawAn.cittadinanza}
            className="col-span-3"
          />
          <Field
            label="Stato Civile"
            value={row?.stato_civile || rawAn.stato_civile}
            className="col-span-3"
          />

          <Field
            label="Indirizzo"
            value={row?.indirizzo || rawAn.indirizzo}
            className="col-span-6"
          />
          <Field label="N. Civico" value={rawAn.civico} className="col-span-1" />
          <Field
            label="Comune Residenza"
            value={row?.comune_residenza || rawAn.comune_residenza}
            className="col-span-3"
          />
          <Field
            label="CAP"
            value={row?.cap || rawAn.cap}
            className="col-span-2"
          />

          <Field
            label="Telefono"
            value={row?.telefono || rawAn.telefono_1 || rawAn.telefono}
            className="col-span-3"
          />
          <Field
            label="Cellulare"
            value={row?.cellulare || rawAn.cellulare || rawAn.telefono_2}
            className="col-span-3"
          />
          <Field
            label="Email"
            value={row?.email || rawAn.email}
            className="col-span-6"
          />
        </div>
      </Group>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Tab 2 - Patente (GeCA: GroupInt/GroupRinn/GroupDupl + GroupPatRil + docRic)
 * ─────────────────────────────────────────────────────────────────────────── */

function TabPatente({ row }) {
  const rawAn = row?.raw_portale?.anagrafica || {};
  const rawPat = row?.raw_portale?.patente || {};
  const rawDoc = row?.raw_portale?.documento || {};

  return (
    <div className="space-y-3">
      {/* Documento di Riconoscimento */}
      <Group title="Documento di Riconoscimento" color="stone">
        <div className="grid grid-cols-12 gap-2">
          <Field
            label="Tipo"
            value={row?.documento_tipo || rawDoc.tipo}
            className="col-span-3"
          />
          <Field
            label="Numero"
            value={row?.documento_numero || rawDoc.numero}
            className="col-span-3"
          />
          <Field
            label="Rilasciato Da"
            value={rawDoc.rilasciato_da}
            className="col-span-3"
          />
          <Field
            label="Data Rilascio"
            value={fmtDate(rawDoc.data_rilascio)}
            className="col-span-3"
          />
          <Field
            label="Scadenza"
            value={fmtDate(rawDoc.data_scadenza)}
            className="col-span-3"
          />
        </div>
      </Group>

      {/* Patente Posseduta (dati patente esistente) */}
      <Group title="Patente Posseduta" color="emerald">
        <div className="grid grid-cols-12 gap-2">
          <Field
            label="N. Patente"
            value={rawPat.numero_patente || row?.numero_patente}
            className="col-span-3"
          />
          <Field
            label="Categoria"
            value={row?.categoria_patente}
            className="col-span-2"
          />
          <Field
            label="Data Rilascio"
            value={fmtDate(rawPat.data_rilascio_patente)}
            className="col-span-3"
          />
          <Field
            label="Scadenza"
            value={fmtDate(rawPat.data_scadenza_patente)}
            className="col-span-2"
          />
          <Field
            label="Punti"
            value={rawPat.punti_attuali}
            className="col-span-2"
          />
          <Field
            label="Rilasciata da"
            value={rawPat.mctc_rilascio || rawPat.ufficio_rilascio}
            className="col-span-6"
          />
          <Field
            label="Stato Patente"
            value={rawPat.stato_patente}
            className="col-span-3"
          />
          <Field
            label="Sospesa/Ritirata"
            value={rawPat.flag_sospesa ? "SI" : "NO"}
            className="col-span-3"
          />
        </div>
      </Group>

      {/* Patente Richiesta (per Int/Rinn/Dupl/Esame) */}
      <Group title="Documento Richiesto / Rilasciato" color="violet">
        <div className="grid grid-cols-12 gap-2">
          <Field
            label="Categoria Richiesta"
            value={rawAn.categoria_richiesta || row?.categoria_patente}
            className="col-span-3"
          />
          <Field
            label="Tipo Cambio"
            value={rawAn.tipo_cambio || "Manuale"}
            className="col-span-2"
          />
          <Field
            label="Obbligo Guida"
            value={rawAn.obbligo_esperimento_guida ? "SI" : "NO"}
            className="col-span-2"
          />
          <Field
            label="Data Esame Teoria"
            value={fmtDate(rawAn.data_esame_teoria)}
            className="col-span-2"
          />
          <Field
            label="Esito Teoria"
            value={rawAn.esito_teoria}
            className="col-span-3"
          />
          <Field
            label="Data Esame Pratica"
            value={fmtDate(rawAn.data_esame_pratica)}
            className="col-span-2"
          />
          <Field
            label="Esito Pratica"
            value={rawAn.esito_pratica}
            className="col-span-3"
          />
          <Field
            label="Data Rilascio Nuova"
            value={fmtDate(rawPat.data_rilascio_nuova || rawAn.data_rilascio_nuova)}
            className="col-span-3"
          />
          <Field
            label="N. Patente Nuova"
            value={rawPat.numero_patente_nuova || rawAn.numero_patente_nuova}
            className="col-span-4"
          />
        </div>
      </Group>

      {/* Certificato Medico */}
      <Group title="Certificato Medico" color="rose">
        <div className="grid grid-cols-12 gap-2">
          <Field
            label="Medico"
            value={rawAn.medico_nome}
            className="col-span-5"
          />
          <Field
            label="Data Visita"
            value={fmtDate(rawAn.data_certificato_medico)}
            className="col-span-3"
          />
          <Field
            label="Scadenza"
            value={fmtDate(rawAn.data_scadenza_certificato)}
            className="col-span-2"
          />
          <Field
            label="Idoneita'"
            value={rawAn.idoneita_medica}
            className="col-span-2"
          />
        </div>
      </Group>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Tab 3 - Schema Abilitazioni (GeCA: GroupAbilitazioni + PanAbilit)
 * ─────────────────────────────────────────────────────────────────────────── */

function TabAbilitazioni({ row }) {
  const rawAb = row?.raw_portale?.abilitazioni || {};
  const rawPat = row?.raw_portale?.patente || {};

  // Schema categorie GeCA (PanAbilit): ordine fisso come nel .Designer.cs
  const categorie = [
    "AM", "A1", "A2", "A", "B1", "B", "BE", "C1", "C", "C1E", "CE",
    "D1", "D", "D1E", "DE",
  ];

  const getCatRilasciata = (c) => !!(rawAb[`CBp${c}`] || rawAb[`CBr${c}`] || rawAb[`cat_${c}`]);
  const getCatData = (c) => rawAb[`data${c}`] || rawAb[`data_${c}`] || "";
  const getCatAnn = (c, n) => rawAb[`ann${n}${c}`] || rawAb[`ann_${c}_${n}`] || "";

  return (
    <div className="space-y-3">
      <Group title="Schema Abilitazioni (GeCA: PanAbilit)" color="violet">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse border border-slate-300 bg-white">
            <thead className="bg-violet-100">
              <tr>
                <th className="border border-slate-300 px-1.5 py-1 text-[10px] font-bold text-violet-900">
                  Cat.
                </th>
                <th className="border border-slate-300 px-1.5 py-1 text-[10px] font-bold text-violet-900">
                  Ril.
                </th>
                <th className="border border-slate-300 px-1.5 py-1 text-[10px] font-bold text-violet-900">
                  Data Rilascio
                </th>
                <th className="border border-slate-300 px-1 py-1 text-[10px] font-bold text-violet-900">
                  Ann.1
                </th>
                <th className="border border-slate-300 px-1 py-1 text-[10px] font-bold text-violet-900">
                  Ann.2
                </th>
                <th className="border border-slate-300 px-1 py-1 text-[10px] font-bold text-violet-900">
                  Ann.3
                </th>
                <th className="border border-slate-300 px-1 py-1 text-[10px] font-bold text-violet-900">
                  Ann.4
                </th>
                <th className="border border-slate-300 px-1 py-1 text-[10px] font-bold text-violet-900">
                  Ann.5
                </th>
              </tr>
            </thead>
            <tbody>
              {categorie.map((c) => (
                <RigaAbilitazione
                  key={c}
                  cat={c}
                  rilasciata={getCatRilasciata(c)}
                  data={getCatData(c)}
                  ann1={getCatAnn(c, 1)}
                  ann2={getCatAnn(c, 2)}
                  ann3={getCatAnn(c, 3)}
                  ann4={getCatAnn(c, 4)}
                  ann5={getCatAnn(c, 5)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Group>

      {/* Abilitazioni professionali (CQC, ADR, Recupero Punti) */}
      <Group title="Abilitazioni Professionali" color="amber">
        <div className="grid grid-cols-12 gap-2">
          <Field
            label="CQC Persone"
            value={rawAb.cqc_persone ? `OK (${fmtDate(rawAb.cqc_persone_scadenza)})` : "—"}
            className="col-span-3"
          />
          <Field
            label="CQC Cose"
            value={rawAb.cqc_cose ? `OK (${fmtDate(rawAb.cqc_cose_scadenza)})` : "—"}
            className="col-span-3"
          />
          <Field
            label="CAP"
            value={rawAb.cap ? `OK (${fmtDate(rawAb.cap_scadenza)})` : "—"}
            className="col-span-3"
          />
          <Field
            label="ADR"
            value={rawAb.adr ? `OK (${fmtDate(rawAb.adr_scadenza)})` : "—"}
            className="col-span-3"
          />

          <Field
            label="Recupero Punti"
            value={rawAb.recupero_punti ? `Corso del ${fmtDate(rawAb.recupero_punti_data)}` : "—"}
            className="col-span-6"
          />
          <Field
            label="Guida Accompagnata"
            value={rawAb.guida_accompagnata ? "Attiva" : "—"}
            className="col-span-3"
          />
          <Field
            label="Patente Nautica"
            value={rawAb.patente_nautica || "—"}
            className="col-span-3"
          />
        </div>
      </Group>

      {/* Annotazioni / Revisioni */}
      <Group title="Annotazioni e Revisioni" color="stone">
        <div className="grid grid-cols-12 gap-2">
          <Field
            label="Ultima Revisione"
            value={fmtDate(rawPat.ultima_revisione)}
            className="col-span-3"
          />
          <Field
            label="Motivo Revisione"
            value={rawPat.motivo_revisione}
            className="col-span-9"
          />
          <Field
            label="Note"
            value={row?.note || row?.raw_portale?.note}
            className="col-span-12"
          />
        </div>
      </Group>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Componente principale
 * ─────────────────────────────────────────────────────────────────────────── */

const TABS = [
  { key: "autoscuola", label: "Autoscuola", color: "violet", icon: "🏫" },
  { key: "patente", label: "Patente", color: "emerald", icon: "🚗" },
  { key: "abilitazioni", label: "Abilitazioni", color: "amber", icon: "📋" },
];

export default function SchedaRiepilogativaModal({
  row,
  open = true,
  onClose,
}) {
  const [activeTab, setActiveTab] = useState("autoscuola");

  // ESC chiude il modal
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handlePrint = useCallback(() => {
    // Forziamo la stampa di TUTTI i tab aggiungendo una classe al body
    document.body.classList.add("print-all-tabs");
    const prevTitle = document.title;
    const cognome = row?.cognome || "";
    const nome = row?.nome || "";
    document.title = `Scheda_${cognome}_${nome}`.replace(/\s+/g, "_");
    setTimeout(() => {
      window.print();
      document.title = prevTitle;
      document.body.classList.remove("print-all-tabs");
    }, 100);
  }, [row]);

  const titolo = useMemo(() => {
    const c = row?.cognome || "";
    const n = row?.nome || "";
    const cf = row?.codice_fiscale ? ` (${row.codice_fiscale})` : "";
    return `${c} ${n}${cf}`.trim() || "Scheda riepilogativa";
  }, [row]);

  if (!open) return null;

  return (
    <>
      {/* CSS @media print per la stampa */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print-scheda,
          .print-scheda * {
            visibility: visible;
          }
          .print-scheda {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 8mm;
          }
          .no-print {
            display: none !important;
          }
          .print-all-tabs .tab-panel {
            display: block !important;
          }
          .print-page-break {
            page-break-before: always;
          }
        }
      `}</style>

      <div
        className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto no-print"
        onClick={(e) => e.target === e.currentTarget && onClose?.()}
      >
        <div
          className="my-4 w-full max-w-5xl rounded-lg border border-slate-200 bg-white shadow-2xl print-scheda"
          onClick={(e) => e.stopPropagation()}
          style={{ maxHeight: "calc(100vh - 2rem)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-violet-700 to-violet-600 px-4 py-3 no-print">
            <div>
              <h2 className="text-base font-bold text-white">
                📄 Scheda Riepilogativa
              </h2>
              <p className="text-xs text-violet-100">{titolo}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrint}
                className="rounded bg-white/20 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/30"
                title="Stampa scheda"
              >
                🖨 Stampa
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded p-1.5 text-white/80 hover:bg-white/20 hover:text-white"
                aria-label="Chiudi"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex border-b border-slate-200 bg-slate-50 no-print">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex-1 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
                    isActive
                      ? "border-violet-600 bg-white text-violet-900"
                      : "border-transparent text-slate-600 hover:bg-white hover:text-slate-900"
                  }`}
                >
                  <span className="mr-1.5">{tab.icon}</span>
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Header visibile solo in stampa */}
          <div className="hidden border-b border-slate-300 px-4 py-3 print:block">
            <h1 className="text-lg font-bold text-slate-900">
              Scheda Riepilogativa Candidato
            </h1>
            <p className="text-sm text-slate-700">{titolo}</p>
            <p className="text-xs text-slate-500">
              Stampato il {new Date().toLocaleString("it-IT")}
            </p>
          </div>

          {/* Body — tab content */}
          <div
            className="overflow-y-auto p-4 bg-slate-50"
            style={{ maxHeight: "calc(100vh - 10rem)" }}
          >
            <div className={`tab-panel ${activeTab === "autoscuola" ? "" : "hidden"}`}>
              <TabAutoscuola row={row} />
            </div>
            <div className={`tab-panel ${activeTab === "patente" ? "" : "hidden print-page-break"}`}>
              <TabPatente row={row} />
            </div>
            <div className={`tab-panel ${activeTab === "abilitazioni" ? "" : "hidden print-page-break"}`}>
              <TabAbilitazioni row={row} />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5 no-print">
            <button
              type="button"
              onClick={handlePrint}
              className="rounded bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              🖨 Stampa PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-300"
            >
              Chiudi
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

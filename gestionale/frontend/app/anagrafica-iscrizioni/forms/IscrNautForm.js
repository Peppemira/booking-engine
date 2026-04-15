"use client";

/**
 * IscrNautForm.js — Patente Nautica
 *
 * Replica fedele del form GeCA Future `iscrNaut.cs` / `iscrNaut.Designer.cs`.
 * Sigla GeCA: PN.
 *
 * Richiesta patente nautica. Gestisce tipologie specifiche e zone di navigazione
 * (entro/oltre 12 miglia, senza limiti, vela, motoscafo, ecc.).
 */

import {
  SectionAutoscuolaIscrizione,
  SectionDocumentoRiconoscimento,
  SectionPatentePosseduta,
  SectionAnagraficaResidenza,
  SectionFotoFirma,
  SectionNote,
  FormButtonsBar,
  FormHeader,
  FormLayout,
} from "./SharedFields";

const TIPI_NAUTICA = [
  { value: "ENTRO_12_MOTORE", label: "Entro 12 miglia — Motore" },
  { value: "ENTRO_12_VELA", label: "Entro 12 miglia — Vela" },
  { value: "OLTRE_12_MOTORE", label: "Oltre 12 miglia — Motore" },
  { value: "OLTRE_12_VELA", label: "Oltre 12 miglia — Vela" },
  { value: "SENZA_LIMITI_MOTORE", label: "Senza limiti — Motore" },
  { value: "SENZA_LIMITI_VELA", label: "Senza limiti — Vela" },
  { value: "COMMERCIALE", label: "Uso Commerciale" },
];

const AUTORITA_MARITTIME = [
  "Capitaneria di Porto",
  "Motorizzazione Civile",
  "Ufficio Circondariale Marittimo",
  "ACI Automobile Club Italia",
];

export default function IscrNautForm({
  editor,
  setEditor,
  onSave,
  onTrasmetti,
  onStampa,
  onAnnulla,
  saving = false,
  trasmettendo = false,
  disabled = false,
  isNew = false,
  modal = false,
}) {
  const upd = (k) => (e) =>
    setEditor((prev) => ({ ...prev, [k]: e.target.value }));

  const title = isNew
    ? "Patente Nautica - Registra Nuova Iscrizione"
    : "Patente Nautica - Modifica";

  return (
    <FormLayout modal={modal}>
      <FormHeader
        title={title}
        subtitle="Richiesta patente nautica"
        tipo="Patente Nautica (PN)"
        onClose={onAnnulla}
      />

      <SectionAutoscuolaIscrizione
        editor={editor}
        setEditor={setEditor}
        disabled={disabled}
      />

      {/* Dati Nautica */}
      <fieldset className="rounded-md border-2 border-cyan-400 bg-cyan-50 p-3">
        <legend className="px-2 text-sm font-semibold text-cyan-800">
          Dati Patente Nautica
        </legend>
        <div className="grid grid-cols-12 gap-2">
          <label className="col-span-4 text-xs">
            Tipo Nautica
            <select
              value={editor.naut_tipo || ""}
              onChange={upd("naut_tipo")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            >
              <option value="">Selezionare...</option>
              {TIPI_NAUTICA.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className="col-span-4 text-xs">
            Autorita' Marittima
            <select
              value={editor.naut_autorita || ""}
              onChange={upd("naut_autorita")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            >
              <option value="">Selezionare...</option>
              {AUTORITA_MARITTIME.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </label>
          <label className="col-span-4 text-xs">
            Sede Ufficio
            <input
              type="text"
              value={editor.naut_sede || ""}
              onChange={upd("naut_sede")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
              placeholder="es. NAPOLI / CIVITAVECCHIA"
            />
          </label>
          <label className="col-span-3 text-xs">
            Data Esame Teoria
            <input
              type="date"
              value={editor.naut_data_teoria || ""}
              onChange={upd("naut_data_teoria")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            />
          </label>
          <label className="col-span-3 text-xs">
            Data Esame Carteggio
            <input
              type="date"
              value={editor.naut_data_carteggio || ""}
              onChange={upd("naut_data_carteggio")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            />
          </label>
          <label className="col-span-3 text-xs">
            Data Esame Pratica
            <input
              type="date"
              value={editor.naut_data_pratica || ""}
              onChange={upd("naut_data_pratica")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            />
          </label>
          <label className="col-span-3 text-xs">
            Data Rilascio
            <input
              type="date"
              value={editor.naut_data_rilascio || ""}
              onChange={upd("naut_data_rilascio")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            />
          </label>
          <label className="col-span-4 text-xs">
            N. Patente Nautica
            <input
              type="text"
              value={editor.naut_numero || ""}
              onChange={upd("naut_numero")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-mono uppercase"
            />
          </label>
          <label className="col-span-4 text-xs">
            Data Scadenza
            <input
              type="date"
              value={editor.naut_data_scadenza || ""}
              onChange={upd("naut_data_scadenza")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            />
          </label>
          <label className="col-span-4 text-xs">
            Protocollo Ministeriale
            <input
              type="text"
              value={editor.naut_protocollo || ""}
              onChange={upd("naut_protocollo")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-mono uppercase"
            />
          </label>
        </div>
      </fieldset>

      <SectionDocumentoRiconoscimento
        editor={editor}
        setEditor={setEditor}
        disabled={disabled}
      />

      <SectionPatentePosseduta
        editor={editor}
        setEditor={setEditor}
        disabled={disabled}
      />

      <SectionAnagraficaResidenza
        editor={editor}
        setEditor={setEditor}
        disabled={disabled}
      />

      <SectionFotoFirma editor={editor} setEditor={setEditor} disabled={disabled} />

      <SectionNote editor={editor} setEditor={setEditor} disabled={disabled} />

      <FormButtonsBar
        onSave={onSave}
        onTrasmetti={onTrasmetti}
        onStampa={onStampa}
        onAnnulla={onAnnulla}
        saving={saving}
        trasmettendo={trasmettendo}
        disabled={disabled}
        showTrasmetti={false}
        showStampa={true}
        saveLabel={isNew ? "Salva Patente Nautica" : "Aggiorna"}
      />
    </FormLayout>
  );
}

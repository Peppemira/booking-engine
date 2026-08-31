"use client";

/**
 * IscrDupForm.js — Duplicato / Conversione Patente
 *
 * Replica fedele del form GeCA Future `iscrdup.cs` / `iscrdup.Designer.cs`.
 * Sigle GeCA:
 *   - D|, Y|, L|, S|, R|  -> Duplicato (smarrimento, riclassificazione, deterioramento, altro)
 *   - M|, E|              -> Conversione (militare, estera)
 *
 * Il form GeCA ha 2 pannelli:
 *   - pandupl  (Duplicato)
 *   - panConv  (Conversione)
 * che vengono mostrati/nascosti a seconda del tipo scelto.
 */

import { useState } from "react";
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

const MOTIVI_DUPLICATO = [
  { value: "SMARRIMENTO", label: "Smarrimento", sigla: "D|" },
  { value: "SOTTRAZIONE", label: "Sottrazione/Furto", sigla: "Y|" },
  { value: "RICLASSIFICAZIONE", label: "Riclassificazione", sigla: "L|" },
  { value: "DETERIORAMENTO", label: "Deterioramento", sigla: "S|" },
  { value: "ALTRO", label: "Altro", sigla: "R|" },
];

const TIPI_CONVERSIONE = [
  { value: "MILITARE", label: "Militare", sigla: "M|" },
  { value: "ESTERA", label: "Estera", sigla: "E|" },
];

export default function IscrDupForm({
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
  modo = "DUPLICATO", // "DUPLICATO" | "CONVERSIONE"
}) {
  const [localModo, setLocalModo] = useState(modo);

  const upd = (k) => (e) =>
    setEditor((prev) => ({ ...prev, [k]: e.target.value }));

  const title = isNew
    ? (localModo === "CONVERSIONE"
        ? "Conversione Patente - Registra Nuova Iscrizione"
        : "Rilascio per Duplicato - Registra Nuova Iscrizione")
    : (localModo === "CONVERSIONE"
        ? "Conversione Patente - Modifica"
        : "Rilascio per Duplicato - Modifica");

  const updModo = (m) => {
    setLocalModo(m);
    setEditor((prev) => ({ ...prev, modo_iscrizione: m }));
  };

  return (
    <FormLayout modal={modal}>
      <FormHeader
        title={title}
        subtitle={
          localModo === "CONVERSIONE"
            ? "Conversione Patente Militare / Estera"
            : "Duplicato per smarrimento, furto, riclassificazione, deterioramento, altro"
        }
        tipo={localModo === "CONVERSIONE" ? "Conversione" : "Duplicato"}
        onClose={onAnnulla}
      />

      {/* Switch Duplicato / Conversione */}
      <fieldset className="rounded-md border-2 border-violet-300 bg-violet-50 p-3">
        <legend className="px-2 text-sm font-semibold text-violet-800">
          Modalità Iscrizione (GeCA: panDupl / panConv)
        </legend>
        <div className="flex gap-4">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="iscrDup_modo"
              value="DUPLICATO"
              checked={localModo === "DUPLICATO"}
              onChange={() => updModo("DUPLICATO")}
              disabled={disabled}
              className="h-4 w-4"
            />
            <span className="text-sm font-medium">Duplicato Patente</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="iscrDup_modo"
              value="CONVERSIONE"
              checked={localModo === "CONVERSIONE"}
              onChange={() => updModo("CONVERSIONE")}
              disabled={disabled}
              className="h-4 w-4"
            />
            <span className="text-sm font-medium">Conversione Patente</span>
          </label>
        </div>
      </fieldset>

      <SectionAutoscuolaIscrizione
        editor={editor}
        setEditor={setEditor}
        disabled={disabled}
      />

      {/* Pannello Duplicato (panDupl) */}
      {localModo === "DUPLICATO" && (
        <fieldset className="rounded-md border border-slate-300 bg-slate-50 p-3">
          <legend className="px-2 text-sm font-semibold text-slate-700">
            Dati Duplicato
          </legend>
          <div className="grid grid-cols-12 gap-2">
            <label className="col-span-4 text-xs">
              Motivo Duplicato
              <select
                value={editor.motivo_duplicato || ""}
                onChange={upd("motivo_duplicato")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              >
                <option value="">Selezionare...</option>
                {MOTIVI_DUPLICATO.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label} ({m.sigla})
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-4 text-xs">
              Data Smarrimento/Furto
              <input
                type="date"
                value={editor.data_smarrimento || ""}
                onChange={upd("data_smarrimento")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </label>
            <label className="col-span-4 text-xs">
              Luogo Denuncia
              <input
                type="text"
                value={editor.luogo_denuncia || ""}
                onChange={upd("luogo_denuncia")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
              />
            </label>
            <label className="col-span-4 text-xs">
              N. Denuncia
              <input
                type="text"
                value={editor.numero_denuncia || ""}
                onChange={upd("numero_denuncia")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-mono uppercase"
              />
            </label>
            <label className="col-span-4 text-xs">
              Autorità di Denuncia
              <input
                type="text"
                value={editor.autorita_denuncia || ""}
                onChange={upd("autorita_denuncia")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
                placeholder="CARABINIERI / POLIZIA / ..."
              />
            </label>
            <label className="col-span-4 text-xs">
              Data Denuncia
              <input
                type="date"
                value={editor.data_denuncia || ""}
                onChange={upd("data_denuncia")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </label>
          </div>
        </fieldset>
      )}

      {/* Pannello Conversione (panConv) */}
      {localModo === "CONVERSIONE" && (
        <fieldset className="rounded-md border border-slate-300 bg-slate-50 p-3">
          <legend className="px-2 text-sm font-semibold text-slate-700">
            Dati Conversione
          </legend>
          <div className="grid grid-cols-12 gap-2">
            <label className="col-span-4 text-xs">
              Tipo Conversione
              <select
                value={editor.tipo_conversione || ""}
                onChange={upd("tipo_conversione")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              >
                <option value="">Selezionare...</option>
                {TIPI_CONVERSIONE.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label} ({t.sigla})
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-4 text-xs">
              Stato Provenienza
              <input
                type="text"
                value={editor.stato_provenienza || ""}
                onChange={upd("stato_provenienza")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
                placeholder="es. FRANCIA / GERMANIA / ..."
              />
            </label>
            <label className="col-span-4 text-xs">
              Categoria Orig.
              <input
                type="text"
                value={editor.categoria_originale || ""}
                onChange={upd("categoria_originale")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
                placeholder="es. B"
              />
            </label>
            <label className="col-span-4 text-xs">
              N. Patente Originale
              <input
                type="text"
                value={editor.numero_patente_originale || ""}
                onChange={upd("numero_patente_originale")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
              />
            </label>
            <label className="col-span-4 text-xs">
              Data Emissione Orig.
              <input
                type="date"
                value={editor.data_emissione_originale || ""}
                onChange={upd("data_emissione_originale")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </label>
            <label className="col-span-4 text-xs">
              Data Scadenza Orig.
              <input
                type="date"
                value={editor.data_scadenza_originale || ""}
                onChange={upd("data_scadenza_originale")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </label>
            <label className="col-span-12 text-xs">
              Ente Rilascio (Estero/Militare)
              <input
                type="text"
                value={editor.ente_rilascio_originale || ""}
                onChange={upd("ente_rilascio_originale")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
                placeholder="Autorità o comando militare"
              />
            </label>
          </div>
        </fieldset>
      )}

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
        showTrasmetti={true}
        showStampa={true}
        saveLabel={
          isNew
            ? localModo === "CONVERSIONE"
              ? "Salva Conversione"
              : "Salva Duplicato"
            : "Aggiorna"
        }
      />
    </FormLayout>
  );
}

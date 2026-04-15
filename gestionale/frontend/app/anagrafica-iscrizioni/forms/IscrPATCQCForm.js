"use client";

/**
 * IscrPATCQCForm.js — Richiesta Patente C.Q.C. / CQC Card
 *
 * Replica fedele del form GeCA Future `iscrPATCQC.cs` / `iscrPATCQC.Designer.cs`.
 * Sigle GeCA:
 *   - PC -> Patente CQC (utenti italiani)
 *   - CC -> CQC Card (utenti stranieri; firma nascosta, layout diverso)
 *
 * Campi specifici:
 *   - Tipo CQC (persone / cose / entrambi)
 *   - Data corso CQC (datcorcqc)
 *   - Numero CQC Card (ncqccard)
 *   - Codice CIA (Centro Istruzione Autorizzato)
 */

import { useState } from "react";
import {
  SectionAutoscuolaIscrizione,
  SectionProtocolliRegistro,
  SectionDocumentoRiconoscimento,
  SectionPatentePosseduta,
  SectionAnagraficaResidenza,
  SectionFotoFirma,
  SectionNote,
  FormButtonsBar,
  FormHeader,
  FormLayout,
} from "./SharedFields";

const TIPI_CQC = [
  { value: "PERSONE", label: "C.Q.C. Persone" },
  { value: "COSE", label: "C.Q.C. Cose" },
  { value: "ENTRAMBE", label: "C.Q.C. Persone + Cose" },
];

export default function IscrPATCQCForm({
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
  variante = "PATENTE", // "PATENTE" (PC) | "CARD" (CC)
}) {
  const [localVariante, setLocalVariante] = useState(variante);

  const upd = (k) => (e) =>
    setEditor((prev) => ({ ...prev, [k]: e.target.value }));

  const updVariante = (v) => {
    setLocalVariante(v);
    setEditor((prev) => ({
      ...prev,
      cqc_variante: v,
      tipo_iscrizione_sigla: v === "CARD" ? "CC" : "PC",
    }));
  };

  const title = isNew
    ? (localVariante === "CARD"
        ? "CQC Card - Registra Nuova Iscrizione"
        : "Patente C.Q.C. - Registra Nuova Iscrizione")
    : (localVariante === "CARD"
        ? "CQC Card - Modifica"
        : "Patente C.Q.C. - Modifica");

  return (
    <FormLayout modal={modal}>
      <FormHeader
        title={title}
        subtitle={
          localVariante === "CARD"
            ? "CQC Card per utenti stranieri"
            : "Richiesta patente C.Q.C. per utenti italiani"
        }
        tipo={localVariante === "CARD" ? "CQC Card (CC)" : "Patente CQC (PC)"}
        onClose={onAnnulla}
      />

      {/* Switch Patente CQC / CQC Card */}
      <fieldset className="rounded-md border-2 border-amber-300 bg-amber-50 p-3">
        <legend className="px-2 text-sm font-semibold text-amber-800">
          Variante (GeCA: PC Patente / CC Card)
        </legend>
        <div className="flex gap-4">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="iscrPATCQC_var"
              value="PATENTE"
              checked={localVariante === "PATENTE"}
              onChange={() => updVariante("PATENTE")}
              disabled={disabled}
              className="h-4 w-4"
            />
            <span className="text-sm font-medium">Patente CQC (utenti italiani)</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="iscrPATCQC_var"
              value="CARD"
              checked={localVariante === "CARD"}
              onChange={() => updVariante("CARD")}
              disabled={disabled}
              className="h-4 w-4"
            />
            <span className="text-sm font-medium">CQC Card (utenti stranieri)</span>
          </label>
        </div>
      </fieldset>

      <SectionAutoscuolaIscrizione
        editor={editor}
        setEditor={setEditor}
        disabled={disabled}
      />

      <SectionProtocolliRegistro
        editor={editor}
        setEditor={setEditor}
        disabled={disabled}
        showFoglioRosa={false}
      />

      {/* Dati CQC specifici */}
      <fieldset className="rounded-md border-2 border-amber-400 bg-amber-50 p-3">
        <legend className="px-2 text-sm font-semibold text-amber-800">
          Dati C.Q.C.
        </legend>
        <div className="grid grid-cols-12 gap-2">
          <label className="col-span-4 text-xs">
            Tipo C.Q.C.
            <select
              value={editor.cqc_tipo || ""}
              onChange={upd("cqc_tipo")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            >
              <option value="">Selezionare...</option>
              {TIPI_CQC.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className="col-span-4 text-xs">
            Data Corso C.Q.C.
            <input
              type="date"
              value={editor.cqc_data_corso || ""}
              onChange={upd("cqc_data_corso")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            />
          </label>
          <label className="col-span-4 text-xs">
            Codice CIA (Centro Istruzione)
            <input
              type="text"
              value={editor.cia_codice || ""}
              onChange={upd("cia_codice")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
            />
          </label>
          <label className="col-span-4 text-xs">
            Prov. CIA
            <input
              type="text"
              value={editor.cia_provincia || ""}
              onChange={upd("cia_provincia")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
              maxLength={2}
            />
          </label>
          <label className="col-span-4 text-xs">
            Data Approvazione (dApproA)
            <input
              type="date"
              value={editor.cqc_data_approvazione || ""}
              onChange={upd("cqc_data_approvazione")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            />
          </label>
          {localVariante === "CARD" && (
            <label className="col-span-4 text-xs">
              N. CQC Card (ncqccard)
              <input
                type="text"
                value={editor.cqc_card_numero || ""}
                onChange={upd("cqc_card_numero")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-mono uppercase"
              />
            </label>
          )}
          <label className="col-span-12 text-xs">
            Abilitazioni Possedute
            <input
              type="text"
              value={editor.abilitazioni_possedute || ""}
              onChange={upd("abilitazioni_possedute")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
              placeholder="es. C, CE, D, DE"
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

      {/* Per CQC Card la firma e' nascosta secondo il form GeCA */}
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
        saveLabel={isNew ? "Salva Richiesta CQC" : "Aggiorna"}
      />
    </FormLayout>
  );
}

"use client";

/**
 * IscrEsameForm.js — Conseguimento per Esame
 *
 * Replica fedele del form GeCA Future `iscrEsame.cs` / `iscrEsame.Designer.cs`
 * (sigle GeCA: IN = Interno, PR = Privatista, RE = Revisione).
 *
 * Sezioni GeCA mappate:
 *   - autoscuola       -> SectionAutoscuolaIscrizione
 *   - protocolli       -> SectionProtocolliRegistro
 *   - AnaRes           -> SectionAnagraficaResidenza
 *   - (documento)      -> SectionDocumentoRiconoscimento
 *   - (patente poss.)  -> SectionPatentePosseduta
 *   - Abilitaz         -> Sezione "Dati Patente e Veicoli" (patrich, cambio, sottotipo)
 *   - Foto/Firma       -> SectionFotoFirma
 *   - Note             -> SectionNote
 *   - btm*             -> FormButtonsBar
 *
 * Campi specifici iscrEsame:
 *   - sottotipo (Interno / Privatista / Revisione)
 *   - patrich (categoria patente richiesta)
 *   - cambio (Automatico / Manuale)
 *   - protoco prima (protocollo precedente, per revisioni)
 *   - obbligo esperimento guida
 */

import { useState } from "react";
import {
  SectionAutoscuolaIscrizione,
  SectionProtocolliRegistro,
  SectionDocumentoRiconoscimento,
  SectionPatentePosseduta,
  SectionAnagraficaResidenza,
  SectionPatenteRichiesta,
  SectionFotoFirma,
  SectionNote,
  FormButtonsBar,
  FormHeader,
  FormLayout,
} from "./SharedFields";

const SOTTOTIPI_ESAME = [
  { value: "INTERNO", label: "Interno", sigla: "IN" },
  { value: "PRIVATISTA", label: "Privatista", sigla: "PR" },
  { value: "REVISIONE", label: "Revisione", sigla: "RE" },
];

export default function IscrEsameForm({
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
  const [localSottotipo, setLocalSottotipo] = useState(
    editor.tipo_iscrizione || "INTERNO"
  );

  const updSottotipo = (val) => {
    setLocalSottotipo(val);
    setEditor((prev) => ({ ...prev, tipo_iscrizione: val, tipo_iscrizione_sigla: SOTTOTIPI_ESAME.find(s => s.value === val)?.sigla || "IN" }));
  };

  const toggleObblGuida = (e) =>
    setEditor((prev) => ({ ...prev, obbligo_esperimento_guida: e.target.checked }));

  const updField = (k) => (e) =>
    setEditor((prev) => ({ ...prev, [k]: e.target.value }));

  const title = isNew
    ? "Conseguimento per Esame - Registra Nuova Iscrizione"
    : "Conseguimento per Esame - Modifica";

  return (
    <FormLayout modal={modal}>
      <FormHeader
        title={title}
        subtitle="Rilascio per Esami: Interno, Privatista, Revisione"
        tipo={SOTTOTIPI_ESAME.find((s) => s.value === localSottotipo)?.label || "Esame"}
        onClose={onAnnulla}
      />

      {/* Sottotipo (Interno/Privatista/Revisione) */}
      <fieldset className="rounded-md border-2 border-indigo-300 bg-indigo-50 p-3">
        <legend className="px-2 text-sm font-semibold text-indigo-800">
          Tipo Rilascio per Esame (GeCA: IN / PR / RE)
        </legend>
        <div className="flex flex-wrap items-center gap-4">
          {SOTTOTIPI_ESAME.map((s) => (
            <label key={s.value} className="flex items-center gap-2">
              <input
                type="radio"
                name="iscrEsame_sottotipo"
                value={s.value}
                checked={localSottotipo === s.value}
                onChange={() => updSottotipo(s.value)}
                disabled={disabled}
                className="h-4 w-4"
              />
              <span className="text-sm font-medium text-slate-800">
                {s.label}
                <span className="ml-1 rounded bg-indigo-200 px-1.5 py-0.5 text-[10px] font-bold text-indigo-800">
                  {s.sigla}
                </span>
              </span>
            </label>
          ))}
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
        showFoglioRosa={true}
      />

      {/* Protocollo precedente (per Revisioni) */}
      {localSottotipo === "REVISIONE" && (
        <fieldset className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <legend className="px-2 text-sm font-semibold text-amber-800">
            Revisione — Protocollo Precedente
          </legend>
          <div className="grid grid-cols-12 gap-2">
            <label className="col-span-4 text-xs">
              Protocollo Precedente
              <input
                type="text"
                value={editor.protocollo_precedente || ""}
                onChange={updField("protocollo_precedente")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-mono uppercase"
              />
            </label>
            <label className="col-span-4 text-xs">
              N. Registro Precedente
              <input
                type="text"
                value={editor.numero_registro_precedente || ""}
                onChange={updField("numero_registro_precedente")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </label>
            <label className="col-span-4 text-xs">
              Motivo Revisione
              <select
                value={editor.motivo_revisione || ""}
                onChange={updField("motivo_revisione")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              >
                <option value="">Selezionare...</option>
                <option value="ART_128">Art. 128 C.d.S.</option>
                <option value="ART_126BIS">Art. 126 bis (punti zero)</option>
                <option value="SANITARIA">Sanitaria</option>
                <option value="ALTRO">Altro</option>
              </select>
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

      <SectionPatenteRichiesta
        editor={editor}
        setEditor={setEditor}
        disabled={disabled}
      >
        {/* Opzioni extra specifiche conseguimento */}
        <label className="col-span-3 text-xs">
          Obblighi
          <div className="mt-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!editor.obbligo_esperimento_guida}
              onChange={toggleObblGuida}
              disabled={disabled}
              className="h-4 w-4"
            />
            <span className="text-sm text-slate-700">Obbligo Esp. Guida</span>
          </div>
        </label>
        <label className="col-span-3 text-xs">
          Data Visita Medica
          <input
            type="date"
            value={editor.data_visita_medica || ""}
            onChange={updField("data_visita_medica")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          />
        </label>
      </SectionPatenteRichiesta>

      <SectionAnagraficaResidenza
        editor={editor}
        setEditor={setEditor}
        disabled={disabled}
      />

      <SectionFotoFirma
        editor={editor}
        setEditor={setEditor}
        disabled={disabled}
      />

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
        saveLabel={isNew ? "Salva Iscrizione" : "Aggiorna"}
      />
    </FormLayout>
  );
}

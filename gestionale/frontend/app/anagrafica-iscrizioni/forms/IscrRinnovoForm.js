"use client";

/**
 * IscrRinnovoForm.js — Conferma di Validita' (Rinnovo Patente)
 *
 * Replica fedele del form GeCA Future `iscrRinnovo.cs` / `iscrRinnovo.Designer.cs`.
 * Sigla GeCA: CV (Conferma Validita').
 *
 * Uso: gestione richieste rinnovo patente (conferma validita').
 *
 * Campi specifici:
 *   - Nuova scadenza (dopo rinnovo)
 *   - Data visita medica
 *   - Codice medico certificatore
 *   - Protocollo medico
 *   - Numero patente da rinnovare (obbligatorio)
 *   - Categoria patente posseduta
 *   - Limitazioni sanitarie
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

export default function IscrRinnovoForm({
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
    ? "Conferma di Validità - Registra Nuova Iscrizione"
    : "Conferma di Validità - Modifica";

  return (
    <FormLayout modal={modal}>
      <FormHeader
        title={title}
        subtitle="Richiesta rinnovo patente (Conferma Validità)"
        tipo="Rinnovo (CV)"
        onClose={onAnnulla}
      />

      <SectionAutoscuolaIscrizione
        editor={editor}
        setEditor={setEditor}
        disabled={disabled}
      />

      {/* Dati Medici per rinnovo */}
      <fieldset className="rounded-md border-2 border-violet-300 bg-violet-50 p-3">
        <legend className="px-2 text-sm font-semibold text-violet-800">
          Dati Visita Medica — Rinnovo
        </legend>
        <div className="grid grid-cols-12 gap-2">
          <label className="col-span-3 text-xs">
            Data Visita Medica
            <input
              type="date"
              value={editor.data_visita_medica || ""}
              onChange={upd("data_visita_medica")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            />
          </label>
          <label className="col-span-3 text-xs">
            Nuova Scadenza Patente
            <input
              type="date"
              value={editor.nuova_scadenza_patente || ""}
              onChange={upd("nuova_scadenza_patente")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            />
          </label>
          <label className="col-span-3 text-xs">
            Codice Medico
            <input
              type="text"
              value={editor.codice_medico || ""}
              onChange={upd("codice_medico")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
            />
          </label>
          <label className="col-span-3 text-xs">
            Protocollo Medico
            <input
              type="text"
              value={editor.protocollo_medico || ""}
              onChange={upd("protocollo_medico")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-mono uppercase"
            />
          </label>
          <label className="col-span-3 text-xs">
            Luogo Visita
            <input
              type="text"
              value={editor.luogo_visita_medica || ""}
              onChange={upd("luogo_visita_medica")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
            />
          </label>
          <label className="col-span-3 text-xs">
            Visus
            <input
              type="text"
              value={editor.visus || ""}
              onChange={upd("visus")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              placeholder="es. 10/10"
            />
          </label>
          <label className="col-span-6 text-xs">
            Limitazioni / Prescrizioni Sanitarie
            <input
              type="text"
              value={editor.limitazioni_sanitarie || ""}
              onChange={upd("limitazioni_sanitarie")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
              placeholder="Es: USO LENTI, VELOCITA RIDOTTA, ..."
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
        showTrasmetti={true}
        showStampa={true}
        saveLabel={isNew ? "Salva Rinnovo" : "Aggiorna"}
      />
    </FormLayout>
  );
}

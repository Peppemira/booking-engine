"use client";

/**
 * IscrCerMedForm.js — Richiesta Certificato Medico
 *
 * Replica fedele del form GeCA Future `iscrCerMed.cs` / `iscrCerMed.Designer.cs`.
 * Sigla GeCA: CM.
 *
 * Form per richiesta certificato medico (per candidati non iscritti o in rinnovo).
 * Include: GroupMedico (dati medici), GroupBox4 (opzioni trasmissione), GroupBox6 (pagamento CM).
 *
 * Campi specifici GeCA:
 *   - codmed (codice medico)
 *   - protmedico (protocollo medico)
 *   - datvis (data visita)
 *   - newscad (nuova scadenza)
 *   - cbObbEG (obbligo esperimento guida)
 *   - cbElimA / cbElimAM (elimina abilitazioni A / AM)
 *   - cmbRiclass (riclassificazione)
 *   - cbExtraTime (tempo supplementare)
 *   - cbReazione (reazione)
 *   - txtdistanza / txtvelocita
 *   - noteSani (note sanitarie)
 *   - flag AIRE
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

const RICLASSIFICAZIONI = [
  { value: "", label: "—" },
  { value: "A", label: "A" },
  { value: "B", label: "B" },
  { value: "C", label: "C" },
  { value: "D", label: "D" },
  { value: "E", label: "E" },
];

const EXTRA_TIME = [
  { value: "", label: "No" },
  { value: "15", label: "+15 min" },
  { value: "30", label: "+30 min" },
  { value: "45", label: "+45 min" },
];

const REAZIONI = [
  { value: "", label: "Normale" },
  { value: "LENTA", label: "Lenta" },
  { value: "NORMALE", label: "Normale" },
  { value: "PRONTA", label: "Pronta" },
];

export default function IscrCerMedForm({
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

  const toggle = (k) => (e) =>
    setEditor((prev) => ({ ...prev, [k]: e.target.checked }));

  const title = isNew
    ? "Certificato Medico - Registra Nuova Iscrizione"
    : "Certificato Medico - Modifica";

  return (
    <FormLayout modal={modal}>
      <FormHeader
        title={title}
        subtitle="Richiesta certificato medico (per non iscritti / rinnovi / ecc.)"
        tipo="Certificato Medico (CM)"
        onClose={onAnnulla}
      />

      <SectionAutoscuolaIscrizione
        editor={editor}
        setEditor={setEditor}
        disabled={disabled}
      />

      {/* GroupMedico - Dati Medici */}
      <fieldset className="rounded-md border-2 border-red-300 bg-red-50 p-3">
        <legend className="px-2 text-sm font-semibold text-red-800">
          Dati Medici (GroupMedico)
        </legend>
        <div className="grid grid-cols-12 gap-2">
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
            Data Visita
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
            Riclassificazione
            <select
              value={editor.riclassificazione || ""}
              onChange={upd("riclassificazione")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            >
              {RICLASSIFICAZIONI.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>
          <label className="col-span-3 text-xs">
            Extra Time
            <select
              value={editor.extra_time || ""}
              onChange={upd("extra_time")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            >
              {EXTRA_TIME.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className="col-span-3 text-xs">
            Reazione
            <select
              value={editor.reazione || ""}
              onChange={upd("reazione")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            >
              {REAZIONI.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>
          <label className="col-span-3 text-xs">
            Visus
            <input
              type="text"
              value={editor.visus || ""}
              onChange={upd("visus")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              placeholder="10/10"
            />
          </label>
          <label className="col-span-3 text-xs">
            Distanza (m)
            <input
              type="text"
              value={editor.distanza || ""}
              onChange={upd("distanza")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            />
          </label>
          <label className="col-span-3 text-xs">
            Velocità (km/h)
            <input
              type="text"
              value={editor.velocita || ""}
              onChange={upd("velocita")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            />
          </label>

          {/* Checkbox Opzioni */}
          <div className="col-span-12 mt-2 flex flex-wrap gap-3 rounded bg-white p-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!editor.obbligo_esperimento_guida}
                onChange={toggle("obbligo_esperimento_guida")}
                disabled={disabled}
                className="h-4 w-4"
              />
              <span className="text-xs font-medium">OBBLIGO ESP. GUIDA</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!editor.elimina_abilitazioni_A}
                onChange={toggle("elimina_abilitazioni_A")}
                disabled={disabled}
                className="h-4 w-4"
              />
              <span className="text-xs font-medium">ELIMINA ABIL. A1-A2-A</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!editor.elimina_abilitazioni_AM}
                onChange={toggle("elimina_abilitazioni_AM")}
                disabled={disabled}
                className="h-4 w-4"
              />
              <span className="text-xs font-medium">ELIMINA ABIL. AM</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!editor.flag_aire}
                onChange={toggle("flag_aire")}
                disabled={disabled}
                className="h-4 w-4"
              />
              <span className="text-xs font-medium">A.I.R.E.</span>
            </label>
          </div>

          <label className="col-span-12 text-xs">
            Note Sanitarie
            <textarea
              rows={2}
              value={editor.note_sanitarie || ""}
              onChange={upd("note_sanitarie")}
              disabled={disabled}
              maxLength={300}
              className="mt-1 w-full resize-y rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              placeholder="Prescrizioni sanitarie particolari"
            />
          </label>
        </div>
      </fieldset>

      {/* GroupBox4 - Opzioni Trasmissione Certificato Medico */}
      <fieldset className="rounded-md border border-blue-300 bg-blue-50 p-3">
        <legend className="px-2 text-sm font-semibold text-blue-800">
          Opzioni Trasmissione Certificato Medico
        </legend>
        <div className="grid grid-cols-12 gap-2">
          <label className="col-span-4 text-xs">
            Tipo Trasmissione
            <select
              value={editor.cm_tipo_trasmissione || "PAGOPA"}
              onChange={upd("cm_tipo_trasmissione")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            >
              <option value="PAGOPA">Con pagoPA</option>
              <option value="NOPAG">Senza pagamento</option>
              <option value="SELPAG">Seleziona pagamento esistente</option>
            </select>
          </label>
          <label className="col-span-4 text-xs">
            ID Pagamento pagoPA
            <input
              type="text"
              value={editor.cm_idpagamento_pagopa || ""}
              onChange={upd("cm_idpagamento_pagopa")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-mono uppercase"
            />
          </label>
          <label className="col-span-4 text-xs">
            IUV
            <input
              type="text"
              value={editor.cm_iuv || ""}
              onChange={upd("cm_iuv")}
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
        showTrasmetti={true}
        showStampa={true}
        saveLabel={isNew ? "Salva Cert. Medico" : "Aggiorna"}
      />
    </FormLayout>
  );
}

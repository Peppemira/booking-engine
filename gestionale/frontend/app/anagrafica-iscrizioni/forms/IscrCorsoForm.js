"use client";

/**
 * IscrCorsoForm.js — Iscrizione Corso
 *
 * Replica fedele del form GeCA Future `iscrCorso.cs` / `iscrCorso.Designer.cs`.
 * Sigle GeCA:
 *   - RP -> Recupero Punti (PanRecupero)
 *   - CQ -> Corso C.Q.C. (panCQC)
 *   - CK -> Corso C.A.P. (panCAP)
 *   - CA -> Corso A.D.R. (PanADR, GroupPag)
 *
 * A seconda del tipo corso si mostra il pannello corrispondente.
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

const TIPI_CORSO = [
  { value: "RECUPERO_PUNTI", label: "Recupero Punti", sigla: "RP", color: "amber" },
  { value: "CQC", label: "Corso C.Q.C.", sigla: "CQ", color: "orange" },
  { value: "CAP", label: "Corso C.A.P.", sigla: "CK", color: "lime" },
  { value: "ADR", label: "Corso A.D.R.", sigla: "CA", color: "rose" },
];

const TIPI_ADR = [
  { value: "BASE", label: "Base" },
  { value: "CISTERNE", label: "Cisterne" },
  { value: "ESPLOSIVI", label: "Esplosivi (Classe 1)" },
  { value: "RADIOATTIVI", label: "Radioattivi (Classe 7)" },
  { value: "COMPLETO", label: "Base + Cisterne + Esplosivi + Rad." },
];

const TIPI_CQC_CORSO = [
  { value: "PERSONE", label: "Persone" },
  { value: "COSE", label: "Cose" },
  { value: "ENTRAMBE", label: "Persone + Cose" },
  { value: "FORMAZIONE_PERIODICA", label: "Formazione Periodica" },
];

export default function IscrCorsoForm({
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
  tipoCorso: initialTipo = "RECUPERO_PUNTI",
}) {
  const [tipoCorso, setTipoCorso] = useState(initialTipo);

  const upd = (k) => (e) =>
    setEditor((prev) => ({ ...prev, [k]: e.target.value }));

  const updTipo = (t) => {
    setTipoCorso(t);
    setEditor((prev) => ({ ...prev, tipo_corso: t }));
  };

  const title = isNew
    ? `Corso ${TIPI_CORSO.find((c) => c.value === tipoCorso)?.label} - Registra Nuova Iscrizione`
    : `Corso ${TIPI_CORSO.find((c) => c.value === tipoCorso)?.label} - Modifica`;

  return (
    <FormLayout modal={modal}>
      <FormHeader
        title={title}
        subtitle="Iscrizione a corsi (Recupero Punti, C.Q.C., C.A.P., A.D.R.)"
        tipo={TIPI_CORSO.find((c) => c.value === tipoCorso)?.label || "Corso"}
        onClose={onAnnulla}
      />

      {/* Switch Tipo Corso */}
      <fieldset className="rounded-md border-2 border-amber-300 bg-amber-50 p-3">
        <legend className="px-2 text-sm font-semibold text-amber-800">
          Tipo Corso (GeCA: RP / CQ / CK / CA)
        </legend>
        <div className="flex flex-wrap gap-4">
          {TIPI_CORSO.map((t) => (
            <label key={t.value} className="flex items-center gap-2">
              <input
                type="radio"
                name="iscrCorso_tipo"
                value={t.value}
                checked={tipoCorso === t.value}
                onChange={() => updTipo(t.value)}
                disabled={disabled}
                className="h-4 w-4"
              />
              <span className="text-sm font-medium">
                {t.label}
                <span className="ml-1 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                  {t.sigla}
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

      {/* Dati generali del corso */}
      <fieldset className="rounded-md border border-slate-300 bg-slate-50 p-3">
        <legend className="px-2 text-sm font-semibold text-slate-700">
          Dati Corso
        </legend>
        <div className="grid grid-cols-12 gap-2">
          <label className="col-span-3 text-xs">
            Data Inizio
            <input
              type="date"
              value={editor.corso_data_inizio || ""}
              onChange={upd("corso_data_inizio")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            />
          </label>
          <label className="col-span-3 text-xs">
            Data Fine
            <input
              type="date"
              value={editor.corso_data_fine || ""}
              onChange={upd("corso_data_fine")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            />
          </label>
          <label className="col-span-3 text-xs">
            Ore Totali
            <input
              type="number"
              min="0"
              value={editor.corso_ore || ""}
              onChange={upd("corso_ore")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            />
          </label>
          <label className="col-span-3 text-xs">
            Sede Corso
            <input
              type="text"
              value={editor.corso_sede || ""}
              onChange={upd("corso_sede")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
            />
          </label>
          <label className="col-span-3 text-xs">
            Docente
            <input
              type="text"
              value={editor.corso_docente || ""}
              onChange={upd("corso_docente")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
            />
          </label>
          <label className="col-span-3 text-xs">
            Protocollo Corso
            <input
              type="text"
              value={editor.corso_protocollo || ""}
              onChange={upd("corso_protocollo")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-mono uppercase"
            />
          </label>
        </div>
      </fieldset>

      {/* Pannelli specifici per tipo corso */}
      {tipoCorso === "RECUPERO_PUNTI" && (
        <fieldset className="rounded-md border-2 border-amber-400 bg-amber-50 p-3">
          <legend className="px-2 text-sm font-semibold text-amber-800">
            Dati Recupero Punti (PanRecupero)
          </legend>
          <div className="grid grid-cols-12 gap-2">
            <label className="col-span-3 text-xs">
              Punti Attuali
              <input
                type="number"
                min="0"
                max="30"
                value={editor.rp_punti_attuali || ""}
                onChange={upd("rp_punti_attuali")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </label>
            <label className="col-span-3 text-xs">
              Punti da Recuperare
              <input
                type="number"
                min="0"
                max="30"
                value={editor.rp_punti_recupero || ""}
                onChange={upd("rp_punti_recupero")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </label>
            <label className="col-span-3 text-xs">
              Categoria di Recupero
              <select
                value={editor.rp_categoria || ""}
                onChange={upd("rp_categoria")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              >
                <option value="">—</option>
                <option value="A_B">A / B (6 punti)</option>
                <option value="C_D_E">C / D / E (9 punti)</option>
                <option value="CQC">C.Q.C. Persone/Cose</option>
              </select>
            </label>
            <label className="col-span-3 text-xs">
              Data Esame Finale
              <input
                type="date"
                value={editor.rp_data_esame || ""}
                onChange={upd("rp_data_esame")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </label>
          </div>
        </fieldset>
      )}

      {tipoCorso === "CQC" && (
        <fieldset className="rounded-md border-2 border-orange-400 bg-orange-50 p-3">
          <legend className="px-2 text-sm font-semibold text-orange-800">
            Dati Corso C.Q.C. (panCQC)
          </legend>
          <div className="grid grid-cols-12 gap-2">
            <label className="col-span-4 text-xs">
              Tipo Corso CQC
              <select
                value={editor.cqc_corso_tipo || ""}
                onChange={upd("cqc_corso_tipo")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              >
                <option value="">—</option>
                {TIPI_CQC_CORSO.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className="col-span-4 text-xs">
              Codice CIA
              <input
                type="text"
                value={editor.cia_codice || ""}
                onChange={upd("cia_codice")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
              />
            </label>
            <label className="col-span-4 text-xs">
              Data Esame Finale
              <input
                type="date"
                value={editor.cqc_data_esame || ""}
                onChange={upd("cqc_data_esame")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </label>
          </div>
        </fieldset>
      )}

      {tipoCorso === "CAP" && (
        <fieldset className="rounded-md border-2 border-lime-400 bg-lime-50 p-3">
          <legend className="px-2 text-sm font-semibold text-lime-800">
            Dati Corso C.A.P. (panCAP)
          </legend>
          <div className="grid grid-cols-12 gap-2">
            <label className="col-span-4 text-xs">
              Tipo CAP
              <select
                value={editor.cap_tipo || ""}
                onChange={upd("cap_tipo")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              >
                <option value="">—</option>
                <option value="KA">CAP KA (taxi, NCC persone)</option>
                <option value="KB">CAP KB (merci)</option>
                <option value="KC">CAP KC</option>
                <option value="KD">CAP KD</option>
              </select>
            </label>
            <label className="col-span-4 text-xs">
              Data Esame
              <input
                type="date"
                value={editor.cap_data_esame || ""}
                onChange={upd("cap_data_esame")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </label>
            <label className="col-span-4 text-xs">
              Protocollo CAP
              <input
                type="text"
                value={editor.cap_protocollo || ""}
                onChange={upd("cap_protocollo")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-mono uppercase"
              />
            </label>
          </div>
        </fieldset>
      )}

      {tipoCorso === "ADR" && (
        <fieldset className="rounded-md border-2 border-rose-400 bg-rose-50 p-3">
          <legend className="px-2 text-sm font-semibold text-rose-800">
            Dati Corso A.D.R. (PanADR)
          </legend>
          <div className="grid grid-cols-12 gap-2">
            <label className="col-span-4 text-xs">
              Tipo ADR
              <select
                value={editor.adr_tipo || ""}
                onChange={upd("adr_tipo")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              >
                <option value="">—</option>
                {TIPI_ADR.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className="col-span-4 text-xs">
              Data Esame ADR
              <input
                type="date"
                value={editor.adr_data_esame || ""}
                onChange={upd("adr_data_esame")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </label>
            <label className="col-span-4 text-xs">
              Scadenza Certificato ADR
              <input
                type="date"
                value={editor.adr_data_scadenza || ""}
                onChange={upd("adr_data_scadenza")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </label>
            <label className="col-span-4 text-xs">
              N. Certificato ADR
              <input
                type="text"
                value={editor.adr_certificato_numero || ""}
                onChange={upd("adr_certificato_numero")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-mono uppercase"
              />
            </label>
            <label className="col-span-8 text-xs">
              Autorita' Certificante
              <input
                type="text"
                value={editor.adr_autorita || ""}
                onChange={upd("adr_autorita")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
                placeholder="es. MIT / Ministero dei Trasporti"
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
        saveLabel={isNew ? "Salva Corso" : "Aggiorna"}
      />
    </FormLayout>
  );
}

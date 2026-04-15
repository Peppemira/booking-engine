"use client";

/**
 * IscrAltroForm.js — Altre Iscrizioni
 *
 * Replica fedele del form GeCA Future `iscrAltro.cs` / `iscrAltro.Designer.cs`.
 * Sigle GeCA:
 *   - EG -> Esercitazione Guida
 *   - AD -> Archivio Dati
 *   - PI -> Permesso Internazionale di Guida
 *   - PP -> Permesso Provvisorio di Guida
 *
 * Form generico per le iscrizioni "altre" che condividono la stessa struttura base
 * con pannelli/campi specifici condizionali per sottotipo.
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

const SOTTOTIPI_ALTRO = [
  { value: "ESERCITAZIONE_GUIDA", label: "Esercitazione Guida", sigla: "EG", color: "sky" },
  { value: "ARCHIVIO_DATI", label: "Archivio Dati", sigla: "AD", color: "stone" },
  { value: "PERMESSO_INTERNAZIONALE", label: "Permesso Internazionale", sigla: "PI", color: "emerald" },
  { value: "PERMESSO_PROVVISORIO", label: "Permesso Provvisorio", sigla: "PP", color: "amber" },
];

export default function IscrAltroForm({
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
  sottotipo: initialSottotipo = "ESERCITAZIONE_GUIDA",
}) {
  const [sottotipo, setSottotipo] = useState(initialSottotipo);

  const upd = (k) => (e) =>
    setEditor((prev) => ({ ...prev, [k]: e.target.value }));

  const updSottotipo = (s) => {
    setSottotipo(s);
    setEditor((prev) => ({
      ...prev,
      altro_sottotipo: s,
      tipo_iscrizione_sigla: SOTTOTIPI_ALTRO.find((x) => x.value === s)?.sigla || "EG",
    }));
  };

  const currentTipo = SOTTOTIPI_ALTRO.find((s) => s.value === sottotipo);
  const title = isNew
    ? `${currentTipo?.label} - Registra Nuova Iscrizione`
    : `${currentTipo?.label} - Modifica`;

  return (
    <FormLayout modal={modal}>
      <FormHeader
        title={title}
        subtitle="Iscrizioni varie (EG / AD / PI / PP)"
        tipo={`${currentTipo?.label} (${currentTipo?.sigla})`}
        onClose={onAnnulla}
      />

      {/* Switch sottotipo */}
      <fieldset className="rounded-md border-2 border-slate-400 bg-slate-50 p-3">
        <legend className="px-2 text-sm font-semibold text-slate-700">
          Tipo Iscrizione (GeCA: EG / AD / PI / PP)
        </legend>
        <div className="flex flex-wrap gap-4">
          {SOTTOTIPI_ALTRO.map((s) => (
            <label key={s.value} className="flex items-center gap-2">
              <input
                type="radio"
                name="iscrAltro_sottotipo"
                value={s.value}
                checked={sottotipo === s.value}
                onChange={() => updSottotipo(s.value)}
                disabled={disabled}
                className="h-4 w-4"
              />
              <span className="text-sm font-medium">
                {s.label}
                <span className="ml-1 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
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

      {/* Esercitazione Guida (EG) */}
      {sottotipo === "ESERCITAZIONE_GUIDA" && (
        <fieldset className="rounded-md border-2 border-sky-400 bg-sky-50 p-3">
          <legend className="px-2 text-sm font-semibold text-sky-800">
            Esercitazione Guida
          </legend>
          <div className="grid grid-cols-12 gap-2">
            <label className="col-span-3 text-xs">
              Data Inizio Es.
              <input
                type="date"
                value={editor.eg_data_inizio || ""}
                onChange={upd("eg_data_inizio")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </label>
            <label className="col-span-3 text-xs">
              Data Fine Es.
              <input
                type="date"
                value={editor.eg_data_fine || ""}
                onChange={upd("eg_data_fine")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </label>
            <label className="col-span-3 text-xs">
              Veicolo (targa)
              <input
                type="text"
                value={editor.eg_veicolo_targa || ""}
                onChange={upd("eg_veicolo_targa")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-mono uppercase"
              />
            </label>
            <label className="col-span-3 text-xs">
              Istruttore
              <input
                type="text"
                value={editor.eg_istruttore || ""}
                onChange={upd("eg_istruttore")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
              />
            </label>
          </div>
        </fieldset>
      )}

      {/* Archivio Dati (AD) */}
      {sottotipo === "ARCHIVIO_DATI" && (
        <fieldset className="rounded-md border-2 border-stone-400 bg-stone-50 p-3">
          <legend className="px-2 text-sm font-semibold text-stone-800">
            Archivio Dati
          </legend>
          <div className="grid grid-cols-12 gap-2">
            <label className="col-span-4 text-xs">
              Motivo Archiviazione
              <select
                value={editor.ad_motivo || ""}
                onChange={upd("ad_motivo")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              >
                <option value="">—</option>
                <option value="TRASFERIMENTO">Trasferimento altra autoscuola</option>
                <option value="RINUNCIA">Rinuncia candidato</option>
                <option value="CHIUSURA_PRATICA">Chiusura pratica</option>
                <option value="DATI_STORICI">Dati storici</option>
              </select>
            </label>
            <label className="col-span-4 text-xs">
              Data Archiviazione
              <input
                type="date"
                value={editor.ad_data || ""}
                onChange={upd("ad_data")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </label>
            <label className="col-span-4 text-xs">
              Protocollo Trasferimento
              <input
                type="text"
                value={editor.ad_protocollo || ""}
                onChange={upd("ad_protocollo")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-mono uppercase"
              />
            </label>
          </div>
        </fieldset>
      )}

      {/* Permesso Internazionale (PI) */}
      {sottotipo === "PERMESSO_INTERNAZIONALE" && (
        <fieldset className="rounded-md border-2 border-emerald-400 bg-emerald-50 p-3">
          <legend className="px-2 text-sm font-semibold text-emerald-800">
            Permesso Internazionale di Guida
          </legend>
          <div className="grid grid-cols-12 gap-2">
            <label className="col-span-4 text-xs">
              Tipo Convenzione
              <select
                value={editor.pi_convenzione || ""}
                onChange={upd("pi_convenzione")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              >
                <option value="">—</option>
                <option value="VIENNA_1968">Convenzione di Vienna 1968 (3 anni)</option>
                <option value="GINEVRA_1949">Convenzione di Ginevra 1949 (1 anno)</option>
              </select>
            </label>
            <label className="col-span-4 text-xs">
              Data Rilascio
              <input
                type="date"
                value={editor.pi_data_rilascio || ""}
                onChange={upd("pi_data_rilascio")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </label>
            <label className="col-span-4 text-xs">
              Data Scadenza
              <input
                type="date"
                value={editor.pi_data_scadenza || ""}
                onChange={upd("pi_data_scadenza")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </label>
            <label className="col-span-4 text-xs">
              Paesi di Utilizzo
              <input
                type="text"
                value={editor.pi_paesi || ""}
                onChange={upd("pi_paesi")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
                placeholder="es. USA, CANADA, AUSTRALIA"
              />
            </label>
            <label className="col-span-4 text-xs">
              N. Permesso
              <input
                type="text"
                value={editor.pi_numero || ""}
                onChange={upd("pi_numero")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-mono uppercase"
              />
            </label>
            <label className="col-span-4 text-xs">
              Ente Rilascio
              <input
                type="text"
                value={editor.pi_ente || ""}
                onChange={upd("pi_ente")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
                placeholder="ACI / Motorizzazione"
              />
            </label>
          </div>
        </fieldset>
      )}

      {/* Permesso Provvisorio (PP) */}
      {sottotipo === "PERMESSO_PROVVISORIO" && (
        <fieldset className="rounded-md border-2 border-amber-400 bg-amber-50 p-3">
          <legend className="px-2 text-sm font-semibold text-amber-800">
            Permesso Provvisorio di Guida
          </legend>
          <div className="grid grid-cols-12 gap-2">
            <label className="col-span-3 text-xs">
              Data Emissione
              <input
                type="date"
                value={editor.pp_data_emissione || ""}
                onChange={upd("pp_data_emissione")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </label>
            <label className="col-span-3 text-xs">
              Data Scadenza
              <input
                type="date"
                value={editor.pp_data_scadenza || ""}
                onChange={upd("pp_data_scadenza")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </label>
            <label className="col-span-3 text-xs">
              N. Permesso
              <input
                type="text"
                value={editor.pp_numero || ""}
                onChange={upd("pp_numero")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-mono uppercase"
              />
            </label>
            <label className="col-span-3 text-xs">
              Categoria Autorizzata
              <input
                type="text"
                value={editor.pp_categoria || ""}
                onChange={upd("pp_categoria")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
              />
            </label>
            <label className="col-span-12 text-xs">
              Motivo Permesso
              <input
                type="text"
                value={editor.pp_motivo || ""}
                onChange={upd("pp_motivo")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
                placeholder="es. Attesa consegna patente definitiva"
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
        showTrasmetti={sottotipo === "PERMESSO_INTERNAZIONALE" || sottotipo === "PERMESSO_PROVVISORIO"}
        showStampa={true}
        saveLabel={isNew ? "Salva Iscrizione" : "Aggiorna"}
      />
    </FormLayout>
  );
}

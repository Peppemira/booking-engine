"use client";

/**
 * IscrGUIACCForm.js — Guida Accompagnata
 *
 * Replica fedele del form GeCA Future `iscrGUIACC.cs` / `iscrGUIACC.Designer.cs`.
 * Sigla GeCA: GA.
 *
 * Autorizzazione guida accompagnata (minori 17 anni che hanno superato esame teorico
 * per patente B e devono guidare affiancati da accompagnatore).
 *
 * Campi specifici:
 *   - Dati accompagnatore (cognome, nome, CF, data nascita)
 *   - N. patente accompagnatore, categoria, ente rilascio, data rilascio/scadenza
 *   - Relazione con candidato (genitore, parente, amico)
 *   - Veicoli autorizzati (targa 1, targa 2, ecc.)
 *   - Data autorizzazione
 */

import { useState } from "react";
import {
  SectionAutoscuolaIscrizione,
  SectionDocumentoRiconoscimento,
  SectionAnagraficaResidenza,
  SectionFotoFirma,
  SectionNote,
  FormButtonsBar,
  FormHeader,
  FormLayout,
} from "./SharedFields";

const RELAZIONI_ACC = [
  "GENITORE",
  "TUTORE LEGALE",
  "PARENTE",
  "AMICO DI FAMIGLIA",
  "ALTRO",
];

export default function IscrGUIACCForm({
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

  const [accompagnatori, setAccompagnatori] = useState(
    Array.isArray(editor.accompagnatori) && editor.accompagnatori.length > 0
      ? editor.accompagnatori
      : [{ cognome: "", nome: "", codice_fiscale: "", npatente: "", categoria: "B", scad: "", relazione: "GENITORE" }]
  );

  const updAcc = (i, k, v) => {
    const next = [...accompagnatori];
    next[i] = { ...next[i], [k]: v };
    setAccompagnatori(next);
    setEditor((prev) => ({ ...prev, accompagnatori: next }));
  };

  const addAcc = () => {
    if (accompagnatori.length >= 4) return;
    const next = [
      ...accompagnatori,
      { cognome: "", nome: "", codice_fiscale: "", npatente: "", categoria: "B", scad: "", relazione: "GENITORE" },
    ];
    setAccompagnatori(next);
    setEditor((prev) => ({ ...prev, accompagnatori: next }));
  };

  const removeAcc = (i) => {
    if (accompagnatori.length <= 1) return;
    const next = accompagnatori.filter((_, idx) => idx !== i);
    setAccompagnatori(next);
    setEditor((prev) => ({ ...prev, accompagnatori: next }));
  };

  const title = isNew
    ? "Guida Accompagnata - Registra Nuova Iscrizione"
    : "Guida Accompagnata - Modifica";

  return (
    <FormLayout modal={modal}>
      <FormHeader
        title={title}
        subtitle="Autorizzazione guida accompagnata (minori 17 anni con teoria superata)"
        tipo="Guida Accompagnata (GA)"
        onClose={onAnnulla}
      />

      <SectionAutoscuolaIscrizione
        editor={editor}
        setEditor={setEditor}
        disabled={disabled}
      />

      {/* Dati Autorizzazione */}
      <fieldset className="rounded-md border-2 border-emerald-300 bg-emerald-50 p-3">
        <legend className="px-2 text-sm font-semibold text-emerald-800">
          Dati Autorizzazione
        </legend>
        <div className="grid grid-cols-12 gap-2">
          <label className="col-span-3 text-xs">
            Data Esame Teoria
            <input
              type="date"
              value={editor.ga_data_teoria || ""}
              onChange={upd("ga_data_teoria")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            />
          </label>
          <label className="col-span-3 text-xs">
            Data Autorizzazione
            <input
              type="date"
              value={editor.ga_data_autorizzazione || ""}
              onChange={upd("ga_data_autorizzazione")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            />
          </label>
          <label className="col-span-3 text-xs">
            Scadenza (1 anno)
            <input
              type="date"
              value={editor.ga_data_scadenza || ""}
              onChange={upd("ga_data_scadenza")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            />
          </label>
          <label className="col-span-3 text-xs">
            Protocollo Autorizzazione
            <input
              type="text"
              value={editor.ga_protocollo || ""}
              onChange={upd("ga_protocollo")}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-mono uppercase"
            />
          </label>
        </div>
      </fieldset>

      {/* Accompagnatori */}
      <fieldset className="rounded-md border-2 border-emerald-400 bg-emerald-50 p-3">
        <legend className="flex items-center gap-2 px-2 text-sm font-semibold text-emerald-800">
          Accompagnatori Autorizzati
          <button
            type="button"
            onClick={addAcc}
            disabled={disabled || accompagnatori.length >= 4}
            className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            + Aggiungi (max 4)
          </button>
        </legend>
        {accompagnatori.map((acc, i) => (
          <div key={i} className="mb-3 rounded border border-emerald-200 bg-white p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-700">
                Accompagnatore #{i + 1}
              </span>
              {accompagnatori.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeAcc(i)}
                  disabled={disabled}
                  className="rounded bg-red-100 px-2 py-0.5 text-[10px] text-red-700 hover:bg-red-200"
                >
                  Rimuovi
                </button>
              )}
            </div>
            <div className="grid grid-cols-12 gap-2">
              <label className="col-span-3 text-xs">
                Cognome
                <input
                  type="text"
                  value={acc.cognome}
                  onChange={(e) => updAcc(i, "cognome", e.target.value.toUpperCase())}
                  disabled={disabled}
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
                />
              </label>
              <label className="col-span-3 text-xs">
                Nome
                <input
                  type="text"
                  value={acc.nome}
                  onChange={(e) => updAcc(i, "nome", e.target.value.toUpperCase())}
                  disabled={disabled}
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
                />
              </label>
              <label className="col-span-3 text-xs">
                Codice Fiscale
                <input
                  type="text"
                  value={acc.codice_fiscale}
                  onChange={(e) => updAcc(i, "codice_fiscale", e.target.value.toUpperCase())}
                  disabled={disabled}
                  maxLength={16}
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-mono uppercase"
                />
              </label>
              <label className="col-span-3 text-xs">
                Relazione
                <select
                  value={acc.relazione}
                  onChange={(e) => updAcc(i, "relazione", e.target.value)}
                  disabled={disabled}
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                >
                  {RELAZIONI_ACC.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </label>
              <label className="col-span-3 text-xs">
                N. Patente
                <input
                  type="text"
                  value={acc.npatente}
                  onChange={(e) => updAcc(i, "npatente", e.target.value.toUpperCase())}
                  disabled={disabled}
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-mono uppercase"
                />
              </label>
              <label className="col-span-2 text-xs">
                Categoria
                <input
                  type="text"
                  value={acc.categoria}
                  onChange={(e) => updAcc(i, "categoria", e.target.value.toUpperCase())}
                  disabled={disabled}
                  maxLength={4}
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
                />
              </label>
              <label className="col-span-3 text-xs">
                Scadenza Patente
                <input
                  type="date"
                  value={acc.scad || ""}
                  onChange={(e) => updAcc(i, "scad", e.target.value)}
                  disabled={disabled}
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                />
              </label>
              <label className="col-span-4 text-xs">
                Targa Veicolo
                <input
                  type="text"
                  value={acc.targa || ""}
                  onChange={(e) => updAcc(i, "targa", e.target.value.toUpperCase())}
                  disabled={disabled}
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-mono uppercase"
                />
              </label>
            </div>
          </div>
        ))}
      </fieldset>

      <SectionDocumentoRiconoscimento
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
        saveLabel={isNew ? "Salva Guida Acc." : "Aggiorna"}
      />
    </FormLayout>
  );
}

"use client";

/**
 * SharedFields.js — Sezioni riusabili per i 9 form specializzati di iscrizione
 * replica GeCA Future (iscrEsame, iscrRinnovo, iscrdup, iscrPATCQC, iscrCerMed,
 * iscrGUIACC, iscrCorso, iscrNaut, iscrAltro).
 *
 * Replica fedele delle sezioni:
 *   - autoscuola       -> SectionAutoscuolaIscrizione
 *   - protocolli       -> SectionProtocolliRegistro
 *   - Documento        -> SectionDocumentoRiconoscimento
 *   - Patente Posseduta-> SectionPatentePosseduta
 *   - AnaRes           -> SectionAnagraficaResidenza
 *   - Foto/Firma       -> SectionFotoFirma
 *   - Pulsanti         -> FormButtonsBar (Salva/Trasmetti/Stampa/Indietro)
 *
 * Ogni sezione riceve:
 *   - editor (stato), setEditor (setter)
 *   - disabled (opzionale)
 */

import {
  TIPO_DOCUMENTO_OPTIONS,
  PATENTE_RICHIESTA_OPTIONS,
} from "../../../lib/candidatoEditor";

/* ============================================================ */
/*              SEZIONE 1 — Autoscuola e Iscrizione               */
/*            (GeCA: GroupBox "autoscuola")                       */
/* ============================================================ */

export function SectionAutoscuolaIscrizione({ editor, setEditor, disabled = false }) {
  const upd = (k) => (e) => setEditor((prev) => ({ ...prev, [k]: e.target.value }));
  return (
    <fieldset className="rounded-md border border-slate-300 bg-slate-50 p-3">
      <legend className="px-2 text-sm font-semibold text-slate-700">
        Autoscuola e Iscrizione
      </legend>
      <div className="grid grid-cols-12 gap-2">
        <label className="col-span-3 text-xs">
          Codice Autoscuola
          <input
            type="text"
            value={editor.codice_autoscuola || ""}
            onChange={upd("codice_autoscuola")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
            maxLength={10}
          />
        </label>
        <label className="col-span-3 text-xs">
          Data Iscrizione
          <input
            type="date"
            value={editor.data_iscrizione || ""}
            onChange={upd("data_iscrizione")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          />
        </label>
        <label className="col-span-3 text-xs">
          Stato Richiesta
          <input
            type="text"
            value={editor.stato_richiesta || ""}
            onChange={upd("stato_richiesta")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          />
        </label>
        <label className="col-span-3 text-xs">
          Provenienza
          <input
            type="text"
            value={editor.provenienza || ""}
            onChange={upd("provenienza")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
            maxLength={6}
          />
        </label>
      </div>
    </fieldset>
  );
}

/* ============================================================ */
/*              SEZIONE 2 — Protocolli e Registro                 */
/*            (GeCA: GroupBox "protocolli")                       */
/* ============================================================ */

export function SectionProtocolliRegistro({ editor, setEditor, disabled = false, showFoglioRosa = true }) {
  const upd = (k) => (e) => setEditor((prev) => ({ ...prev, [k]: e.target.value }));
  return (
    <fieldset className="rounded-md border border-slate-300 bg-slate-50 p-3">
      <legend className="px-2 text-sm font-semibold text-slate-700">
        Protocolli e Registro Iscrizioni
      </legend>
      <div className="grid grid-cols-12 gap-2">
        <label className="col-span-3 text-xs">
          N. Registro
          <input
            type="text"
            value={editor.numero_registro || ""}
            onChange={upd("numero_registro")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            maxLength={10}
          />
        </label>
        <label className="col-span-3 text-xs">
          Data Registro
          <input
            type="date"
            value={editor.data_registro || ""}
            onChange={upd("data_registro")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          />
        </label>
        <label className="col-span-3 text-xs">
          Protocollo Ministeriale
          <input
            type="text"
            value={editor.protocollo_ministeriale || ""}
            onChange={upd("protocollo_ministeriale")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
            maxLength={20}
          />
        </label>
        <label className="col-span-3 text-xs">
          Data Emissione
          <input
            type="date"
            value={editor.data_emissione_protocollo || ""}
            onChange={upd("data_emissione_protocollo")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          />
        </label>
        {showFoglioRosa && (
          <>
            <label className="col-span-3 text-xs">
              Emissione Foglio Rosa
              <input
                type="date"
                value={editor.ppg_data_emissione || ""}
                onChange={upd("ppg_data_emissione")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </label>
            <label className="col-span-3 text-xs">
              Scadenza Foglio Rosa
              <input
                type="date"
                value={editor.ppg_data_scadenza || ""}
                onChange={upd("ppg_data_scadenza")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </label>
            <label className="col-span-3 text-xs">
              N. Foglio Rosa
              <input
                type="text"
                value={editor.ppg_numero || ""}
                onChange={upd("ppg_numero")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </label>
            <label className="col-span-3 text-xs">
              Presenze A2/A
              <input
                type="text"
                value={editor.presenze_a2_a || ""}
                onChange={upd("presenze_a2_a")}
                disabled={disabled}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </label>
          </>
        )}
      </div>
    </fieldset>
  );
}

/* ============================================================ */
/*          SEZIONE 3 — Documento di Riconoscimento               */
/*          (GeCA: tipdoc, luogodoc, rildoc, scaddoc)             */
/* ============================================================ */

export function SectionDocumentoRiconoscimento({ editor, setEditor, disabled = false }) {
  const upd = (k) => (e) => setEditor((prev) => ({ ...prev, [k]: e.target.value }));
  return (
    <fieldset className="rounded-md border border-slate-300 bg-slate-50 p-3">
      <legend className="px-2 text-sm font-semibold text-slate-700">
        Documento di Riconoscimento
      </legend>
      <div className="grid grid-cols-12 gap-2">
        <label className="col-span-3 text-xs">
          Tipo Documento
          <select
            value={editor.tipo_documento || ""}
            onChange={upd("tipo_documento")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          >
            <option value="">SELEZIONARE</option>
            {TIPO_DOCUMENTO_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </label>
        <label className="col-span-3 text-xs">
          N. Documento
          <input
            type="text"
            value={editor.numero_documento || ""}
            onChange={upd("numero_documento")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
            maxLength={20}
          />
        </label>
        <label className="col-span-3 text-xs">
          Luogo Rilascio
          <input
            type="text"
            value={editor.ente_rilascio_documento || ""}
            onChange={upd("ente_rilascio_documento")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
            maxLength={30}
          />
        </label>
        <label className="col-span-3 text-xs">
          Data Rilascio
          <input
            type="date"
            value={editor.rilasciato_il_documento || ""}
            onChange={upd("rilasciato_il_documento")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          />
        </label>
        <label className="col-span-3 text-xs">
          Scadenza
          <input
            type="date"
            value={editor.scade_il_documento || ""}
            onChange={upd("scade_il_documento")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          />
        </label>
      </div>
    </fieldset>
  );
}

/* ============================================================ */
/*          SEZIONE 4 — Patente Posseduta                         */
/*          (GeCA: npatposs, emiss, scad, luogo)                  */
/* ============================================================ */

export function SectionPatentePosseduta({ editor, setEditor, disabled = false }) {
  const upd = (k) => (e) => setEditor((prev) => ({ ...prev, [k]: e.target.value }));
  return (
    <fieldset className="rounded-md border border-slate-300 bg-slate-50 p-3">
      <legend className="px-2 text-sm font-semibold text-slate-700">
        Patente Posseduta
      </legend>
      <div className="grid grid-cols-12 gap-2">
        <label className="col-span-3 text-xs">
          N. Patente Posseduta
          <input
            type="text"
            value={editor.numero_patente_posseduta || ""}
            onChange={upd("numero_patente_posseduta")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
            maxLength={20}
          />
        </label>
        <label className="col-span-3 text-xs">
          Ente Rilascio
          <input
            type="text"
            value={editor.ente_rilascio_patente || ""}
            onChange={upd("ente_rilascio_patente")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
          />
        </label>
        <label className="col-span-3 text-xs">
          Data Rilascio
          <input
            type="date"
            value={editor.rilasciata_il_patente || ""}
            onChange={upd("rilasciata_il_patente")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          />
        </label>
        <label className="col-span-3 text-xs">
          Scadenza Patente
          <input
            type="date"
            value={editor.scade_il_patente || ""}
            onChange={upd("scade_il_patente")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          />
        </label>
      </div>
    </fieldset>
  );
}

/* ============================================================ */
/*          SEZIONE 5 — Dati Anagrafici e Residenza (AnaRes)      */
/*          (GeCA: AnaRes GroupBox)                               */
/* ============================================================ */

export function SectionAnagraficaResidenza({ editor, setEditor, disabled = false }) {
  const upd = (k) => (e) => setEditor((prev) => ({ ...prev, [k]: e.target.value }));
  return (
    <fieldset className="rounded-md border border-slate-300 bg-slate-50 p-3">
      <legend className="px-2 text-sm font-semibold text-slate-700">
        Dati Anagrafici e Residenza
      </legend>
      <div className="grid grid-cols-12 gap-2">
        {/* Riga 1: cognome, nome, CF, diacritici, eta' */}
        <label className="col-span-3 text-xs">
          Cognome
          <input
            type="text"
            value={editor.cognome || ""}
            onChange={upd("cognome")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
            maxLength={40}
          />
        </label>
        <label className="col-span-3 text-xs">
          Nome
          <input
            type="text"
            value={editor.nome || ""}
            onChange={upd("nome")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
            maxLength={40}
          />
        </label>
        <label className="col-span-3 text-xs">
          Codice Fiscale
          <input
            type="text"
            value={editor.codice_fiscale || ""}
            onChange={upd("codice_fiscale")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-mono uppercase"
            maxLength={16}
          />
        </label>
        <label className="col-span-2 text-xs">
          Diacritici
          <input
            type="text"
            value={editor.diacritici || ""}
            onChange={upd("diacritici")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            maxLength={4}
          />
        </label>
        <label className="col-span-1 text-xs">
          Sesso
          <select
            value={editor.sesso || "M"}
            onChange={upd("sesso")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-1 py-1 text-sm"
          >
            <option value="M">M</option>
            <option value="F">F</option>
          </select>
        </label>

        {/* Riga 2: data nascita, localita, provincia, stato estero */}
        <label className="col-span-3 text-xs">
          Data di Nascita
          <input
            type="date"
            value={editor.data_nascita || ""}
            onChange={upd("data_nascita")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          />
        </label>
        <label className="col-span-3 text-xs">
          Comune di Nascita
          <input
            type="text"
            value={editor.comune_nascita || ""}
            onChange={upd("comune_nascita")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
            maxLength={30}
          />
        </label>
        <label className="col-span-2 text-xs">
          Prov. Nascita
          <input
            type="text"
            value={editor.prov_nascita || ""}
            onChange={upd("prov_nascita")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
            maxLength={2}
          />
        </label>
        <label className="col-span-2 text-xs">
          Stato Estero Nasc.
          <input
            type="text"
            value={editor.stato_estero_nascita || ""}
            onChange={upd("stato_estero_nascita")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
          />
        </label>
        <label className="col-span-2 text-xs">
          Cittadinanza
          <input
            type="text"
            value={editor.cittadinanza || "ITALIANA"}
            onChange={upd("cittadinanza")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
          />
        </label>

        {/* Riga 3: Residenza: comune, provincia, CAP, toponimo */}
        <label className="col-span-4 text-xs">
          Comune di Residenza
          <input
            type="text"
            value={editor.comune_residenza || ""}
            onChange={upd("comune_residenza")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
            maxLength={30}
          />
        </label>
        <label className="col-span-2 text-xs">
          Prov. Res.
          <input
            type="text"
            value={editor.prov_residenza || ""}
            onChange={upd("prov_residenza")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
            maxLength={2}
          />
        </label>
        <label className="col-span-2 text-xs">
          CAP
          <input
            type="text"
            value={editor.cap_residenza || ""}
            onChange={upd("cap_residenza")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            maxLength={5}
          />
        </label>
        <label className="col-span-2 text-xs">
          Toponimo
          <input
            type="text"
            value={editor.toponimo_residenza || ""}
            onChange={upd("toponimo_residenza")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
            placeholder="VIA/PIAZZA"
          />
        </label>
        <label className="col-span-2 text-xs">
          N. Civico
          <input
            type="text"
            value={editor.numero_civico || ""}
            onChange={upd("numero_civico")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
            maxLength={6}
          />
        </label>

        {/* Riga 4: Indirizzo */}
        <label className="col-span-12 text-xs">
          Indirizzo di Residenza
          <input
            type="text"
            value={editor.indirizzo_residenza || ""}
            onChange={upd("indirizzo_residenza")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm uppercase"
            maxLength={60}
          />
        </label>

        {/* Riga 5: Contatti */}
        <label className="col-span-3 text-xs">
          Telefono 1
          <input
            type="tel"
            value={editor.telefono_1 || ""}
            onChange={upd("telefono_1")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          />
        </label>
        <label className="col-span-3 text-xs">
          Telefono 2
          <input
            type="tel"
            value={editor.telefono_2 || ""}
            onChange={upd("telefono_2")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          />
        </label>
        <label className="col-span-6 text-xs">
          Email
          <input
            type="email"
            value={editor.email_contatto || ""}
            onChange={upd("email_contatto")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          />
        </label>
      </div>
    </fieldset>
  );
}

/* ============================================================ */
/*          SEZIONE 6 — Patente Richiesta (PATENTE RICHIESTA)     */
/*          (GeCA: patrich ComboBox)                              */
/* ============================================================ */

export function SectionPatenteRichiesta({ editor, setEditor, disabled = false, children = null }) {
  const upd = (k) => (e) =>
    setEditor((prev) => ({ ...prev, [k]: e.target.value }));
  const toggleCambio = (e) =>
    setEditor((prev) => ({ ...prev, cambio_automatico: e.target.checked }));
  return (
    <fieldset className="rounded-md border border-slate-300 bg-slate-50 p-3">
      <legend className="px-2 text-sm font-semibold text-slate-700">
        Patente Richiesta
      </legend>
      <div className="grid grid-cols-12 gap-2">
        <label className="col-span-3 text-xs">
          Categoria Richiesta
          <select
            value={editor.categoria_patente || "B"}
            onChange={upd("categoria_patente")}
            disabled={disabled}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          >
            {PATENTE_RICHIESTA_OPTIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="col-span-3 text-xs">
          Cambio
          <div className="mt-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!editor.cambio_automatico}
              onChange={toggleCambio}
              disabled={disabled}
              className="h-4 w-4"
            />
            <span className="text-sm text-slate-700">Automatico</span>
          </div>
        </label>
        {children}
      </div>
    </fieldset>
  );
}

/* ============================================================ */
/*          SEZIONE 7 — Foto e Firma                              */
/*          (GeCA: foto PictureBox + firma PictureBox)            */
/* ============================================================ */

export function SectionFotoFirma({ editor, setEditor, disabled = false }) {
  const handleFile = (key) => (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setEditor((prev) => ({ ...prev, [key]: reader.result }));
    };
    reader.readAsDataURL(file);
  };
  const clearField = (key) => () => {
    setEditor((prev) => ({ ...prev, [key]: "" }));
  };
  return (
    <fieldset className="rounded-md border border-slate-300 bg-slate-50 p-3">
      <legend className="px-2 text-sm font-semibold text-slate-700">
        Foto e Firma
      </legend>
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-6">
          <p className="mb-1 text-xs font-medium text-slate-600">Foto</p>
          <div className="flex items-start gap-3">
            <div className="flex h-[140px] w-[110px] items-center justify-center overflow-hidden rounded border border-slate-300 bg-white">
              {editor.foto_data_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={editor.foto_data_url} alt="Foto" className="h-full w-full object-cover" />
              ) : (
                <span className="text-xs text-slate-400">Nessuna foto</span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <input
                type="file"
                accept="image/*"
                onChange={handleFile("foto_data_url")}
                disabled={disabled}
                className="text-xs"
              />
              {editor.foto_data_url && (
                <button
                  type="button"
                  onClick={clearField("foto_data_url")}
                  disabled={disabled}
                  className="rounded border border-red-300 px-2 py-0.5 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Rimuovi
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="col-span-6">
          <p className="mb-1 text-xs font-medium text-slate-600">Firma</p>
          <div className="flex items-start gap-3">
            <div className="flex h-[80px] w-[220px] items-center justify-center overflow-hidden rounded border border-slate-300 bg-white">
              {editor.firma_data_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={editor.firma_data_url} alt="Firma" className="h-full w-full object-contain" />
              ) : (
                <span className="text-xs text-slate-400">Nessuna firma</span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <input
                type="file"
                accept="image/*"
                onChange={handleFile("firma_data_url")}
                disabled={disabled}
                className="text-xs"
              />
              {editor.firma_data_url && (
                <button
                  type="button"
                  onClick={clearField("firma_data_url")}
                  disabled={disabled}
                  className="rounded border border-red-300 px-2 py-0.5 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Rimuovi
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </fieldset>
  );
}

/* ============================================================ */
/*          SEZIONE 8 — Note                                      */
/* ============================================================ */

export function SectionNote({ editor, setEditor, disabled = false }) {
  return (
    <fieldset className="rounded-md border border-slate-300 bg-slate-50 p-3">
      <legend className="px-2 text-sm font-semibold text-slate-700">
        Note
      </legend>
      <textarea
        rows={3}
        value={editor.note || ""}
        onChange={(e) => setEditor((prev) => ({ ...prev, note: e.target.value }))}
        disabled={disabled}
        maxLength={500}
        className="w-full resize-y rounded border border-slate-300 bg-white px-2 py-1 text-sm"
        placeholder="Note interne sulla pratica"
      />
    </fieldset>
  );
}

/* ============================================================ */
/*          FORM BUTTONS BAR                                      */
/*          (GeCA: btmconf, btmStampe, btmTrasm, btmback)         */
/* ============================================================ */

export function FormButtonsBar({
  onSave,
  onTrasmetti,
  onStampa,
  onAnnulla,
  saving = false,
  trasmettendo = false,
  showTrasmetti = true,
  showStampa = true,
  saveLabel = "Salva Iscrizione",
  disabled = false,
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex items-center justify-between gap-2 border-t border-slate-300 bg-white px-4 py-3 shadow-[0_-4px_10px_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onAnnulla}
          disabled={disabled || saving}
          className="rounded border border-slate-400 bg-slate-100 px-4 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
        >
          ← Indietro
        </button>
      </div>
      <div className="flex items-center gap-2">
        {showStampa && (
          <button
            type="button"
            onClick={onStampa}
            disabled={disabled || saving || !onStampa}
            className="rounded border border-blue-400 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-40"
            title="Stampa documento iscrizione"
          >
            🖨 Stampa
          </button>
        )}
        {showTrasmetti && (
          <button
            type="button"
            onClick={onTrasmetti}
            disabled={disabled || saving || trasmettendo || !onTrasmetti}
            className="rounded border border-amber-500 bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-40"
            title="Trasmetti pratica al CED/MIT"
          >
            {trasmettendo ? "Trasmissione..." : "📤 Trasmetti CED"}
          </button>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={disabled || saving}
          className="rounded border border-emerald-600 bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? "Salvataggio..." : "💾 " + saveLabel}
        </button>
      </div>
    </div>
  );
}

/* ============================================================ */
/*          HEADER titolo form (replica "... - Registra Nuova")   */
/* ============================================================ */

export function FormHeader({ title, subtitle, tipo, onClose }) {
  return (
    <div className="mb-3 flex items-start justify-between border-b border-slate-300 pb-2">
      <div>
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        {tipo && (
          <span className="mt-1 inline-block rounded bg-slate-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
            {tipo}
          </span>
        )}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          title="Chiudi"
        >
          <span className="text-xl leading-none">×</span>
        </button>
      )}
    </div>
  );
}

/* ============================================================ */
/*          HELPER: layout wrapper pagina/modale form             */
/* ============================================================ */

export function FormLayout({ children, modal = false }) {
  if (modal) {
    return (
      <div className="flex max-h-[92vh] flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-xl">
        <div className="flex-1 overflow-y-auto px-4 pt-4">{children}</div>
      </div>
    );
  }
  return <div className="space-y-3">{children}</div>;
}

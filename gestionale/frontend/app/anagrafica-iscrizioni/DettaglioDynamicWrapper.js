"use client";

/**
 * DettaglioDynamicWrapper.js — Wrapper dinamico per apertura form in modalita' MODIFICA.
 *
 * Replica fedele di GeCA `anagrafe.cs` btmedit_Click / eleIscritti_CellDoubleClick:
 *
 *   IN / PR / RE   -> iscrEsame.ShowDialog()      (Rilascio per Esame)
 *   CM             -> iscrCerMed.ShowDialog()     (Certificato Medico)
 *   PN             -> iscrNaut.ShowDialog()       (Patente Nautica)
 *   D|Y|L|S|R|     -> iscrdup.ShowDialog() (DUP)  (Duplicato Patente)
 *   M| / E|        -> iscrdup.ShowDialog() (CONV) (Conversione)
 *   PC / CC        -> iscrPATCQC.ShowDialog()     (Patente CQC / CQC Card)
 *   CV             -> iscrRinnovo.ShowDialog()    (Rinnovo)
 *   GA             -> iscrGUIACC.ShowDialog()     (Guida Accompagnata)
 *   EG/AD/PI/PP    -> iscrAltro.ShowDialog()      (Altri)
 *   RP/CQ/CK/CA    -> iscrCorso.ShowDialog()      (Corsi)
 *
 * Questo componente:
 *   1. Riceve una `row` (candidato selezionato in griglia)
 *   2. Risolve il Component giusto via `resolveFormByTipoIscrizione(row)`
 *   3. Lo renderizza in modalita' isNew=false (modifica) con i props appropriati
 *   4. Fallback a DettaglioPanel passato come prop se la sigla non e' riconosciuta
 *
 * Propaga tutti i parametri extra del form (modo/variante/tipoCorso/sottotipo)
 * in base al mapping in GECA_FORM_MAP.
 */

import { useMemo, useState, useCallback } from "react";
import { resolveFormByTipoIscrizione } from "./forms";
import { API_BASE, authHeaders } from "../../lib/authClient";
import { mapCandidateForSave } from "../../lib/candidatoEditor";
import SchedaRiepilogativaModal from "./SchedaRiepilogativaModal";

/**
 * Componente wrapper.
 *
 * Props:
 *  - row: oggetto candidato completo (per risolvere sigla)
 *  - editor, setEditor: stato editor condiviso con il page.js
 *  - editorBaseRawPortale: payload raw_portale originale (per mapCandidateForSave)
 *  - candidatoId: id del candidato (per PUT)
 *  - onClose: chiude il wrapper (torna alla griglia)
 *  - onSaved: callback post-save (ricarica griglia)
 *  - fallbackComponent: React component (es. DettaglioPanel vecchio) se sigla non riconosciuta
 *  - fallbackProps: props extra per fallbackComponent
 */
export default function DettaglioDynamicWrapper({
  row,
  editor,
  setEditor,
  editorBaseRawPortale = {},
  candidatoId,
  onClose,
  onSaved,
  fallbackComponent: FallbackComponent = null,
  fallbackProps = {},
}) {
  const [saving, setSaving] = useState(false);
  const [trasmettendo, setTrasmettendo] = useState(false);
  const [errore, setErrore] = useState("");
  const [showScheda, setShowScheda] = useState(false);

  // Risolvi il form da usare in base a sigla / tipo iscrizione
  const resolved = useMemo(() => resolveFormByTipoIscrizione(row || {}), [row]);

  /**
   * Salvataggio PUT /api/candidati-api/:id
   */
  const handleSave = useCallback(async () => {
    setErrore("");
    if (!editor?.cognome?.trim() || !editor?.nome?.trim()) {
      setErrore("Cognome e Nome sono obbligatori");
      return;
    }
    if (!candidatoId) {
      setErrore("ID candidato mancante");
      return;
    }

    setSaving(true);
    try {
      const basePayload = mapCandidateForSave(editor, editorBaseRawPortale || {});
      const payload = {
        ...basePayload,
        // Mantieni sigla/label se presenti nell'editor o risolte da sigla corrente
        tipo_iscrizione_sigla:
          editor.tipo_iscrizione_sigla || resolved?.sigla || basePayload.tipo_iscrizione_sigla,
        tipo_iscrizione:
          editor.tipo_iscrizione || resolved?.label || basePayload.tipo_iscrizione,
      };

      const res = await fetch(`${API_BASE}/api/candidati-api/${candidatoId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      if (typeof onSaved === "function") onSaved(data.candidato || payload);
      if (typeof onClose === "function") onClose();
    } catch (e) {
      setErrore(`Errore salvataggio: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }, [editor, editorBaseRawPortale, candidatoId, resolved, onSaved, onClose]);

  /**
   * Placeholder trasmetti (hook per FASE 6 — Trasmissione Pratiche)
   */
  const handleTrasmetti = useCallback(async () => {
    setErrore("");
    setTrasmettendo(true);
    try {
      // Se il candidato non ha ancora un id, prima va salvato
      if (!candidatoId) {
        setErrore("Salvare prima di trasmettere");
        return;
      }
      // TODO FASE 6: implementare chiamata a /api/portale-trasmissione
      setErrore("Trasmissione al Portale non ancora implementata (FASE 6)");
    } catch (e) {
      setErrore(`Errore trasmissione: ${e.message}`);
    } finally {
      setTrasmettendo(false);
    }
  }, [candidatoId]);

  /**
   * Stampa — apre SchedaRiepilogativaModal (FASE 4, replica GeCA frmRiepilogo)
   * che gestisce internamente i 3 tab + stampa PDF via window.print().
   */
  const handleStampa = useCallback(() => {
    setShowScheda(true);
  }, []);

  // Props comuni a tutti i form specializzati (contratto SharedFields / FormButtonsBar)
  const commonFormProps = {
    editor,
    setEditor,
    onSave: handleSave,
    onTrasmetti: handleTrasmetti,
    onStampa: handleStampa,
    onAnnulla: onClose,
    saving,
    trasmettendo,
    disabled: false,
    isNew: false,
    modal: true,
  };

  // Banner di errore (overlay sopra il form)
  const errorBanner = errore ? (
    <div className="fixed left-1/2 top-4 z-[60] -translate-x-1/2 rounded-md border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-800 shadow-lg">
      {errore}
    </div>
  ) : null;

  // Scheda riepilogativa overlay (comune a tutti i casi)
  const schedaOverlay = showScheda ? (
    <SchedaRiepilogativaModal
      row={row}
      open={true}
      onClose={() => setShowScheda(false)}
    />
  ) : null;

  // ── CASO 1: sigla riconosciuta → render del form specializzato ──
  if (resolved?.Component) {
    const SpecForm = resolved.Component;
    const specProps = resolved.props || {};
    return (
      <>
        {errorBanner}
        <SpecForm {...commonFormProps} {...specProps} />
        {schedaOverlay}
      </>
    );
  }

  // ── CASO 2: sigla non riconosciuta → fallback (DettaglioPanel vecchio) ──
  if (FallbackComponent) {
    return (
      <>
        {errorBanner}
        <FallbackComponent
          editor={editor}
          setEditor={setEditor}
          onSalva={handleSave}
          onAnnulla={onClose}
          saving={saving}
          {...fallbackProps}
        />
        {schedaOverlay}
      </>
    );
  }

  // ── CASO 3: nessun fallback → messaggio di errore ──
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-300 bg-white p-6 shadow-2xl">
        <h2 className="mb-2 text-lg font-bold text-slate-900">
          Tipo iscrizione non riconosciuto
        </h2>
        <p className="mb-4 text-sm text-slate-700">
          Sigla: <code className="rounded bg-slate-100 px-1">{row?.tipo_iscrizione_sigla || "?"}</code>
          <br />
          Tipo: <code className="rounded bg-slate-100 px-1">{row?.tipo_iscrizione || "?"}</code>
        </p>
        <p className="mb-4 text-xs text-slate-500">
          Non esiste un form specializzato per questa iscrizione. Contattare il supporto.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-violet-700"
        >
          Chiudi
        </button>
      </div>
    </div>
  );
}

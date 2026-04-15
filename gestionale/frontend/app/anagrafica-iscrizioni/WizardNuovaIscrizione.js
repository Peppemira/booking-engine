"use client";

/**
 * WizardNuovaIscrizione.js — Wizard "Registra Nuova Iscrizione"
 *
 * Replica fedele del form GeCA Future `nuovaiscr.cs` / `nuovaiscr.Designer.cs`.
 *
 * Flow (2 step):
 *   STEP 1 — Scelta tipo iscrizione:
 *     16 radio button disposti su 2 colonne (layout Navy identico a GeCA)
 *     corrispondenti alle Tag 0..15 del form originale.
 *   STEP 2 — Form specializzato:
 *     Apertura dinamica del componente React corrispondente (da GECA_FORM_MAP
 *     in forms/index.js), passando i props configurati (modo/variante/
 *     sottotipo/tipoCorso) e gestendo Save/Trasmetti/Stampa/Annulla.
 *
 * Mapping sigla ↔ form (da nuovaiscr.cs Button1_Click):
 *   Tag 0  radEsame        -> iscrEsame                     (IN/PR/RE)
 *   Tag 1  RadRINNOVO      -> iscrRinnovo                   (CV)
 *   Tag 2  radPATENTE      -> iscrDup { modo: DUPLICATO }   (D|)
 *   Tag 3  radCONV         -> iscrDup { modo: CONVERSIONE } (M|)
 *   Tag 4  radPATENTECQC   -> iscrPATCQC { variante: PATENTE } (PC)
 *   Tag 5  radCQCCARD      -> iscrPATCQC { variante: CARD }  (CC)
 *   Tag 6  radARCDATI      -> iscrAltro { sottotipo: ARCHIVIO_DATI } (AD)
 *   Tag 7  radESEGUIDA     -> iscrAltro { sottotipo: ESERCITAZIONE_GUIDA } (EG)
 *   Tag 8  radRECPUNTI     -> iscrCorso { tipoCorso: RECUPERO_PUNTI } (RP)
 *   Tag 9  RadPermInternaz -> iscrAltro { sottotipo: PERMESSO_INTERNAZIONALE } (PI)
 *   Tag 10 RadGuiAccom     -> iscrGUIACC                    (GA)
 *   Tag 11 RadCorsoCQC     -> iscrCorso { tipoCorso: CQC }  (CQ)
 *   Tag 12 RadiCertMed     -> iscrCerMed                    (CM)
 *   Tag 13 RadPP           -> iscrAltro { sottotipo: PERMESSO_PROVVISORIO } (PP)
 *   Tag 14 RadADR          -> iscrCorso { tipoCorso: ADR }  (CA)
 *   Tag 15 RadNaut         -> iscrNaut                      (PN)
 */

import { useState, useCallback, useMemo } from "react";
import { API_BASE, authHeaders } from "../../lib/authClient";
import { buildEmptyEditor, mapCandidateForSave } from "../../lib/candidatoEditor";
import { GECA_FORM_MAP } from "./forms";
import ModalOmonimi from "./ModalOmonimi";

/**
 * Definizione dei 16 radio button, ordinati per posizione (colonna / riga)
 * come in nuovaiscr.Designer.cs.
 *
 * Colonna sinistra  (x=27..)    : tag 0,1,2,3,4,5,6,7
 * Colonna destra    (x=650..)   : tag 8,9,10,11,12,13,14,15
 */
const TIPI_ISCRIZIONE = [
  // Colonna SX
  { tag: 0,  col: "L", sigla: "IN", label: "Rilascio per Esami : Interno - Privatista - Revisione", icon: "📝", desc: "Conseguimento patente per esame (interno/privatista/revisione)" },
  { tag: 1,  col: "L", sigla: "CV", label: "Conferma di Validità (Rinnovo Patente)",                icon: "🔄", desc: "Rinnovo/conferma validità patente posseduta" },
  { tag: 2,  col: "L", sigla: "D|", label: "Duplicato per : Smarrim. - Riclassif. - Deterioram. - Altro", icon: "📑", desc: "Duplicato patente per smarrimento/sottrazione/deterioramento" },
  { tag: 3,  col: "L", sigla: "M|", label: "Conversione Patente : Militare - Estera",               icon: "🌍", desc: "Conversione patente militare o estera" },
  { tag: 4,  col: "L", sigla: "PC", label: "Patente CQC : Utenti Italiani",                         icon: "🚛", desc: "Rilascio patente CQC (Carta Qualif. Conducente)" },
  { tag: 5,  col: "L", sigla: "CC", label: "CQC CARD : Utenti Stranieri",                           icon: "🆔", desc: "CQC Card per cittadini stranieri" },
  { tag: 6,  col: "L", sigla: "AD", label: "Archivio Dati",                                          icon: "🗄️", desc: "Archivio dati candidato (trasferimento/chiusura pratica)" },
  { tag: 7,  col: "L", sigla: "EG", label: "Esercitazione Guida",                                    icon: "🚗", desc: "Esercitazione di guida per candidato" },
  // Colonna DX
  { tag: 8,  col: "R", sigla: "RP", label: "Recupero Punti",                                         icon: "⚖️", desc: "Corso di recupero punti patente" },
  { tag: 9,  col: "R", sigla: "PI", label: "Permesso Intern.le di Guida",                            icon: "🌐", desc: "Permesso internazionale di guida (Vienna/Ginevra)" },
  { tag: 10, col: "R", sigla: "GA", label: "Guida Accompagnata",                                     icon: "👥", desc: "Autorizzazione guida accompagnata minori 17 anni" },
  { tag: 11, col: "R", sigla: "CQ", label: "Corso C.Q.C.",                                           icon: "🎓", desc: "Corso per qualifica del conducente" },
  { tag: 12, col: "R", sigla: "CM", label: "Certificato Medico (per non iscritti)",                  icon: "🏥", desc: "Rich. certificato medico per non iscritti" },
  { tag: 13, col: "R", sigla: "PP", label: "Permesso Provv. di Guida",                               icon: "📜", desc: "Permesso provvisorio di guida" },
  { tag: 14, col: "R", sigla: "CA", label: "Corso A.D.R.",                                           icon: "☣️", desc: "Corso trasporto merci pericolose A.D.R." },
  { tag: 15, col: "R", sigla: "PN", label: "Patente Nautica",                                        icon: "⛵", desc: "Richiesta patente nautica (varie zone)" },
];

const COL_L = TIPI_ISCRIZIONE.filter((t) => t.col === "L").sort((a, b) => a.tag - b.tag);
const COL_R = TIPI_ISCRIZIONE.filter((t) => t.col === "R").sort((a, b) => a.tag - b.tag);

/* ────────────────────────────────────────────────────────────────────────────
 * STEP 1 — Scelta tipo iscrizione
 * ─────────────────────────────────────────────────────────────────────────── */

function Step1ScegliTipo({ selectedSigla, onSelect, onCrea, onEsci }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header tema gestionale (violet) */}
      <div className="rounded-t-lg border border-b-0 border-violet-200 bg-gradient-to-r from-violet-100 to-violet-50 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📋</span>
          <div>
            <h3 className="text-base font-bold text-violet-900">
              Registrazione Nuova Iscrizione
            </h3>
            <p className="text-xs text-violet-700">
              Seleziona il tipo di iscrizione da registrare (16 tipologie GeCA)
            </p>
          </div>
        </div>
      </div>

      {/* Corpo con le 16 opzioni su 2 colonne */}
      <div className="flex-1 overflow-y-auto border-x border-violet-200 bg-white px-5 py-4">
        <div className="grid grid-cols-1 gap-x-4 gap-y-2 md:grid-cols-2">
          {/* Colonna sinistra */}
          <div className="space-y-1.5">
            {COL_L.map((t) => (
              <TipoRadio
                key={t.sigla}
                tipo={t}
                checked={selectedSigla === t.sigla}
                onSelect={() => onSelect(t.sigla)}
              />
            ))}
          </div>
          {/* Colonna destra */}
          <div className="space-y-1.5">
            {COL_R.map((t) => (
              <TipoRadio
                key={t.sigla}
                tipo={t}
                checked={selectedSigla === t.sigla}
                onSelect={() => onSelect(t.sigla)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Footer: bottone esci + bottone CREA */}
      <div className="flex items-center justify-between rounded-b-lg border border-t-0 border-violet-200 bg-slate-50 px-5 py-3">
        <button
          type="button"
          onClick={onEsci}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-100"
        >
          ← Annulla
        </button>
        <div className="flex items-center gap-3">
          {selectedSigla ? (
            <span className="text-xs text-slate-600">
              Tipo selezionato:{" "}
              <strong className="text-violet-700">
                {TIPI_ISCRIZIONE.find((t) => t.sigla === selectedSigla)?.label || selectedSigla}
              </strong>
            </span>
          ) : (
            <span className="text-xs italic text-slate-500">
              Seleziona una tipologia dall'elenco
            </span>
          )}
          <button
            type="button"
            onClick={onCrea}
            disabled={!selectedSigla}
            className="rounded-md bg-violet-600 px-5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            title={selectedSigla ? "Crea iscrizione" : "Seleziona prima un tipo"}
          >
            ▶ CREA ISCRIZIONE
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * TipoRadio — Singolo radio button nel Wizard (tema gestionale chiaro).
 * Bordo violet su selezione + icona, label, sottodescrizione.
 */
function TipoRadio({ tipo, checked, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-all ${
        checked
          ? "border-violet-500 bg-violet-50 shadow-sm ring-1 ring-violet-300"
          : "border-slate-200 bg-white hover:border-violet-300 hover:bg-violet-50/40"
      }`}
      title={tipo.desc}
    >
      {/* Radio indicator */}
      <div
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
          checked ? "border-violet-600 bg-violet-600" : "border-slate-300 bg-white"
        }`}
      >
        {checked ? (
          <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        ) : null}
      </div>
      <span className="text-xl leading-none">{tipo.icon}</span>
      <div className="min-w-0 flex-1">
        <div
          className={`text-sm font-semibold ${
            checked ? "text-violet-900" : "text-slate-800"
          }`}
        >
          {tipo.label}
        </div>
        <div className="truncate text-[10px] text-slate-500">{tipo.desc}</div>
      </div>
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
          checked ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-600"
        }`}
      >
        {tipo.sigla}
      </span>
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * STEP 2 — Form specializzato dinamico
 * ─────────────────────────────────────────────────────────────────────────── */

function Step2FormSpecializzato({
  sigla,
  editor,
  setEditor,
  saving,
  trasmettendo,
  onSave,
  onTrasmetti,
  onStampa,
  onBack,
  onAnnulla,
}) {
  const entry = GECA_FORM_MAP[sigla];
  if (!entry) {
    return (
      <div className="rounded-lg border-2 border-red-400 bg-red-50 p-6">
        <h3 className="text-lg font-bold text-red-700">Errore: tipo iscrizione non riconosciuto</h3>
        <p className="mt-2 text-sm text-red-600">
          La sigla <code className="font-mono">{String(sigla)}</code> non è presente nella mappa
          GECA_FORM_MAP di <code>forms/index.js</code>.
        </p>
        <button
          onClick={onBack}
          className="mt-4 rounded bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-600"
        >
          ← Torna alla scelta tipo
        </button>
      </div>
    );
  }
  const { Component, props: mapProps, label } = entry;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* Barra breadcrumb con bottone back */}
      <div className="flex items-center justify-between rounded-md border border-slate-300 bg-slate-100 px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-slate-700">
          <button
            type="button"
            onClick={onBack}
            className="rounded bg-slate-300 px-2 py-1 text-[11px] font-bold text-slate-800 hover:bg-slate-400"
            title="Torna alla scelta tipo"
          >
            ← Indietro
          </button>
          <span className="text-slate-500">Tipo selezionato:</span>
          <strong className="text-slate-900">{label}</strong>
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-mono text-slate-700">
            {sigla}
          </span>
        </div>
      </div>

      {/* Form specializzato */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Component
          {...mapProps}
          editor={editor}
          setEditor={setEditor}
          onSave={onSave}
          onTrasmetti={onTrasmetti}
          onStampa={onStampa}
          onAnnulla={onAnnulla}
          saving={saving}
          trasmettendo={trasmettendo}
          isNew={true}
          modal={false}
        />
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Wizard principale
 * ─────────────────────────────────────────────────────────────────────────── */

export default function WizardNuovaIscrizione({
  open = true,
  initialSigla = null,
  initialEditor = null,
  onClose,
  onSaved,
  onSelectExistingOmonimo = null, // callback opzionale: se l'utente sceglie un omonimo esistente
}) {
  const [step, setStep] = useState(initialSigla ? 2 : 1);
  const [sigla, setSigla] = useState(initialSigla || null);
  const [editor, setEditor] = useState(() =>
    initialEditor || {
      ...buildEmptyEditor("B"),
      data_iscrizione: new Date().toISOString().slice(0, 10),
      tipo_iscrizione_sigla: initialSigla || "",
    }
  );
  const [saving, setSaving] = useState(false);
  const [trasmettendo, setTrasmettendo] = useState(false);
  const [errore, setErrore] = useState("");
  // ModalOmonimi: aperto quando il backend trova candidati con stesso cognome/nome
  const [showOmonimi, setShowOmonimi] = useState(false);

  // Etichetta del tipo corrente (da TIPI_ISCRIZIONE, se presente)
  const tipoCorrente = useMemo(
    () => TIPI_ISCRIZIONE.find((t) => t.sigla === sigla) || null,
    [sigla]
  );

  /**
   * Step1 -> Step2: aggiorna sigla nell'editor e passa allo step successivo
   */
  const handleCrea = useCallback(() => {
    if (!sigla) return;
    setEditor((prev) => ({
      ...prev,
      tipo_iscrizione_sigla: sigla,
      // Se il tipo è un "Rilascio per Esame" (tag 0), sottotipo iniziale INTERNO
      ...(sigla === "IN" ? { esame_sottotipo: "INTERNO" } : {}),
    }));
    setStep(2);
  }, [sigla]);

  const handleBackToStep1 = useCallback(() => {
    setStep(1);
    setErrore("");
  }, []);

  /**
   * Esecuzione effettiva del salvataggio (POST candidati-api) — chiamato
   * dopo la validazione + check omonimi.
   */
  const doActualSave = useCallback(async () => {
    setErrore("");
    setSaving(true);
    try {
      // Payload: include il tipo_iscrizione_sigla (e tipo_iscrizione descrittivo)
      const basePayload = mapCandidateForSave(editor, {
        tipo_iscrizione_sigla: sigla,
        tipo_iscrizione_label: tipoCorrente?.label || "",
      });
      const payload = {
        ...basePayload,
        stato_iscrizione: "attivo",
        tipo_iscrizione_sigla: sigla,
        tipo_iscrizione: tipoCorrente?.label || "",
        raw_portale: {
          ...basePayload.raw_portale,
          tipo_iscrizione_sigla: sigla,
          tipo_iscrizione_label: tipoCorrente?.label || "",
          // Metadati specifici del form
          esame_sottotipo: editor.esame_sottotipo || null,
          dup_modo: editor.dup_modo || null,
          cqc_variante: editor.cqc_variante || null,
          tipo_corso: editor.tipo_corso || null,
          altro_sottotipo: editor.altro_sottotipo || null,
          // Campi specifici preservati integralmente
          ...editor,
        },
      };

      const res = await fetch(`${API_BASE}/api/candidati-api`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Errore ${res.status}`);
      }
      const saved = await res.json();
      onSaved?.(saved);
      onClose?.();
    } catch (err) {
      setErrore(`Errore salvataggio: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }, [editor, sigla, tipoCorrente, onSaved, onClose]);

  /**
   * Salvataggio al backend candidati-api (POST, come ModalNuovaIscrizione).
   * Esegue prima validazione e controllo omonimi: se esistono candidati con
   * stesso cognome+nome+data_nascita, apre ModalOmonimi per far scegliere
   * all'utente se selezionare uno esistente oppure procedere col nuovo.
   */
  const handleSave = useCallback(async () => {
    setErrore("");
    // Validazione minima
    if (!editor.cognome?.trim() || !editor.nome?.trim()) {
      setErrore("Cognome e Nome sono obbligatori");
      return;
    }
    if (!editor.codice_fiscale?.trim() || editor.codice_fiscale.length !== 16) {
      setErrore("Codice fiscale obbligatorio (16 caratteri)");
      return;
    }

    // Controllo omonimi (non bloccante: se trova risultati apre la modale;
    // se fallisce l'endpoint, procede al salvataggio)
    try {
      const resOm = await fetch(`${API_BASE}/api/candidati-api/omonimi`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          cognome: editor.cognome,
          nome: editor.nome,
          data_nascita: editor.data_nascita,
          exact: true,
        }),
      });
      if (resOm.ok) {
        const om = await resOm.json();
        const count = om?.count || om?.omonimi?.length || 0;
        if (count > 0) {
          // Apre la ModalOmonimi (che ri-esegue la stessa ricerca)
          setShowOmonimi(true);
          return;
        }
      }
    } catch (_) {
      /* omonimi non bloccanti: se endpoint fallisce procede al save */
    }

    // Nessun omonimo: procedi con salvataggio effettivo
    await doActualSave();
  }, [editor, doActualSave]);

  /**
   * Callback ModalOmonimi: l'utente clicca "Procedi comunque" -> salva
   * il nuovo candidato ignorando gli omonimi.
   */
  const handleOmonimiProceed = useCallback(async () => {
    setShowOmonimi(false);
    await doActualSave();
  }, [doActualSave]);

  /**
   * Callback ModalOmonimi: l'utente seleziona un candidato esistente.
   * Chiude wizard e delega al parent la gestione (apertura in modifica).
   */
  const handleOmonimiSelect = useCallback(
    (candidato) => {
      setShowOmonimi(false);
      if (typeof onSelectExistingOmonimo === "function") {
        onSelectExistingOmonimo(candidato);
      }
      onClose?.();
    },
    [onSelectExistingOmonimo, onClose]
  );

  /**
   * Trasmissione al CED (placeholder: usa stessa logica salvataggio ma con flag)
   * TODO FASE 6: implementare endpoint dedicato /api/candidati-api/trasmetti
   */
  const handleTrasmetti = useCallback(async () => {
    setErrore("");
    if (!window.confirm("Confermi la trasmissione al CED / Portale?")) return;
    setTrasmettendo(true);
    try {
      await handleSave();
      // TODO: chiamata a endpoint trasmissione quando disponibile (Fase 6/7)
      // Per ora il salvataggio è sufficiente, la trasmissione sarà gestita dalla /trasmissione-pratiche
    } finally {
      setTrasmettendo(false);
    }
  }, [handleSave]);

  /**
   * Stampa: TODO Fase 4 (stampa PDF scheda completa)
   */
  const handleStampa = useCallback(() => {
    window.print();
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[95vh] w-full max-w-6xl flex-col rounded-xl bg-white shadow-2xl ring-1 ring-slate-200">
        {/* Header con gradient violet (tema gestionale) */}
        <div className="flex items-center justify-between rounded-t-xl border-b border-violet-200 bg-gradient-to-r from-violet-700 to-violet-600 px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 text-lg">
              📋
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">
                Registra Nuova Iscrizione
                {step === 2 && tipoCorrente && (
                  <span className="ml-2 font-normal text-violet-100">
                    — {tipoCorrente.label}
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-violet-200">
                {step === 1
                  ? "Passo 1 di 2 — Scegli il tipo di iscrizione"
                  : "Passo 2 di 2 — Compila i dati dell'iscrizione"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-violet-100 transition hover:bg-violet-800 hover:text-white"
            title="Chiudi wizard"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Banner errore globale */}
        {errore && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            <strong>⚠️ {errore}</strong>
          </div>
        )}

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50 p-4">
          {step === 1 ? (
            <Step1ScegliTipo
              selectedSigla={sigla}
              onSelect={setSigla}
              onCrea={handleCrea}
              onEsci={onClose}
            />
          ) : (
            <Step2FormSpecializzato
              sigla={sigla}
              editor={editor}
              setEditor={setEditor}
              saving={saving}
              trasmettendo={trasmettendo}
              onSave={handleSave}
              onTrasmetti={handleTrasmetti}
              onStampa={handleStampa}
              onBack={handleBackToStep1}
              onAnnulla={onClose}
            />
          )}
        </div>
      </div>

      {/* ModalOmonimi — aperta quando si tenta di salvare con cognome+nome gia' presenti */}
      <ModalOmonimi
        open={showOmonimi}
        onClose={() => setShowOmonimi(false)}
        initialCognome={editor.cognome || ""}
        initialNome={editor.nome || ""}
        initialDataNascita={editor.data_nascita || ""}
        autoSearchOnOpen={true}
        showProceedButton={true}
        onProceedAnyway={handleOmonimiProceed}
        onSelectCandidate={handleOmonimiSelect}
        title="⚠️ Candidati con stesso cognome/nome trovati"
      />
    </div>
  );
}

/**
 * Esportazione alternativa: modalità "a pagina intera" senza overlay modale.
 * Utile per usi embedded dentro /anagrafica-iscrizioni/nuova.
 */
export function WizardNuovaIscrizioneInline(props) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <WizardNuovaIscrizione {...props} open={true} />
    </div>
  );
}

/**
 * Export delle mappe di tipo iscrizione per riuso da altre parti del sistema
 * (es. routing Edit, scheda riepilogativa).
 */
export { TIPI_ISCRIZIONE };

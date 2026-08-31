/**
 * index.js — Barrel export per i 9 form iscrizione specializzati GeCA.
 *
 * Corrispondenza sigle GeCA ↔ Form React (replica fedele di anagrafe.cs
 * CellDoubleClick routing):
 *
 *   IN, PR, RE       -> IscrEsameForm
 *   CV               -> IscrRinnovoForm
 *   D|, Y|, L|, S|, R| -> IscrDupForm (modo=DUPLICATO)
 *   M|, E|           -> IscrDupForm (modo=CONVERSIONE)
 *   PC               -> IscrPATCQCForm (variante=PATENTE)
 *   CC               -> IscrPATCQCForm (variante=CARD)
 *   CM               -> IscrCerMedForm
 *   GA               -> IscrGUIACCForm
 *   PN               -> IscrNautForm
 *   RP, CQ, CK, CA   -> IscrCorsoForm (tipoCorso dedotto)
 *   EG, AD, PI, PP   -> IscrAltroForm (sottotipo dedotto)
 */

export { default as IscrEsameForm } from "./IscrEsameForm";
export { default as IscrRinnovoForm } from "./IscrRinnovoForm";
export { default as IscrDupForm } from "./IscrDupForm";
export { default as IscrPATCQCForm } from "./IscrPATCQCForm";
export { default as IscrCerMedForm } from "./IscrCerMedForm";
export { default as IscrGUIACCForm } from "./IscrGUIACCForm";
export { default as IscrCorsoForm } from "./IscrCorsoForm";
export { default as IscrNautForm } from "./IscrNautForm";
export { default as IscrAltroForm } from "./IscrAltroForm";

export * from "./SharedFields";

/**
 * Mappa sigla GeCA → { component, props }
 * Usata per il routing CellDoubleClick su anagrafe griglia.
 */
import IscrEsameForm from "./IscrEsameForm";
import IscrRinnovoForm from "./IscrRinnovoForm";
import IscrDupForm from "./IscrDupForm";
import IscrPATCQCForm from "./IscrPATCQCForm";
import IscrCerMedForm from "./IscrCerMedForm";
import IscrGUIACCForm from "./IscrGUIACCForm";
import IscrCorsoForm from "./IscrCorsoForm";
import IscrNautForm from "./IscrNautForm";
import IscrAltroForm from "./IscrAltroForm";

export const GECA_FORM_MAP = {
  // Conseguimento per esame
  IN: { Component: IscrEsameForm, props: {}, label: "Interno" },
  PR: { Component: IscrEsameForm, props: {}, label: "Privatista" },
  RE: { Component: IscrEsameForm, props: {}, label: "Revisione" },
  // Conferma validita' (rinnovo)
  CV: { Component: IscrRinnovoForm, props: {}, label: "Rinnovo Patente" },
  // Duplicato
  "D|": { Component: IscrDupForm, props: { modo: "DUPLICATO" }, label: "Duplicato (Smarrimento)" },
  "Y|": { Component: IscrDupForm, props: { modo: "DUPLICATO" }, label: "Duplicato (Sottrazione)" },
  "L|": { Component: IscrDupForm, props: { modo: "DUPLICATO" }, label: "Duplicato (Riclassif.)" },
  "S|": { Component: IscrDupForm, props: { modo: "DUPLICATO" }, label: "Duplicato (Deterior.)" },
  "R|": { Component: IscrDupForm, props: { modo: "DUPLICATO" }, label: "Duplicato (Altro)" },
  // Conversione
  "M|": { Component: IscrDupForm, props: { modo: "CONVERSIONE" }, label: "Conversione Militare" },
  "E|": { Component: IscrDupForm, props: { modo: "CONVERSIONE" }, label: "Conversione Estera" },
  // Patente CQC
  PC: { Component: IscrPATCQCForm, props: { variante: "PATENTE" }, label: "Patente CQC" },
  CC: { Component: IscrPATCQCForm, props: { variante: "CARD" }, label: "CQC Card" },
  // Certificato Medico
  CM: { Component: IscrCerMedForm, props: {}, label: "Certificato Medico" },
  // Guida Accompagnata
  GA: { Component: IscrGUIACCForm, props: {}, label: "Guida Accompagnata" },
  // Patente Nautica
  PN: { Component: IscrNautForm, props: {}, label: "Patente Nautica" },
  // Corsi
  RP: { Component: IscrCorsoForm, props: { tipoCorso: "RECUPERO_PUNTI" }, label: "Recupero Punti" },
  CQ: { Component: IscrCorsoForm, props: { tipoCorso: "CQC" }, label: "Corso CQC" },
  CK: { Component: IscrCorsoForm, props: { tipoCorso: "CAP" }, label: "Corso CAP" },
  CA: { Component: IscrCorsoForm, props: { tipoCorso: "ADR" }, label: "Corso ADR" },
  // Altri
  EG: { Component: IscrAltroForm, props: { sottotipo: "ESERCITAZIONE_GUIDA" }, label: "Esercitazione Guida" },
  AD: { Component: IscrAltroForm, props: { sottotipo: "ARCHIVIO_DATI" }, label: "Archivio Dati" },
  PI: { Component: IscrAltroForm, props: { sottotipo: "PERMESSO_INTERNAZIONALE" }, label: "Permesso Internazionale" },
  PP: { Component: IscrAltroForm, props: { sottotipo: "PERMESSO_PROVVISORIO" }, label: "Permesso Provvisorio" },
};

/**
 * Risolve il form da aprire dato:
 * - tipo_iscrizione_sigla (preferito)
 * - oppure stringa tipo_iscrizione descrittiva (fallback matching)
 *
 * Ritorna { Component, props, sigla, label } oppure null se non trovato.
 */
export function resolveFormByTipoIscrizione(row = {}) {
  // 1. Match diretto per sigla
  const sigla = (row.tipo_iscrizione_sigla || row.eleTipoIscrizione || "").trim();
  if (sigla && GECA_FORM_MAP[sigla]) {
    return { sigla, ...GECA_FORM_MAP[sigla] };
  }

  // 2. Match per stringa descrittiva (GeCA TIPO_ISCRIZIONE_OPTIONS)
  const tipo = String(row.tipo_iscrizione || row.stato_iscrizione || "").toUpperCase().trim();
  if (!tipo) return null;

  if (tipo.includes("INTERNO")) return { sigla: "IN", ...GECA_FORM_MAP.IN };
  if (tipo.includes("PRIVATISTA")) return { sigla: "PR", ...GECA_FORM_MAP.PR };
  if (tipo.includes("REVISIONE")) return { sigla: "RE", ...GECA_FORM_MAP.RE };
  if (tipo.includes("RILASCIO PER ESAM")) return { sigla: "IN", ...GECA_FORM_MAP.IN };
  if (tipo.includes("CONFERMA") || tipo.includes("RINNOVO")) return { sigla: "CV", ...GECA_FORM_MAP.CV };
  if (tipo.includes("DUPLICATO") || tipo.includes("SMARRIM")) return { sigla: "D|", ...GECA_FORM_MAP["D|"] };
  if (tipo.includes("CONVERSIONE")) return { sigla: "M|", ...GECA_FORM_MAP["M|"] };
  if (tipo.includes("CQC CARD")) return { sigla: "CC", ...GECA_FORM_MAP.CC };
  if (tipo.includes("PATENTE CQC") || tipo.includes("PATENTE C.Q.C")) return { sigla: "PC", ...GECA_FORM_MAP.PC };
  if (tipo.includes("CERTIFICATO MEDICO")) return { sigla: "CM", ...GECA_FORM_MAP.CM };
  if (tipo.includes("GUIDA ACCOMPAGNATA")) return { sigla: "GA", ...GECA_FORM_MAP.GA };
  if (tipo.includes("NAUTICA")) return { sigla: "PN", ...GECA_FORM_MAP.PN };
  if (tipo.includes("RECUPERO PUNTI")) return { sigla: "RP", ...GECA_FORM_MAP.RP };
  if (tipo.includes("CORSO C.Q.C") || tipo.includes("CORSO CQC")) return { sigla: "CQ", ...GECA_FORM_MAP.CQ };
  if (tipo.includes("C.A.P") || tipo.includes("CAP")) return { sigla: "CK", ...GECA_FORM_MAP.CK };
  if (tipo.includes("A.D.R") || tipo.includes("ADR")) return { sigla: "CA", ...GECA_FORM_MAP.CA };
  if (tipo.includes("ESERCITAZIONE GUIDA")) return { sigla: "EG", ...GECA_FORM_MAP.EG };
  if (tipo.includes("ARCHIVIO DATI")) return { sigla: "AD", ...GECA_FORM_MAP.AD };
  if (tipo.includes("PERMESSO INTERN")) return { sigla: "PI", ...GECA_FORM_MAP.PI };
  if (tipo.includes("PERMESSO PROVV")) return { sigla: "PP", ...GECA_FORM_MAP.PP };

  return null;
}

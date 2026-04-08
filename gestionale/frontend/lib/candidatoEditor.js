/**
 * Helper per editor candidato (GeCA: anagrafe, nuovaiscr, dettaglio).
 * Condiviso tra Candidati e Anagrafica Iscrizioni.
 */

/** Formatta una data per la visualizzazione in tabella (locale it-IT). */
export function formatData(value) {
  if (!value) return "–";
  const d =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)
      ? value.slice(0, 10)
      : value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d))
    return new Date(d + "Z").toLocaleDateString("it-IT");
  return String(value).slice(0, 12) || "–";
}

export function toInputDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const text = String(value).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
  }
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function buildEmptyEditor(practiceType = "B") {
  return {
    nome: "",
    cognome: "",
    diacritici: "",
    codice_fiscale: "",
    categoria_patente: practiceType,
    patente_numero: "",
    data_iscrizione: "",
    codice_autoscuola: "",
    numero_registro: "",
    data_registro: "",
    stato_richiesta: "",
    stato_richiesta_testo: "",
    sesso: "M",
    data_nascita: "",
    comune_nascita: "",
    prov_nascita: "",
    stato_estero_nascita: "",
    localita_estera_nascita: "",
    sigla_nascita: "",
    cittadinanza: "ITALIANA",
    localita_residenza: "",
    toponimo_residenza: "",
    indirizzo_residenza: "",
    numero_civico: "",
    comune_residenza: "",
    prov_residenza: "",
    cap_residenza: "",
    ubicazione_uno: "",
    ubicazione_due: "",
    telefono_1: "",
    telefono_2: "",
    email_contatto: "",
    tipo_documento: "",
    numero_documento: "",
    ente_rilascio_documento: "",
    rilasciato_il_documento: "",
    scade_il_documento: "",
    numero_patente_posseduta: "",
    ente_rilascio_patente: "",
    rilasciata_il_patente: "",
    scade_il_patente: "",
    foto_data_url: "",
    firma_data_url: "",
    note: "",
    ppg_numero: "",
    ppg_data_emissione: "",
    ppg_data_scadenza: "",
    presenze_a2_a: "",
    acquisition_mode: "portale",
    portal_cognome: "",
    portal_numero_patente: "",
    portal_protocollo_cert_medico: "",
    portal_marca_operativa: "",
    ncf_mobile: "",
    capture_remote_token: "",
    capture_remote_link: "",
    capture_remote_last_sync: "",
    documenti_acquisiti: [],
  };
}

export function extractExtendedEditor(row = {}) {
  // Legge prima dalle colonne DB dirette, poi da raw_portale.anagrafica come fallback
  const anagrafica = row?.raw_portale?.anagrafica || {};
  const documentiAcquisiti = Array.isArray(row?.raw_portale?.documenti_acquisiti)
    ? row.raw_portale.documenti_acquisiti
    : [];
  return {
    nome: row.nome || "",
    cognome: row.cognome || "",
    diacritici: anagrafica.diacritici || "",
    codice_fiscale: row.codice_fiscale || "",
    categoria_patente: row.categoria_patente || anagrafica.categoria_patente || "B",
    patente_numero: row.patente_numero || anagrafica.patente_numero || "",
    // Data iscrizione: colonna DB > raw_portale > created_at
    data_iscrizione: toInputDate(row.data_iscrizione || anagrafica.data_iscrizione || row.created_at),
    codice_autoscuola: row.codice_autoscuola || anagrafica.codice_autoscuola || row.autoscuola_codice || "",
    numero_registro: anagrafica.numero_registro || "",
    data_registro: toInputDate(anagrafica.data_registro),
    stato_richiesta: anagrafica.stato_richiesta || row.richiesta || row.stato || "",
    // Sesso: colonna DB > raw_portale
    sesso: row.sesso || anagrafica.sesso || "M",
    // Nascita: colonne DB > raw_portale
    data_nascita: toInputDate(row.data_nascita || anagrafica.data_nascita),
    comune_nascita: row.comune_nascita || anagrafica.comune_nascita || "",
    prov_nascita: row.provincia_nascita || anagrafica.prov_nascita || "",
    stato_estero_nascita: anagrafica.stato_estero_nascita || "",
    localita_estera_nascita: anagrafica.localita_estera_nascita || "",
    sigla_nascita: anagrafica.sigla_nascita || "",
    // Cittadinanza: colonna DB > raw_portale
    cittadinanza: row.cittadinanza || anagrafica.cittadinanza || "ITALIANA",
    // Residenza: colonne DB > raw_portale
    localita_residenza: anagrafica.localita_residenza || "",
    toponimo_residenza: anagrafica.toponimo_residenza || "",
    indirizzo_residenza: row.indirizzo || anagrafica.indirizzo_residenza || "",
    numero_civico: anagrafica.numero_civico || "",
    comune_residenza: row.comune || anagrafica.comune_residenza || "",
    prov_residenza: row.provincia || anagrafica.prov_residenza || "",
    cap_residenza: row.cap || anagrafica.cap_residenza || "",
    ubicazione_uno: anagrafica.ubicazione_uno || "",
    ubicazione_due: anagrafica.ubicazione_due || "",
    // Contatti: colonne DB > raw_portale
    telefono_1: row.telefono_1 || anagrafica.telefono_1 || row.telefono || row.telefono_cellulare || row.cellulare || "",
    telefono_2: anagrafica.telefono_2 || "",
    email_contatto: row.email_contatto || anagrafica.email_contatto || row.email || "",
    // Documento: colonne DB > raw_portale
    tipo_documento: row.tipo_documento || anagrafica.tipo_documento || "",
    numero_documento: row.numero_documento || anagrafica.numero_documento || "",
    ente_rilascio_documento: row.luogo_rilascio_doc || anagrafica.ente_rilascio_documento || "",
    rilasciato_il_documento: toInputDate(row.data_rilascio_doc || anagrafica.rilasciato_il_documento),
    scade_il_documento: toInputDate(row.scade_il_documento || anagrafica.scade_il_documento),
    // Patente
    numero_patente_posseduta: anagrafica.numero_patente_posseduta || "",
    ente_rilascio_patente: anagrafica.ente_rilascio_patente || "",
    rilasciata_il_patente: toInputDate(anagrafica.rilasciata_il_patente),
    scade_il_patente: toInputDate(row.scade_il_patente || anagrafica.scade_il_patente),
    // Media
    foto_data_url: row?.raw_portale?.foto_data_url || row?.foto_data_url || "",
    firma_data_url: row?.raw_portale?.firma_data_url || row?.firma_data_url || "",
    // Note: colonna DB > raw_portale
    note: row.note || row?.raw_portale?.note || "",
    // PPG / foglio rosa: colonna DB > raw_portale
    ppg_numero: row?.raw_portale?.ppg_numero || "",
    ppg_data_emissione: toInputDate(row?.raw_portale?.ppg_data_emissione),
    ppg_data_scadenza: toInputDate(row.ppg_data_scadenza || row?.raw_portale?.ppg_data_scadenza),
    presenze_a2_a: row?.raw_portale?.presenze_a2_a || "",
    // Pratiche CED
    marca_operativa: row.marca_operativa || anagrafica.portal_marca_operativa || "",
    codice_statino: row.codice_statino || "",
    // Portale
    codice_candidato: row.codice_candidato || "",
    turno_prefer: row.turno_prefer || anagrafica.turno_prefer || "",
    lingua: row.lingua || anagrafica.lingua || "",
    supporto_audio: row.supporto_audio || false,
    // Metadati portale
    acquisition_mode: anagrafica.acquisition_mode || "portale",
    portal_cognome: anagrafica.portal_cognome || "",
    portal_numero_patente: anagrafica.portal_numero_patente || "",
    portal_protocollo_cert_medico: anagrafica.portal_protocollo_cert_medico || "",
    portal_marca_operativa: row.marca_operativa || anagrafica.portal_marca_operativa || "",
    ncf_mobile: anagrafica.ncf_mobile || "",
    capture_remote_token: anagrafica.capture_remote_token || "",
    capture_remote_link: anagrafica.capture_remote_link || "",
    capture_remote_last_sync: anagrafica.capture_remote_last_sync || "",
    documenti_acquisiti: documentiAcquisiti,
  };
}

/**
 * Payload per POST/PUT candidato (backend accetta nome, cognome, codice_fiscale, categoria_patente, telefono, email, raw_portale).
 */
export function mapCandidateForSave(data = {}, editorBaseRawPortale = {}) {
  const documentiAcquisiti = Array.isArray(data.documenti_acquisiti) ? data.documenti_acquisiti : [];
  const anagrafica = {
    data_iscrizione: String(data.data_iscrizione || "").trim() || null,
    codice_autoscuola: String(data.codice_autoscuola || "").trim(),
    numero_registro: String(data.numero_registro || "").trim(),
    data_registro: String(data.data_registro || "").trim() || null,
    stato_richiesta: String(data.stato_richiesta || "").trim(),
    stato_richiesta_testo: String(data.stato_richiesta_testo || "").trim(),
    sesso: String(data.sesso || "").trim(),
    diacritici: String(data.diacritici || "").trim(),
    data_nascita: String(data.data_nascita || "").trim() || null,
    comune_nascita: String(data.comune_nascita || "").trim(),
    prov_nascita: String(data.prov_nascita || "").trim(),
    stato_estero_nascita: String(data.stato_estero_nascita || "").trim(),
    localita_estera_nascita: String(data.localita_estera_nascita || "").trim(),
    sigla_nascita: String(data.sigla_nascita || "").trim(),
    cittadinanza: String(data.cittadinanza || "").trim(),
    localita_residenza: String(data.localita_residenza || "").trim(),
    toponimo_residenza: String(data.toponimo_residenza || "").trim(),
    indirizzo_residenza: String(data.indirizzo_residenza || "").trim(),
    numero_civico: String(data.numero_civico || "").trim(),
    comune_residenza: String(data.comune_residenza || "").trim(),
    prov_residenza: String(data.prov_residenza || "").trim(),
    cap_residenza: String(data.cap_residenza || "").trim(),
    ubicazione_uno: String(data.ubicazione_uno || "").trim(),
    ubicazione_due: String(data.ubicazione_due || "").trim(),
    telefono_1: String(data.telefono_1 || "").trim(),
    telefono_2: String(data.telefono_2 || "").trim(),
    email_contatto: String(data.email_contatto || "").trim(),
    tipo_documento: String(data.tipo_documento || "").trim(),
    numero_documento: String(data.numero_documento || "").trim(),
    ente_rilascio_documento: String(data.ente_rilascio_documento || "").trim(),
    rilasciato_il_documento: String(data.rilasciato_il_documento || "").trim() || null,
    scade_il_documento: String(data.scade_il_documento || "").trim() || null,
    numero_patente_posseduta: String(data.numero_patente_posseduta || "").trim(),
    ente_rilascio_patente: String(data.ente_rilascio_patente || "").trim(),
    rilasciata_il_patente: String(data.rilasciata_il_patente || "").trim() || null,
    scade_il_patente: String(data.scade_il_patente || "").trim() || null,
    categoria_patente: String(data.categoria_patente || "").trim() || "B",
    patente_numero: String(data.patente_numero || "").trim(),
    acquisition_mode: String(data.acquisition_mode || "").trim(),
    portal_cognome: String(data.portal_cognome || "").trim(),
    portal_numero_patente: String(data.portal_numero_patente || "").trim(),
    portal_protocollo_cert_medico: String(data.portal_protocollo_cert_medico || "").trim(),
    portal_marca_operativa: String(data.portal_marca_operativa || "").trim(),
    ncf_mobile: String(data.ncf_mobile || "").trim(),
    capture_remote_token: String(data.capture_remote_token || "").trim(),
    capture_remote_link: String(data.capture_remote_link || "").trim(),
    capture_remote_last_sync: String(data.capture_remote_last_sync || "").trim(),
  };
  const s = (v) => String(v || "").trim() || null;

  return {
    // Campi top-level obbligatori
    nome: String(data.nome || "").trim(),
    cognome: String(data.cognome || "").trim(),
    codice_fiscale: String(data.codice_fiscale || "").trim(),
    categoria_patente: String(data.categoria_patente || "").trim() || "B",
    // Contatti (duplicati sia in top-level che in raw_portale per compatibilità)
    telefono: s(data.telefono_1 || data.telefono),
    email: s(data.email_contatto || data.email),
    telefono_1: s(data.telefono_1),
    email_contatto: s(data.email_contatto),
    // Anagrafica top-level (nuove colonne DB)
    sesso: s(data.sesso),
    data_nascita: s(data.data_nascita),
    comune_nascita: s(data.comune_nascita),
    provincia_nascita: s(data.prov_nascita),
    cittadinanza: s(data.cittadinanza),
    indirizzo: s(data.indirizzo_residenza),
    cap: s(data.cap_residenza),
    comune: s(data.comune_residenza),
    provincia: s(data.prov_residenza),
    // Documento
    tipo_documento: s(data.tipo_documento),
    numero_documento: s(data.numero_documento),
    luogo_rilascio_doc: s(data.ente_rilascio_documento),
    data_rilascio_doc: s(data.rilasciato_il_documento),
    scade_il_documento: s(data.scade_il_documento),
    // Patente / PPG
    scade_il_patente: s(data.scade_il_patente),
    ppg_data_scadenza: s(data.ppg_data_scadenza),
    // Pratiche
    codice_autoscuola: s(data.codice_autoscuola),
    marca_operativa: s(data.marca_operativa || data.portal_marca_operativa),
    codice_statino: s(data.codice_statino),
    data_iscrizione: s(data.data_iscrizione),
    // Portale
    codice_candidato: s(data.codice_candidato),
    turno_prefer: s(data.turno_prefer),
    lingua: s(data.lingua),
    supporto_audio: !!data.supporto_audio,
    // Stato iscrizione
    stato_iscrizione: s(data.stato_iscrizione),
    // Patente extra
    categoria_richiesta: s(data.categoria_richiesta || data.categoria_patente),
    cambio_automatico: !!data.cambio_automatico,
    // Visita medica
    data_visita_medica: s(data.data_visita_medica),
    codice_iscrizione_medico: s(data.codice_iscrizione_medico),
    luogo_visita_medica: s(data.luogo_visita_medica),
    // Note
    note: s(data.note),
    // Timestamp
    updated_at: new Date().toISOString(),
    // raw_portale per compatibilità con campi non ancora in colonne DB
    raw_portale: {
      ...editorBaseRawPortale,
      foto_data_url: String(data.foto_data_url || "").trim() || null,
      firma_data_url: String(data.firma_data_url || "").trim() || null,
      note: String(data.note || "").trim() || null,
      ppg_numero: String(data.ppg_numero || "").trim() || null,
      ppg_data_emissione: String(data.ppg_data_emissione || "").trim() || null,
      ppg_data_scadenza: String(data.ppg_data_scadenza || "").trim() || null,
      presenze_a2_a: String(data.presenze_a2_a || "").trim() || null,
      documenti_acquisiti: documentiAcquisiti,
      anagrafica,
    },
  };
}

export const PATENTE_RICHIESTA_OPTIONS = ["A1", "A2", "A", "B", "BE", "C", "CE", "D", "DE", "CQC", "ADR", "NAUTICA"];
/** Opzioni tipo documento (GeCA: TIPO DOCUMENTO – SELEZIONARE, CARTA IDENTITÀ, PASSAPORTO, ecc.) */
export const TIPO_DOCUMENTO_OPTIONS = ["CARTA IDENTITÀ", "PATENTE", "PASSAPORTO", "PERMESSO DI SOGGIORNO", "MODELLI AT/BT", "ALTRO"];
/** Tipo percorso breve (Interno, Privatista, Revisione) */
export const TIPO_PERCORSO_OPTIONS = ["Interno", "Privatista", "Revisione"];
/** Opzioni TIPO ISCRIZIONE per form Nuova Iscrizione (GeCA: Registrazione Nuova Iscrizione) */
export const TIPO_ISCRIZIONE_OPTIONS = [
  "",
  "Rilascio per Esami: Interno - Privatista - Revisione",
  "Conferma di Validità (Rinnovo Patente)",
  "Duplicato per: Smarrim. - Riclassif. - Deterioram. - Altro",
  "Conversione Patente: Militare - Estera",
  "Patente CQC: Utenti Italiani",
  "CQC CARD: Utenti Stranieri",
  "Archivio Dati",
  "Esercitazione Guida",
  "Recupero Punti",
  "Permesso Intern.le di Guida",
  "Guida Accompagnata",
  "Corso C.Q.C.",
  "Certificato Medico (per non iscritti)",
  "Permesso Provv. di Guida",
  "Corso A.D.R.",
  "Patente Nautica",
  "INTERNO",
  "PRIVATISTA",
  "REVISIONE",
];

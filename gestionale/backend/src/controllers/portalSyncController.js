/**
 * portalSyncController.js
 * =======================
 * Controller REST per lettura dati dal Portale dell'Automobilista:
 *
 *   GET  /api/portal-sync/patente-posseduta       — Punto 9: dati patente
 *   GET  /api/portal-sync/esami-svolti            — Punto 10: esiti esami
 *   GET  /api/portal-sync/esami-candidato         — Punto 11: esami prenotati candidato
 *   GET  /api/portal-sync/rinnovi-attivi          — Punto 12: rinnovi attivi
 *   GET  /api/portal-sync/ricevuta-sostitutiva    — Punto 7: ricevuta sostitutiva
 *   GET  /api/portal-sync/allievi-prenotati       — Punto 14: allievi prenotati
 *   POST /api/portal-sync/salva-esiti-esame       — Salva esiti su Supabase (tabella esiti_esami)
 */

"use strict";

const supabase = require("../database/supabase");
const { getOrLoginJarFast } = require("../connector/portalSession");
const { makeHttpClient }    = require("../connector/portalHttp");
const {
  leggiDatiPatentePosseduta,
  leggiEsamiSvolti,
  leggiEsamiCandidato,
  leggiRinnoviAttivi,
  leggiRicevutaSostitutiva,
  creaRicevutaSostitutiva,
  leggiAllieviPrenotati,
  leggiCertificatoMedico,
  syncDatiCliente,
  leggiAnomaliePortale,
} = require("../connector/portalSync");

// ─── Helper: client HTTP con sessione portale ──────────────────────────────────

async function getClient(req) {
  let username = process.env.PORTAL_USER || process.env.PORTAL_USERNAME;
  let password = process.env.PORTAL_PASSWORD || process.env.PORTAL_PWD;
  let pin      = process.env.PORTAL_PIN;

  // Se l'autoscuola ha credenziali dedicate, usale
  if (req?.autoscuolaId) {
    const { data } = await supabase
      .from("autoscuole")
      .select("portal_user, portal_pass, portal_pin")
      .eq("id", req.autoscuolaId)
      .maybeSingle();
    if (data?.portal_user) {
      username = data.portal_user;
      password = data.portal_pass;
      pin      = data.portal_pin || pin;
    }
  }

  const jar = await getOrLoginJarFast({ username, password, pin });
  return makeHttpClient(jar);
}

// ─── Punto 9 — Dati patente posseduta ─────────────────────────────────────────

/**
 * GET /api/portal-sync/patente-posseduta?numeroPatente=XX
 */
async function getPatenteHandler(req, res) {
  try {
    const { numeroPatente, numero_patente } = req.query;
    const patente = numeroPatente || numero_patente;
    if (!patente) {
      return res.status(400).json({ error: "numeroPatente obbligatorio" });
    }

    const client = await getClient(req);
    const dati   = await leggiDatiPatentePosseduta(client, { numeroPatente: patente });

    // Salva su candidato se fornito il candidato_id
    const { candidato_id } = req.query;
    if (candidato_id && dati.numero_patente) {
      await supabase.from("candidates").update({
        numero_patente:   dati.numero_patente,
        data_rilascio_patente: dati.data_rilascio || null,
        data_scadenza_patente: dati.data_scadenza || null,
        categorie_patente_portale: JSON.stringify(dati.categorie || []),
      }).eq("id", candidato_id);
    }

    res.json(dati);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore lettura dati patente" });
  }
}

// ─── Punto 10 — Esiti esami svolti ────────────────────────────────────────────

/**
 * GET /api/portal-sync/esami-svolti?tipo=quiz&dataInizio=YYYY-MM-DD&dataFine=YYYY-MM-DD&withCandidati=1
 */
async function getEsamiSvoltiHandler(req, res) {
  try {
    const {
      tipo = "quiz",
      dataInizio,
      dataFine,
      withCandidati,
    } = req.query;

    const client   = await getClient(req);
    const sessioni = await leggiEsamiSvolti(client, {
      tipo,
      dataInizio,
      dataFine,
      withCandidati: withCandidati === "1" || withCandidati === "true",
    });

    res.json(sessioni);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore lettura esami svolti" });
  }
}

/**
 * POST /api/portal-sync/salva-esiti-esame
 * Salva esiti esame su Supabase (tabella esiti_esami).
 * Body: { sessione: {...}, candidati: [...] }
 */
async function salvaEsitiEsameHandler(req, res) {
  try {
    const { sessione, candidati, autoscuola_id } = req.body || {};

    if (!sessione || !Array.isArray(candidati)) {
      return res.status(400).json({ error: "sessione e candidati obbligatori" });
    }

    const autoscuolaId = autoscuola_id || req.autoscuolaId;

    // Per ogni candidato, cerca il candidato_id in Supabase tramite marca_operativa
    const records = [];
    for (const cand of candidati) {
      let candidatoId = null;
      let praticaId   = null;

      if (cand.marca_operativa) {
        const { data: pratica } = await supabase
          .from("pratiche_patente")
          .select("id, candidato_id, candidate_id")
          .or(`marca_operativa.eq.${cand.marca_operativa}`)
          .maybeSingle();
        if (pratica) {
          praticaId   = pratica.id;
          candidatoId = pratica.candidato_id || pratica.candidate_id;
        }
      }

      // Mappa esito portale → nostro valore
      const esitoMap = {
        "IDONEO":         "idoneo",
        "NON IDONEO":     "non_idoneo",
        "ASSENTE":        "assente",
        "RITIRATO":       "ritirato",
        "SOSPESO":        "sospeso",
      };
      const esitoKey = (cand.esito_esame || "").toUpperCase().trim();
      const esito = esitoMap[esitoKey] || (esitoKey.includes("IDON") ? "idoneo" : esitoKey.includes("NON") ? "non_idoneo" : null);

      records.push({
        autoscuola_id:       autoscuolaId || null,
        candidato_id:        candidatoId,
        pratica_id:          praticaId,
        data_esame:          sessione.data_verbale || null,
        tipo_esame:          sessione.tipo === "guida" ? "guida" : "teoria",
        codice_sessione:     sessione.n_verbale || sessione.id_verbale,
        sede_esame:          sessione.localita || sessione.desc_localita,
        commissione:         sessione.esaminatore || null,
        esito,
        id_verbale_portale:  sessione.id_verbale,
        data_sync_portale:   new Date().toISOString(),
        note: cand.codice_anomalia ? `Anomalia: ${cand.codice_anomalia}` : null,
      });
    }

    // Upsert con conflitto su (candidato_id, data_esame, tipo_esame)
    const { data, error } = await supabase
      .from("esiti_esami")
      .upsert(records, {
        onConflict: "candidato_id,data_esame,tipo_esame",
        ignoreDuplicates: false,
      });

    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true, salvati: records.length });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore salvataggio esiti" });
  }
}

// ─── Punto 11 — Esami guida candidato ─────────────────────────────────────────

/**
 * GET /api/portal-sync/esami-candidato?cf=XX&cognome=YY&tipo=SGOS
 */
async function getEsamiCandidatoHandler(req, res) {
  try {
    const { cf, cognome, tipo = "SGOS" } = req.query;

    if (!cf && !cognome) {
      return res.status(400).json({ error: "cf o cognome obbligatorio" });
    }

    const client = await getClient(req);
    const esami  = await leggiEsamiCandidato(client, { cf, cognome, tipo });

    res.json(esami);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore lettura esami candidato" });
  }
}

// ─── Punto 12 — Rinnovi attivi ────────────────────────────────────────────────

/**
 * GET /api/portal-sync/rinnovi-attivi?dataInizio=YYYY-MM-DD&dataFine=YYYY-MM-DD
 */
async function getRinnoviAttiviHandler(req, res) {
  try {
    const { dataInizio, dataFine, withDettaglio } = req.query;

    const client  = await getClient(req);
    const rinnovi = await leggiRinnoviAttivi(client, {
      dataInizio,
      dataFine,
      withDettaglio: withDettaglio !== "0" && withDettaglio !== "false",
    });

    res.json(rinnovi);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore lettura rinnovi attivi" });
  }
}

// ─── Punto 7 — Ricevuta sostitutiva ───────────────────────────────────────────

/**
 * GET /api/portal-sync/ricevuta-sostitutiva?cf=XX&cognome=YY&numeroPatente=ZZ
 */
async function getRicevutaSostitutivaHandler(req, res) {
  try {
    const { cf, cognome, numeroPatente } = req.query;

    const client   = await getClient(req);
    const ricevute = await leggiRicevutaSostitutiva(client, { cf, cognome, numeroPatente });

    // Salva su Supabase se trovate
    if (ricevute.length > 0) {
      for (const r of ricevute) {
        if (!r.codice_fiscale && !cf) continue;
        // Cerca candidato per CF
        const cfCand = r.codice_fiscale || cf;
        const { data: cand } = await supabase
          .from("candidates")
          .select("id, autoscuola_id")
          .eq("codice_fiscale", cfCand)
          .maybeSingle();

        if (cand) {
          await supabase.from("ricevute_sostitutive").upsert({
            candidato_id:        cand.id,
            autoscuola_id:       cand.autoscuola_id,
            numero_ricevuta:     r.numero_ricevuta,
            data_rilascio:       parsePortalDate(r.data_rilascio),
            data_scadenza:       parsePortalDate(r.data_scadenza),
            tipo_documento:      r.tipo_documento,
            data_sync_portale:   new Date().toISOString(),
            raw_portale:         JSON.stringify(r),
          }, { onConflict: "candidato_id,numero_ricevuta", ignoreDuplicates: false });
        }
      }
    }

    res.json(ricevute);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore lettura ricevuta sostitutiva" });
  }
}

// ─── Punto 14 — Allievi prenotati ─────────────────────────────────────────────

/**
 * GET /api/portal-sync/allievi-prenotati?tipo=SQI&codiceAutoscuola=0674
 */
async function getAllieviPrenotatiHandler(req, res) {
  try {
    const { tipo = "SQI", codiceAutoscuola, dataInizio, dataFine } = req.query;

    const client  = await getClient(req);
    const allievi = await leggiAllieviPrenotati(client, {
      tipo,
      codiceAutoscuola,
      dataInizio,
      dataFine,
    });

    res.json(allievi);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore lettura allievi prenotati" });
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Converte data portale "DD/MM/YYYY" → "YYYY-MM-DD" (o null)
 */
function parsePortalDate(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

// ─── Punto 8 — Certificato medico TT2112 ──────────────────────────────────────

/**
 * GET /api/portal-sync/certificato-medico?protocollo=XX&prgRicCerMed=YY
 */
async function getCertificatoMedicoHandler(req, res) {
  try {
    const { protocollo, prgRicCerMed, salva, candidato_id } = req.query;

    const client     = await getClient(req);
    const risultati  = await leggiCertificatoMedico(client, { protocollo, prgRicCerMed });

    // Salva su Supabase se richiesto
    if ((salva === "1" || salva === "true") && risultati.length > 0) {
      for (const cert of risultati) {
        let candId = candidato_id;
        if (!candId && cert.codice_fiscale) {
          const { data: cand } = await supabase
            .from("candidates")
            .select("id")
            .eq("codice_fiscale", cert.codice_fiscale)
            .maybeSingle();
          if (cand) candId = cand.id;
        }
        if (candId) {
          await supabase.from("certificati_medici").upsert({
            candidato_id:        candId,
            tipo_certificato:    "TT2112",
            numero_certificato:  cert.progressivo || cert.protocollo,
            data_rilascio:       parsePortalDate(cert.data_visita),
            medico_nome:         cert.medico,
            commissione_medica:  cert.commissione,
            id_protocollo_medico:cert.protocollo,
            data_sync_portale:   new Date().toISOString(),
            raw_portale:         JSON.stringify(cert),
          }, { onConflict: "candidato_id,id_protocollo_medico", ignoreDuplicates: false });
        }
      }
    }

    res.json(risultati);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore lettura certificato medico" });
  }
}

// ─── Punto 13 — Sync bidirezionale candidato ──────────────────────────────────

/**
 * GET /api/portal-sync/sync-candidato?cognome=XX&numeroPatente=YY&cf=ZZ
 * Recupera e salva tutti i dati disponibili per un candidato (patente + ricevuta + form).
 */
async function syncCandidatoHandler(req, res) {
  try {
    const { cognome, numeroPatente, cf, candidato_id } = req.query;

    if (!cf && !numeroPatente && !cognome) {
      return res.status(400).json({ error: "cf, numeroPatente o cognome obbligatorio" });
    }

    const client = await getClient(req);
    const dati   = await syncDatiCliente(client, { cognome, numeroPatente, cf });

    // Salva su candidato se fornito candidato_id
    if (candidato_id) {
      const updates = {};

      if (dati.patente?.numero_patente) {
        updates.numero_patente          = dati.patente.numero_patente;
        updates.data_rilascio_patente   = dati.patente.data_rilascio || null;
        updates.data_scadenza_patente   = dati.patente.data_scadenza || null;
      }
      if (dati.datiForm?.medico_data_visita) {
        updates.medico_data_visita      = dati.datiForm.medico_data_visita;
        updates.medico_iscrizione_albo  = dati.datiForm.medico_iscrizione_albo;
        updates.medico_uff_sanitario    = dati.datiForm.medico_uff_sanitario;
      }

      if (Object.keys(updates).length > 0) {
        await supabase.from("candidates").update(updates).eq("id", candidato_id);
      }

      // Salva ricevute sostitutive
      for (const r of dati.ricevute || []) {
        await supabase.from("ricevute_sostitutive").upsert({
          candidato_id,
          numero_ricevuta:    r.numero_ricevuta,
          data_rilascio:      parsePortalDate(r.data_rilascio),
          data_scadenza:      parsePortalDate(r.data_scadenza),
          tipo_documento:     r.tipo_documento,
          data_sync_portale:  new Date().toISOString(),
        }, { onConflict: "candidato_id,numero_ricevuta", ignoreDuplicates: false });
      }
    }

    res.json(dati);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore sync candidato" });
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

// ─── Generazione ricevuta sostitutiva ──────────────────────────────────────────

/**
 * POST /api/portal-sync/ricevuta-sostitutiva
 * Body: { cf, cognome, nome, numeroPatente, tipoDocumento, dataRilascio }
 * Genera una nuova ricevuta sostitutiva del documento di guida sul portale.
 */
async function postRicevutaSostitutivaHandler(req, res) {
  try {
    const { cf, cognome, nome, numeroPatente, tipoDocumento, dataRilascio } = req.body || {};
    if (!cf && !cognome) return res.status(400).json({ error: "cf o cognome obbligatorio" });

    const client  = await getClient(req);
    const result  = await creaRicevutaSostitutiva(client, {
      cf, cognome, nome, numeroPatente,
      tipoDocumento: tipoDocumento || "F",
      dataRilascio,
    });

    // Se trovata, salva su Supabase
    if (result.success && result.numero_ricevuta && cf) {
      const { data: cand } = await supabase
        .from("candidates")
        .select("id, autoscuola_id")
        .eq("codice_fiscale", cf)
        .maybeSingle();

      if (cand) {
        await supabase.from("ricevute_sostitutive").upsert({
          candidato_id:       cand.id,
          autoscuola_id:      cand.autoscuola_id,
          numero_ricevuta:    result.numero_ricevuta,
          tipo_documento:     tipoDocumento || "F",
          data_rilascio:      dataRilascio ? new Date(dataRilascio.split("/").reverse().join("-")).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
          data_sync_portale:  new Date().toISOString(),
          raw_portale:        JSON.stringify(result),
        }, { onConflict: "candidato_id,numero_ricevuta", ignoreDuplicates: false });
      }
    }

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore generazione ricevuta sostitutiva" });
  }
}

// ─── Punto 13 — Anomalie portale ─────────────────────────────────────────────

/**
 * GET /api/portal-sync/anomalie?dataInizio=DD/MM/YYYY&dataFine=DD/MM/YYYY
 * Restituisce la lista di pratiche in anomalia sul portale.
 */
async function getAnomalieHandler(req, res) {
  try {
    const { dataInizio, dataFine } = req.query;
    const client  = await getClient(req);
    const anomalie = await leggiAnomaliePortale(client, { dataInizio, dataFine });
    res.json({ anomalie, totale: anomalie.length });
  } catch (e) {
    res.status(500).json({ error: e.message || "Errore lettura anomalie portale" });
  }
}

module.exports = {
  getPatenteHandler,
  getEsamiSvoltiHandler,
  salvaEsitiEsameHandler,
  getEsamiCandidatoHandler,
  getRinnoviAttiviHandler,
  getRicevutaSostitutivaHandler,
  postRicevutaSostitutivaHandler,
  getAllieviPrenotatiHandler,
  getCertificatoMedicoHandler,
  syncCandidatoHandler,
  getAnomalieHandler,
};

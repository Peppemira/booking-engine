/**
 * Service per la cache dei dettagli sessioni portale in Supabase.
 * Permette di avere i dati disponibili anche quando il portale è fuori orario.
 */
const supabase = require("../database/supabase");

const TABLE = "sessioni_dettaglio_cache";
const DEFAULT_AUTOSCUOLA_ID = process.env.DEFAULT_AUTOSCUOLA_ID || "9380513a-99ad-4067-adc7-493af2e083d1";

/**
 * Cerca un dettaglio sessione in cache.
 * @param {Object} params
 * @param {string} params.dataSessione - formato dd/mm/yyyy o yyyy-mm-dd
 * @param {string} params.tipoEsame
 * @param {string} params.aula
 * @param {string} params.ufficioProv
 * @param {string} [params.autoscuolaId]
 * @returns {Object|null}
 */
async function getFromCache({ dataSessione, tipoEsame, aula, ufficioProv, autoscuolaId }) {
  const autId = autoscuolaId || DEFAULT_AUTOSCUOLA_ID;
  const dataNorm = normalizeDate(dataSessione);
  if (!dataNorm) return null;

  let q = supabase
    .from(TABLE)
    .select("*")
    .eq("autoscuola_id", autId)
    .eq("data_sessione", dataNorm);

  if (tipoEsame) q = q.eq("tipo_esame", tipoEsame.toUpperCase());
  if (aula) q = q.eq("aula", String(aula).trim());
  if (ufficioProv) q = q.eq("ufficio_prov", ufficioProv.toUpperCase());

  const { data, error } = await q.order("fetched_at", { ascending: false }).limit(1).single();
  if (error || !data) return null;
  return data;
}

/**
 * Cerca tutti i dettagli sessioni in cache per un range di date.
 */
async function getCacheByDateRange({ dataDa, dataA, tipoEsame, autoscuolaId }) {
  const autId = autoscuolaId || DEFAULT_AUTOSCUOLA_ID;
  const da = normalizeDate(dataDa);
  const a = normalizeDate(dataA);

  let q = supabase
    .from(TABLE)
    .select("*")
    .eq("autoscuola_id", autId);

  if (da) q = q.gte("data_sessione", da);
  if (a) q = q.lte("data_sessione", a);
  if (tipoEsame) q = q.eq("tipo_esame", tipoEsame.toUpperCase());

  const { data, error } = await q.order("data_sessione", { ascending: true });
  if (error) {
    console.error("[sessioniDettaglioCache] getCacheByDateRange error:", error.message);
    return [];
  }
  return data || [];
}

/**
 * Salva (upsert) un dettaglio sessione in cache.
 * @param {Object} dettaglio - risultato da readSessioneDettaglioViaBrowser o HTTP
 * @param {Object} meta - metadati sessione (dataSessione, tipoEsame, aula, ufficioProv)
 * @param {string} [autoscuolaId]
 */
async function saveToCache(dettaglio, meta, autoscuolaId) {
  const autId = autoscuolaId || DEFAULT_AUTOSCUOLA_ID;
  const dataNorm = normalizeDate(meta.dataSessione);
  if (!dataNorm) {
    console.warn("[sessioniDettaglioCache] saveToCache: data non valida", meta.dataSessione);
    return null;
  }

  const record = {
    autoscuola_id: autId,
    data_sessione: dataNorm,
    tipo_esame: (meta.tipoEsame || extractCampo(dettaglio, "Tipo Esame") || "").toUpperCase() || null,
    aula: meta.aula || extractCampo(dettaglio, "Aula") || null,
    ufficio_prov: (meta.ufficioProv || extractCampo(dettaglio, "Ufficio Prov.") || "").toUpperCase() || null,
    fascia_oraria: meta.fasciaOraria || extractCampo(dettaglio, "Fascia Oraria") || null,
    campi: dettaglio.campi || dettaglio.campiNoti || {},
    turni: dettaglio.turni || [],
    candidati: dettaglio.candidati || [],
    session_radio_value: meta.radioValue || null,
    page_title: dettaglio.pageTitle || null,
    source: dettaglio.source || "browser",
    fetched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from(TABLE)
    .upsert(record, {
      onConflict: "autoscuola_id,data_sessione,tipo_esame,aula,ufficio_prov",
    })
    .select()
    .single();

  if (error) {
    console.error("[sessioniDettaglioCache] saveToCache error:", error.message);
    return null;
  }
  return data;
}

/**
 * Salva in batch i dettagli di più sessioni.
 */
async function saveBatchToCache(dettagli, autoscuolaId) {
  if (!Array.isArray(dettagli) || !dettagli.length) return [];
  const autId = autoscuolaId || DEFAULT_AUTOSCUOLA_ID;

  const records = dettagli
    .map((d) => {
      const dataNorm = normalizeDate(d.dataSessione || d.meta?.dataSessione);
      if (!dataNorm) return null;
      return {
        autoscuola_id: autId,
        data_sessione: dataNorm,
        tipo_esame: (d.tipoEsame || d.meta?.tipoEsame || "").toUpperCase() || null,
        aula: d.aula || d.meta?.aula || null,
        ufficio_prov: (d.ufficioProv || d.meta?.ufficioProv || "").toUpperCase() || null,
        fascia_oraria: d.fasciaOraria || null,
        campi: d.campi || {},
        turni: d.turni || [],
        candidati: d.candidati || [],
        source: d.source || "browser",
        fetched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    })
    .filter(Boolean);

  if (!records.length) return [];

  const { data, error } = await supabase
    .from(TABLE)
    .upsert(records, {
      onConflict: "autoscuola_id,data_sessione,tipo_esame,aula,ufficio_prov",
    })
    .select();

  if (error) {
    console.error("[sessioniDettaglioCache] saveBatchToCache error:", error.message);
    return [];
  }
  return data || [];
}

/**
 * Controlla se la cache è fresca (meno di maxAgeMinutes).
 */
function isCacheFresh(cacheRecord, maxAgeMinutes = 60) {
  if (!cacheRecord?.fetched_at) return false;
  const fetchedAt = new Date(cacheRecord.fetched_at).getTime();
  const now = Date.now();
  return (now - fetchedAt) < maxAgeMinutes * 60 * 1000;
}

// ── Helpers ──────────────────────────────────────────────────────────

function normalizeDate(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  // dd/mm/yyyy → yyyy-mm-dd
  const ddmmyyyy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
  // yyyy-mm-dd (già ok)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Prova Date parse
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function extractCampo(dettaglio, fieldName) {
  const campi = dettaglio?.campi || dettaglio?.campiNoti || {};
  if (campi[fieldName]) return campi[fieldName];
  const key = Object.keys(campi).find((k) => k.toLowerCase().includes(fieldName.toLowerCase()));
  return key ? campi[key] : "";
}

module.exports = {
  getFromCache,
  getCacheByDateRange,
  saveToCache,
  saveBatchToCache,
  isCacheFresh,
};

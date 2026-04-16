-- =============================================================================
-- MIGRAZIONE: Indice composito per query scadenze medico
-- Data: 2026-04-16
-- Descr: Le pagine /scadenze-mediche e il widget dashboard fanno ricorrentemente
--        la query:
--          SELECT ... FROM rinnovi_portale
--          WHERE autoscuola_id = ?
--            AND tipo_rinnovo = 'medico'
--            AND data_scadenza BETWEEN x AND y
--          ORDER BY data_scadenza ASC LIMIT N
--
--        Gli indici esistenti (idx_rinnovi_portale_autoscuola e idx_rinnovi_portale_tipo)
--        sono troppo generici: Postgres deve fare un index scan + filter + sort.
--        Con un indice composito (autoscuola_id, tipo_rinnovo, data_scadenza)
--        la query diventa una pura range scan ordinata, senza sort in memoria.
--
--        Beneficio: O(log n) lookup + sequential scan ordinato sul range,
--        elimina sort. Per tenant con 50K+ rinnovi medici fa la differenza
--        tra ~50ms e <5ms.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_rinnovi_portale_scadenza_medico
  ON public.rinnovi_portale (autoscuola_id, tipo_rinnovo, data_scadenza)
  WHERE data_scadenza IS NOT NULL;

-- Reload PostgREST schema (Supabase)
NOTIFY pgrst, 'reload schema';

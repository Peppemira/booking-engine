# Script SQL Supabase – Gestionale

## Schema completo (progetto nuovo)

**File:** `2026-03-08_schema_completo_supabase.sql`

Crea tutte le tabelle necessarie al gestionale (se non esistono) e aggiunge eventuali colonne mancanti. Idempotente: puoi eseguirlo più volte.

1. Apri [Supabase](https://supabase.com) → il tuo progetto
2. **SQL Editor** → New query
3. Incolla il contenuto di `2026-03-08_schema_completo_supabase.sql`
4. **Run**

**Tabelle create/aggiornate:**

| Tabella                   | Uso                                                                          |
| ------------------------- | ---------------------------------------------------------------------------- |
| `autoscuole`              | Login gestionale, credenziali portale (portal_user, portal_pass, portal_pin) |
| `candidates`              | Anagrafica candidati                                                         |
| `waitlist`                | Lista attesa esami (Radar), priorità, stato pending/prenotato                |
| `prenotazioni`            | Prenotazioni esame                                                           |
| `pratiche_patente`        | Sync Richiesta Patenti dal portale                                           |
| `pagamenti`               | Cassa / pagoPA / satispay                                                    |
| `remote_capture_sessions` | Acquisizione remota CIE                                                      |

---

## Solo tabelle mancanti (DB già esistente)

**File:** `2026-03-08_solo_tabelle_mancenti.sql`

Crea solo **pratiche_patente** e **pagamenti**. Usalo se hai già `autoscuole`, `candidates`, `waitlist`, `prenotazioni` e ti mancano solo queste due.

---

## Altri script (migrazioni precedenti)

- `2026-02-25_multi_autoscuola_auth.sql` – autoscuole + colonna autoscuola_id
- `2026-02-23_waitlist_candidate_id_uuid.sql` – waitlist.candidate_id come UUID
- `2026-02-26_prenotazioni_created_at.sql` – prenotazioni.created_at
- `2026-03-01_candidates_extended_anagrafica.sql` – colonne estese candidates
- `2026-03-01_remote_capture_sessions.sql` – tabella remote_capture_sessions
- `2026-03-08_calendar_events.sql` – tabella calendar_events (scadenze, guide, appuntamenti)

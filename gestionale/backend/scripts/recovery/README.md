# scripts/recovery

Script di recupero dati per l'archivio storico rinnovi medici di Giuseppe Miracolo
(autoscuola_id = `9380513a-99ad-4067-adc7-493af2e083d1`).

Sono la pipeline completa di **Strategia A medici**: recupero di tutti i rinnovi
medici storici tramite iterazione per-persona sul Portale dell'Automobilista,
bypassando la finestra di 31 giorni della ricerca standard.

## Pipeline (in ordine di esecuzione)

### 1. `strategia_a_medici_full.js` — recupero principale

Itera tutte le persone di GM dall'anagrafica `candidates`, per ciascuna esegue
`leggiRinnoviMediciPerPersona`, fetcha il dettaglio di ogni rinnovo trovato e
salva **immediatamente** in DB (no batch, crash-resilient).

```bash
# Dry run su 5 persone (no DB writes)
node scripts/recovery/strategia_a_medici_full.js --dry-run --limit=5

# Run reale con pacing 250ms tra una persona e l'altra
node scripts/recovery/strategia_a_medici_full.js --delay=250

# Resume da persona N (utile dopo crash)
node scripts/recovery/strategia_a_medici_full.js --start=500 --delay=250
```

**Argomenti:**
- `--limit=N` — processa solo le prime N persone
- `--start=N` — skippa le prime N persone (resume)
- `--delay=N` — pausa in ms tra una persona e l'altra (default 0)
- `--dry-run` — simula senza scrivere in DB

**Note:**
- Richiede `PORTAL_USER`, `PORTAL_PASS`, `PORTAL_PIN` in `.env`
- Persistenza streaming: se il processo crasha, i dati già salvati restano
- Log consigliato: reindirizzare stdout su file per poi usare `retry_persone_errore.js`

Risultato ultimo run GM (aprile 2026): **4458 rinnovi medici inseriti** su 2316
persone, 20 errori, durata 238 min.

---

### 2. `retry_persone_errore.js` — retry errori

Analizza il log del run principale, estrae persone/marche con errore
(`errore [COGNOME]:` / `det error [MARCA]:`), e rilancia fetch+dettaglio+upsert
con backoff esponenziale.

```bash
node scripts/recovery/retry_persone_errore.js --log=PATH_AL_LOG --delay=500 --max-retry=3
```

**Argomenti:**
- `--log=PATH` — (obbligatorio) percorso al file di log del run principale
- `--delay=N` — pausa in ms tra una persona e l'altra (default 500)
- `--max-retry=N` — numero massimo di tentativi per chiamata (default 3)

**Backoff:** 500ms → 1s → 2s → ...

Risultato ultimo run: 44 persone riprocessate, 11 nuovi rinnovi inseriti.

---

### 3. `calcola_scadenze_medico.js` — materializzazione scadenze

Per ogni rinnovo medico senza `data_scadenza`, calcola la scadenza ufficiale
usando `scadenzeService.calcolaScadenzaMedico()` (regole italiane art. 126 CdS)
e la salva in `rinnovi_portale.data_scadenza`.

```bash
# Dry run su tutti
node scripts/recovery/calcola_scadenze_medico.js --dry-run

# Run reale
node scripts/recovery/calcola_scadenze_medico.js

# Solo primi 100
node scripts/recovery/calcola_scadenze_medico.js --limit=100
```

**Argomenti:**
- `--dry-run` — simula senza scrivere
- `--limit=N` — processa solo i primi N rinnovi

**Regole applicate (art. 126 CdS):**

| Categoria         | Età alla visita | Durata  |
|-------------------|-----------------|---------|
| A/B/BE/AM/A1/A2   | < 50            | 10 anni |
|                   | 50–69           | 5 anni  |
|                   | 70–79           | 3 anni  |
|                   | ≥ 80            | 2 anni  |
| C/C1/CE/C1E       | < 65            | 5 anni  |
| D/D1/DE/D1E       | ≥ 65            | 2 anni  |
| CQC               | sempre          | 5 anni  |

Fonte: `src/services/scadenzeService.js` (+ test unitari).

Risultato ultimo run GM: **4328 / 4480 scadenze materializzate (97%)**.

---

## Ordine consigliato (recupero completo da zero)

```bash
# 1. Import completo dal portale per una singola autoscuola
node scripts/recovery/strategia_a_medici_full.js --delay=250 2>&1 | tee logs/medici_full.log

# 2. Retry degli errori
node scripts/recovery/retry_persone_errore.js --log=logs/medici_full.log

# 3. Materializza data_scadenza
node scripts/recovery/calcola_scadenze_medico.js
```

## Configurazione richiesta (`.env`)

```bash
SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE=...
PORTAL_USER=...
PORTAL_PASS=...
PORTAL_PIN=...
PORTAL_BASE_URL=https://www.ilportaledellautomobilista.it
```

## Note multi-tenant

Gli script sono attualmente hardcoded sul tenant **Giuseppe Miracolo** (costante
`GM`). Per usarli su un'altra autoscuola:
1. Recuperare il suo `autoscuola_id` da `autoscuole` in Supabase
2. Sostituirlo nella costante `GM` in cima a ciascuno script
3. Verificare che le credenziali portale in `.env` siano del tenant target

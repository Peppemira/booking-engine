# prenota

gestionale prenota

## Smoke tests pagamenti

Prerequisito: backend attivo su `http://localhost:3001`.

- Test completo azioni pagamento (crea booking temporanea, verifica `bollettino -> 400` e `pagopa -> 200`, poi cleanup):

```powershell
npm run smoke:payment-actions
```

- Test completo in sequenza (`payment-actions` + `payment-history:readonly`):

```powershell
$env:SMOKE_AUTH_TOKEN='TOKEN_JWT_VALIDO'
npm run smoke:all
```

- Test sequenziale non interattivo (esegue sempre `payment-actions`; esegue `payment-history:readonly` solo se `SMOKE_AUTH_TOKEN` è impostato):

```powershell
npm run smoke:all:noninteractive
```

- Test read-only storico pagamenti (non crea/modifica dati):

```powershell
$env:SMOKE_AUTH_TOKEN='TOKEN_JWT_VALIDO'
npm run smoke:payment-history:readonly
```

Note:

- `smoke:payment-history:readonly` richiede un token valido perché chiama endpoint protetti.
- Entrambi gli script sono definiti nel root `package.json` e delegano al backend (`gestionale/backend`).

## Sync archivio autoscuole (portale -> DB)

Per popolare/allineare il DB candidati con tutte le pratiche riconducibili alle autoscuole configurate:

```powershell
npm --prefix gestionale/backend run sync:archivio:autoscuole
```

Opzioni utili:

```powershell
# simulazione senza scrivere su DB
npm --prefix gestionale/backend run sync:archivio:autoscuole:dry

# solo pratiche attive
node gestionale/backend/src/syncArchivioAutoscuole.js --status=attivi

# solo pratiche passate/idonee
node gestionale/backend/src/syncArchivioAutoscuole.js --status=passati

# limita a una sola autoscuola (match su id, nome, email o codice)
node gestionale/backend/src/syncArchivioAutoscuole.js --only=DEMO

# se in autoscuole non hai la colonna codice_autoscuola, puoi forzare il codice per la singola autoscuola filtrata
node gestionale/backend/src/syncArchivioAutoscuole.js --only=demo817981@autoscuola.local --codice=DEMO
```

Prerequisiti per ogni autoscuola (tabella `autoscuole`):

- `codice_autoscuola` (oppure, solo per run singolo, parametro `--codice`)
- `portal_user`
- `portal_pass`

Lo script usa upsert su `candidates`, quindi può essere schedulato (Windows Task Scheduler / cron) senza creare duplicati.

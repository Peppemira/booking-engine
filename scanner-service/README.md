# Scanner Service (locale)

Servizio locale per acquisizione foto e firma in stile GeCA Future. Architettura a 2 componenti:

```
Gestionale Web (dashboard)  →  Scanner Service (localhost:5001)  →  [futuro: TWAIN/WIA]
```

## Avvio

Sul PC dell’autoscuola, nella cartella `scanner-service`:

```bash
npm install
node server.js
```

Oppure: `npm start`

Il servizio è attivo su **http://localhost:5001**.

## API

| Metodo | Path   | Descrizione |
|--------|--------|-------------|
| GET    | /ping  | Verifica che il servizio sia online. Risposta: `{ "status": "scanner service online" }` |
| POST   | /scan  | Upload immagine (multipart, campo `image`). Salva in `scans/` e restituisce `dataUrl` per anteprima nel gestionale. |

## Flusso nel gestionale

1. L’utente clicca **Scanner** (o doppio click su Foto/Firma) → si apre la finestra **Scansione Foto e Firma**.
2. **Scanner FOTO** / **Scanner FIRMA**: il frontend chiama `/ping`; se il servizio risponde, apre la scelta file (o in futuro l’acquisizione TWAIN) e invia il file a `/scan`, poi mostra l’anteprima.
3. **Carica da file**: scelta file locale senza passare dal servizio.
4. **CONFERMA** → foto e firma vengono scritte nel form Nuova iscrizione e la finestra si chiude.

## Passo successivo (TWAIN/WIA)

Per aprire direttamente lo scanner fisico senza “Scegli file” si può integrare un bridge TWAIN/WIA nel servizio (es. modulo Node o helper esterno) che acquisisce e risponde con l’immagine; il frontend resta invariato (sempre POST a `/scan` o nuovo endpoint dedicato).

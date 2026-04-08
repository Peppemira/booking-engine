#!/usr/bin/env python3
"""
portale_scraper.py — Portale dell'Automobilista scraper
Autentica, interroga la Situazione Candidati, restituisce dati strutturati.

Uso:
    python portale_scraper.py --user USERNAME --password PASSWORD
    python portale_scraper.py --user USERNAME --password PASSWORD --stato P   (PRENOTATI)
    python portale_scraper.py --user USERNAME --password PASSWORD --json       (output JSON)
"""

import requests
import argparse
import json
import sys
import re
from bs4 import BeautifulSoup
from datetime import datetime

# ── Configurazione ──────────────────────────────────────────────────────────
BASE_URL     = "https://www.ilportaledellautomobilista.it"
LOGIN_URL    = f"{BASE_URL}/SSO/SSOLogin/Login_initAction.action"
SEARCH_URL   = f"{BASE_URL}/prenotazione/richiestaEmissioneDocumentoAbilitazioneEP/Read_initActionSituazioneCandidati.action"
SEARCH_PAGE  = f"{SEARCH_URL}?pageStatus=SEARCH"

# Valori fissi autoscuola (modificare se necessario)
COD_UFFICIO     = "ME"
COD_AUTOSCUOLA  = "0674"


# ── Login ────────────────────────────────────────────────────────────────────

def login(session: requests.Session, username: str, password: str) -> bool:
    """Autentica sul Portale. Ritorna True se il login ha avuto successo."""
    payload = {
        "loginView.beanUtente.userName": username,
        "loginView.beanUtente.password": password,
        "loginView.gotoRedirect": BASE_URL,
        "orgname": "/",
        "action:Login_executeLogin": "Login",
    }
    resp = session.post(LOGIN_URL, data=payload, allow_redirects=True, timeout=30)
    # Login riuscito se arriviamo su una pagina con nome utente o se
    # l'URL non torna più alla pagina di login
    if "Login_initAction" in resp.url or "login" in resp.url.lower():
        return False
    # Ulteriore check: presenza di "Benvenuto" nel body
    return "Benvenuto" in resp.text or "prenotazione" in resp.url


# ── Estrazione token Struts ──────────────────────────────────────────────────

def get_struts_token(session: requests.Session) -> dict:
    """
    Carica la pagina di ricerca e restituisce il token Struts e i
    valori predefiniti del form (codice ufficio, autoscuola, ecc.).
    """
    resp = session.get(SEARCH_PAGE, timeout=30)
    soup = BeautifulSoup(resp.text, "html.parser")

    form = soup.find("form", {"id": "RicercaSituazioneCandidati"})
    if not form:
        raise RuntimeError("Form RicercaSituazioneCandidati non trovato. Sessione scaduta?")

    # Estrae tutti gli input hidden (incluso il token)
    params = {}
    for inp in form.find_all("input", {"type": "hidden"}):
        if inp.get("name"):
            params[inp["name"]] = inp.get("value", "")

    # Legge anche i valori predefiniti nei select (ufficio, autoscuola)
    for sel in form.find_all("select"):
        name = sel.get("name", "")
        # Prende il valore selezionato o la prima opzione non vuota
        selected = sel.find("option", selected=True)
        if selected and selected.get("value"):
            params[name] = selected["value"]
        else:
            for opt in sel.find_all("option"):
                if opt.get("value"):
                    params[name] = opt["value"]
                    break

    return params


# ── Ricerca Situazione Candidati ─────────────────────────────────────────────

def cerca_candidati(
    session: requests.Session,
    tipo_sessione: str = "C",      # C = CONSEGUIMENTO
    tipo_esame: str = "P",         # P = PATENTE, Q = CQC
    stato: str = "D",              # D = DA PRENOTARE, P = PRENOTATI
) -> list[dict]:
    """
    Esegue la ricerca Situazione Candidati e ritorna lista di righe.
    Ogni riga: {ufficio, autoscuola, tipo_esame, abilitazione, nr_candidati, stato}
    """
    # 1. Ottieni token fresco
    base_params = get_struts_token(session)

    # 2. Costruisci il payload POST
    prefix = "richiestaEmissioneDocumentoAbilitazioneEPView.situazioneCandidatiBean."
    payload = dict(base_params)  # incluso struts token

    payload[f"{prefix}indicatoreTipoSessione"]   = tipo_sessione
    payload[f"{prefix}indicatoreConseguimentoEsame"] = tipo_esame
    payload[f"{prefix}theDisponibilitaEsaminatoreEP.codUfficioMCTC"] = COD_UFFICIO
    payload[f"{prefix}theRichiestaEmissioneDocumentoAbilitazioneEP.codiceIdentificativoAutoscuolaAgenzia"] = COD_AUTOSCUOLA
    payload[f"{prefix}indicatoreStatoCandidati"] = stato
    payload[f"{prefix}dataFrom"]                 = ""
    payload[f"{prefix}dataTo"]                   = ""
    payload[f"{prefix}indicatoreTipoProvaEsame"] = "Q"
    payload[f"{prefix}indicatoreStatoRichiesta"] = "A"
    payload[f"{prefix}indicatoreTipoProvaEsameDaPrenotare"] = "T"

    # Aggiungi il nome azione submit (come fa il browser al click di Ricerca)
    payload["action:ReadSituazioneCandidati_pagingSituazioneCandidati"] = "Ricerca"

    # 3. POST
    resp = session.post(SEARCH_URL, data=payload, allow_redirects=True, timeout=30)

    # 4. Parsing
    return parse_risultati(resp.text)


# ── Parsing HTML risultati ───────────────────────────────────────────────────

def parse_risultati(html: str) -> list[dict]:
    """Estrae le righe dati dalla tabella risultati."""
    soup = BeautifulSoup(html, "html.parser")
    tables = soup.find_all("table")

    candidati = []

    for table in tables:
        headers = [th.get_text(strip=True) for th in table.find_all("th")]
        if "Uff. Prov." not in headers:
            continue

        # Mappa posizione colonne
        col = {h: i for i, h in enumerate(headers)}

        for tr in table.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) < len(headers) - 1:
                continue

            def cell(name):
                idx = col.get(name)
                return tds[idx].get_text(strip=True) if idx is not None and idx < len(tds) else ""

            # Leggi anche il valore radio (contiene parametri per dettaglio)
            radio_val = ""
            radio = tds[col.get("Sel.", 0)].find("input", {"type": "radio"}) if tds else None
            if radio:
                radio_val = radio.get("value", "")

            row = {
                "ufficio":       cell("Uff. Prov."),
                "autoscuola":    cell("Autoscuola"),
                "tipo_esame":    cell("Tipo Esame"),
                "abilitazione":  cell("Abilitazione Richiesta").strip(),
                "nr_candidati":  cell("Nr. Candidati"),
                "stato":         cell("Stato Candidati"),
                "radio_key":     radio_val,
            }

            if row["ufficio"]:  # salta righe vuote
                candidati.append(row)

    return candidati


# ── Formattazione output ─────────────────────────────────────────────────────

def print_tabella(rows: list[dict], titolo: str = "Situazione Candidati") -> None:
    """Stampa i risultati come tabella ASCII."""
    if not rows:
        print(f"\n  [{titolo}] Nessun risultato trovato.\n")
        return

    total = sum(int(r["nr_candidati"]) for r in rows if r["nr_candidati"].isdigit())

    print(f"\n  ╔══════════════════════════════════════════════════════════════╗")
    print(f"  ║  {titolo:<60}║")
    print(f"  ║  Estratto il: {datetime.now().strftime('%d/%m/%Y %H:%M')}                              ║")
    print(f"  ╚══════════════════════════════════════════════════════════════╝")
    print()
    print(f"  {'Ufficio':<10} {'Autoscuola':<12} {'Tipo Esame':<12} {'Abilit.':<10} {'N. Cand.':<10} {'Stato'}")
    print(f"  {'-'*70}")
    for r in rows:
        print(f"  {r['ufficio']:<10} {r['autoscuola']:<12} {r['tipo_esame']:<12} {r['abilitazione']:<10} {r['nr_candidati']:<10} {r['stato']}")
    print(f"  {'-'*70}")
    print(f"  Totale candidati: {total}")
    print()


# ── Entry point ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Portale Automobilista — Situazione Candidati")
    parser.add_argument("--user",     required=True,  help="Username Portale")
    parser.add_argument("--password", required=True,  help="Password Portale")
    parser.add_argument("--stato",    default="D",    help="D=Da Prenotare, P=Prenotati (default: D)")
    parser.add_argument("--esame",    default="P",    help="P=Patente, Q=CQC (default: P)")
    parser.add_argument("--json",     action="store_true", help="Output in formato JSON")
    parser.add_argument("--salva",    default="",     help="Salva risultati in file JSON (es. candidati.json)")
    args = parser.parse_args()

    session = requests.Session()
    session.verify = True  # SSL attivo
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.5",
        "Referer": BASE_URL,
    })

    # 1. Login
    print(f"  Login come {args.user}...", end=" ", flush=True)
    ok = login(session, args.user, args.password)
    if not ok:
        print("❌ FALLITO")
        print("  Verificare username e password.")
        sys.exit(1)
    print("✅ OK")

    # 2. Ricerca
    stato_label = "Da Prenotare" if args.stato == "D" else "Prenotati"
    esame_label = "Patente" if args.esame == "P" else "CQC"
    print(f"  Ricerca candidati {esame_label} — {stato_label}...", end=" ", flush=True)

    try:
        rows = cerca_candidati(session, tipo_esame=args.esame, stato=args.stato)
        print(f"✅ {len(rows)} righe trovate")
    except Exception as e:
        print(f"❌ Errore: {e}")
        sys.exit(1)

    # 3. Output
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
    else:
        titolo = f"Situazione Candidati — {esame_label} — {stato_label}"
        print_tabella(rows, titolo)

    # 4. Salvataggio opzionale
    if args.salva:
        output = {
            "estratto_il": datetime.now().isoformat(),
            "autoscuola": COD_AUTOSCUOLA,
            "ufficio": COD_UFFICIO,
            "tipo_esame": esame_label,
            "stato": stato_label,
            "righe": rows,
        }
        with open(args.salva, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        print(f"  💾 Salvato in: {args.salva}")


if __name__ == "__main__":
    main()

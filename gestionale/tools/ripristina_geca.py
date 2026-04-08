#!/usr/bin/env python3
"""Ripristina GeCAFuture.exe.config rimuovendo il proxy Fiddler."""
import sys, os, shutil, re

GECA_CONFIG = r"C:\AFSoft\GeCAFuture\GeCAFuture.exe.config"
BACKUP_EXT  = ".bak_originale"

def main():
    backup = GECA_CONFIG + BACKUP_EXT

    # Metodo 1: ripristina dal backup originale
    if os.path.isfile(backup):
        shutil.copy2(backup, GECA_CONFIG)
        os.remove(backup)
        print(f"✅ GeCA ripristinato dal backup originale")
        return

    # Metodo 2: rimuovi il blocco proxy manualmente
    if not os.path.isfile(GECA_CONFIG):
        print(f"❌ File non trovato: {GECA_CONFIG}")
        sys.exit(1)

    with open(GECA_CONFIG, "r", encoding="utf-8") as f:
        content = f.read()

    if "GECA Intel" not in content:
        print("ℹ  Nessun proxy configurato — niente da fare")
        return

    # Rimuovi il blocco <system.net>...</system.net> con il commento
    cleaned = re.sub(
        r'\n\s*<!--\s*GECA Intel.*?</system\.net>\n',
        '\n',
        content,
        flags=re.DOTALL
    )

    with open(GECA_CONFIG, "w", encoding="utf-8") as f:
        f.write(cleaned)

    print(f"✅ Proxy rimosso da {GECA_CONFIG}")
    print("   GeCA torna a connettersi direttamente (nessun proxy)")

if __name__ == "__main__":
    main()

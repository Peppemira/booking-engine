#!/usr/bin/env python3
"""
Modifica GeCAFuture.exe.config per usare Fiddler come proxy HTTP.
Solo GeCA viene interessato — nessun proxy di sistema.
"""
import sys, os, shutil, re
from datetime import datetime

GECA_CONFIG = r"C:\AFSoft\GeCAFuture\GeCAFuture.exe.config"
BACKUP_EXT  = ".bak_originale"

PROXY_PORT = sys.argv[1] if len(sys.argv) > 1 else "8888"

PROXY_BLOCK = f"""
  <!-- GECA Intel: proxy temporaneo per cattura chiamate HTTP -->
  <!-- Rimuovi questo blocco (o esegui RIPRISTINA_GECA.bat) per tornare normale -->
  <system.net>
    <defaultProxy enabled="true" useDefaultCredentials="false">
      <proxy proxyaddress="http://127.0.0.1:{PROXY_PORT}"
             bypassonlocal="false" />
    </defaultProxy>
  </system.net>
"""

def main():
    if not os.path.isfile(GECA_CONFIG):
        print(f"❌ File non trovato: {GECA_CONFIG}")
        print("   Verifica che GeCA sia installato in C:\\AFSoft\\GeCAFuture\\")
        sys.exit(1)

    # Backup
    backup_path = GECA_CONFIG + BACKUP_EXT
    if not os.path.isfile(backup_path):
        shutil.copy2(GECA_CONFIG, backup_path)
        print(f"✅ Backup creato: {backup_path}")
    else:
        print(f"ℹ  Backup già presente: {backup_path}")

    with open(GECA_CONFIG, "r", encoding="utf-8") as f:
        content = f.read()

    # Controlla se il proxy è già configurato
    if "GECA Intel" in content:
        print(f"ℹ  Proxy già configurato (porta {PROXY_PORT})")
        # Aggiorna la porta se diversa
        content = re.sub(
            r'proxyaddress="http://127\.0\.0\.1:\d+"',
            f'proxyaddress="http://127.0.0.1:{PROXY_PORT}"',
            content
        )
        with open(GECA_CONFIG, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"✅ Porta aggiornata a {PROXY_PORT}")
        return

    # Inserisci prima di </configuration>
    if "</configuration>" not in content:
        print("❌ File .config non valido (tag </configuration> non trovato)")
        sys.exit(1)

    new_content = content.replace(
        "</configuration>",
        PROXY_BLOCK + "\n</configuration>"
    )

    with open(GECA_CONFIG, "w", encoding="utf-8") as f:
        f.write(new_content)

    print(f"✅ GeCA configurato per proxy Fiddler su 127.0.0.1:{PROXY_PORT}")
    print(f"   File modificato: {GECA_CONFIG}")
    print()
    print("   → Ora apri GecaFuture.exe e usa il Portale normalmente")
    print("   → Le chiamate appariranno in Fiddler in tempo reale")

if __name__ == "__main__":
    main()

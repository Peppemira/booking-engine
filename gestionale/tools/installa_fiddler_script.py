#!/usr/bin/env python3
"""
Installa/aggiorna il FiddlerScript per esportare le chiamate GeCA verso GECA Intel.
Modifica CustomRules.js aggiungendo un hook OnBeforeResponse che:
  - Intercetta le risposte di ilportaledellautomobilista.it
  - Salva l'endpoint in C:\\analisi-geca\\catture\\geca\\endpoint_map.json
  - Aggiorna C:\\analisi-geca\\catture\\tutto\\stats.json
"""
import os, sys, shutil

USERNAME = os.environ.get("USERNAME", "bluef")
FIDDLER_SCRIPT = rf"C:\Users\{USERNAME}\Documents\Fiddler2\Scripts\CustomRules.js"
GECA_INTEL_BASE = r"C:\analisi-geca\catture"

# Blocco da iniettare in CustomRules.js (JScript.NET)
INJECT_MARKER  = "// ===GECA_INTEL_START==="
INJECT_END     = "// ===GECA_INTEL_END==="

INJECT_CODE = r"""
// ===GECA_INTEL_START===
// GECA Intel: cattura chiamate GeCA verso Portale Automobilista
// Aggiunto automaticamente da installa_fiddler_script.py
// NOTA: usa nomi completi System.IO.* per evitare conflitti di import

static var _giEndpoints: System.Collections.Hashtable = new System.Collections.Hashtable();
static var _giCallCount: int = 0;

static function GecaIntelSave(lastHost: String) {
    try {
        var gecaDir  = "C:\\analisi-geca\\catture\\geca";
        var tuttoDir = "C:\\analisi-geca\\catture\\tutto";

        if (!System.IO.Directory.Exists(gecaDir))   System.IO.Directory.CreateDirectory(gecaDir);
        if (!System.IO.Directory.Exists(tuttoDir))  System.IO.Directory.CreateDirectory(tuttoDir);

        // Costruisci JSON manualmente (nessuna dipendenza esterna)
        var sb = new System.Text.StringBuilder();
        sb.Append("{");
        var first: boolean = true;
        var keys = _giEndpoints.Keys.GetEnumerator();
        while (keys.MoveNext()) {
            var k: String = keys.Current;
            var ep = _giEndpoints[k];
            if (!first) sb.Append(",");
            first = false;
            var safeKey  = k.Replace("\\", "\\\\").Replace("\"", "\\\"");
            var safePath = ep.path.Replace("\\", "\\\\").Replace("\"", "\\\"");
            var safeHost = ep.host.Replace("\\", "\\\\").Replace("\"", "\\\"");
            sb.Append("\"" + safeKey + "\":{");
            sb.Append("\"method\":\"" + ep.method + "\",");
            sb.Append("\"host\":\"" + safeHost + "\",");
            sb.Append("\"path\":\"" + safePath + "\",");
            sb.Append("\"calls\":" + ep.calls + ",");
            sb.Append("\"esempi\":[]}");
        }
        sb.Append("}");

        var json: String = sb.ToString();
        System.IO.File.WriteAllText(gecaDir + "\\endpoint_map.json", json);

        var stats: String = "{\"geca\":{\"chiamate\":" + _giCallCount + ",\"tipo\":\"HTTP\"}," +
                            "\"portale\":{\"chiamate\":" + _giCallCount + "}}";
        System.IO.File.WriteAllText(tuttoDir + "\\stats.json", stats);

    } catch (exSave) {
        // Ignora errori di scrittura
    }
}

static function GecaIntelOnResponse(oSession: Session) {
    try {
        var host: String = oSession.hostname.ToLower();
        if (!host.Contains("automobilista") && !host.Contains("motorizzazione") && !host.Contains("mit.gov")) {
            return;
        }

        _giCallCount++;
        var method: String    = oSession.RequestMethod.ToUpper();
        var fullPath: String  = oSession.PathAndQuery;
        var qi: int           = fullPath.IndexOf("?");
        var cleanPath: String = (qi >= 0) ? fullPath.Substring(0, qi) : fullPath;
        var key: String       = method + " " + cleanPath;

        if (!_giEndpoints.ContainsKey(key)) {
            var ep = { method: method, host: oSession.hostname, path: cleanPath, calls: 0 };
            _giEndpoints.Add(key, ep);
        }
        _giEndpoints[key].calls = _giEndpoints[key].calls + 1;

        // Salva subito la prima volta, poi ogni 3 chiamate
        if (_giCallCount == 1 || (_giCallCount % 3) == 0) {
            GecaIntelSave(oSession.hostname);
        }
    } catch (exResp) {
        // Ignora errori di cattura
    }
}
// ===GECA_INTEL_END===
"""

HOOK_CODE = """
        // GECA Intel hook
        GecaIntelOnResponse(oSession);"""

def find_fiddler_script():
    """Cerca CustomRules.js in vari percorsi."""
    candidates = [
        FIDDLER_SCRIPT,
        rf"C:\Users\{USERNAME}\Documents\Fiddler\Scripts\CustomRules.js",
        rf"C:\Users\{USERNAME}\AppData\Local\Programs\Fiddler\Scripts\CustomRules.js",
    ]
    for p in candidates:
        if os.path.isfile(p):
            return p
    return None

def main():
    script_path = find_fiddler_script()

    if not script_path:
        print(f"⚠  CustomRules.js non trovato nel percorso standard.")
        print(f"   Percorso cercato: {FIDDLER_SCRIPT}")
        print()
        print("   SOLUZIONE MANUALE:")
        print("   1. Apri Fiddler → Rules → Customize Rules")
        print("   2. Si apre CustomRules.js nel Fiddler ScriptEditor")
        print("   3. Copia e incolla il contenuto di:")
        print("      gestionale\\tools\\fiddler_geca_addon.js")
        print("      nella sezione 'static function OnBeforeResponse'")

        # Crea file con il codice da copiare manualmente
        addon_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fiddler_geca_addon.js")
        with open(addon_path, "w", encoding="utf-8") as f:
            f.write("// Aggiungi questo codice in CustomRules.js di Fiddler\n")
            f.write("// Nella funzione static function OnBeforeResponse(oSession: Session) {\n")
            f.write("//   aggiungi alla fine del corpo della funzione:\n\n")
            f.write("//   GecaIntelOnResponse(oSession);\n\n")
            f.write("// E aggiungi queste funzioni/variabili a livello di classe:\n\n")
            f.write(INJECT_CODE)
        print(f"\n   File creato: {addon_path}")
        return

    # Backup
    backup = script_path + ".bak_geca"
    if not os.path.isfile(backup):
        shutil.copy2(script_path, backup)
        print(f"✅ Backup: {backup}")

    with open(script_path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()

    # Rimuovi precedente iniezione
    if INJECT_MARKER in content:
        import re
        content = re.sub(
            r'// ===GECA_INTEL_START===.*?// ===GECA_INTEL_END===\n?',
            '',
            content,
            flags=re.DOTALL
        )
        # Rimuovi anche l'hook
        content = content.replace(HOOK_CODE, "")
        print("ℹ  Rimossa versione precedente dello script")

    # Aggiungi il blocco di funzioni prima della riga "}"  finale della classe
    # (in Fiddler, CustomRules.js ha una struttura class con }  finale)
    if "class Handlers" in content:
        # Inserisci il codice DENTRO la classe, prima della chiusura
        insert_pos = content.rfind("\n}")  # ultima "}"
        if insert_pos > 0:
            content = content[:insert_pos] + "\n" + INJECT_CODE + "\n" + content[insert_pos:]
    else:
        content += "\n" + INJECT_CODE

    # Aggiungi l'hook nella funzione OnBeforeResponse
    if "OnBeforeResponse" in content:
        content = content.replace(
            "static function OnBeforeResponse(oSession: Session) {",
            "static function OnBeforeResponse(oSession: Session) {" + HOOK_CODE
        )
        print("✅ Hook aggiunto in OnBeforeResponse")
    else:
        print("⚠  Funzione OnBeforeResponse non trovata — hook non aggiunto")
        print("   Aggiungi manualmente: GecaIntelOnResponse(oSession);")
        print("   nella funzione OnBeforeResponse di Fiddler")

    with open(script_path, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"✅ FiddlerScript installato: {script_path}")
    print()
    print("   In Fiddler: Rules > Reload Scripts (o riavvia Fiddler)")
    print(f"   Output GECA Intel: {GECA_INTEL_BASE}")

if __name__ == "__main__":
    main()

// Aggiungi questo codice in CustomRules.js di Fiddler
// Nella funzione static function OnBeforeResponse(oSession: Session) {
//   aggiungi alla fine del corpo della funzione:

//   GecaIntelOnResponse(oSession);

// E aggiungi queste funzioni/variabili a livello di classe:


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

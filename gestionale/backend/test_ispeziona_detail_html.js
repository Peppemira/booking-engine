// Inspect detail HTML to find all name/cognome/nome fields
require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const cheerio = require("cheerio");
const { loginDirectHttp } = require("./src/connector/portalSession");
const { makeHttpClient } = require("./src/connector/portalHttp");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);
const GM = "9380513a-99ad-4067-adc7-493af2e083d1";
const PORTAL_BASE = process.env.PORTAL_BASE_URL || "https://www.ilportaledellautomobilista.it";

(async () => {
  // Prendiamo un record con nome IS NULL
  const { data } = await supabase
    .from("rinnovi_portale")
    .select("marca_operativa, cognome, nome")
    .eq("autoscuola_id", GM)
    .is("codice_fiscale", null)
    .is("nome", null)
    .limit(1);
  const rec = data?.[0];
  if (!rec) { console.log("Nessun record con nome NULL"); return; }
  console.log("Target:", rec.marca_operativa, "cognome=", rec.cognome, " nome=", rec.nome);

  const jar = await loginDirectHttp({
    username: process.env.PORTAL_USER,
    password: process.env.PORTAL_PASS,
    pin:      process.env.PORTAL_PIN,
  });
  const client = makeHttpClient(jar);

  const url = `${PORTAL_BASE}/RichiestaPatenti/richiesta/ReadGestRinnAgenzia_pagingGestRinnAgenzia.action?richiestaView.richiestaRinnAgenziaFrom.marcaOperativa=${encodeURIComponent(rec.marca_operativa)}&action%3ASelectRichRinnAgenzia_viewElementRichRinnAgenzia=Visualizza`;
  const resp = await client.get(url);
  const html = typeof resp === "string" ? resp : resp.data;
  const $ = cheerio.load(html);

  console.log("\nHTML length:", html.length);

  // Stampa tutti gli input/textarea con name*='gnome'/'nome' (inclusi cognome)
  console.log("\n=== Tutti gli input con name che contiene 'ognome', 'Nome', 'nome' ===");
  $("input, textarea, select").each(function () {
    const n = $(this).attr("name") || "";
    if (/cognome|Cognome|nome|Nome/i.test(n)) {
      const v = $(this).attr("value") || $(this).val() || "";
      const type = $(this).attr("type") || this.tagName;
      console.log(`  [${type}] ${n} = "${String(v).trim().slice(0, 60)}"`);
    }
  });

  // Cerca text label come "Cognome:" / "Nome:" e prendi il valore adiacente
  console.log("\n=== Label 'Cognome'/'Nome' nel body ===");
  const bodyText = $("body").text();
  const idxCognome = bodyText.search(/Cognome\s*[:]/i);
  const idxNome = bodyText.search(/\bNome\s*[:]/i);
  if (idxCognome >= 0) console.log("  Cognome context:", bodyText.slice(idxCognome, idxCognome + 100).replace(/\s+/g, " "));
  if (idxNome >= 0)    console.log("  Nome    context:", bodyText.slice(idxNome, idxNome + 100).replace(/\s+/g, " "));

  // Dumps any td.label-like cells near Cognome/Nome
  console.log("\n=== Cerco <td>/<label> con 'Cognome'/'Nome' ===");
  $("td, label, span, div").each(function () {
    const t = $(this).text().replace(/\s+/g, " ").trim();
    if (/^Cognome\s*:?\s*$/i.test(t) || /^Nome\s*:?\s*$/i.test(t)) {
      const next = $(this).next();
      const nextInput = next.find("input, span, td").first();
      const v = nextInput.attr("value") || nextInput.text() || next.text();
      console.log(`  ${t} -> next="${String(v).trim().slice(0, 60)}" (next.tag=${next.prop("tagName")})`);
    }
  });
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });

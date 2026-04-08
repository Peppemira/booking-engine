/**
 * Routes verbali svolti — archivio storico con filtri avanzati e auto-sync
 */

const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/verbaliSvoltiController");
const { requireAuth } = require("../server/auth");

// Ricerca locale con tutti i filtri
router.get("/", requireAuth, ctrl.searchVerbali);

// Cerca un verbale specifico nel DB locale (per Dettaglio arricchito)
router.get("/find", requireAuth, ctrl.findVerbale);

// Statistiche per anno
router.get("/stats", requireAuth, ctrl.getStats);

// Stato sincronizzazione (needsFullSync, needsUpdate)
router.get("/sync-status", requireAuth, ctrl.getSyncStatusEndpoint);

// Sync singolo range dal portale
router.post("/sync", requireAuth, ctrl.syncRange);

// Auto-sync intelligente (SSE) — scarica solo periodi mancanti
router.post("/auto-sync", requireAuth, ctrl.autoSync);

// Sync storico completo (SSE) — legacy, ora usa auto-sync con forceFullSync
router.post("/sync-storico", requireAuth, ctrl.syncStorico);

// DEBUG: ispeziona il form del portale per trovare i nomi dei campi
router.get("/debug-form", requireAuth, async (req, res) => {
  try {
    const { resolvePortalCredentials } = require("../server/portalHelpers");
    const { makeHttpClient, readVerbali } = require("../connector/portalHttp");
    const { getOrLoginJarFast } = require("../connector/portalSession");
    const cheerio = require("cheerio");

    const creds = await resolvePortalCredentials(req);
    const jar = await getOrLoginJarFast(creds);
    const client = makeHttpClient(jar);

    const baseUrl = "https://www.ilportaledellautomobilista.it/prenotazione/sessioneEsameAbilitazioneEP/Read_initActionVerbaliSvoltiConseguimento.action";
    let html = (await client.get(baseUrl + "?pageStatus=SEARCH", {
      headers: { Referer: "https://www.ilportaledellautomobilista.it/prenotazione/menu/LoadMenu_execute.action" },
    })).data;

    // Handle redirects
    for (let i = 0; i < 5; i++) {
      if (typeof html !== "string") break;
      if (html.includes("DispatcherEntry_executeDispatch")) {
        const $ = cheerio.load(html);
        const form = $("form[name='postform']").first();
        const action = form.attr("action");
        if (!action) break;
        const fullAction = action.startsWith("http") ? action : "https://www.ilportaledellautomobilista.it" + action;
        const formData = new URLSearchParams();
        form.find("input[type='hidden']").each((_, inp) => {
          const n = $(inp).attr("name");
          if (n) formData.append(n, $(inp).attr("value") || "");
        });
        html = (await client.post(fullAction, formData.toString(), {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        })).data;
        continue;
      }
      if (html.includes("SSO - Pin Validation") || html.includes('name="loginView.pin"')) {
        const $ = cheerio.load(html);
        const pinForm = $("form#LoginForm, form[name='LoginForm']").first();
        const pinAction = pinForm.attr("action");
        if (!pinAction) break;
        const fullAction = pinAction.startsWith("http") ? pinAction : "https://www.ilportaledellautomobilista.it" + pinAction;
        const pinData = new URLSearchParams();
        pinForm.find("input[type='hidden']").each((_, inp) => {
          const n = $(inp).attr("name");
          if (n) pinData.append(n, $(inp).attr("value") || "");
        });
        pinData.append("loginView.pin", process.env.PORTAL_PIN || "");
        pinData.append("action:Pin_executePinValidation", "Conferma");
        html = (await client.post(fullAction, pinData.toString(), {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        })).data;
        continue;
      }
      break;
    }

    const $ = cheerio.load(html);
    const result = { selects: [], allFields: [], forms: [] };

    // All forms
    $("form").each((_, f) => {
      const $f = $(f);
      result.forms.push({
        name: $f.attr("name") || "",
        id: $f.attr("id") || "",
        action: ($f.attr("action") || "").slice(0, 200),
        inputs: $f.find("input").length,
        selects: $f.find("select").length,
      });
    });

    // All selects
    $("select").each((_, sel) => {
      const $s = $(sel);
      const opts = [];
      $s.find("option").each((__, opt) => {
        opts.push({ value: $(opt).attr("value") || "", text: $(opt).text().trim() });
      });
      result.selects.push({ name: $s.attr("name") || "", id: $s.attr("id") || "", options: opts });
    });

    // All fields
    $("input, select, textarea").each((_, el) => {
      const $e = $(el);
      const name = $e.attr("name") || "";
      if (name) result.allFields.push({
        tag: $e.prop("tagName"),
        name,
        type: $e.attr("type") || "",
        value: ($e.val() || "").slice(0, 100),
      });
    });

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

module.exports = router;

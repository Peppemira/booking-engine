"use strict";
/**
 * Test del template "remote_capture_link" in notificheService.
 * Verifica che subject/html/text esistano e che la sostituzione segnaposto funzioni.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { TEMPLATES, getRemoteCaptureWhatsappText } = require("../src/services/notificheService");

describe("Template remote_capture_link", () => {
  it("esiste in TEMPLATES con subject/html/text", () => {
    assert.ok(TEMPLATES, "TEMPLATES non esportato");
    assert.ok(TEMPLATES.remote_capture_link, "TEMPLATES.remote_capture_link non definito");
    const t = TEMPLATES.remote_capture_link;
    assert.ok(typeof t.subject === "string" || typeof t.subject === "function", "subject deve essere stringa o funzione");
    assert.equal(typeof t.html, "function", "html deve essere funzione");
    assert.equal(typeof t.text, "function", "text deve essere funzione");
  });

  it("html() sostituisce {nome} {autoscuola} {link} {scadenza}", () => {
    const html = TEMPLATES.remote_capture_link.html({
      nome: "Anna",
      autoscuola: "Autoscuola Miracolo",
      link: "https://gest.example/acquisizione-remota?token=abc",
      scadenza: "18/04/2026 14:30",
    });
    assert.match(html, /Anna/);
    assert.match(html, /Autoscuola Miracolo/);
    assert.match(html, /acquisizione-remota\?token=abc/);
    assert.match(html, /18\/04\/2026 14:30/);
  });

  it("text() sostituisce {nome} {autoscuola} {link} {scadenza}", () => {
    const text = TEMPLATES.remote_capture_link.text({
      nome: "Mario",
      autoscuola: "Bluefox",
      link: "https://gest.example/acquisizione-remota?token=xyz",
      scadenza: "18/04/2026 14:30",
    });
    assert.match(text, /Mario/);
    assert.match(text, /Bluefox/);
    assert.match(text, /acquisizione-remota\?token=xyz/);
    assert.match(text, /18\/04\/2026 14:30/);
  });

  it("subject (statico o funzione) include il nome autoscuola se funzione", () => {
    const t = TEMPLATES.remote_capture_link;
    const sub = typeof t.subject === "function"
      ? t.subject({ autoscuola: "TestAutoscuolaXYZ" })
      : t.subject;
    assert.ok(sub && sub.length > 0, "subject vuoto");
    if (typeof t.subject === "function") {
      assert.match(sub, /TestAutoscuolaXYZ/);
    }
  });

  it("getRemoteCaptureWhatsappText sostituisce i segnaposto", () => {
    assert.equal(typeof getRemoteCaptureWhatsappText, "function", "getRemoteCaptureWhatsappText deve essere esportata");
    const text = getRemoteCaptureWhatsappText({
      nome: "Lucia",
      autoscuola: "Bluefox",
      link: "https://gest.example/acquisizione-remota?token=wa1",
      scadenza: "18/04/2026 14:30",
    });
    assert.match(text, /Lucia/);
    assert.match(text, /Bluefox/);
    assert.match(text, /acquisizione-remota\?token=wa1/);
    assert.match(text, /18\/04\/2026 14:30/);
  });
});

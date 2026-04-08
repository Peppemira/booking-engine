const cheerio = require("cheerio");

const PORTAL_BASE_URL = "https://www.ilportaledellautomobilista.it";

function toAbsoluteUrl(action) {
  if (!action) return "";
  if (action.startsWith("http://") || action.startsWith("https://")) return action;
  return `${PORTAL_BASE_URL}${action}`;
}

function getSubmitControls($form) {
  const controls = [];

  $form.find('input[type="submit"], button[type="submit"], button[name], input[name^="action:"]').each((_, el) => {
    const $el = $form.find(el).first();
    const name = $el.attr("name") || "";
    const value = $el.attr("value") || $el.text().trim() || "Conferma";

    if (name) {
      controls.push({ name, value });
    }
  });

  return controls;
}

function scoreForm(action, submitControls, hiddenFieldsCount) {
  const actionLower = String(action || "").toLowerCase();
  let score = 0;

  if (actionLower.includes("conferma")) score += 8;
  if (actionLower.includes("prenot")) score += 6;
  if (actionLower.includes("seleziona")) score += 4;
  if (actionLower.includes("disponibilitasessioneesameep")) score += 3;
  if (hiddenFieldsCount > 0) score += 2;

  const hasConfirmSubmit = submitControls.some((ctrl) =>
    ctrl.name.toLowerCase().includes("conferma") ||
    String(ctrl.value).toLowerCase().includes("conferma")
  );

  if (hasConfirmSubmit) score += 5;

  return score;
}

function extractConfirmationRequest(step2Html) {
  const $ = cheerio.load(step2Html || "");
  const candidates = [];

  $("form").each((_, form) => {
    const $form = $(form);
    const action = $form.attr("action") || "";

    const hiddenFields = {};
    $form.find('input[type="hidden"]').each((__, input) => {
      const $input = $(input);
      const name = $input.attr("name");
      const value = $input.attr("value") || "";
      if (name) hiddenFields[name] = value;
    });

    const submitControls = getSubmitControls($form);
    const score = scoreForm(action, submitControls, Object.keys(hiddenFields).length);

    if (score <= 0) return;

    candidates.push({
      action,
      hiddenFields,
      submitControls,
      score,
    });
  });

  if (!candidates.length) {
    return null;
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  const payload = new URLSearchParams();
  Object.entries(best.hiddenFields).forEach(([name, value]) => {
    payload.append(name, value == null ? "" : String(value));
  });

  if (best.submitControls.length) {
    const submit = best.submitControls[0];
    payload.append(submit.name, submit.value || "Conferma");
  }

  return {
    url: toAbsoluteUrl(best.action),
    payload,
    score: best.score,
  };
}

module.exports = { extractConfirmationRequest };

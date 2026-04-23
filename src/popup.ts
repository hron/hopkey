import {
  loadSettings,
  saveSettings,
  createDefaultSettings,
} from "./lib/settings";
import type { Settings, ExclusionRule } from "./lib/settings";
import {
  getMatchingRules,
  isValidPattern,
  matchesPattern,
  normalizePassKeys,
  normalizePatternInput,
  suggestPatternForUrl,
} from "./lib/exclusions";

let settings: Settings = createDefaultSettings();
let activeUrl: string | null = null;
let suggestedPattern: string | null = null;
let popupRules: ExclusionRule[] = [];

const els = {
  siteLabel: document.getElementById("site-label") as HTMLElement,
  stateCaption: document.getElementById("state-caption") as HTMLElement,
  unsupported: document.getElementById("unsupported") as HTMLElement,
  rulesPanel: document.getElementById("rules-panel") as HTMLElement,
  rulesContainer: document.getElementById("rules-container") as HTMLElement,
  rulesEmpty: document.getElementById("rules-empty") as HTMLElement,
  addRule: document.getElementById("add-rule-btn") as HTMLButtonElement,
  save: document.getElementById("save-btn") as HTMLButtonElement,
  feedback: document.getElementById("feedback") as HTMLElement,
};

async function init() {
  wireListeners();

  settings = await loadSettings();

  const tab = await getActiveTab();
  activeUrl = tab?.url ?? null;
  suggestedPattern = activeUrl ? suggestPatternForUrl(activeUrl) : null;

  if (!activeUrl || !suggestedPattern) {
    els.siteLabel.textContent = activeUrl ?? "No active page";
    els.stateCaption.textContent = "Site exceptions are unavailable for this page type.";
    els.unsupported.style.display = "block";
    els.rulesPanel.style.display = "none";
    els.save.disabled = true;
    return;
  }

  els.siteLabel.textContent = activeUrl;
  popupRules = getMatchingRules(settings.exclusionRules, activeUrl).map((rule) => ({
    pattern: rule.pattern,
    passKeys: rule.passKeys,
  }));

  renderRules();
  syncStateCaption();
}

function wireListeners() {
  els.addRule.addEventListener("click", onAddRule);
  els.save.addEventListener("click", onSave);
}

function renderRules() {
  els.rulesContainer.innerHTML = "";

  if (popupRules.length === 0) {
    els.rulesEmpty.style.display = "block";
  } else {
    els.rulesEmpty.style.display = "none";
  }

  popupRules.forEach((rule, index) => {
    const row = document.createElement("div");
    row.className = "rule-row";

    const patternInput = document.createElement("input");
    patternInput.type = "text";
    patternInput.className = "text-input rule-pattern";
    patternInput.placeholder = "*://example.com/*";
    patternInput.spellcheck = false;
    patternInput.autocomplete = "off";
    patternInput.value = rule.pattern;
    patternInput.addEventListener("input", () => {
      popupRules[index].pattern = patternInput.value;
      syncStateCaption();
      syncRowValidation(row, popupRules[index]);
    });

    const keysInput = document.createElement("input");
    keysInput.type = "text";
    keysInput.className = "text-input rule-keys";
    keysInput.placeholder = "f F gi (empty = disable all)";
    keysInput.spellcheck = false;
    keysInput.autocomplete = "off";
    keysInput.value = rule.passKeys;
    keysInput.addEventListener("input", () => {
      popupRules[index].passKeys = keysInput.value;
      syncStateCaption();
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn btn-ghost btn-sm";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      popupRules.splice(index, 1);
      renderRules();
      syncStateCaption();
    });

    const validation = document.createElement("p");
    validation.className = "validation";

    row.append(patternInput, keysInput, removeBtn, validation);
    els.rulesContainer.appendChild(row);

    syncRowValidation(row, rule);
  });
}

function syncRowValidation(row: HTMLElement, rule: ExclusionRule) {
  const validationEl = row.querySelector(".validation") as HTMLElement;
  const pattern = normalizePatternInput(rule.pattern);

  if (!pattern) {
    row.classList.add("invalid");
    validationEl.textContent = "URL pattern is required.";
    return;
  }

  if (!isValidPattern(pattern)) {
    row.classList.add("invalid");
    validationEl.textContent = "Invalid URL pattern.";
    return;
  }

  if (activeUrl && !matchesPattern(pattern, activeUrl)) {
    row.classList.add("invalid");
    validationEl.textContent = "Pattern does not match current page.";
    return;
  }

  row.classList.remove("invalid");
  validationEl.textContent = "";
}

function syncStateCaption() {
  if (popupRules.length === 0) {
    els.stateCaption.textContent = "All HopKey shortcuts are enabled on this page.";
    return;
  }

  const hasDisableAllRule = popupRules.some(
    (rule) => normalizePassKeys(rule.passKeys).length === 0,
  );

  if (hasDisableAllRule) {
    els.stateCaption.textContent = "No HopKey shortcuts are enabled on this page.";
  } else {
    els.stateCaption.textContent = "Some HopKey shortcuts are enabled on this page.";
  }
}

function onAddRule() {
  popupRules.push({
    pattern: suggestedPattern ?? "",
    passKeys: "",
  });
  renderRules();
  syncStateCaption();

  const rows = els.rulesContainer.querySelectorAll<HTMLInputElement>(".rule-pattern");
  const last = rows[rows.length - 1];
  last?.focus();
}

async function onSave() {
  if (!activeUrl) return;

  const normalizedRules = normalizePopupRules();
  if (!normalizedRules) return;

  const untouchedRules = settings.exclusionRules.filter(
    (rule) => !matchesPattern(rule.pattern, activeUrl),
  );

  settings.exclusionRules = [...untouchedRules, ...normalizedRules];

  await saveSettings(settings);

  popupRules = normalizedRules.map((rule) => ({ ...rule }));
  renderRules();
  syncStateCaption();

  showFeedback("Site exceptions saved.", "success");
}

function normalizePopupRules(): ExclusionRule[] | null {
  if (!activeUrl) return null;

  const normalized: ExclusionRule[] = [];

  for (const [index, rule] of popupRules.entries()) {
    const pattern = normalizePatternInput(rule.pattern);
    const passKeys = normalizePassKeys(rule.passKeys);

    if (!pattern && !passKeys) continue;

    if (!pattern) {
      showFeedback(`Rule #${index + 1} needs a URL pattern.`, "error");
      return null;
    }

    if (!isValidPattern(pattern)) {
      showFeedback(`Rule #${index + 1} has an invalid URL pattern.`, "error");
      return null;
    }

    if (!matchesPattern(pattern, activeUrl)) {
      showFeedback(`Rule #${index + 1} does not match this page URL.`, "error");
      return null;
    }

    normalized.push({ pattern, passKeys });
  }

  return normalized;
}

function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0]);
    });
  });
}

let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

function showFeedback(message: string, kind: "success" | "info" | "error") {
  els.feedback.textContent = message;
  els.feedback.className = `feedback ${kind}`;
  els.feedback.style.display = "block";

  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => {
    els.feedback.style.display = "none";
    feedbackTimer = null;
  }, 2800);
}

init();

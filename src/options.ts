/**
 * Options page logic.
 *
 * Reads settings from chrome.storage.sync, renders the binding table and
 * hint-character controls, and lets the user reassign any binding via a
 * key-capture modal.
 */

import {
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  createDefaultSettings,
  ACTION_LABELS,
  ACTION_NAMES,
} from "./lib/settings";
import type { Settings, ActionName, ExclusionRule } from "./lib/settings";
import {
  normalizePassKeys,
  normalizePatternInput,
  isValidPattern,
} from "./lib/exclusions";

// ── State ─────────────────────────────────────────────────────────────────

let settings: Settings = createDefaultSettings();

/** Which action is currently being reassigned (null = modal closed) */
let capturingFor: ActionName | null = null;
/** Keys typed so far in the capture modal */
let captureBuffer = "";

// ── Init ──────────────────────────────────────────────────────────────────

async function init() {
  settings = await loadSettings();
  renderBindings();
  syncControls();
  wireStaticListeners();
}

// ── Rendering ─────────────────────────────────────────────────────────────

function renderBindings() {
  const container = document.getElementById("bindings-container")!;
  container.innerHTML = "";

  for (const action of ACTION_NAMES) {
    const row = document.createElement("div");
    row.className = "binding-row";

    const labelEl = document.createElement("span");
    labelEl.className = "binding-label";
    labelEl.textContent = ACTION_LABELS[action];

    const kbd = document.createElement("kbd");
    kbd.className = "binding-key";
    kbd.id = `key-${action}`;
    kbd.textContent = settings[action];

    const btn = document.createElement("button");
    btn.className = "btn btn-sm";
    btn.textContent = "Reassign";
    btn.addEventListener("click", () => openCapture(action));

    row.append(labelEl, kbd, btn);
    container.appendChild(row);
  }
}

function syncControls() {
  (document.getElementById("hint-chars") as HTMLInputElement).value =
    settings.hintChars;
  (document.getElementById("hint-uppercase") as HTMLInputElement).checked =
    settings.hintUpperCase;

  const candidate =
    normalizeHexColor(settings.inputCandidateColor) ??
    DEFAULT_SETTINGS.inputCandidateColor;
  const current =
    normalizeHexColor(settings.inputCurrentColor) ??
    DEFAULT_SETTINGS.inputCurrentColor;

  settings.inputCandidateColor = candidate;
  settings.inputCurrentColor = current;

  (document.getElementById("input-candidate-color") as HTMLInputElement).value =
    candidate;
  (document.getElementById("input-current-color") as HTMLInputElement).value =
    current;
  (document.getElementById("input-candidate-hex") as HTMLInputElement).value =
    candidate;
  (document.getElementById("input-current-hex") as HTMLInputElement).value =
    current;

  (document.getElementById("link-search-fuzzy") as HTMLInputElement).checked =
    settings.linkSearchFuzzy;

  renderExclusionRules();
}

function renderExclusionRules() {
  const container = document.getElementById("exceptions-container")!;
  const emptyState = document.getElementById("exceptions-empty")!;

  container.innerHTML = "";

  if (settings.exclusionRules.length === 0) {
    emptyState.style.display = "block";
    return;
  }

  emptyState.style.display = "none";

  settings.exclusionRules.forEach((rule, index) => {
    const row = document.createElement("div");
    row.className = "exception-row";

    const patternInput = document.createElement("input");
    patternInput.type = "text";
    patternInput.className = "text-input mono exception-pattern";
    patternInput.placeholder = "*://example.com/*";
    patternInput.autocomplete = "off";
    patternInput.spellcheck = false;
    patternInput.value = rule.pattern;
    patternInput.addEventListener("input", () => {
      settings.exclusionRules[index].pattern = patternInput.value;
    });

    const passKeysInput = document.createElement("input");
    passKeysInput.type = "text";
    passKeysInput.className = "text-input mono exception-passkeys";
    passKeysInput.placeholder = "f F i (empty = disable all)";
    passKeysInput.autocomplete = "off";
    passKeysInput.spellcheck = false;
    passKeysInput.value = rule.passKeys;
    passKeysInput.addEventListener("input", () => {
      settings.exclusionRules[index].passKeys = passKeysInput.value;
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn btn-sm btn-ghost";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      settings.exclusionRules.splice(index, 1);
      renderExclusionRules();
    });

    row.append(patternInput, passKeysInput, removeBtn);
    container.appendChild(row);
  });
}

function addExclusionRule() {
  settings.exclusionRules.push({ pattern: "", passKeys: "" });
  renderExclusionRules();

  const patternInputs = document.querySelectorAll<HTMLInputElement>(
    "#exceptions-container .exception-pattern",
  );
  const lastPatternInput = patternInputs[patternInputs.length - 1];
  lastPatternInput?.focus();
}

// ── Static event listeners ────────────────────────────────────────────────

function wireStaticListeners() {
  document.getElementById("save-btn")!.addEventListener("click", onSave);
  document
    .getElementById("reset-btn")!
    .addEventListener("click", onResetDefaults);
  document
    .getElementById("cancel-capture-btn")!
    .addEventListener("click", closeCapture);
  document
    .getElementById("add-exception-btn")!
    .addEventListener("click", addExclusionRule);

  const hintCharsEl = document.getElementById(
    "hint-chars",
  ) as HTMLInputElement;
  hintCharsEl.addEventListener("input", () => {
    // Deduplicate and strip non-alpha
    const unique = [
      ...new Set(hintCharsEl.value.toLowerCase().replace(/[^a-z]/g, "")),
    ].join("");
    settings.hintChars = unique || DEFAULT_SETTINGS.hintChars;
  });

  const hintUpperEl = document.getElementById(
    "hint-uppercase",
  ) as HTMLInputElement;
  hintUpperEl.addEventListener("change", () => {
    settings.hintUpperCase = hintUpperEl.checked;
  });

  const linkSearchFuzzyEl = document.getElementById(
    "link-search-fuzzy",
  ) as HTMLInputElement;
  linkSearchFuzzyEl.addEventListener("change", () => {
    settings.linkSearchFuzzy = linkSearchFuzzyEl.checked;
  });

  const candidateColorEl = document.getElementById(
    "input-candidate-color",
  ) as HTMLInputElement;
  const candidateHexEl = document.getElementById(
    "input-candidate-hex",
  ) as HTMLInputElement;

  candidateColorEl.addEventListener("input", () => {
    settings.inputCandidateColor = candidateColorEl.value;
    candidateHexEl.value = candidateColorEl.value;
  });

  candidateHexEl.addEventListener("input", () => {
    const normalized = normalizeHexColor(candidateHexEl.value);
    if (!normalized) return;
    settings.inputCandidateColor = normalized;
    candidateColorEl.value = normalized;
    candidateHexEl.value = normalized;
  });

  const currentColorEl = document.getElementById(
    "input-current-color",
  ) as HTMLInputElement;
  const currentHexEl = document.getElementById(
    "input-current-hex",
  ) as HTMLInputElement;

  currentColorEl.addEventListener("input", () => {
    settings.inputCurrentColor = currentColorEl.value;
    currentHexEl.value = currentColorEl.value;
  });

  currentHexEl.addEventListener("input", () => {
    const normalized = normalizeHexColor(currentHexEl.value);
    if (!normalized) return;
    settings.inputCurrentColor = normalized;
    currentColorEl.value = normalized;
    currentHexEl.value = normalized;
  });

  // Key capture is global — runs whenever the modal is open
  document.addEventListener("keydown", onCaptureKey, true);
}

// ── Key-capture modal ─────────────────────────────────────────────────────

function openCapture(action: ActionName) {
  capturingFor = action;
  captureBuffer = "";

  document.getElementById(`key-${action}`)!.classList.add("capturing");

  updateCapturePreview();
  document.getElementById("capture-modal")!.style.display = "flex";
  document.getElementById("capture-modal")!.focus();
}

function closeCapture() {
  if (capturingFor) {
    document
      .getElementById(`key-${capturingFor}`)!
      .classList.remove("capturing");
  }
  capturingFor = null;
  captureBuffer = "";
  document.getElementById("capture-modal")!.style.display = "none";
}

function onCaptureKey(e: KeyboardEvent) {
  if (!capturingFor) return;

  e.preventDefault();
  e.stopPropagation();

  if (e.key === "Escape") {
    closeCapture();
    return;
  }

  if (e.key === "Enter") {
    if (captureBuffer.length > 0) confirmCapture();
    return;
  }

  if (e.key === "Backspace") {
    captureBuffer = captureBuffer.slice(0, -1);
    updateCapturePreview();
    return;
  }

  // Accept printable characters only, max 3
  if (e.key.length === 1 && captureBuffer.length < 3) {
    captureBuffer += e.key;
    updateCapturePreview();
  }
}

function updateCapturePreview() {
  const previewEl = document.getElementById("capture-preview")!;
  const hintEl = document.getElementById("capture-hint")!;

  if (captureBuffer.length === 0) {
    previewEl.textContent = "—";
    hintEl.textContent = "Type the new shortcut, then press Enter to confirm.";
  } else {
    previewEl.textContent = captureBuffer;
    hintEl.textContent = "Press Enter to confirm, Backspace to edit, Escape to cancel.";
  }
}

function confirmCapture() {
  if (!capturingFor || captureBuffer.length === 0) return;

  // Conflict check
  const conflict = ACTION_NAMES.find(
    (a) => a !== capturingFor && settings[a] === captureBuffer,
  );
  if (conflict) {
    showFeedback(`"${captureBuffer}" is already used by "${ACTION_LABELS[conflict]}"`, "error");
    return;
  }

  settings[capturingFor] = captureBuffer;
  document.getElementById(`key-${capturingFor}`)!.textContent = captureBuffer;
  closeCapture();
  showFeedback("Binding updated — remember to Save.", "info");
}

// ── Toolbar actions ───────────────────────────────────────────────────────

async function onSave() {
  if (settings.hintChars.length < 2) {
    showFeedback("Hint characters must contain at least 2 letters.", "error");
    return;
  }

  // Re-sync hint controls in case user edited the text field
  const hintCharsEl = document.getElementById("hint-chars") as HTMLInputElement;
  const unique = [...new Set(hintCharsEl.value.toLowerCase().replace(/[^a-z]/g, ""))].join("");
  settings.hintChars = unique || DEFAULT_SETTINGS.hintChars;
  hintCharsEl.value = settings.hintChars;

  const candidateHexEl = document.getElementById(
    "input-candidate-hex",
  ) as HTMLInputElement;
  const currentHexEl = document.getElementById(
    "input-current-hex",
  ) as HTMLInputElement;

  const candidate = normalizeHexColor(candidateHexEl.value);
  const current = normalizeHexColor(currentHexEl.value);

  if (!candidate || !current) {
    showFeedback("Highlight colors must be valid hex values like #60a5fa.", "error");
    return;
  }

  settings.inputCandidateColor = candidate;
  settings.inputCurrentColor = current;

  candidateHexEl.value = candidate;
  currentHexEl.value = current;
  (document.getElementById("input-candidate-color") as HTMLInputElement).value =
    candidate;
  (document.getElementById("input-current-color") as HTMLInputElement).value =
    current;

  const normalizedExclusions = normalizeExclusionRules();
  if (!normalizedExclusions) return;
  settings.exclusionRules = normalizedExclusions;
  renderExclusionRules();

  await saveSettings(settings);
  showFeedback("Settings saved!", "success");
}

function onResetDefaults() {
  settings = createDefaultSettings();
  renderBindings();
  syncControls();
  showFeedback("Reset to defaults — click Save to apply.", "info");
}

function normalizeExclusionRules(): ExclusionRule[] | null {
  const normalized: ExclusionRule[] = [];
  const seenPatterns = new Set<string>();

  for (const [index, rule] of settings.exclusionRules.entries()) {
    const pattern = normalizePatternInput(rule.pattern);
    const passKeys = normalizePassKeys(rule.passKeys);

    if (!pattern && !passKeys) continue;

    if (!pattern) {
      showFeedback(`Exception #${index + 1} is missing a URL pattern.`, "error");
      return null;
    }

    if (!isValidPattern(pattern)) {
      showFeedback(`Exception #${index + 1} has an invalid URL pattern.`, "error");
      return null;
    }

    if (seenPatterns.has(pattern)) {
      showFeedback(`Duplicate exception pattern: ${pattern}`, "error");
      return null;
    }

    seenPatterns.add(pattern);
    normalized.push({ pattern, passKeys });
  }

  return normalized;
}

function normalizeHexColor(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : null;
}

// ── Feedback toast ────────────────────────────────────────────────────────

let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

function showFeedback(message: string, kind: "success" | "info" | "error") {
  const el = document.getElementById("feedback")!;
  el.textContent = message;
  el.className = `feedback ${kind}`;
  el.style.display = "block";

  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => {
    el.style.display = "none";
    feedbackTimer = null;
  }, 3500);
}

// ── Go ────────────────────────────────────────────────────────────────────

init();

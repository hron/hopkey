/**
 * HopKey content script — runs in every frame of every page.
 *
 * Frame switching is coordinated purely through window.postMessage
 * between the content-script instances that live inside the same tab.
 * No background worker is involved.
 *
 *   ┌─ top frame (frameId 0) ──────────────────────────────────────────┐
 *   │  • Acts as coordinator for frame-focus cycling                    │
 *   │  • Checks document.activeElement to find the focused iframe      │
 *   │  • Forwards focus_self to the target iframe's contentWindow      │
 *   └──────────────────────────────────────────────────────────────────┘
 *         ↑ postMessage: next_frame / main_frame
 *         ↓ postMessage: focus_self
 *   ┌─ iframe content scripts ─────────────────────────────────────────┐
 *   │  • Handle their own hints / input mode                             │
 *   │  • Delegate frame-switch requests up to window.top              │
 *   └──────────────────────────────────────────────────────────────────┘
 */

import {
  loadSettings,
  createDefaultSettings,
  ACTION_NAMES,
} from "./lib/settings";
import type { Settings, ActionName } from "./lib/settings";
import { getEffectiveRule, tokenizePassKeys } from "./lib/exclusions";
import { HintSystem } from "./lib/hints";
import { InputMode } from "./lib/input-mode";
import { LinkSearchMode } from "./lib/link-search-mode";
import { formatKeyEvent } from "./lib/keys";
import { performHintAction, activateElement } from "./lib/hint-actions";
import type { HintAction } from "./lib/hint-actions";

// ── postMessage protocol ──────────────────────────────────────────────────
//
// All messages carry a sentinel so we never accidentally react to unrelated
// postMessages from the page itself.

const MSG_TAG = "__hopkey__" as const;

type FrameMsg =
  | { [MSG_TAG]: true; type: "next_frame" }  // child → top
  | { [MSG_TAG]: true; type: "main_frame" }  // child → top
  | { [MSG_TAG]: true; type: "focus_self" }; // top   → child

function isHopkeyMsg(data: unknown): data is FrameMsg {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>)[MSG_TAG] === true
  );
}

function send(win: Window, type: FrameMsg["type"]) {
  win.postMessage({ [MSG_TAG]: true, type } satisfies FrameMsg, "*");
}

// ── State ─────────────────────────────────────────────────────────────────

let settings: Settings = createDefaultSettings();
let seqBuffer = "";
let suppressSingleKeyUntil = 0;
let hintSystem: HintSystem | null = null;
let inputMode: InputMode | null = null;
let linkSearchMode: LinkSearchMode | null = null;

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function init() {
  settings = await loadSettings();

  chrome.storage.onChanged.addListener((changes) => {
    for (const key of Object.keys(changes) as Array<keyof Settings>) {
      if (key in settings) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (settings as any)[key] = changes[key].newValue;
      }
    }
  });

  window.addEventListener("message", onFrameMessage);
  document.addEventListener("keydown", onKeyDown, true);
}

// ── Frame message handler ─────────────────────────────────────────────────

function onFrameMessage(e: MessageEvent) {
  if (!isHopkeyMsg(e.data)) return;

  const { type } = e.data;

  // Any frame handles focus_self (sent to it by the top frame)
  if (type === "focus_self") {
    focusSelf();
    return;
  }

  // Only the top frame acts as coordinator for next_frame / main_frame
  if (window !== window.top) return;

  if (type === "main_frame") {
    focusSelf();
    return;
  }

  if (type === "next_frame") {
    const iframes = visibleIframes();
    const senderWin = e.source as Window | null;
    const senderIdx = senderWin
      ? iframes.findIndex((f) => f.contentWindow === senderWin)
      : -1;

    if (iframes.length === 0 || senderIdx === iframes.length - 1) {
      // Last iframe (or none) → wrap back to top frame
      focusSelf();
    } else {
      const nextIdx = senderIdx === -1 ? 0 : senderIdx + 1;
      const nextWin = iframes[nextIdx].contentWindow;
      if (nextWin) send(nextWin, "focus_self");
    }
  }
}

// ── Key handler ───────────────────────────────────────────────────────────

function onKeyDown(e: KeyboardEvent) {
  const bindings = activeBindings();
  const bindingEntries = Object.entries(bindings) as Array<[ActionName, string]>;

  if (bindingEntries.length === 0) {
    seqBuffer = "";
    suppressSingleKeyUntil = 0;
    deactivateModes();
    return;
  }

  if (linkSearchMode?.active) {
    linkSearchMode.handleKey(e);
    return;
  }

  if (inputMode?.active) {
    inputMode.handleKey(e);
    return;
  }

  if (hintSystem?.active) {
    hintSystem.handleKey(e);
    return;
  }

  if (isEditable(e.target)) {
    if (e.key === "Escape") {
      seqBuffer = "";
      suppressSingleKeyUntil = 0;
      blurActiveEditableSoon();
    }
    return;
  }

  if (e.key === "Escape") {
    seqBuffer = "";
    suppressSingleKeyUntil = 0;
    return;
  }

  const keyStr = formatKeyEvent(e);
  if (!keyStr) return;

  if (Date.now() >= suppressSingleKeyUntil) {
    suppressSingleKeyUntil = 0;
  }

  seqBuffer += keyStr;

  // Exact match → execute
  const matched = bindingEntries.find(([, value]) => value === seqBuffer)?.[0];
  if (matched) {
    const matchedBinding = bindings[matched] ?? "";
    const isSingleKeyMatch = matchedBinding.length === 1;

    // Heuristic for sites with multi-key shortcuts (e.g. Gmail "gi"):
    // if an unhandled key was typed just before, let one single-key HopKey
    // command pass through so the page can complete its sequence.
    if (isSingleKeyMatch && suppressSingleKeyUntil > 0) {
      suppressSingleKeyUntil = 0;
      seqBuffer = "";
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    seqBuffer = "";
    runAction(matched);
    return;
  }

  // Valid prefix → keep waiting
  const isPrefix = bindingEntries.some(
    ([, value]) => value.startsWith(seqBuffer) && value !== seqBuffer,
  );
  if (isPrefix) {
    e.preventDefault();
    return;
  }

  // Dead end — pass through, and briefly suppress one single-key HopKey
  // command so websites can finish two-key sequences.
  if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1 && /^[a-zA-Z]$/.test(e.key)) {
    suppressSingleKeyUntil = Date.now() + 1200;
  }

  seqBuffer = "";
}

// ── Action dispatcher ─────────────────────────────────────────────────────

function runAction(action: ActionName) {
  switch (action) {
    case "followLink":         startHints("follow");           break;
    case "followLinkNewTab":   startHints("follow-new-tab");   break;
    case "followLinkNewWindow":startHints("follow-new-window");break;
    case "copyLink":           startHints("copy");             break;
    case "focusInput":         startInputMode();                break;
    case "searchLink":         startLinkSearchMode();           break;
    case "nextFrame":          switchFrame("next");            break;
    case "mainFrame":          switchFrame("main");            break;
  }
}

// ── Hint mode ─────────────────────────────────────────────────────────────

function startHints(action: HintAction) {
  hintSystem?.deactivate();
  inputMode?.deactivate();
  linkSearchMode?.deactivate();

  hintSystem = new HintSystem(settings, action, (url, el, act) => {
    hintSystem = null;
    performHintAction(url, el, act);
  });
  hintSystem.activate();
  if (!hintSystem.active) hintSystem = null;
}

// ── Input mode ────────────────────────────────────────────────────────────

function startInputMode() {
  inputMode?.deactivate();
  linkSearchMode?.deactivate();

  inputMode = new InputMode(
    {
      candidate: settings.inputCandidateColor,
      current: settings.inputCurrentColor,
    },
    () => {
      inputMode = null;
    },
  );
  inputMode.activate();
  if (!inputMode.active) inputMode = null;
}

function startLinkSearchMode() {
  linkSearchMode?.deactivate();
  inputMode?.deactivate();
  hintSystem?.deactivate();

  linkSearchMode = new LinkSearchMode(
    {
      candidateColor: settings.inputCandidateColor,
      currentColor: settings.inputCurrentColor,
      fuzzy: settings.linkSearchFuzzy,
    },
    (url, el, openInNewTab) => {
      linkSearchMode = null;
      if (openInNewTab) {
        if (url) window.open(url, "_blank");
        else activateElement(el);
      } else {
        if (url) window.location.href = url;
        else activateElement(el);
      }
    },
    () => {
      linkSearchMode = null;
    },
  );

  linkSearchMode.activate();
  if (!linkSearchMode.active) linkSearchMode = null;
}

// ── Frame switching ───────────────────────────────────────────────────────

function switchFrame(direction: "next" | "main") {
  const isTop = window === window.top;

  if (direction === "main") {
    if (isTop) focusSelf();
    else send(window.top!, "main_frame");
    return;
  }

  // "next" — top frame acts immediately; iframes delegate up
  if (isTop) {
    const iframes = visibleIframes();
    if (iframes.length === 0) return;

    // document.activeElement is the <iframe> element when focus is inside it
    const active = document.activeElement;
    const currentIdx =
      active instanceof HTMLIFrameElement ? iframes.indexOf(active) : -1;

    if (currentIdx === iframes.length - 1) {
      // Already at last iframe — wrap back to top
      focusSelf();
    } else {
      const nextIdx = currentIdx + 1; // -1+1=0 when top is focused → first iframe
      const nextWin = iframes[nextIdx].contentWindow;
      if (nextWin) send(nextWin, "focus_self");
    }
  } else {
    send(window.top!, "next_frame");
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function focusSelf() {
  try { window.focus(); } catch { /* cross-origin best-effort */ }

  const candidate = document.querySelector<HTMLElement>(
    '[tabindex="0"], a[href], button:not([disabled]), ' +
    "input:not([disabled]), textarea:not([disabled])",
  );
  if (candidate) {
    candidate.focus();
  } else {
    document.body?.setAttribute("tabindex", "-1");
    document.body?.focus();
    document.body?.removeAttribute("tabindex");
  }
}

/** Returns visible <iframe> elements in top-to-bottom, left-to-right order. */
function visibleIframes(): HTMLIFrameElement[] {
  const vh = window.innerHeight;
  return Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe"))
    .filter((f) => {
      const r = f.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top < vh && r.bottom > 0;
    })
    .sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const dy = ra.top - rb.top;
      return Math.abs(dy) > 8 ? dy : ra.left - rb.left;
    });
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function isEscBlurTarget(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || el.isContentEditable;
}

function blurActiveEditableSoon(): void {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return;
  if (!isEscBlurTarget(active)) return;

  queueMicrotask(() => {
    if (document.activeElement === active) {
      active.blur();
    }
  });
}

function deactivateModes() {
  hintSystem?.deactivate();
  inputMode?.deactivate();
  linkSearchMode?.deactivate();
  hintSystem = null;
  inputMode = null;
  linkSearchMode = null;
}

function activeBindings(): Partial<Record<ActionName, string>> {
  const allBindings: Record<ActionName, string> = {
    followLink: settings.followLink,
    followLinkNewTab: settings.followLinkNewTab,
    followLinkNewWindow: settings.followLinkNewWindow,
    copyLink: settings.copyLink,
    focusInput: settings.focusInput,
    searchLink: settings.searchLink,
    nextFrame: settings.nextFrame,
    mainFrame: settings.mainFrame,
  };

  const matchedRule = getEffectiveRule(settings.exclusionRules, window.location.href);
  if (!matchedRule) return allBindings;

  const passKeys = new Set(tokenizePassKeys(matchedRule.passKeys));
  if (passKeys.size === 0) return {};

  const filtered: Partial<Record<ActionName, string>> = {};
  for (const action of ACTION_NAMES) {
    const binding = allBindings[action];
    if (!passKeys.has(binding)) {
      filtered[action] = binding;
    }
  }

  return filtered;
}

// ── Go ────────────────────────────────────────────────────────────────────

init();

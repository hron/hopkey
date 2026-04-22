/**
 * HopKey content script — runs in every frame of every page.
 *
 * Frame switching (gf / gF) is coordinated purely through window.postMessage
 * between the content-script instances that live inside the same tab.
 * No background worker is involved.
 *
 *   ┌─ top frame (frameId 0) ──────────────────────────────────────────┐
 *   │  • Acts as coordinator for gf cycling                            │
 *   │  • Checks document.activeElement to find the focused iframe      │
 *   │  • Forwards focus_self to the target iframe's contentWindow      │
 *   └──────────────────────────────────────────────────────────────────┘
 *         ↑ postMessage: next_frame / main_frame
 *         ↓ postMessage: focus_self
 *   ┌─ iframe content scripts ─────────────────────────────────────────┐
 *   │  • Handle their own hints / gi                                    │
 *   │  • Delegate frame-switch requests up to window.top              │
 *   └──────────────────────────────────────────────────────────────────┘
 */

import { loadSettings, DEFAULT_SETTINGS } from "./lib/settings";
import type { Settings, ActionName } from "./lib/settings";
import { HintSystem, type HintAction } from "./lib/hints";
import { InputMode } from "./lib/input-mode";

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

let settings: Settings = { ...DEFAULT_SETTINGS };
let seqBuffer = "";
let hintSystem: HintSystem | null = null;
let inputMode: InputMode | null = null;

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
  if (inputMode?.active) {
    inputMode.handleKey(e);
    return;
  }

  if (hintSystem?.active) {
    hintSystem.handleKey(e);
    return;
  }

  if (isEditable(e.target)) return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;

  if (e.key === "Escape") {
    seqBuffer = "";
    return;
  }

  if (e.key.length !== 1) return;

  seqBuffer += e.key;

  const bindings = activeBindings();

  // Exact match → execute
  const matched = (Object.keys(bindings) as ActionName[]).find(
    (a) => bindings[a] === seqBuffer,
  );
  if (matched) {
    e.preventDefault();
    e.stopPropagation();
    seqBuffer = "";
    runAction(matched);
    return;
  }

  // Valid prefix → keep waiting
  const isPrefix = (Object.values(bindings) as string[]).some(
    (v) => v.startsWith(seqBuffer) && v !== seqBuffer,
  );
  if (isPrefix) {
    e.preventDefault();
    return;
  }

  // Dead end — restart with current key
  const lastKey = e.key;
  seqBuffer = "";

  const freshMatch = (Object.keys(bindings) as ActionName[]).find(
    (a) => bindings[a] === lastKey,
  );
  if (freshMatch) {
    e.preventDefault();
    e.stopPropagation();
    runAction(freshMatch);
    return;
  }

  if (
    (Object.values(bindings) as string[]).some(
      (v) => v.startsWith(lastKey) && v !== lastKey,
    )
  ) {
    seqBuffer = lastKey;
    e.preventDefault();
  }
}

// ── Action dispatcher ─────────────────────────────────────────────────────

function runAction(action: ActionName) {
  switch (action) {
    case "followLink":       startHints("follow");          break;
    case "followLinkNewTab": startHints("follow-new-tab");  break;
    case "copyLink":         startHints("copy");            break;
    case "focusInput":       startInputMode();              break;
    case "nextFrame":        switchFrame("next");           break;
    case "mainFrame":        switchFrame("main");           break;
  }
}

// ── Hint mode ─────────────────────────────────────────────────────────────

function startHints(action: HintAction) {
  hintSystem?.deactivate();
  hintSystem = new HintSystem(settings, action, (url, el, act) => {
    hintSystem = null;
    performHintAction(url, el, act);
  });
  hintSystem.activate();
  if (!hintSystem.active) hintSystem = null;
}

function performHintAction(
  url: string | null,
  el: HTMLElement,
  action: HintAction,
) {
  if (action === "follow") {
    if (url) window.location.href = url;
    else el.click();
    return;
  }

  if (action === "follow-new-tab") {
    // window.open is not subject to the page's CSP when called from a
    // content script, and counts as a user gesture (triggered by keydown).
    if (url) window.open(url, "_blank");
    else el.click();
    return;
  }

  if (action === "copy") {
    const text = url ?? el.textContent?.trim() ?? "";
    navigator.clipboard.writeText(text).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(ta);
      ta.select();
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      document.execCommand("copy");
      ta.remove();
    });
  }
}

// ── Input mode ────────────────────────────────────────────────────────────

function startInputMode() {
  inputMode?.deactivate();
  inputMode = new InputMode(() => { inputMode = null; });
  inputMode.activate();
  if (!inputMode.active) inputMode = null;
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

function activeBindings(): Record<ActionName, string> {
  return {
    followLink:       settings.followLink,
    followLinkNewTab: settings.followLinkNewTab,
    copyLink:         settings.copyLink,
    focusInput:       settings.focusInput,
    nextFrame:        settings.nextFrame,
    mainFrame:        settings.mainFrame,
  };
}

// ── Go ────────────────────────────────────────────────────────────────────

init();

/**
 * Performs the action selected via hint mode.
 * Extracted to a testable module.
 */

export function activateElement(el: HTMLElement): void {
  const target = resolveActivationTarget(el);
  const rect = target.getBoundingClientRect();

  const x = Math.round(
    Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2)),
  );
  const y = Math.round(
    Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2)),
  );

  const mouseInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    button: 0,
    clientX: x,
    clientY: y,
  };

  let pointerInit: PointerEventInit | null = null;
  if (typeof PointerEvent === "function") {
    pointerInit = {
      ...mouseInit,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    };
    target.dispatchEvent(new PointerEvent("pointerdown", pointerInit));
  }

  target.dispatchEvent(new MouseEvent("mousedown", mouseInit));

  if (pointerInit) {
    target.dispatchEvent(new PointerEvent("pointerup", pointerInit));
  }

  target.dispatchEvent(new MouseEvent("mouseup", mouseInit));
  target.click();
}

function resolveActivationTarget(el: HTMLElement): HTMLElement {
  const target = el.closest<HTMLElement>(
    'button, a[href], input, select, textarea, summary, label, ' +
    '[role="button"], [role="link"], [role="tab"], [onclick], [contenteditable]',
  );
  return target ?? el;
}

export type HintAction = "follow" | "follow-new-tab" | "follow-new-window" | "copy";

export function performHintAction(
  url: string | null,
  el: HTMLElement,
  action: HintAction,
): void {
  if (action === "follow") {
    if (url) window.location.href = url;
    else activateElement(el);
    return;
  }

  if (action === "follow-new-tab") {
    if (url) window.open(url, "_blank");
    else activateElement(el);
    return;
  }

  if (action === "follow-new-window") {
    if (url) {
      chrome.runtime.sendMessage(
        { type: "openNewWindow", url },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error(
              "[HopKey] Failed to open new window:",
              chrome.runtime.lastError.message,
            );
          }
        },
      );
    } else {
      activateElement(el);
    }
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

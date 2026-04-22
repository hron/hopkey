/**
 * `gi` mode: highlights visible <textarea> elements on the page and lets the
 * user cycle through them with Tab / Shift-Tab. Escape exits the mode.
 */
export class InputMode {
  private inputs: HTMLElement[] = [];
  private readonly onExit: () => void;
  private _active = false;
  private styleEl: HTMLStyleElement | null = null;

  // Bound reference so we can remove it later
  private readonly keyHandler = this.handleKey.bind(this);
  private readonly blurHandler = this.handleBlur.bind(this);

  constructor(onExit: () => void) {
    this.onExit = onExit;
  }

  get active() {
    return this._active;
  }

  activate(): void {
    const inputs = collectInputs();
    if (inputs.length === 0) return;

    this._active = true;
    this.inputs = inputs;

    // Inject highlight style via a <style> tag so it survives CSP rules that
    // block inline style mutations on some pages.
    this.styleEl = document.createElement("style");
    this.styleEl.textContent = `
      .hopkey-gi-highlight {
        outline: 2px solid #4f46e5 !important;
        outline-offset: 2px !important;
      }
    `;
    document.head.appendChild(this.styleEl);

    this.inputs.forEach((el) => el.classList.add("hopkey-gi-highlight"));
    this.inputs[0].focus();

    document.addEventListener("keydown", this.keyHandler, true);
    // Exit when the user clicks outside of any highlighted input
    document.addEventListener("focusout", this.blurHandler, true);
  }

  deactivate(): void {
    if (!this._active) return;
    this._active = false;

    this.inputs.forEach((el) => el.classList.remove("hopkey-gi-highlight"));
    this.styleEl?.remove();
    this.styleEl = null;
    this.inputs = [];

    document.removeEventListener("keydown", this.keyHandler, true);
    document.removeEventListener("focusout", this.blurHandler, true);
    this.onExit();
  }

  handleKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      (document.activeElement as HTMLElement | null)?.blur();
      this.deactivate();
      return;
    }

    if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();

      const idx = this.inputs.indexOf(
        document.activeElement as HTMLElement,
      );
      const next = e.shiftKey
        ? (idx - 1 + this.inputs.length) % this.inputs.length
        : (idx + 1) % this.inputs.length;

      this.inputs[next].focus();
    }
    // All other keys pass through to the focused input normally
  }

  // ── private ──────────────────────────────────────────────────────────────

  private handleBlur(e: FocusEvent): void {
    // relatedTarget is the element receiving focus next
    const next = e.relatedTarget as HTMLElement | null;
    if (next && this.inputs.includes(next)) return; // still within our set
    // Small timeout so browser can settle before we check activeElement
    setTimeout(() => {
      if (!this.inputs.includes(document.activeElement as HTMLElement)) {
        this.deactivate();
      }
    }, 50);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

const INPUT_SELECTOR = "textarea:not([disabled])";

function collectInputs(): HTMLElement[] {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  return Array.from(document.querySelectorAll<HTMLElement>(INPUT_SELECTOR))
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw)
        return false;
      const s = getComputedStyle(el);
      return s.visibility !== "hidden" && s.display !== "none";
    })
    .sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const dy = ra.top - rb.top;
      return Math.abs(dy) > 8 ? dy : ra.left - rb.left;
    });
}

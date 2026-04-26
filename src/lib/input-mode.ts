/**
 * Input focus mode: highlights visible text-entry fields (Vimium-like filtering)
 * and lets the user cycle a "current" candidate with Tab / Shift-Tab.
 *
 * This uses Vimium's core approach: draw independent overlay
 * rectangles on top of inputs (instead of styling inputs directly).
 *
 * Behavior:
 * - Esc: exit mode (no focus changes)
 * - Tab / Shift-Tab: move current highlight
 * - Enter: focus current input
 * - Any printable key: focus current input and insert that key immediately
 */
export class InputMode {
  private entries: OverlayEntry[] = [];
  private selectedIndex = 0;
  private readonly onExit: () => void;
  private readonly candidateColor: string;
  private readonly currentColor: string;
  private readonly candidateFill: string;
  private readonly currentFill: string;
  private readonly currentHalo: string;
  private _active = false;
  private markerContainer: HTMLDivElement | null = null;
  private refreshRaf = 0;

  private readonly viewportHandler = this.onViewportChanged.bind(this);

  constructor(
    colors: { candidate: string; current: string },
    onExit: () => void,
  ) {
    this.candidateColor = safeHexColor(colors.candidate, "#60a5fa");
    this.currentColor = safeHexColor(colors.current, "#f59e0b");

    const alpha = getOverlayAlphaTuning();
    this.candidateFill =
      hexToRgba(this.candidateColor, alpha.candidate) ??
      `rgba(96, 165, 250, ${alpha.candidate})`;
    this.currentFill =
      hexToRgba(this.currentColor, alpha.current) ??
      `rgba(245, 158, 11, ${alpha.current})`;
    this.currentHalo =
      hexToRgba(this.currentColor, alpha.halo) ??
      `rgba(245, 158, 11, ${alpha.halo})`;

    this.onExit = onExit;
  }

  get active() {
    return this._active;
  }

  activate(): void {
    const inputs = collectInputs();
    if (inputs.length === 0) return;

    this._active = true;
    this.selectedIndex = 0;

    const container = document.createElement("div");
    container.id = "hopkey-input-marker-container";
    container.style.cssText = [
      "position:fixed",
      "left:0",
      "top:0",
      "width:100%",
      "height:100%",
      "pointer-events:none",
      "z-index:2147483647",
      "margin:0",
      "border:none",
      "padding:0",
      "overflow:visible",
    ].join(";");
    document.body.appendChild(container);
    this.markerContainer = container;

    this.entries = inputs.map((element) => {
      const marker = document.createElement("div");
      marker.style.cssText = [
        "position:absolute",
        "display:block",
        "pointer-events:none",
        "box-sizing:border-box",
        "margin:0",
        "padding:0",
      ].join(";");
      container.appendChild(marker);
      return { element, marker };
    });

    this.updateMarkerRects();
    this.applyMarkerStyles();
    this.bindViewportListeners();
  }

  deactivate(): void {
    if (!this._active) return;
    this._active = false;

    this.unbindViewportListeners();

    if (this.refreshRaf) {
      cancelAnimationFrame(this.refreshRaf);
      this.refreshRaf = 0;
    }

    if (this.markerContainer) {
      this.markerContainer.remove();
    }
    this.markerContainer = null;
    this.entries = [];
    this.selectedIndex = 0;

    this.onExit();
  }

  handleKey(e: KeyboardEvent): void {
    if (!this._active) return;

    // In input mode, Ctrl/Cmd+V should paste into the currently highlighted input.
    // We focus it first, then let the same key event continue naturally.
    if (isPasteChord(e)) {
      this.commitSelection();
      return;
    }

    // Allow other browser/OS/system shortcuts through.
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this.deactivate();
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      this.moveSelection(e.shiftKey ? -1 : 1);
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      this.commitSelection();
      return;
    }

    if (isPrintableKey(e)) {
      e.preventDefault();
      e.stopPropagation();
      this.commitSelection(e.key);
      return;
    }

    // Keep mode stable on other keys.
    e.preventDefault();
    e.stopPropagation();
  }

  // ── private ──────────────────────────────────────────────────────────────

  private bindViewportListeners(): void {
    window.addEventListener("scroll", this.viewportHandler, true);
    window.addEventListener("resize", this.viewportHandler, true);
  }

  private unbindViewportListeners(): void {
    window.removeEventListener("scroll", this.viewportHandler, true);
    window.removeEventListener("resize", this.viewportHandler, true);
  }

  private onViewportChanged(): void {
    if (!this._active || this.refreshRaf) return;
    this.refreshRaf = requestAnimationFrame(() => {
      this.refreshRaf = 0;
      this.updateMarkerRects();
    });
  }

  private updateMarkerRects(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    for (const { element, marker } of this.entries) {
      const rect = element.getBoundingClientRect();
      const hidden =
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.bottom < 0 ||
        rect.top > vh ||
        rect.right < 0 ||
        rect.left > vw ||
        !isRendered(element);

      if (hidden) {
        marker.style.display = "none";
        continue;
      }

      marker.style.display = "block";
      marker.style.left = `${Math.round(rect.left)}px`;
      marker.style.top = `${Math.round(rect.top)}px`;
      marker.style.width = `${Math.round(rect.width)}px`;
      marker.style.height = `${Math.round(rect.height)}px`;
      marker.style.borderRadius = getComputedStyle(element).borderRadius;
    }
  }

  private applyMarkerStyles(): void {
    this.entries.forEach(({ marker }, i) => {
      marker.style.backgroundColor = this.candidateFill;
      marker.style.border = `1px solid ${this.candidateColor}`;
      marker.style.boxShadow = "none";

      if (i === this.selectedIndex) {
        marker.style.backgroundColor = this.currentFill;
        marker.style.border = `2px solid ${this.currentColor}`;
        marker.style.boxShadow = `0 0 0 2px ${this.currentHalo}`;
      }
    });
  }

  private moveSelection(delta: number): void {
    if (this.entries.length === 0) return;
    this.selectedIndex =
      (this.selectedIndex + delta + this.entries.length) % this.entries.length;
    this.applyMarkerStyles();
  }

  private commitSelection(initialChar?: string): void {
    const target = this.entries[this.selectedIndex]?.element;
    if (!target) {
      this.deactivate();
      return;
    }

    this.deactivate();
    target.focus();

    if (initialChar) {
      routePrintableToInput(target, initialChar);
    }
  }
}

interface OverlayEntry {
  element: HTMLElement;
  marker: HTMLDivElement;
}

// ── helpers ──────────────────────────────────────────────────────────────────

const INPUT_SELECTOR = "input, textarea, [contenteditable]";
const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "number",
  "password",
  "date",
  "tel",
]);

interface OverlayAlphaTuning {
  candidate: number;
  current: number;
  halo: number;
}

function getOverlayAlphaTuning(): OverlayAlphaTuning {
  const isDark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;

  if (isDark) {
    return {
      candidate: 0.32,
      current: 0.42,
      halo: 0.55,
    };
  }

  return {
    candidate: 0.22,
    current: 0.30,
    halo: 0.35,
  };
}

function collectInputs(): HTMLElement[] {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  return Array.from(document.querySelectorAll<HTMLElement>(INPUT_SELECTOR))
    .filter(isInputFocusTarget)
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw)
        return false;
      return isRendered(el);
    })
    .sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const dy = ra.top - rb.top;
      return Math.abs(dy) > 8 ? dy : ra.left - rb.left;
    });
}

function isInputFocusTarget(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement) {
    if (el.disabled || el.readOnly) return false;
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    return type === "" || TEXT_INPUT_TYPES.has(type);
  }

  if (el instanceof HTMLTextAreaElement) {
    return !el.disabled && !el.readOnly;
  }

  const ce = el.getAttribute("contenteditable");
  if (ce === null) return false;
  return ce === "" || ce.toLowerCase() === "true";
}

function isRendered(el: HTMLElement): boolean {
  const s = getComputedStyle(el);
  return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
}

function isPrintableKey(e: KeyboardEvent): boolean {
  return e.key.length === 1;
}

function isPasteChord(e: KeyboardEvent): boolean {
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && !e.altKey && key === "v") return true;
  if (!e.ctrlKey && !e.metaKey && !e.altKey && e.shiftKey && e.key === "Insert") {
    return true;
  }
  return false;
}

function routePrintableToInput(target: HTMLElement, char: string): void {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    if (target.disabled || target.readOnly) return;

    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    target.setRangeText(char, start, end, "end");
    target.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: "insertText",
        data: char,
      }),
    );
    return;
  }

  if (target.isContentEditable) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const ok = document.execCommand("insertText", false, char);
      if (ok) return;
    } catch {
      // fallback below
    }

    const sel = window.getSelection();
    if (!sel) return;

    let range: Range;
    if (sel.rangeCount > 0) {
      range = sel.getRangeAt(0);
    } else {
      range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      sel.addRange(range);
    }

    if (!target.contains(range.startContainer)) {
      range.selectNodeContents(target);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    range.deleteContents();
    const node = document.createTextNode(char);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);

    target.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: "insertText",
        data: char,
      }),
    );
  }
}

function safeHexColor(value: string, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

function hexToRgba(hex: string, alpha: number): string | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return null;
  const v = m[1];
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

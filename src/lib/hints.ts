import type { Settings } from "../lib/settings";

export type HintAction = "follow" | "follow-new-tab" | "copy";

interface HintEntry {
  label: string;
  element: HTMLElement;
  hintEl: HTMLElement;
}

/**
 * Generates and manages the visual hint overlay for link selection.
 *
 * Layout strategy: a `position:fixed` container covers the viewport so
 * hint badges can be placed with `position:fixed` coordinates taken
 * directly from `getBoundingClientRect()` — no scroll offset needed.
 * The container uses `pointer-events:none` so it never blocks clicks.
 */
export class HintSystem {
  private readonly settings: Settings;
  private readonly action: HintAction;
  private readonly onSelect: (url: string | null, el: HTMLElement, action: HintAction) => void;

  private container: HTMLElement | null = null;
  private hints: HintEntry[] = [];
  private typed = "";
  private _active = false;

  constructor(
    settings: Settings,
    action: HintAction,
    onSelect: (url: string | null, el: HTMLElement, action: HintAction) => void,
  ) {
    this.settings = settings;
    this.action = action;
    this.onSelect = onSelect;
  }

  get active() {
    return this._active;
  }

  activate(): void {
    this._active = true;
    this.typed = "";
    this.hints = [];
    this.buildOverlay();
    if (this.hints.length === 0) {
      this.deactivate();
    }
  }

  deactivate(): void {
    this._active = false;
    this.teardown();
  }

  handleKey(e: KeyboardEvent): void {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      this.deactivate();
      return;
    }

    if (e.key === "Backspace") {
      if (this.typed.length > 0) {
        this.typed = this.typed.slice(0, -1);
        this.refreshFilter();
      }
      return;
    }

    if (e.key.length !== 1) return;

    const ch = e.key.toLowerCase();
    if (!this.settings.hintChars.toLowerCase().includes(ch)) return;

    this.typed += ch;

    const match = this.hints.find((h) => h.label === this.typed);
    if (match) {
      const url = getHref(match.element);
      this.deactivate();
      this.onSelect(url, match.element, this.action);
      return;
    }

    this.refreshFilter();

    const remaining = this.hints.filter((h) => h.label.startsWith(this.typed));
    if (remaining.length === 0) {
      this.deactivate();
    }
  }

  // ── private ──────────────────────────────────────────────────────────────

  private buildOverlay(): void {
    const links = collectVisibleLinks();
    if (links.length === 0) return;

    const labels = this.generateLabels(links.length);

    this.container = document.createElement("div");
    Object.assign(this.container.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "2147483647",
    });
    document.documentElement.appendChild(this.container);

    links.forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      const label = labels[i];

      const badge = document.createElement("div");
      badge.dataset.label = label;
      badge.style.cssText = [
        "position:fixed",
        `left:${Math.round(rect.left)}px`,
        `top:${Math.round(rect.top)}px`,
        "transform:translateY(-100%)",
        "background:#ffea00",
        "color:#000",
        "font:bold 11px/16px 'SF Mono',ui-monospace,monospace",
        "padding:0 3px",
        "border:1px solid #c8a000",
        "border-radius:2px",
        "box-shadow:0 1px 4px rgba(0,0,0,.35)",
        "white-space:nowrap",
        "pointer-events:none",
        "letter-spacing:.5px",
      ].join(";");

      badge.textContent = this.settings.hintUpperCase
        ? label.toUpperCase()
        : label;

      this.container!.appendChild(badge);
      this.hints.push({ label, element: el, hintEl: badge });
    });
  }

  private refreshFilter(): void {
    const typed = this.typed;
    this.hints.forEach((h) => {
      if (!h.label.startsWith(typed)) {
        h.hintEl.style.display = "none";
        return;
      }
      h.hintEl.style.display = "";
      // Dim already-typed prefix, highlight remaining
      if (typed.length > 0) {
        const dim = document.createElement("span");
        dim.style.cssText = "color:#999;font-weight:normal";
        dim.textContent = this.settings.hintUpperCase
          ? typed.toUpperCase()
          : typed;

        const rest = document.createElement("span");
        rest.textContent = this.settings.hintUpperCase
          ? h.label.slice(typed.length).toUpperCase()
          : h.label.slice(typed.length);

        h.hintEl.replaceChildren(dim, rest);
      } else {
        h.hintEl.textContent = this.settings.hintUpperCase
          ? h.label.toUpperCase()
          : h.label;
      }
    });
  }

  private teardown(): void {
    this.container?.remove();
    this.container = null;
    this.hints = [];
    this.typed = "";
  }

  /**
   * Distribute labels so that after typing ONE character the visible hints
   * are spread across many first-characters (up to hintChars.length hints
   * per first character).  For ≤N links (N = hintChars.length) every hint
   * has a unique first character so a single keystroke selects it.
   *
   *   row = i % N   → first character
   *   col = i / N   → second character
   */
  private generateLabels(count: number): string[] {
    const chars = this.settings.hintChars.toLowerCase();
    const n = chars.length;
    const labels: string[] = [];
    for (let i = 0; i < count && i < n * n; i++) {
      const row = i % n;
      const col = Math.floor(i / n);
      labels.push(chars[row] + chars[col]);
    }
    return labels;
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function getHref(el: HTMLElement): string | null {
  if (el instanceof HTMLAnchorElement && el.href) return el.href;
  // Some SPAs wrap non-anchor elements in a link-like role
  const anchor = el.closest("a[href]") as HTMLAnchorElement | null;
  return anchor?.href ?? null;
}

function collectVisibleLinks(): HTMLElement[] {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [role="link"], [role="button"]',
    ),
  );

  return candidates
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (r.bottom < 0 || r.top > vh) return false;
      if (r.right < 0 || r.left > vw) return false;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none" || s.opacity === "0")
        return false;
      return true;
    })
    .sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const dy = ra.top - rb.top;
      return Math.abs(dy) > 8 ? dy : ra.left - rb.left;
    });
}

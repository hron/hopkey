import type { Settings } from "../lib/settings";

export type HintAction = "follow" | "follow-new-tab" | "copy";

interface HintEntry {
  label: string;
  element: HTMLElement;
  hintEl: HTMLElement;
}

const HINT_EDGE_MARGIN_PX = 1;

const HINT_OVERLAY_CSS = `
  :host {
    all: initial;
    color-scheme: light dark;
    forced-color-adjust: none;

    --hopkey-hint-bg: #ffea00;
    --hopkey-hint-fg: #111111;
    --hopkey-hint-border: #c8a000;
    --hopkey-hint-shadow: rgba(0, 0, 0, 0.35);
    --hopkey-hint-prefix: #6b6b6b;
  }

  @media (prefers-color-scheme: dark) {
    :host {
      --hopkey-hint-bg: #3a2d00;
      --hopkey-hint-fg: #ffe08a;
      --hopkey-hint-border: #ffcf5a;
      --hopkey-hint-shadow: rgba(0, 0, 0, 0.7);
      --hopkey-hint-prefix: #b7a26b;
    }
  }

  .hopkey-hint-badge {
    position: fixed;
    background: var(--hopkey-hint-bg);
    color: var(--hopkey-hint-fg);
    font: bold 11px/16px 'SF Mono', ui-monospace, monospace;
    padding: 0 3px;
    border: 1px solid var(--hopkey-hint-border);
    border-radius: 2px;
    box-shadow: 0 1px 4px var(--hopkey-hint-shadow);
    white-space: nowrap;
    pointer-events: none;
    letter-spacing: 0.5px;
    text-shadow: none;
    filter: none;
    mix-blend-mode: normal;
  }

  .hopkey-hint-prefix {
    color: var(--hopkey-hint-prefix);
    font-weight: normal;
  }
`;

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
  private readonly onSelect: (
    url: string | null,
    el: HTMLElement,
    action: HintAction,
  ) => void;

  private container: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
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
      e.stopImmediatePropagation();
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

    this.shadow = this.container.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = HINT_OVERLAY_CSS;
    this.shadow.appendChild(style);

    document.documentElement.appendChild(this.container);

    links.forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      const label = labels[i];
      if (!label) return;

      const badge = document.createElement("div");
      badge.className = "hopkey-hint-badge";
      badge.dataset.label = label;

      badge.textContent = this.settings.hintUpperCase
        ? label.toUpperCase()
        : label;

      this.shadow!.appendChild(badge);
      this.positionBadge(badge, rect);
      this.hints.push({ label, element: el, hintEl: badge });
    });
  }

  private positionBadge(badge: HTMLElement, rect: DOMRect): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const badgeWidth = badge.offsetWidth;
    const badgeHeight = badge.offsetHeight;

    const minLeft = HINT_EDGE_MARGIN_PX;
    const maxLeft = Math.max(minLeft, vw - badgeWidth - HINT_EDGE_MARGIN_PX);

    const minTop = HINT_EDGE_MARGIN_PX;
    const maxTop = Math.max(minTop, vh - badgeHeight - HINT_EDGE_MARGIN_PX);

    let left = Math.round(rect.left);
    let top = Math.round(rect.top - badgeHeight);

    // Near top edge: place the hint on top of the target so it stays readable.
    if (top < minTop) {
      top = rect.top;
    }

    left = clamp(left, minLeft, maxLeft);
    top = clamp(top, minTop, maxTop);

    badge.style.left = `${left}px`;
    badge.style.top = `${top}px`;
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
        dim.className = "hopkey-hint-prefix";
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
    this.shadow = null;
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

  // Vimium-like candidate discovery: scan all elements (including shadow DOM)
  // and keep those that are likely clickable.
  const all = collectAllElements(document.documentElement);
  const candidates = all.filter(isPotentiallyClickable);

  return candidates
    .filter((el) => isUserVisibleAndClickable(el, vw, vh))
    .sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const dy = ra.top - rb.top;
      return Math.abs(dy) > 8 ? dy : ra.left - rb.left;
    });
}

function collectAllElements(root: ParentNode | null): HTMLElement[] {
  if (!root) return [];

  const out: HTMLElement[] = [];
  const stack: ParentNode[] = [root];

  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const el of Array.from(node.querySelectorAll<HTMLElement>("*"))) {
      out.push(el);
      if (el.shadowRoot) {
        stack.push(el.shadowRoot);
      }
    }
  }

  return out;
}

const CLICKABLE_ROLES = new Set([
  "button",
  "tab",
  "link",
  "checkbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "radio",
  "textbox",
]);

const CLICKABLE_INPUT_TYPES = new Set([
  "button",
  "submit",
  "reset",
  "image",
  "file",
  "checkbox",
  "radio",
  "color",
  "range",
]);

const EXPLICIT_CLICKABLE_SELECTOR =
  "a[href], button, select, input, textarea, summary, details, label, " +
  '[role], [onclick], [contenteditable], [tabindex]:not([tabindex="-1"])';

function hasExplicitClickableDescendant(el: Element): boolean {
  return !!el.querySelector(EXPLICIT_CLICKABLE_SELECTOR);
}

function hasPointerCursorOnSelfOrChildren(el: Element): boolean {
  if (getComputedStyle(el).cursor === "pointer") return true;
  for (const child of Array.from(el.children)) {
    if (getComputedStyle(child).cursor === "pointer") return true;
  }
  return false;
}

function isPotentiallyClickable(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();

  if (tag === "a") {
    return !!(el as HTMLAnchorElement).href;
  }

  if (tag === "button" || tag === "select") {
    return !(el as HTMLButtonElement | HTMLSelectElement).disabled;
  }

  if (tag === "input") {
    const input = el as HTMLInputElement;
    if (input.disabled) return false;
    const type = (input.getAttribute("type") ?? "text").toLowerCase();
    return CLICKABLE_INPUT_TYPES.has(type);
  }

  if (tag === "summary" || tag === "details" || tag === "label") {
    return true;
  }

  if (el.hasAttribute("onclick")) {
    return true;
  }

  const role = el.getAttribute("role")?.toLowerCase();
  if (role && CLICKABLE_ROLES.has(role)) {
    return true;
  }

  const ce = el.getAttribute("contenteditable");
  if (
    ce != null &&
    ["", "true", "contenteditable"].includes(ce.toLowerCase())
  ) {
    return true;
  }

  const tabindex = el.getAttribute("tabindex");
  if (tabindex != null && Number(tabindex) >= 0) {
    return true;
  }

  // Heuristic for JS-only custom elements (e.g. <theme-switcher> with click
  // handler on host and clickable SVG child).
  if (tag.includes("-") && !hasExplicitClickableDescendant(el)) {
    return hasPointerCursorOnSelfOrChildren(el);
  }

  return false;
}

function isUserVisibleAndClickable(
  el: HTMLElement,
  vw: number,
  vh: number,
): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  if (r.bottom < 0 || r.top > vh) return false;
  if (r.right < 0 || r.left > vw) return false;

  const s = getComputedStyle(el);
  if (s.visibility === "hidden" || s.display === "none") {
    return false;
  }

  // Keep hover-revealed controls (often opacity:0 / pointer-events:none until hover).
  // We still require viewport intersection + top-most hit-testing to avoid obvious noise.
  return isTopMostAtAnySamplePoint(el, r, vw, vh);
}

function isTopMostAtAnySamplePoint(
  el: HTMLElement,
  rect: DOMRect,
  vw: number,
  vh: number,
): boolean {
  const left = Math.max(0, Math.min(vw - 1, rect.left));
  const right = Math.max(0, Math.min(vw - 1, rect.right - 1));
  const top = Math.max(0, Math.min(vh - 1, rect.top));
  const bottom = Math.max(0, Math.min(vh - 1, rect.bottom - 1));

  const cx = Math.round((left + right) / 2);
  const cy = Math.round((top + bottom) / 2);

  const points: Array<[number, number]> = [
    [cx, cy],
    [Math.round(left + 1), Math.round(top + 1)],
    [Math.round(right - 1), Math.round(top + 1)],
    [Math.round(left + 1), Math.round(bottom - 1)],
    [Math.round(right - 1), Math.round(bottom - 1)],
  ];

  for (const [x, y] of points) {
    if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
    const topEl = document.elementFromPoint(x, y);
    if (!(topEl instanceof Element)) continue;

    if (topEl === el || el.contains(topEl) || topEl.contains(el)) {
      return true;
    }
  }

  return false;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

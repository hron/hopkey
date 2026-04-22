export interface LinkSearchModeOptions {
  candidateColor: string;
  currentColor: string;
  fuzzy: boolean;
}

export class LinkSearchMode {
  private entries: LinkEntry[] = [];
  private readonly options: LinkSearchModeOptions;
  private readonly onSelect: (
    url: string | null,
    el: HTMLElement,
    openInNewTab: boolean,
  ) => void;
  private readonly onExit: () => void;

  private query = "";
  private matches: number[] = [];
  private selectedPos = 0;
  private _active = false;

  private markerContainer: HTMLDivElement | null = null;
  private hudEl: HTMLDivElement | null = null;
  private refreshRaf = 0;

  private readonly viewportHandler = this.onViewportChanged.bind(this);

  constructor(
    options: LinkSearchModeOptions,
    onSelect: (url: string | null, el: HTMLElement, openInNewTab: boolean) => void,
    onExit: () => void,
  ) {
    this.options = {
      candidateColor: safeHexColor(options.candidateColor, "#60a5fa"),
      currentColor: safeHexColor(options.currentColor, "#f59e0b"),
      fuzzy: options.fuzzy,
    };
    this.onSelect = onSelect;
    this.onExit = onExit;
  }

  get active() {
    return this._active;
  }

  activate(): void {
    const links = collectVisibleLinks();
    if (links.length === 0) return;

    this._active = true;
    this.query = "";
    this.matches = [];
    this.selectedPos = 0;

    const container = document.createElement("div");
    container.id = "hopkey-link-search-marker-container";
    container.style.cssText = [
      "position:absolute",
      "left:0",
      "top:0",
      "width:0",
      "height:0",
      "pointer-events:none",
      "z-index:2147483647",
    ].join(";");
    (document.documentElement ?? document.body).appendChild(container);
    this.markerContainer = container;

    this.entries = links.map((element) => {
      const marker = document.createElement("div");
      marker.style.cssText = [
        "position:absolute",
        "display:none",
        "pointer-events:none",
        "box-sizing:border-box",
        "margin:0",
        "padding:0",
      ].join(";");
      container.appendChild(marker);

      return {
        element,
        marker,
        text: searchableText(element),
        visible: true,
      };
    });

    this.hudEl = document.createElement("div");
    this.hudEl.id = "hopkey-link-search-hud";
    this.hudEl.style.cssText = [
      "position:fixed",
      "right:14px",
      "bottom:14px",
      "max-width:min(60vw,640px)",
      "padding:8px 10px",
      "border-radius:8px",
      "font:600 12px/1.3 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      "background:rgba(17,24,39,.92)",
      "color:#f8fafc",
      "box-shadow:0 6px 20px rgba(0,0,0,.35)",
      "letter-spacing:.01em",
      "z-index:2147483647",
      "pointer-events:none",
      "white-space:pre-wrap",
      "word-break:break-word",
    ].join(";");
    document.documentElement.appendChild(this.hudEl);

    this.updateMarkerRects();
    this.applyMatches();
    this.updateHud();
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

    this.markerContainer?.remove();
    this.hudEl?.remove();

    this.markerContainer = null;
    this.hudEl = null;
    this.entries = [];
    this.query = "";
    this.matches = [];
    this.selectedPos = 0;

    this.onExit();
  }

  handleKey(e: KeyboardEvent): void {
    if (!this._active) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this.deactivate();
      return;
    }

    if (e.key === "Backspace") {
      e.preventDefault();
      e.stopPropagation();
      this.query = this.query.slice(0, -1);
      this.recomputeMatches();
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      if (this.matches.length > 0) {
        this.selectedPos =
          (this.selectedPos + (e.shiftKey ? -1 : 1) + this.matches.length) %
          this.matches.length;
        this.applyMatches();
        this.updateHud();
      }
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      this.commitSelection(e.shiftKey);
      return;
    }

    // Allow browser shortcuts to pass through.
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (isPrintableKey(e)) {
      e.preventDefault();
      e.stopPropagation();
      this.query += e.key;
      this.recomputeMatches();
      return;
    }

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
      this.recomputeMatches();
    });
  }

  private updateMarkerRects(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    for (const entry of this.entries) {
      const rect = entry.element.getBoundingClientRect();
      const hidden =
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.bottom < 0 ||
        rect.top > vh ||
        rect.right < 0 ||
        rect.left > vw ||
        !isRendered(entry.element) ||
        !isTopMostAtAnySamplePoint(entry.element, rect, vw, vh);

      entry.visible = !hidden;

      if (hidden) {
        entry.marker.style.display = "none";
        continue;
      }

      entry.marker.style.left = `${Math.round(rect.left + window.scrollX)}px`;
      entry.marker.style.top = `${Math.round(rect.top + window.scrollY)}px`;
      entry.marker.style.width = `${Math.round(rect.width)}px`;
      entry.marker.style.height = `${Math.round(rect.height)}px`;
      entry.marker.style.borderRadius = getComputedStyle(entry.element).borderRadius;
    }
  }

  private recomputeMatches(): void {
    this.matches = rankedMatches(this.entries, this.query, this.options.fuzzy);
    if (this.selectedPos >= this.matches.length) {
      this.selectedPos = 0;
    }
    this.applyMatches();
    this.updateHud();
  }

  private applyMatches(): void {
    const candidateFill =
      hexToRgba(this.options.candidateColor, 0.22) ?? "rgba(96, 165, 250, 0.22)";
    const currentFill =
      hexToRgba(this.options.currentColor, 0.30) ?? "rgba(245, 158, 11, 0.30)";
    const currentHalo =
      hexToRgba(this.options.currentColor, 0.35) ?? "rgba(245, 158, 11, 0.35)";

    for (const entry of this.entries) {
      entry.marker.style.display = "none";
    }

    for (const idx of this.matches) {
      const entry = this.entries[idx];
      if (!entry || !entry.visible) continue;
      entry.marker.style.display = "block";
      entry.marker.style.backgroundColor = candidateFill;
      entry.marker.style.border = `1px solid ${this.options.candidateColor}`;
      entry.marker.style.boxShadow = "none";
    }

    if (this.matches.length > 0) {
      const currentIdx = this.matches[this.selectedPos];
      const current = this.entries[currentIdx];
      if (current && current.visible) {
        current.marker.style.display = "block";
        current.marker.style.backgroundColor = currentFill;
        current.marker.style.border = `2px solid ${this.options.currentColor}`;
        current.marker.style.boxShadow = `0 0 0 2px ${currentHalo}`;
      }
    }
  }

  private updateHud(): void {
    if (!this.hudEl) return;

    const phrase = this.query.length > 0 ? this.query : "";
    const status =
      this.query.length === 0
        ? "type to search links"
        : this.matches.length === 0
          ? "no matches"
          : `${this.selectedPos + 1}/${this.matches.length}`;

    this.hudEl.textContent = `link search: ${phrase}\n${status}`;
  }

  private commitSelection(openInNewTab: boolean): void {
    if (this.matches.length === 0) return;

    const idx = this.matches[this.selectedPos];
    const entry = this.entries[idx];
    if (!entry) return;

    const url = getHref(entry.element);
    this.deactivate();
    this.onSelect(url, entry.element, openInNewTab);
  }
}

interface LinkEntry {
  element: HTMLElement;
  marker: HTMLDivElement;
  text: string;
  visible: boolean;
}

interface MatchRank {
  index: number;
  exact: boolean;
  exactPos: number;
  fuzzyScore: number;
  textLength: number;
}

function rankedMatches(
  entries: LinkEntry[],
  query: string,
  fuzzyEnabled: boolean,
): number[] {
  const q = normalize(query);
  if (q.length === 0) return [];

  const ranks: MatchRank[] = [];

  entries.forEach((entry, index) => {
    if (!entry.visible) return;

    const exactPos = entry.text.indexOf(q);
    if (exactPos >= 0) {
      ranks.push({
        index,
        exact: true,
        exactPos,
        fuzzyScore: 0,
        textLength: entry.text.length,
      });
      return;
    }

    if (!fuzzyEnabled) return;

    const score = fuzzySubsequenceScore(q, entry.text);
    if (score == null) return;

    ranks.push({
      index,
      exact: false,
      exactPos: Number.MAX_SAFE_INTEGER,
      fuzzyScore: score,
      textLength: entry.text.length,
    });
  });

  ranks.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1;

    if (a.exact && b.exact) {
      if (a.exactPos !== b.exactPos) return a.exactPos - b.exactPos;
      if (a.textLength !== b.textLength) return a.textLength - b.textLength;
      return a.index - b.index;
    }

    if (a.fuzzyScore !== b.fuzzyScore) return b.fuzzyScore - a.fuzzyScore;
    if (a.textLength !== b.textLength) return a.textLength - b.textLength;
    return a.index - b.index;
  });

  return ranks.map((r) => r.index);
}

function fuzzySubsequenceScore(query: string, text: string): number | null {
  let t = 0;
  let score = 0;
  let first = -1;
  let prev = -1;

  for (const ch of query) {
    const idx = text.indexOf(ch, t);
    if (idx < 0) return null;

    if (first < 0) first = idx;

    score += 10;
    if (prev >= 0) {
      const gap = idx - prev - 1;
      score -= gap;
      if (gap === 0) score += 5;
    }

    prev = idx;
    t = idx + 1;
  }

  score -= first * 0.25;
  score -= (text.length - query.length) * 0.01;

  return score;
}

function searchableText(el: HTMLElement): string {
  const parts = [
    el.textContent ?? "",
    el.getAttribute("aria-label") ?? "",
    el.getAttribute("title") ?? "",
  ];

  const href = getHref(el);
  if (href) parts.push(href);

  return normalize(parts.join(" "));
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function getHref(el: HTMLElement): string | null {
  if (el instanceof HTMLAnchorElement && el.href) return el.href;
  if (el instanceof HTMLAreaElement && el.href) return el.href;
  const anchor = el.closest("a[href], area[href]") as
    | HTMLAnchorElement
    | HTMLAreaElement
    | null;
  return anchor?.href ?? null;
}

function collectVisibleLinks(): HTMLElement[] {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('a[href], [role="link"]'),
  );

  const unique = new Set<HTMLElement>();

  const out = candidates
    .filter((el) => {
      if (unique.has(el)) return false;
      unique.add(el);

      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (r.bottom < 0 || r.top > vh) return false;
      if (r.right < 0 || r.left > vw) return false;
      if (!isRendered(el)) return false;
      return isTopMostAtAnySamplePoint(el, r, vw, vh);
    })
    .sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const dy = ra.top - rb.top;
      return Math.abs(dy) > 8 ? dy : ra.left - rb.left;
    });

  return out;
}

function isRendered(el: HTMLElement): boolean {
  const s = getComputedStyle(el);
  return (
    s.visibility !== "hidden" &&
    s.display !== "none" &&
    s.opacity !== "0" &&
    s.pointerEvents !== "none"
  );
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
    if (!(topEl instanceof HTMLElement)) continue;
    if (topEl === el || el.contains(topEl) || topEl.contains(el)) return true;
  }

  return false;
}

function isPrintableKey(e: KeyboardEvent): boolean {
  return e.key.length === 1;
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

// Action names that map to key bindings
export type ActionName =
  | "followLink"
  | "followLinkNewTab"
  | "copyLink"
  | "focusInput"
  | "searchLink"
  | "nextFrame"
  | "mainFrame";

export interface ExclusionRule {
  /** URL wildcard pattern, e.g. *://mail.google.com/* */
  pattern: string;
  /** Space-separated HopKey shortcuts to pass through on matching pages. */
  passKeys: string;
}

export interface Settings {
  followLink: string;
  followLinkNewTab: string;
  copyLink: string;
  focusInput: string;
  nextFrame: string;
  mainFrame: string;
  searchLink: string;
  hintChars: string;
  hintUpperCase: boolean;
  inputCandidateColor: string;
  inputCurrentColor: string;
  linkSearchFuzzy: boolean;
  exclusionRules: ExclusionRule[];
}

export const DEFAULT_SETTINGS: Settings = {
  followLink: "f",
  followLinkNewTab: "F",
  copyLink: "k",
  focusInput: "i",
  nextFrame: "h",
  mainFrame: "H",
  searchLink: "l",
  hintChars: "sadfjklewcmpgh",
  hintUpperCase: false,
  inputCandidateColor: "#60a5fa",
  inputCurrentColor: "#f59e0b",
  linkSearchFuzzy: true,
  exclusionRules: [],
};

export const ACTION_LABELS: Record<ActionName, string> = {
  followLink: "Follow link",
  followLinkNewTab: "Follow link in new tab",
  copyLink: "Copy link URL",
  focusInput: "Focus input field",
  searchLink: "Search link by text",
  nextFrame: "Switch to next frame",
  mainFrame: "Switch to main frame",
};

export const ACTION_NAMES = Object.keys(ACTION_LABELS) as ActionName[];

export function createDefaultSettings(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    exclusionRules: [],
  };
}

export function cloneSettings(source: Settings): Settings {
  return {
    ...source,
    exclusionRules: source.exclusionRules.map((rule) => ({ ...rule })),
  };
}

export function loadSettings(): Promise<Settings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(createDefaultSettings(), (result) => {
      const raw = result as Partial<Settings>;
      const settings = createDefaultSettings();

      settings.followLink = typeof raw.followLink === "string" ? raw.followLink : settings.followLink;
      settings.followLinkNewTab =
        typeof raw.followLinkNewTab === "string" ? raw.followLinkNewTab : settings.followLinkNewTab;
      settings.copyLink = typeof raw.copyLink === "string" ? raw.copyLink : settings.copyLink;
      settings.focusInput = typeof raw.focusInput === "string" ? raw.focusInput : settings.focusInput;
      settings.nextFrame = typeof raw.nextFrame === "string" ? raw.nextFrame : settings.nextFrame;
      settings.mainFrame = typeof raw.mainFrame === "string" ? raw.mainFrame : settings.mainFrame;
      settings.searchLink = typeof raw.searchLink === "string" ? raw.searchLink : settings.searchLink;
      settings.hintChars = typeof raw.hintChars === "string" ? raw.hintChars : settings.hintChars;
      settings.hintUpperCase =
        typeof raw.hintUpperCase === "boolean" ? raw.hintUpperCase : settings.hintUpperCase;
      const legacyCandidateColor = (raw as Record<string, unknown>)["giCandidateColor"];
      const legacyCurrentColor = (raw as Record<string, unknown>)["giCurrentColor"];

      settings.inputCandidateColor =
        typeof raw.inputCandidateColor === "string"
          ? raw.inputCandidateColor
          : typeof legacyCandidateColor === "string"
            ? legacyCandidateColor
            : settings.inputCandidateColor;
      settings.inputCurrentColor =
        typeof raw.inputCurrentColor === "string"
          ? raw.inputCurrentColor
          : typeof legacyCurrentColor === "string"
            ? legacyCurrentColor
            : settings.inputCurrentColor;
      settings.linkSearchFuzzy =
        typeof raw.linkSearchFuzzy === "boolean" ? raw.linkSearchFuzzy : settings.linkSearchFuzzy;

      settings.exclusionRules = Array.isArray(raw.exclusionRules)
        ? raw.exclusionRules
            .flatMap((rule) => {
              if (typeof rule !== "object" || rule === null) return [];
              const pattern = (rule as { pattern?: unknown }).pattern;
              const passKeys = (rule as { passKeys?: unknown }).passKeys;
              if (typeof pattern !== "string") return [];
              return [
                {
                  pattern,
                  passKeys: typeof passKeys === "string" ? passKeys : "",
                },
              ];
            })
        : [];

      resolve(settings);
    });
  });
}

export function saveSettings(settings: Settings): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set(cloneSettings(settings) as Record<string, unknown>, resolve);
  });
}

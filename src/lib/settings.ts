// Action names that map to key bindings
export type ActionName =
  | "followLink"
  | "followLinkNewTab"
  | "copyLink"
  | "focusInput"
  | "searchLink"
  | "nextFrame"
  | "mainFrame";

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
  giCandidateColor: string;
  giCurrentColor: string;
  linkSearchFuzzy: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  followLink: "f",
  followLinkNewTab: "F",
  copyLink: "yf",
  focusInput: "gi",
  nextFrame: "gf",
  mainFrame: "gF",
  searchLink: "gl",
  hintChars: "sadfjklewcmpgh",
  hintUpperCase: false,
  giCandidateColor: "#60a5fa",
  giCurrentColor: "#f59e0b",
  linkSearchFuzzy: true,
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

export function loadSettings(): Promise<Settings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (result) => {
      resolve(result as Settings);
    });
  });
}

export function saveSettings(settings: Settings): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set(settings as Record<string, unknown>, resolve);
  });
}

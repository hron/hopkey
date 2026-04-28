/**
 * Converts a KeyboardEvent to a canonical key string like "ctrl-f",
 * "alt-F", "shift-Enter", etc.
 *
 * Returns null for lone modifier keydowns (Control, Alt, Shift, Meta).
 */
export function formatKeyEvent(e: KeyboardEvent): string | null {
  if (e.key === "Control" || e.key === "Alt" || e.key === "Shift" || e.key === "Meta") {
    return null;
  }

  const parts: string[] = [];
  if (e.ctrlKey) parts.push("ctrl");
  if (e.altKey) parts.push("alt");
  if (e.metaKey) parts.push("meta");

  const hasOtherModifier = e.ctrlKey || e.altKey || e.metaKey;
  const isSinglePrintable = e.key.length === 1;
  if (e.shiftKey && (hasOtherModifier || !isSinglePrintable)) {
    parts.push("shift");
  }

  parts.push(e.key);
  return parts.join("-");
}

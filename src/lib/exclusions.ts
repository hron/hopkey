import type { ExclusionRule } from "./settings";

function escapeRegExp(input: string): string {
  return input.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizePatternInput(input: string): string {
  let pattern = input.trim();
  if (!pattern) return "";

  if (!pattern.includes("://")) {
    pattern = `*://${pattern}`;
  }

  if (/^[^/]+:\/\/[^/]+$/u.test(pattern)) {
    pattern += "/*";
  }

  return pattern;
}

export function isValidPattern(pattern: string): boolean {
  return compilePattern(pattern) !== null;
}

function compilePattern(pattern: string): RegExp | null {
  const normalized = normalizePatternInput(pattern);
  if (!normalized) return null;

  try {
    const escaped = escapeRegExp(normalized).replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`);
  } catch {
    return null;
  }
}

export function matchesPattern(pattern: string, url: string): boolean {
  const regex = compilePattern(pattern);
  if (!regex) return false;
  return regex.test(url);
}

export function normalizePassKeys(input: string): string {
  const unique = Array.from(new Set(tokenizePassKeys(input)));
  return unique.join(" ");
}

export function tokenizePassKeys(input: string): string[] {
  return input
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export function getMatchingRules(
  rules: ExclusionRule[],
  url: string,
): ExclusionRule[] {
  return rules.filter((rule) => matchesPattern(rule.pattern, url));
}

export function getMatchedRule(
  rules: ExclusionRule[],
  url: string,
): ExclusionRule | null {
  return getMatchingRules(rules, url)[0] ?? null;
}

/**
 * Merges all matching rules for a URL, Vimium-style.
 * - Any matching rule with blank passKeys disables HopKey entirely.
 * - Otherwise, all passKeys are merged and deduplicated.
 */
export function getEffectiveRule(
  rules: ExclusionRule[],
  url: string,
): ExclusionRule | null {
  const matchingRules = getMatchingRules(rules, url);
  if (matchingRules.length === 0) return null;

  for (const rule of matchingRules) {
    if (normalizePassKeys(rule.passKeys).length === 0) {
      return { pattern: rule.pattern, passKeys: "" };
    }
  }

  const mergedTokens = matchingRules.flatMap((rule) =>
    tokenizePassKeys(rule.passKeys),
  );
  return {
    pattern: matchingRules[0].pattern,
    passKeys: Array.from(new Set(mergedTokens)).join(" "),
  };
}

export function suggestPatternForUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.host) return null;
    if (parsed.protocol === "chrome:" || parsed.protocol === "edge:" || parsed.protocol === "about:") {
      return null;
    }
    return `*://${parsed.host}/*`;
  } catch {
    return null;
  }
}

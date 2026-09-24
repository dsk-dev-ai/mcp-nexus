export interface IntentRule {
  /** Allowed capability-intent vocabulary for this route (must be ordered most-specific first). */
  pattern: RegExp;
  tool: string;
  intent: string;
  weight: number;
  group: string;
}

/**
 * ORDERED intent surface — rules run most-specific first, so a query that
 * names a concrete domain ("what changed lately" → git history; "outdated
 * vulnerable lockfile" → dependency risk) wins over the generic repository /
 * context-analysis fallbacks that the heuristic and semantic layers would
 * otherwise choose by raw bigram/capability overlap alone (§25 §31 §5).
 *
 * Critically (the §31 hard-failure fix): the specific terms — "changed",
 * "recent history", "commits", "log", "outdated", "vulnerable", "risky",
 * "lockfile" — are NOT part of git-inspector's or dependency-audit's stored
 * capability vocabulary ("git/history/blame" and "security/dependency-audit").
 * Without this overlay both routers mis-dispatch "which node packages are
 * outdated and vulnerable" to ctx/repoarch. The vocabulary below closes that
 * gap deterministically: a rule match returns the specific tool.
 *
 * Every rule is a pure regular expression over the lowercased query — fully
 * deterministic, zero-dependency, no network (the offline V1 contract).
 */
export const INTENT_RULES: IntentRule[] = [
  // — repo history — most specific domain vocabulary first —
  {
    pattern: /\b(what changed|whats changed|what changed in this repo|recent history|recent changes|lately|recent commits|latest commits|git (log|history|blame)|repo history|repository history|recent git)\b/i,
    tool: "git-inspector",
    intent: "repo-history",
    weight: 3,
    group: "git-history",
  },
  // — dependency / lockfile risk — specific security domain —
  {
    pattern: /\b(outdated|outdated (node |npm |package |packages |dependency |dependencies )|vulnerable|vulnerabilities?|risky (package|packages|dependency|dependencies)|risk[sy]? packages? (in|of) lockfile|lockfile|lock file|risky packages?|vulnerable packages?|audit (of )?(dependencies|packages|lockfile))\b/i,
    tool: "dependency-audit",
    intent: "dependency-security",
    weight: 3,
    group: "dependency-audit",
  },
  // — secret scanning — "API keys", "leaked secrets", "committed secrets" →
  //   the secret-scanner, not the generic dependency/security fuzzy bucket —
  {
    pattern: /\b(api keys?|leaked secrets?|scan (for|of) (api keys?|secrets?|credentials?|tokens?)|commit(ed)? secrets?|find (leaked |committed |exposed )?secrets?|credential scanning?|secret scan(ning)?)\b/i,
    tool: "secret-scanner",
    intent: "secret-scanning",
    weight: 3,
    group: "secret-scanner",
  },
  // — repo organization / structure — generic "how is this project laid out"
  //   intents that the heuristic bigram haters scatter across ctx/repoarch —
  {
    pattern: /\b(understand how (this|the|my|our) (project|repo|codebase)|what does (the|my|this|our) (project|repo|codebase) (structure|layout)|how (the|this|my|our) (project|repo|codebase) (is )?wired|wired up|project (structure|layout|organization)|repo (structure|layout|organization)|repository structure|codebase (structure|layout|organization))\b/i,
    tool: "repoarch",
    intent: "repo-organization",
    weight: 2,
    group: "repoarch",
  },
];

/**
 * Deterministic intent lookup: the FIRST rule whose pattern matches the
 * lowercased query wins (most-specific-first ordering). Returns the rule plus
 * its targeted tool, or null when no specific intent fires.
 */
export function matchIntent(query: string): { rule: IntentRule; tool: string } | null {
  const lower = query.toLowerCase();
  for (const rule of INTENT_RULES) {
    if (rule.pattern.test(lower)) return { rule, tool: rule.tool };
  }
  return null;
}

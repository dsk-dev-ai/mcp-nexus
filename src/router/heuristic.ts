import type { RouterProvider, RoutingResult, RouterAlternative } from "./types.ts";
import type { ToolManifest } from "../registry/manifest.ts";
import type { RegistryEntry } from "../registry/registry.ts";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "for", "on", "in", "with",
  "this", "that", "my", "me", "can", "you", "please", "show", "find", "me",
  // interrogatives / filler that don't discriminate between tools
  "what", "how", "why", "when", "does", "did", "do", "is", "are", "was", "were",
  "could", "would", "should", "will", "may", "might", "need", "want", "make",
  "get", "look", "like", "see", "up", "out", "any", "all", "some",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Split capability phrases too so "repository-analysis" matches "repository analysis". */
export function capabilityTokens(capabilities: string[]): string[] {
  return capabilities.flatMap((c) => tokenize(c + " " + c.replaceAll("-", " ")));
}

export interface HeuristicRouterOptions {
  /** Proportional word overlap required at minimum (1-x of max) — see score. */
  threshold?: number;
}

/**
 * Deterministic, zero-dependency router. Scores every enabled tool by word
 * overlap between the query and the tool's name, description and capabilities.
 * The best match keeps its raw score as confidence; alternatives are ranked.
 */
export class HeuristicRouter implements RouterProvider {
  readonly name = "heuristic";
  private readonly threshold: number;

  constructor(options: HeuristicRouterOptions = {}) {
    this.threshold = options.threshold ?? 0.28;
  }

  async route(query: string, tools: RegistryEntry[]): Promise<RoutingResult> {
    const qTokens = tokenize(query);
    if (qTokens.length === 0) {
      return { reliability: "unavailable" };
    }

    if (tools.length === 0) {
      return { reliability: "unavailable" };
    }

    const scored: Array<{ entry: RegistryEntry; score: number; matched: string[] }> = tools.map(
      (entry) => {
        const nameTokens = tokenize(entry.name);
        const capabilityToks = capabilityTokens(entry.capabilities);
        const descTokens = tokenize(entry.description);
        const matched = new Set<string>();

        const overlap = (tokens: string[]): number =>
          tokens.filter((tok) => {
            const hit = qTokens.some((q) => matches(q, tok));
            if (hit) matched.add(tok);
            return hit;
          }).length;

        const nameHits = overlap(nameTokens);
        const capHits = overlap(capabilityToks);
        const descHits = overlap(descTokens);

        // Weighted: exact name match highest, then capability, then description.
        const score = nameHits * 1.5 + capHits * 1.2 + descHits * 0.5;
        return {
          entry,
          score,
          matched: entry.capabilities.filter((c) =>
            tokenize(c).some((tok) => qTokens.some((q) => matches(q, tok))),
          ),
        };
      },
    );

    const maxScore = Math.max(...scored.map((s) => s.score));

    if (maxScore <= 0) {
      return {
        reliability: "available",
        decision: {
          provider: "heuristic",
          confidence: 0,
          matchedCapabilities: [],
          alternatives: [],
          explanation: "No keyword overlap between the request and registered tools.",
        },
      };
    }

    const ranked = [...scored].sort((a, b) => b.score - a.score);
    const best = ranked[0]!;
    const confidence = best.score / maxScore;

    if (confidence < this.threshold) {
      return {
        reliability: "available",
        decision: {
          provider: "heuristic",
          confidence,
          matchedCapabilities: best.matched,
          alternatives: [],
          explanation: "Best match below confidence threshold; deferring to next provider.",
        },
      };
    }

    const decision = {
      provider: "heuristic",
      tool: best.entry satisfies ToolManifest,
      confidence,
      matchedCapabilities: best.matched,
      alternatives: ranked.slice(1, 4).map<RouterAlternative>((s) => ({
        name: s.entry.name,
        confidence: s.score === 0 ? 0 : s.score / maxScore,
        matchedCapabilities: s.matched,
      })),
      explanation: buildExplanation(best.entry, best.matched),
    };

    return { reliability: "available", decision };
  }
}

/** Lightweight stemmer for common English inflections (plural/gerund/past/ity). */
export function stem(word: string): string {
  const w = word.toLowerCase();
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("ity") && w.length > 5) return w.slice(0, -3);
  if (w.endsWith("ing") && w.length > 5) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length > 4) return w.slice(0, -2);
  // "boxes" -> "box", but "files" must fall through to "file"
  if (w.endsWith("es") && w.length > 4 && ["s", "x", "z"].includes(w[w.length - 3]!)) {
    return w.slice(0, -2);
  }
  if (w.endsWith("s") && w.length > 3) return w.slice(0, -1);
  // security ~ secure, structure ~ structural
  if (w.endsWith("al") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("e") && w.length > 4) return w.slice(0, -1);
  return w;
}

/** Does one token loosely match another (equal after stemming, or shared prefix)? */
export function matches(a: string, b: string): boolean {
  if (a === b) return true;
  const sa = stem(a);
  const sb = stem(b);
  if (sa === sb) return true;
  if (sa.length >= 3 && sb.length >= 3) {
    return sa.startsWith(sb) || sb.startsWith(sa);
  }
  return false;
}

function buildExplanation(tool: ToolManifest, matched: string[]): string {
  if (matched.length > 0) {
    return `Matched capabilities: ${matched.join(", ")} for "${tool.name}".`;
  }
  return `Matched request vocabulary to "${tool.name}".`;
}
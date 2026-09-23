import type { RouterProvider, RoutingResult, RouterAlternative } from "./types.ts";
import type { ToolManifest } from "../registry/manifest.ts";
import type { RegistryEntry } from "../registry/registry.ts";
import { tokenize, stem, capabilityTokens } from "./heuristic.ts";

export interface SemanticRouterOptions {
  /** Minimum bigram-similarity before a term counts as a match */
  matchThreshold?: number;
}

/**
 * Zero-dependency "semantic" router based on character-bigram similarity
 * weighted by inverse document frequency.
 *
 * Where the heuristic router requires exact (or stemmed-prefix) token overlap,
 * bigram matching is resistant to typos and spelling drift: "repozarch",
 * "archtecture", "vulnrabilties" still land correct. IDF down-weights common
 * vocabulary (tool, project) so distinctive terms drive the decision. Fully
 * deterministic, no dependencies, no network — a lightweight stand-in for
 * embeddings.
 */
export class SemanticRouter implements RouterProvider {
  readonly name = "semantic";
  private readonly matchThreshold: number;

  constructor(options: SemanticRouterOptions = {}) {
    this.matchThreshold = options.matchThreshold ?? 0.35;
  }

  async route(query: string, tools: RegistryEntry[]): Promise<RoutingResult> {
    const qTokens = tokenize(query);
    if (qTokens.length === 0 || tools.length === 0) {
      return { reliability: "unavailable" };
    }

    const index = this.buildIndex(tools);
    const qBigrams = new Set<string>();
    for (const token of qTokens) for (const b of bigrams(token)) qBigrams.add(b);
    if (qBigrams.size === 0) {
      return { reliability: "unavailable" };
    }

    const scored = tools.map((tool) => {
      const weighted: Array<{ sim: number; idf: number }> = [];
      for (const token of qTokens) {
        let best: { sim: number; idf: number } | null = null;
        for (const term of this.termsFor(tool)) {
          const entry = index.get(term);
          if (!entry) continue;
          const sim = dice(qBigrams, entry.bigrams);
          if (sim < this.matchThreshold) continue;
          if (!best || sim > best.sim) {
            best = { sim, idf: idfOf(entry.inTools.size, tools.length) };
          }
        }
        if (best) weighted.push(best);
      }
      const score = weighted.reduce((sum, m) => sum + m.sim * (1 + m.idf), 0);
      const matched = tool.capabilities.filter((c) =>
        capabilityTokens([c]).some((term) =>
          qTokens.some(() =>
            dice(qBigrams, index.get(stem(term))?.bigrams ?? new Set()) >= this.matchThreshold,
          ),
        ),
      );
      return { entry: tool, score, matched: [...new Set(matched)] };
    });

    const maxScore = Math.max(...scored.map((s) => s.score));
    if (maxScore <= 0) {
      return {
        reliability: "available",
        decision: {
          provider: "semantic",
          confidence: 0,
          matchedCapabilities: [],
          alternatives: [],
          explanation: "No fuzzy match above threshold; deferring to next provider.",
        },
      };
    }

    const ranked = [...scored].sort((a, b) => b.score - a.score);
    const best = ranked[0]!;
    const confidence = best.score / maxScore;

    if (confidence < 0.35) {
      return {
        reliability: "available",
        decision: {
          provider: "semantic",
          confidence,
          matchedCapabilities: best.matched,
          alternatives: [],
          explanation: `Best fuzzy match below confidence threshold (${(confidence * 100).toFixed(0)}%); deferring to next provider.`,
        },
      };
    }

    return {
      reliability: "available",
      decision: {
        provider: "semantic",
        tool: best.entry satisfies ToolManifest,
        confidence,
        matchedCapabilities: best.matched,
        alternatives: ranked.slice(1, 4).map<RouterAlternative>((s) => ({
          name: s.entry.name,
          confidence: s.score === 0 ? 0 : s.score / maxScore,
          matchedCapabilities: s.matched,
        })),
        explanation: `Fuzzy capability match via bigram similarity (${(confidence * 100).toFixed(0)}%).`,
      },
    };
  }

  private termsFor(tool: ToolManifest): string[] {
    const terms = new Set<string>();
    for (const term of tokenize(tool.name)) terms.add(stem(term));
    for (const term of capabilityTokens(tool.capabilities)) terms.add(stem(term));
    for (const term of tokenize(tool.description)) terms.add(stem(term));
    return [...terms];
  }

  private buildIndex(tools: RegistryEntry[]): Map<string, TermIndex> {
    const index = new Map<string, TermIndex>();
    for (const tool of tools) {
      for (const term of this.termsFor(tool)) {
        let entry = index.get(term);
        if (!entry) {
          entry = { term, inTools: new Set<string>(), bigrams: new Set(bigrams(term)) };
          index.set(term, entry);
        }
        entry.inTools.add(tool.name);
      }
    }
    return index;
  }
}

interface TermIndex {
  term: string;
  inTools: Set<string>;
  bigrams: Set<string>;
}

function bigrams(word: string): string[] {
  const out: string[] = [];
  for (const token of tokenize(word)) {
    const padded = `#${token}#`;
    for (let i = 0; i < padded.length - 1; i++) {
      out.push(padded.slice(i, i + 2));
    }
  }
  return out;
}

/** Dice (Sørensen) similarity between query bigram set and a term's bigram set. */
function dice(a: Set<string>, b: Set<string>): number {
  if (a.size + b.size === 0) return 0;
  let inter = 0;
  for (const k of a) if (b.has(k)) inter++;
  return (2 * inter) / (a.size + b.size);
}

/** Inverse document frequency: common terms get small weight. */
function idfOf(inTools: number, total: number): number {
  return Math.log1p(total / (1 + inTools));
}
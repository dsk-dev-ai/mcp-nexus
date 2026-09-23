import type { RouterProvider, RoutingDecision, RoutingResult } from "./types.ts";
import type { RegistryEntry } from "../registry/registry.ts";

const THRESHOLD = 0.5;

export interface DiscoveredTool {
  name: string;
  provider: string;
  confidence: number;
  matchedCapabilities: string[];
}

export interface DiscoveryResult {
  query: string;
  surface: DiscoveredTool[];
}

/**
 * Orchestrates provider fallback. Tries each configured provider in order:
 * a provider that reports "unavailable" is skipped; a decision whose confidence
 * clears the threshold wins. The router therefore keeps working with no LLM at all.
 */
export class NexusRouter {
  private readonly providers: RouterProvider[];

  constructor(providers: RouterProvider[]) {
    this.providers = providers;
  }

  async route(query: string, tools: RegistryEntry[]): Promise<RoutingDecision> {
    for (const provider of this.providers) {
      let result: RoutingResult;
      try {
        result = await provider.route(query, tools);
      } catch {
        continue;
      }
      if (result.reliability === "unavailable") continue;
      const decision = result.decision!;
      // Strict: a decision must *exceed* the threshold to short-circuit the chain,
      // so calibrated ties (exactly 0.5) defer to the next provider.
      if (decision.tool && decision.confidence > THRESHOLD) {
        return decision;
      }
    }
    return {
      provider: "fallback",
      confidence: 0,
      matchedCapabilities: [],
      alternatives: [],
      explanation:
        "No provider produced a confident match. Try rephrasing or check that tools are registered.",
    };
  }

  /**
   * Dynamic capability discovery: return the minimal tool surface for a
   * request — every tool a provider considered non-trivial, ranked across the
   * provider chain (no confidence gate, so the whole candidate space is shown).
   */
  async discover(query: string, tools: RegistryEntry[]): Promise<DiscoveryResult> {
    const seen = new Map<string, DiscoveredTool>();

    for (const provider of this.providers) {
      let result: RoutingResult;
      try {
        result = await provider.route(query, tools);
      } catch {
        continue;
      }
      if (result.reliability === "unavailable" || !result.decision) continue;
      const decision = result.decision;
      const add = (name: string, confidence: number, matched: string[]): void => {
        const current = seen.get(name);
        if (!current) {
          seen.set(name, { name, provider: decision.provider, confidence, matchedCapabilities: matched });
        } else if (confidence > current.confidence) {
          seen.set(name, { ...current, confidence });
        }
      };
      if (decision.tool) add(decision.tool.name, decision.confidence, decision.matchedCapabilities);
      for (const alt of decision.alternatives) add(alt.name, alt.confidence, alt.matchedCapabilities);
    }

    return {
      query,
      surface: [...seen.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 5),
    };
  }
}
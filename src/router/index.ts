import type { RouterProvider, RoutingDecision, RoutingResult } from "./types.ts";
import type { RegistryEntry } from "../registry/registry.ts";

const THRESHOLD = 0.5;

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
      if (decision.tool && decision.confidence >= THRESHOLD) {
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
}
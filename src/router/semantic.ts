import type { RouterProvider, RoutingResult } from "./types.ts";
import type { RegistryEntry } from "../registry/registry.ts";

/**
 * Placeholder for the semantic (embedding) router. Reports "unavailable" so the
 * fallback chain stays healthy. Real implementation: on the V2 roadmap (see
 * ROADMAP.md).
 */
export class SemanticRouter implements RouterProvider {
  readonly name = "semantic";

  async route(_query: string, _tools: RegistryEntry[]): Promise<RoutingResult> {
    return { reliability: "unavailable" };
  }
}
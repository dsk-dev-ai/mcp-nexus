import type { RegistryEntry } from "../registry/registry.ts";
import type { ToolManifest } from "../registry/manifest.ts";

export interface RouterAlternative {
  name: string;
  confidence: number;
  matchedCapabilities: string[];
}

export interface RoutingDecision {
  tool?: ToolManifest;
  provider: string;
  confidence: number;
  matchedCapabilities: string[];
  alternatives: RouterAlternative[];
  explanation: string;
}

export type Reliability = "available" | "unavailable";

export interface RoutingResult {
  reliability: Reliability;
  decision?: RoutingDecision;
}

export interface RouterProvider {
  readonly name: string;
  /** Classify a natural-language request against the registered, enabled tools. */
  route(query: string, tools: RegistryEntry[]): Promise<RoutingResult>;
}
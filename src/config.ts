import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface NexusConfig {
  /** Directory where mcp-nexus keeps registry.json, policy.json, activity.jsonl */
  home: string;
  /** HTTP port reserved for dashboard / future HTTP integration */
  port: number;
  /** Routing providers tried in order. Each is skipped if it reports "unavailable". */
  routerProviders: string[];
  openrouterApiKey?: string;
  geminiApiKey?: string;
}

export const DEFAULT_PROVIDERS = ["heuristic", "semantic", "llm"];

function envHome(): string {
  return process.env.NEXUS_HOME ?? ".nexus";
}

function readOverrides(): Partial<NexusConfig> {
  const file = join(process.cwd(), ".nexus", "config.json");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Partial<NexusConfig>;
  } catch {
    return {};
  }
}

export function loadConfig(): NexusConfig {
  const overrides = readOverrides();
  const providers = (process.env.ROUTER_PROVIDERS ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  return {
    home: overrides.home ?? envHome(),
    port: Number(process.env.MCP_NEXUS_PORT ?? overrides.port ?? 3000),
    routerProviders: providers.length > 0 ? providers : (overrides.routerProviders ?? DEFAULT_PROVIDERS),
    openrouterApiKey: process.env.OPENROUTER_API_KEY ?? overrides.openrouterApiKey,
    geminiApiKey: process.env.GEMINI_API_KEY ?? overrides.geminiApiKey,
  };
}
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type RouterMode = "hybrid" | "heuristic" | "semantic" | "llm";

export interface NexusConfig {
  /** Directory where mcp-nexus keeps registry.json, policy.json, activity.jsonl */
  home: string;
  /** HTTP port for the dashboard / future HTTP integration */
  port: number;
  /** Bind address — loopback by default; 0.0.0.0 for container deployments */
  bindHost: string;
  /** Routing providers tried in order (skips ones reporting "unavailable") */
  routerProviders: string[];
  /** High-level routing strategy — maps to a provider priority list */
  routerMode: RouterMode;
  /** Runtime log verbosity */
  logLevel: LogLevel;
  /** Default execution timeout for tools (ms) */
  executionTimeoutMs: number;
  /** Optional API keys — never surfaced by any API (masked) */
  openrouterApiKey?: string;
  geminiApiKey?: string;
  /** Optional bearer token protecting the dashboard REST API (§20/§32). */
  apiToken?: string;
}

export const DEFAULT_PROVIDERS = ["heuristic", "semantic", "llm"];

export const DEFAULT_CONFIG: Readonly<Omit<NexusConfig, "routerProviders" | "openrouterApiKey" | "geminiApiKey">> = {
  home: ".nexus",
  port: 3000,
  bindHost: "127.0.0.1",
  routerMode: "hybrid",
  logLevel: "info",
  executionTimeoutMs: 30_000,
};

const MODE_PROVIDERS: Record<RouterMode, string[]> = {
  hybrid: ["heuristic", "semantic", "llm"],
  heuristic: ["heuristic"],
  semantic: ["heuristic", "semantic"],
  llm: ["heuristic", "semantic", "llm"],
};

/** Fill defaults so partial specs (tests, embeds) produce a complete config. */
export function normalizeConfig(p: Partial<NexusConfig>): NexusConfig {
  const routerMode: RouterMode = p.routerMode ?? DEFAULT_CONFIG.routerMode;
  const providers = p.routerProviders?.length ? p.routerProviders : MODE_PROVIDERS[routerMode];
  return {
    home: p.home ?? DEFAULT_CONFIG.home,
    port: p.port ?? DEFAULT_CONFIG.port,
    bindHost: p.bindHost ?? DEFAULT_CONFIG.bindHost,
    routerProviders: providers,
    routerMode,
    logLevel: p.logLevel ?? DEFAULT_CONFIG.logLevel,
    executionTimeoutMs: p.executionTimeoutMs ?? DEFAULT_CONFIG.executionTimeoutMs,
    openrouterApiKey: p.openrouterApiKey,
    geminiApiKey: p.geminiApiKey,
    apiToken: p.apiToken,
  };
}

function envHome(): string {
  return process.env.MCP_NEXUS_HOME ?? process.env.NEXUS_HOME ?? DEFAULT_CONFIG.home;
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

function readEnv(): Partial<NexusConfig> {
  const e = process.env;
  const out: Partial<NexusConfig> = {};
  if (e.MCP_NEXUS_PORT) out.port = Number(e.MCP_NEXUS_PORT);
  if (e.MCP_NEXUS_HOST) out.bindHost = e.MCP_NEXUS_HOST;
  if (e.MCP_NEXUS_LOG_LEVEL) out.logLevel = e.MCP_NEXUS_LOG_LEVEL as LogLevel;
  if (e.MCP_NEXUS_EXECUTION_TIMEOUT) out.executionTimeoutMs = Number(e.MCP_NEXUS_EXECUTION_TIMEOUT);
  if (e.MCP_NEXUS_ROUTER_MODE) out.routerMode = e.MCP_NEXUS_ROUTER_MODE as RouterMode;
  if (e.MCP_NEXUS_ROUTER_PROVIDERS) {
    out.routerProviders = e.MCP_NEXUS_ROUTER_PROVIDERS.split(",").map((s) => s.trim()).filter(Boolean);
  }
  out.openrouterApiKey = e.MCP_NEXUS_OPENROUTER_API_KEY ?? e.OPENROUTER_API_KEY;
  out.geminiApiKey = e.MCP_NEXUS_GEMINI_API_KEY ?? e.GEMINI_API_KEY;
  out.apiToken = e.MCP_NEXUS_API_TOKEN;
  return out;
}

/** Minimal .env parser: KEY=VALUE, comments (#), blank lines, optional quotes. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !key.startsWith("#")) out[key] = value;
  }
  return out;
}

/** Load `.env` from a directory into process.env (existing vars win). */
export function loadDotEnv(dir: string): void {
  const file = join(dir, ".env");
  if (!existsSync(file)) return;
  const parsed = parseDotEnv(readFileSync(file, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function loadConfig(): NexusConfig {
  loadDotEnv(process.cwd());
  const env = readEnv();
  const overrides = readOverrides();
  const providers = env.routerProviders ?? overrides.routerProviders;
  return normalizeConfig({
    home: overrides.home ?? envHome(),
    port: env.port ?? overrides.port,
    bindHost: env.bindHost ?? overrides.bindHost,
    routerProviders: providers,
    routerMode: env.routerMode ?? overrides.routerMode,
    logLevel: env.logLevel ?? overrides.logLevel,
    executionTimeoutMs: env.executionTimeoutMs ?? overrides.executionTimeoutMs,
    openrouterApiKey: env.openrouterApiKey ?? overrides.openrouterApiKey,
    geminiApiKey: env.geminiApiKey ?? overrides.geminiApiKey,
    apiToken: env.apiToken ?? overrides.apiToken,
  });
}
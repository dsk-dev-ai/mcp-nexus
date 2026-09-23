import type { ToolManifest, PermissionScope } from "../registry/manifest.ts";
import type { RegistryEntry } from "../registry/registry.ts";
import type { RoutingResult } from "../router/types.ts";
import type { ExecArgs, ExecResult } from "../executor/executor.ts";
import type { PolicyConfig, PolicyDecision } from "../policy/policy.ts";

/**
 * Plugin contract interfaces (V1 spec §30).
 *
 * Every built-in component satisfies one of these. Authors can drop in their
 * own implementation that conforms to the same shape — for example a new
 * routing provider, an alternative executor, or a different telemetry sink —
 * without touching the Nexus core.
 */

/** A single routing strategy (built-ins: heuristic, semantic, llm). */
export interface RouterPlugin {
  readonly name: string;
  route(query: string, tools: RegistryEntry[]): Promise<RoutingResult>;
}

/** An optional LLM router. Reports `configured` so UIs can surface it. */
export interface LLMProviderPlugin extends RouterPlugin {
  readonly configured: boolean;
}

/** Executes a routed, policy-approved tool call (built-in: ToolExecutor). */
export interface ExecutorPlugin {
  execute(tool: ToolManifest, args: ExecArgs): Promise<ExecResult>;
}

/** Authorizes tool execution (built-in: PolicyEngine). */
export interface PolicyProviderPlugin {
  readonly snapshot: PolicyConfig;
  evaluate(tool: ToolManifest, scopes: string[], approvals?: unknown): PolicyDecision;
}

/** Stores and serves tool manifests (built-in: ToolRegistry). */
export interface RegistryPlugin {
  list(): RegistryEntry[];
  get(name: string): RegistryEntry | undefined;
  add(manifest: string | ToolManifest): RegistryEntry;
  update(manifest: string | ToolManifest): RegistryEntry;
  remove(name: string): void;
  setEnabled(name: string, enabled: boolean): RegistryEntry;
  enabled(): RegistryEntry[];
}

/** Records and aggregates activity (built-in: ActivityLog). */
export interface TelemetryProviderPlugin {
  log(record: { tool: string; status: string; durationMs: number }): void;
  summary(): { total: number; avgDurationMs: number };
  recent(limit?: number): Array<{ timestamp: string }>;
}

export type { ToolManifest, PermissionScope, RegistryEntry, RoutingResult, ExecArgs, ExecResult, PolicyConfig, PolicyDecision };
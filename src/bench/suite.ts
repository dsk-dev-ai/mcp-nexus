import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolRegistry, type RegistryEntry } from "../registry/registry.ts";
import type { RoutingResult } from "../router/types.ts";

export type BenchCategory = "exact" | "semantic" | "ambiguous" | "unknown";

export interface BenchTask {
  query: string;
  category: BenchCategory;
  /** exact/natural → single name; ambiguous → acceptable set; unknown → null (expect no confident pick) */
  expected: string | string[] | null;
}

export interface CategoryStats {
  total: number;
  correct: number;
}

export interface BenchProviderResult {
  provider: string;
  accuracy: number; // overall percent
  failureRate: number; // 100 - accuracy
  latencyMs: number; // average per task
  byCategory: Record<BenchCategory, CategoryStats>;
  failures: Array<{ query: string; category: BenchCategory; expected: string; got: string | null }>;
}

const REFERENCE_TOOLS: Array<[string, string, string[]]> = [
  ["repoarch", "Analyze repository architecture, structure and dependencies of a project", ["repository-analysis", "architecture", "dependencies"]],
  ["ctx", "Pack a project into a single file for LLM context", ["context-packing", "codebase-summary"]],
  ["dependency-audit", "Scan dependencies for vulnerable or insecure packages", ["security", "dependency-audit"]],
  ["env-proof", "Validate environment variables for Node and TypeScript projects", ["env-validation", "configuration"]],
  ["git-inspector", "Inspect git history and blame: who changed a file, and when", ["git", "history", "blame"]],
  ["secret-scanner", "Scan a repository for leaked secrets and API keys", ["security", "secrets"]],
];

/** The 6 reference tools used by the deterministic smoke suite. */
export function referenceCatalog(): RegistryEntry[] {
  const registry = ToolRegistry.default(join(tmpdir(), `mcp-nexus-bench-${Date.now()}`));
  for (const [name, description, capabilities] of REFERENCE_TOOLS) {
    registry.add(JSON.stringify({
      name, version: "1.0.0", description, capabilities,
      transport: { type: "local", command: ["echo"] }, enabled: true,
    }));
  }
  return registry.list();
}

/**
 * Synthetic catalog for the large-collection case (V1 spec §31). Each tool is
 * domain × action with distinctive vocabulary so ground truth is unambiguous
 * but the catalog stresses scoring.
 */
export function syntheticCatalog(count: number): RegistryEntry[] {
  const domains = [
    "auth", "db", "deploy", "ml", "media", "search", "iot", "billing", "geo", "crypto",
    "email", "storage", "queue", "logs", "metrics", "edge", "video", "docs", "maps", "payments",
  ];
  const actions = ["backup", "monitor", "sync", "transform", "preview", "validate", "migrate", "notify", "render", "export"];
  const entries: RegistryEntry[] = [];
  const unique = new Set<string>();
  let guard = 0;
  while (entries.length < count && guard++ < count * 10) {
    const domain = domains[guard % domains.length]!;
    const action = actions[(guard * 7) % actions.length]!;
    const name = `${domain}-${action}`;
    if (unique.has(name)) continue;
    unique.add(name);
    entries.push({
      name,
      version: "1.0.0",
      description: `Synthetic tool that ${action.replace(/(sh|t|re|te|fy)$/s, "")}s ${domain} resources and ${action} pipelines`,
      capabilities: [`${domain}-${action}`, `${domain}-ops`, `${action}-engine`],
      transport: { type: "local", command: ["echo"] },
      enabled: true,
      addedAt: new Date().toISOString(),
    });
  }
  return entries;
}

const REFERENCE_TASKS: Array<[string, string]> = [
  ["diagram my repository architecture", "repoarch"],
  ["what does my project structure look like", "repoarch"],
  ["understand how this project is organized", "repoarch"],
  ["check for vulnerable dependencies", "dependency-audit"],
  ["are my npm packages secure", "dependency-audit"],
  ["find leaked secrets in this repo", "secret-scanner"],
  ["scan for API keys", "secret-scanner"],
  ["pack this codebase into one file", "ctx"],
  ["make a single context file for my LLM", "ctx"],
  ["check my env variables are set", "env-proof"],
  ["validate configuration for node", "env-proof"],
  ["show me recent git commits", "git-inspector"],
  ["tell me what changed in this repo lately", "git-inspector"],
  ["which node packages are outdated and vulnerable", "dependency-audit"],
  ["analyze my repository structure and then check dependencies", "repoarch"],
];

const AMBIGUOUS_TASKS: Array<[string, string[]]> = [
  ["i need a broad overview plus a packed context dump of the codebase", ["repoarch", "ctx"]],
  ["security pass over both dependencies and committed secrets", ["dependency-audit", "secret-scanner"]],
  ["tell me about the repo and who's been messing with it", ["repoarch", "git-inspector"]],
  ["quick summary of project layout for my LLM", ["ctx", "repoarch"]],
  ["check the node setup and environment before running anything", ["env-proof"]],
];

const UNKNOWN_TASKS: string[] = [
  "book me a flight to tokyo",
  "pay my electricity bill",
  "translate this document to french",
  "what is the weather in berlin",
  "order a pizza",
  "send an email to the team",
  "create a spreadsheet of my expenses",
  "calculate the factorial of 100",
];

export interface BenchTasks {
  tasks: BenchTask[];
  byCategory: Record<BenchCategory, BenchTask[]>;
}

export function buildTasks(): BenchTasks {
  const exact = REFERENCE_TASKS.map(([query, expected]) => ({ query, expected, category: "exact" as const }));
  const semantic = [
    ["figure out how the repo is wired up", "repoarch"],
    ["are there any risky packages in lockfile", "dependency-audit"],
    ["list recent history of the repo", "git-inspector"],
    ["bundle the project for a model", "ctx"],
  ] as Array<[string, string]>;
  const semanticTasks = semantic.map(([query, expected]) => ({ query, expected, category: "semantic" as const }));
  const ambiguous = AMBIGUOUS_TASKS.map(([query, expected]) => ({ query, expected, category: "ambiguous" as const }));
  const unknown = UNKNOWN_TASKS.map((query) => ({ query, expected: null, category: "unknown" as const }));
  const tasks = [...exact, ...semanticTasks, ...ambiguous, ...unknown];
  return { tasks, byCategory: { exact, semantic: semanticTasks, ambiguous, unknown } };
}

export function buildLargeTasks(catalog: RegistryEntry[], count: number): BenchTask[] {
  return catalog.slice(0, count).map((t) => ({
    query: `please ${t.name.split("-").join(" ")} everything ${t.capabilities[0] ?? t.name}`,
    expected: t.name,
    category: "exact" as const,
  }));
}

function decidedName(decision: { tool?: { name: string } | null; confidence: number }): string | null {
  if (!decision.tool) return null;
  return decision.confidence >= 0.5 ? decision.tool.name : null;
}

function isCorrect(task: BenchTask, got: string | null): boolean {
  if (task.expected === null) return got === null;
  if (Array.isArray(task.expected)) return got !== null && task.expected.includes(got);
  return got === task.expected;
}

function formatExpected(expected: string | string[] | null): string {
  if (expected === null) return "none";
  return Array.isArray(expected) ? expected.join(",") : expected;
}

export interface BenchProvider {
  name: string;
  route(query: string, tools: RegistryEntry[]): Promise<RoutingResult>;
}

/**
 * Run one provider over a full task set, measuring per-task latency and
 * category-level accuracy. Deterministic inputs; no network for the
 * local providers.
 */
export async function runBenchProvider(
  provider: BenchProvider,
  catalog: RegistryEntry[],
  tasks: BenchTask[],
): Promise<BenchProviderResult> {
  const byCategory: Record<BenchCategory, CategoryStats> = {
    exact: { total: 0, correct: 0 },
    semantic: { total: 0, correct: 0 },
    ambiguous: { total: 0, correct: 0 },
    unknown: { total: 0, correct: 0 },
  };
  const totalMs: number[] = [];
  const failures: BenchProviderResult["failures"] = [];

  for (const task of tasks) {
    const start = Date.now();
    const result = await provider.route(task.query, catalog);
    totalMs.push(Date.now() - start);

    const stats = byCategory[task.category];
    stats.total += 1;
    const decision = result.decision;
    if (!decision) {
      if (isCorrect(task, null)) stats.correct += 1;
      else failures.push({ query: task.query, category: task.category, expected: formatExpected(task.expected), got: null });
      continue;
    }
    const got = decidedName(decision);
    if (isCorrect(task, got)) stats.correct += 1;
    else failures.push({ query: task.query, category: task.category, expected: formatExpected(task.expected), got });
  }

  const total = tasks.length;
  const correct = Object.values(byCategory).reduce((sum, s) => sum + s.correct, 0);
  const accuracy = total === 0 ? 100 : (100 * correct) / total;
  const latencyMs = totalMs.length ? totalMs.reduce((a, b) => a + b, 0) / totalMs.length : 0;

  return {
    provider: provider.name,
    accuracy,
    failureRate: 100 - accuracy,
    latencyMs,
    byCategory,
    failures,
  };
}

export function formatBench(provider: string, r: BenchProviderResult): string {
  const line = [`${provider}:`, `  Accuracy:   ${r.accuracy.toFixed(1)}%`, `  Failure:    ${r.failureRate.toFixed(1)}%`, `  Latency:    ${r.latencyMs.toFixed(2)}ms avg`];
  for (const cat of ["exact", "semantic", "ambiguous", "unknown"] as BenchCategory[]) {
    const s = r.byCategory[cat];
    line.push(`  ${cat.padEnd(10)} ${s.correct}/${s.total} (${s.total ? ((100 * s.correct) / s.total).toFixed(0) : 0}%)`);
  }
  return line.join("\n");
}
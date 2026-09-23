import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, type NexusConfig } from "./config.ts";
import { ToolRegistry, ToolNotFoundError } from "./registry/registry.ts";
import { ManifestValidationError, parseManifest } from "./registry/manifest.ts";
import { HeuristicRouter } from "./router/heuristic.ts";
import { SemanticRouter } from "./router/semantic.ts";
import { LlmRouter } from "./router/llm.ts";
import { NexusRouter } from "./router/index.ts";
import { PolicyEngine } from "./policy/policy.ts";
import { ApprovalStore } from "./policy/approvals.ts";
import { deriveScopes } from "./policy/scopes.ts";
import { ToolExecutor } from "./executor/executor.ts";
import { ActivityLog } from "./telemetry/logger.ts";
import { NexusMCPServer } from "./server/server.ts";
import { createInterface } from "node:readline";

interface CliContext {
  config: NexusConfig;
  registry: ToolRegistry;
  router: NexusRouter;
  policy: PolicyEngine;
  executor: ToolExecutor;
  activity: ActivityLog;
  approvals: ApprovalStore;
}

const HELP = `mcp-nexus — intelligent routing layer for MCP tools

Usage: mcp-nexus <command> [options]

Commands:
  start              Start the MCP server over stdio (connect Claude/Cursor/etc.)
  add <file|json>    Register or update a tool from a manifest file or JSON string
  remove <name>      Unregister a tool
  list               List registered tools
  inspect <name>     Show full manifest for a tool
  search <query>     Route a request (dry run): show the best tool + why
  route <query>      Alias for search
  discover <query>   Show the minimal capability surface for a request
  invoke <query>     Route + policy-check + execute a request (approval prompts interactively)
  approvals          List pending operator approvals
  resolve <id> +|-   Approve (+) or deny (-) a pending approval
  policy             Show current policy configuration
  config [a=b ...]   Read or set config values (e.g. port=8080)
  doctor             Diagnose this environment
  benchmark          Run the built-in routing benchmark
  help               Show this help
`;

export async function run(argv: string[]): Promise<number> {
  const command = argv[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return 0;
  }

  const known: Array<keyof CliContext> = [
    "registry",
    "router",
    "policy",
    "executor",
    "activity",
  ];

  switch (command) {
    case "start":
    case "doctor":
    case "list":
    case "policy":
      break;
    case "add":
    case "remove":
    case "inspect":
    case "search":
    case "route":
    case "discover":
    case "invoke":
    case "approvals":
    case "resolve":
    case "benchmark": {
      const ctx = context();
      return await dispatch(command, ctx, argv.slice(1));
    }
    case "config":
      return await configCommand(argv.slice(1));
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      return 1;
  }

  const ctx = context();

  if (command === "start") {
    const server = new NexusMCPServer({
      registry: ctx.registry,
      router: ctx.router,
      policy: ctx.policy,
      executor: ctx.executor,
      activity: ctx.activity,
      approvals: ctx.approvals,
      home: ctx.config.home,
    });
    await server.connect();
    return 0;
  }

  if (command === "doctor") {
    return await doctor(ctx);
  }

  if (command === "list") {
    return await listCommand(ctx);
  }

  if (command === "policy") {
    return await policyCommand(ctx);
  }

  return 1;
}

function context(): CliContext {
  const config = loadConfig();
  if (!existsSync(config.home)) mkdirSync(config.home, { recursive: true });
  const registry = ToolRegistry.default(config.home);
  const providers = [
    new HeuristicRouter(),
    new SemanticRouter(),
    new LlmRouter(config.geminiApiKey ?? config.openrouterApiKey),
  ];
  return {
    config,
    registry,
    router: new NexusRouter(providers),
    policy: PolicyEngine.load(config.home),
    executor: new ToolExecutor(),
    activity: ActivityLog.default(config.home),
    approvals: ApprovalStore.load(config.home),
  };
}

async function dispatch(
  command: string,
  ctx: CliContext,
  args: string[],
): Promise<number> {
  switch (command) {
    case "add":
      return await addCommand(ctx, args[0]);
    case "remove":
      return await removeCommand(ctx, args[0]);
    case "inspect":
      return await inspectCommand(ctx, args[0]);
case "search":
  case "route":
    return await searchCommand(ctx, args.join(" "));
  case "discover":
    return await discoverCommand(ctx, args.join(" "));
  case "invoke":
    return await invokeCommand(ctx, args.join(" "));
  case "approvals":
    return await approvalsCommand(ctx);
  case "resolve":
    return await resolveCommand(ctx, args);
    case "benchmark":
      return await benchmarkCommand(ctx);
    default:
      return 1;
  }
}

function addCommand(ctx: CliContext, input: string | undefined): number {
  if (!input) {
    console.error("usage: mcp-nexus add <file|json>");
    return 1;
  }
  try {
    const text = existsSync(input) ? readFileSync(input, "utf8") : input;
    const manifest = parseManifest(text);
    try {
      ctx.registry.update(JSON.stringify(manifest));
      console.log(`Updated tool: ${manifest.name} v${manifest.version}`);
    } catch {
      ctx.registry.add(JSON.stringify(manifest));
      console.log(`Registered tool: ${manifest.name} v${manifest.version}`);
    }
    return 0;
  } catch (error) {
    console.error(`add failed: ${message(error)}`);
    return 1;
  }
}

function removeCommand(ctx: CliContext, name: string | undefined): number {
  if (!name) {
    console.error("usage: mcp-nexus remove <name>");
    return 1;
  }
  try {
    ctx.registry.remove(name);
    console.log(`Removed tool: ${name}`);
    return 0;
  } catch (err) {
    if (err instanceof ToolNotFoundError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }
}

function listCommand(ctx: CliContext): number {
  const tools = ctx.registry.list();
  if (tools.length === 0) {
    console.log("No tools registered. Add one with: mcp-nexus add tools/<name>.json");
    return 0;
  }
  for (const t of tools) {
    const flag = t.enabled ? "active" : "disabled";
    console.log(`- ${t.name.padEnd(22)} ${flag.padEnd(9)} ${t.transport.type.padEnd(6)} ${t.capabilities.join(", ")}`);
  }
  return 0;
}

function inspectCommand(ctx: CliContext, name: string | undefined): number {
  if (!name) {
    console.error("usage: mcp-nexus inspect <name>");
    return 1;
  }
  const tool = ctx.registry.get(name);
  if (!tool) {
    console.error(`tool "${name}" not found`);
    return 1;
  }
  console.log(JSON.stringify(tool, null, 2));
  return 0;
}

async function searchCommand(ctx: CliContext, query: string): Promise<number> {
  if (!query.trim()) {
    console.error("usage: mcp-nexus search <query>");
    return 1;
  }
  const decision = await ctx.router.route(query, ctx.registry.enabled());
  printDecision(query, decision);
  return decision.tool ? 0 : 1;
}

async function invokeCommand(ctx: CliContext, query: string): Promise<number> {
  if (!query.trim()) {
    console.error("usage: mcp-nexus invoke <query>");
    return 1;
  }
  const decision = await ctx.router.route(query, ctx.registry.enabled());
  if (!decision.tool) {
    printDecision(query, decision);
    return 1;
  }

  const tool = ctx.registry.get(decision.tool.name)!;
  const scopes = deriveScopes(tool);
  const policyDecision = ctx.policy.evaluate(tool, scopes, ctx.approvals);

  if (policyDecision.action === "deny") {
    console.log(`Blocked by policy: ${policyDecision.reasons.join("; ")}`);
    return 1;
  }

  if (policyDecision.action === "approval") {
    console.log(`Approval required: ${policyDecision.reasons.join("; ")}`);
    const ok = await promptYesNo(
      `Approve execution of "${tool.name}" (scopes: ${scopes.join(", ")})? `,
    );
    if (!ok) {
      console.log("Aborted by operator.");
      return 1;
    }
    ctx.approvals.resolve(ctx.approvals.request(tool.name, scopes, policyDecision.reasons).id, true);
    ctx.approvals.persist(ctx.config.home);
    console.log("Approved for this session.");
  }

  const result = await ctx.executor.execute(tool, {});
  ctx.activity.log({
    tool: tool.name,
    status: result.status,
    durationMs: result.durationMs,
    router: decision.provider,
    confidence: decision.confidence,
  });

  console.log(`\nTool: ${tool.name} (${result.status} in ${result.durationMs}ms)`);
  console.log(result.stdout || "(no stdout)");
  if (result.stderr) console.log(`stderr: ${result.stderr}`);
  return result.status === "success" ? 0 : 1;
}

function promptYesNo(promptText: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(/^\s*(y|yes)\s*$/i.test(answer));
    });
  });
}

function approvalsCommand(ctx: CliContext): number {
  const pending = ctx.approvals.list();
  if (pending.length === 0) {
    console.log("No pending approvals.");
    return 0;
  }
  for (const a of pending) {
    console.log(`- ${a.id} [${a.tool}] ${a.reasons.join("; ")} (${a.requestedAt})`);
  }
  return 0;
}

function resolveCommand(ctx: CliContext, args: string[]): number {
  const [id, vote] = args;
  if (!id || !vote || !/^[+-]$/.test(vote)) {
    console.error("usage: mcp-nexus resolve <id> [+|-]");
    return 1;
  }
  const approval = ctx.approvals.resolve(id, vote === "+");
  if (!approval) {
    console.error(`No pending approval "${id}".`);
    return 1;
  }
  ctx.approvals.persist(ctx.config.home);
  console.log(vote === "+" ? `Approved ${approval.tool}: ${approval.scopes.join(", ")}` : `Denied ${approval.tool}: ${approval.scopes.join(", ")}`);
  return 0;
}

async function discoverCommand(ctx: CliContext, query: string): Promise<number> {
  if (!query.trim()) {
    console.error("usage: mcp-nexus discover <query>");
    return 1;
  }
  const { query: q, surface } = await ctx.router.discover(query, ctx.registry.enabled());
  console.log(`\nRequest: "${q}"`);
  console.log(`Minimal capability surface:`);
  for (const t of surface) {
    console.log(`  - ${t.name} (${(t.confidence * 100).toFixed(0)}%, ${t.provider})${
      t.matchedCapabilities.length ? ` — ${t.matchedCapabilities.join(", ")}` : ""
    }`);
  }
  if (surface.length === 0) {
    console.log("  (no tools match — register some first)");
  }
  console.log("");
  return surface.length ? 0 : 1;
}

function printDecision(query: string, decision: ReturnType<NexusRouter["route"]> extends Promise<infer T> ? T : never): void {
  console.log(`\nRequest: "${query}"`);
  console.log(`Selected: ${decision.tool?.name ?? "(none)"}`);
  console.log(`Provider: ${decision.provider}`);
  console.log(`Confidence: ${(decision.confidence * 100).toFixed(0)}%`);
  if (decision.matchedCapabilities.length > 0) {
    console.log(`Matched capabilities: ${decision.matchedCapabilities.join(", ")}`);
  }
  if (decision.alternatives.length > 0) {
    console.log(`Alternatives: ${decision.alternatives
      .map((a) => `${a.name} (${(a.confidence * 100).toFixed(0)}%)`)
      .join(", ")}`);
  }
  console.log(`Why: ${decision.explanation}\n`);
}

function policyCommand(ctx: CliContext): number {
  console.log(JSON.stringify(ctx.policy, null, 2));
  return 0;
}

async function configCommand(args: string[]): Promise<number> {
  const file = join(process.cwd(), ".nexus", "config.json");
  const current: Record<string, string | number> = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, string | number>)
    : {};

  if (args.length === 0) {
    console.log(JSON.stringify(current, null, 2));
    return 0;
  }

  for (const kv of args) {
    const eq = kv.indexOf("=");
    if (eq === -1) {
      console.error(`expected KEY=VALUE, got: ${kv}`);
      return 1;
    }
    const key = kv.slice(0, eq).trim();
    const raw = kv.slice(eq + 1).trim();
    current[key] = /^\d+$/.test(raw) ? Number(raw) : raw;
  }

  if (!existsSync(".nexus")) mkdirSync(".nexus", { recursive: true });
  writeFileSync(file, JSON.stringify(current, null, 2));
  console.log("Written to .nexus/config.json");
  console.log(JSON.stringify(current, null, 2));
  return 0;
}

async function doctor(ctx: CliContext): Promise<number> {
  const ok: string[] = [];
  const warn: string[] = [];
  const err: string[] = [];

  const [major] = process.versions.node.split(".").map(Number) as [number];
  if (major >= 22) ok.push(`Node.js ${process.versions.node} (type-stripping supported)`);
  else err.push(`Node.js ${process.versions.node} — >= 22 required`);

  const hasSdk = existsSync(join(process.cwd(), "node_modules", "@modelcontextprotocol", "sdk"));
  hasSdk ? ok.push("@modelcontextprotocol/sdk installed") : warn.push("mcp SDK not found — run npm install");

  const tools = ctx.registry.list();
  ok.push(`Registry: ${tools.length} tool${tools.length === 1 ? "" : "s"} (${ctx.registry.enabled().length} enabled)`);

  const providers = ctx.router["providers"] ?? [];
  for (const p of providers) {
    if (p.name === "heuristic") ok.push("Router heuristic: available (zero-dependency)");
    if (p.name === "semantic") ok.push("Router semantic: available (zero-dependency fuzzy)");
    if (p.name === "llm") {
      if (typeof p === "object" && p && "apiKey" in p && (p as { apiKey?: string }).apiKey) {
        ok.push("Router llm: configured (Gemini free tier)");
      } else {
        warn.push("Router llm: not configured — add GEMINI_API_KEY to enable");
      }
    }
  }

  const policy = ctx.policy;
  const policyJson = JSON.stringify(policy, null, 2);
  const ruleCount = (policyJson.match(/"tool"/g) ?? []).length;
  ruleCount > 0
    ? ok.push(`Policy: ${ruleCount} rule(s) active`)
    : warn.push("Policy: default allow — configure rules for untrusted tools");

  const activity = ctx.activity.summary();
  ok.push(`Activity: ${activity.total} call(s), avg ${activity.avgDurationMs}ms`);

  const box = (symbol: string, label: string, rows: Array<[string, string]>): void => {
    console.log(`\n${symbol} ${label}`);
    for (const [k, v] of rows) {
      console.log(k ? `    ${k.padEnd(28)} ${v}` : `    ${v}`);
    }
  };

  box("✓", "OK", ok.map((s) => ["", s]));
  if (warn.length) box("!", "WARNINGS", warn.map((s) => ["", s]));
  if (err.length) box("✗", "ERRORS", err.map((s) => ["", s]));

  return err.length ? 1 : 0;
}

async function benchmarkCommand(ctx: CliContext): Promise<number> {
  const { suite, tasks } = benchmarkSuite();

  const results: Array<{ query: string; expected: string; got: string | null; correct: boolean }> = [];
  for (const task of tasks) {
    const decision = await ctx.router.route(task.query, suite);
    results.push({
      query: task.query,
      expected: task.expected,
      got: decision.tool?.name ?? null,
      correct: decision.tool?.name === task.expected,
    });
  }

  const correct = results.filter((r) => r.correct).length;

  console.log(`\nMCP Nexus Benchmark (heuristic router)`);
  console.log(`Tools in catalog: ${suite.length}`);
  console.log(`Tasks: ${tasks.length}`);
  console.log(`Accuracy: ${((correct / tasks.length) * 100).toFixed(1)}%`);
  const failures = results.filter((r) => !r.correct);
  if (failures.length > 0) {
    console.log(`\nFailures:`);
    for (const f of failures) {
      console.log(`  - "${f.query}" expected=${f.expected} got=${f.got ?? "none"}`);
    }
  }
  return failures.length ? 1 : 0;
}

function benchmarkSuite(): { suite: ReturnType<ToolRegistry["list"]>; tasks: Array<{ query: string; expected: string }> } {
  const tools = [
    ["repoarch", "Analyze repository architecture, structure and dependencies of a project", ["repository-analysis", "architecture", "dependencies"]],
    ["ctx", "Pack a project into a single file for LLM context", ["context-packing", "codebase-summary"]],
    ["dependency-audit", "Scan dependencies for vulnerable or insecure packages", ["security", "dependency-audit"]],
    ["env-proof", "Validate environment variables for Node and TypeScript projects", ["env-validation", "configuration"]],
    ["git-inspector", "Inspect git history and blame: who changed a file, and when", ["git", "history", "blame"]],
    ["secret-scanner", "Scan a repository for leaked secrets and API keys", ["security", "secrets"]],
  ] as Array<[string, string, string[]]>;

  const registry = ToolRegistry.default(join(tmpdir(), `mcp-nexus-bench-${Date.now()}`));
  for (const [name, description, capabilities] of tools) {
    registry.add(JSON.stringify({
      name, version: "1.0.0", description, capabilities,
      transport: { type: "local", command: ["echo"] }, enabled: true,
    }));
  }

  const tasks = ([
    ["diagram my repository architecture", "repoarch"],
    ["what does my project structure look like", "repoarch"],
    ["check for vulnerable dependencies", "dependency-audit"],
    ["are my npm packages secure", "dependency-audit"],
    ["find leaked secrets in this repo", "secret-scanner"],
    ["scan for API keys", "secret-scanner"],
    ["pack this codebase into one file", "ctx"],
    ["make a single context file for my LLM", "ctx"],
    ["check my env variables are set", "env-proof"],
    ["validate configuration for node", "env-proof"],
    ["show me recent git commits", "git-inspector"],
    ["who changed this file last", "git-inspector"],
    ["analyze my repository structure and then check dependencies", "repoarch"],
  ] as Array<[string, string]>).map(([query, expected]) => ({ query, expected }));

  return { suite: registry.list(), tasks };
}

function message(error: unknown): string {
  if (error instanceof ManifestValidationError || error instanceof Error) {
    return error.message;
  }
  return String(error);
}
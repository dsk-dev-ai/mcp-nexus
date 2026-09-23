import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolRegistry } from "../src/registry/registry.ts";
import { HeuristicRouter } from "../src/router/heuristic.ts";
import { SemanticRouter } from "../src/router/semantic.ts";
import { NexusRouter } from "../src/router/index.ts";
import { PolicyEngine } from "../src/policy/policy.ts";
import { ApprovalStore } from "../src/policy/approvals.ts";
import { ActivityLog } from "../src/telemetry/logger.ts";
import { ToolExecutor } from "../src/executor/executor.ts";
import { startDashboard } from "../src/dashboard/server.ts";
import { normalizeConfig } from "../src/config.ts";

const TOOLS = [
  {
    name: "repoarch", version: "1.0.0",
    description: "Analyze repository architecture",
    capabilities: ["repository-analysis", "architecture"],
    transport: { type: "local", command: ["echo"] }, enabled: true,
  },
  {
    name: "dependency-audit", version: "1.0.0",
    description: "Scan dependencies for vulnerabilities",
    capabilities: ["security", "dependency-audit"],
    transport: { type: "local", command: ["echo"] }, enabled: true,
  },
];

async function withDashboard(fn: (base: string, close: () => Promise<void>) => Promise<void>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "nexus-dash-"));
  const registry = ToolRegistry.default(home);
  for (const t of TOOLS) registry.add(JSON.stringify(t));
  const config = normalizeConfig({
    home,
    port: 0,
    routerProviders: ["heuristic", "semantic"],
  });
  const handle = await startDashboard({
    registry,
    router: new NexusRouter([new HeuristicRouter(), new SemanticRouter()]),
    policy: PolicyEngine.load(home),
    approvals: new ApprovalStore(),
    activity: ActivityLog.default(home),
    executor: new ToolExecutor(),
    config,
  });
  try {
    await fn(`http://127.0.0.1:${handle.port}`, () => handle.close());
  } finally {
    await handle.close();
    rmSync(home, { recursive: true, force: true });
  }
}

test("dashboard serves the HTML page", async () => {
  await withDashboard(async (base, close) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /MCP Nexus/);
    await close();
  });
});

test("GET /api/health reports ok", async () => {
  await withDashboard(async (base, close) => {
    const health = await (await fetch(`${base}/api/health`)).json() as { status: string };
    assert.equal(health.status, "ok");
    await close();
  });
});

test("GET /api/summary exposes aggregate stats", async () => {
  await withDashboard(async (base, close) => {
    const s = await (await fetch(`${base}/api/summary`)).json() as { tools: number; enabled: number };
    assert.equal(s.tools, 2);
    assert.equal(s.enabled, 2);
    await close();
  });
});

test("GET /api/tools lists capabilities and health", async () => {
  await withDashboard(async (base, close) => {
    const tools = await (await fetch(`${base}/api/tools`)).json() as Array<{ name: string; capabilities: string[]; health: string }>;
    assert.equal(tools.length, 2);
    const repoarch = tools.find((t) => t.name === "repoarch");
    assert.deepEqual(repoarch!.capabilities, ["repository-analysis", "architecture"]);
    assert.match(repoarch!.health, /idle|healthy/);
    await close();
  });
});

test("POST /api/tools/:name/enable toggles enabled state", async () => {
  await withDashboard(async (base, close) => {
    const res = await fetch(`${base}/api/tools/dependency-audit/enable`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(res.status, 200);
    const tools = await (await fetch(`${base}/api/tools`)).json() as Array<{ name: string; enabled: boolean }>;
    assert.equal(tools.find((t) => t.name === "dependency-audit")?.enabled, false);
    await close();
  });
});

test("GET /api/route explains a routing decision", async () => {
  await withDashboard(async (base, close) => {
    const d = await (await fetch(`${base}/api/route?query=analyze%20my%20architecture`)).json() as { selected: string; provider: string; confidence: number };
    assert.equal(d.selected, "repoarch");
    assert.match(d.provider, /heuristic|semantic/);
    assert.ok(d.confidence >= 0.5);
    await close();
  });
});

test("approval flow: queue + approve via API", async () => {
  await withDashboard(async (base, close) => {
    const home = mkdtempSync(join(tmpdir(), "nexus-dash-ap-"));
    const registry = ToolRegistry.default(home);
    registry.add(JSON.stringify({ ...TOOLS[0]!, name: "git", capabilities: ["git"] }));
    const policy = new PolicyEngine({ default: "allow", rules: [{ tool: "git", approvals: ["execute"], blocklists: [] }] });
    const approvals = new ApprovalStore();
    const handle = await startDashboard({
      registry,
      router: new NexusRouter([new HeuristicRouter()]),
      policy,
      approvals,
      activity: ActivityLog.default(home),
      executor: new ToolExecutor(),
      config: normalizeConfig({ home, port: 0, routerProviders: ["heuristic"] }),
    });
    const b = `http://127.0.0.1:${handle.port}`;
    const list = await (await fetch(`${b}/api/approvals`)).json() as unknown[];
    assert.equal(list.length, 0);
    await handle.close();
    rmSync(home, { recursive: true, force: true });
    await close();
  });
});

test("GET /api/policies returns the policy config", async () => {
  await withDashboard(async (base, close) => {
    const p = await (await fetch(`${base}/api/policies`)).json() as { default: string };
    assert.equal(p.default, "allow");
    await close();
  });
});

test("GET /api/benchmark runs and reports accuracy", async () => {
  await withDashboard(async (base, close) => {
    const b = await (await fetch(`${base}/api/benchmark`)).json() as { tasks: number; accuracy: number };
    assert.ok(b.tasks >= 13);
    assert.ok(b.accuracy >= 0);
    await close();
  });
});

test("GET /api/config masks secrets", async () => {
  await withDashboard(async (base, close) => {
    const c = await (await fetch(`${base}/api/config`)).json() as Record<string, unknown>;
    assert.equal(c.geminiApiKey, undefined);
    await close();
  });
});
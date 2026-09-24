import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolRegistry } from "../src/registry/registry.ts";
import { HeuristicRouter } from "../src/router/heuristic.ts";
import { SemanticRouter } from "../src/router/semantic.ts";
import { NexusRouter } from "../src/router/index.ts";
import { PolicyEngine } from "../src/policy/policy.ts";
import { ApprovalStore } from "../src/policy/approvals.ts";
import { ActivityLog } from "../src/telemetry/logger.ts";
import { ToolExecutor } from "../src/executor/executor.ts";
import { buildNexusMcpServer } from "../src/server/server.ts";
import { startDashboard } from "../src/dashboard/server.ts";
import { normalizeConfig } from "../src/config.ts";

interface ToolResult {
  content?: Array<{ text?: string }>;
  isError?: boolean;
}

function textOf(result: ToolResult): string {
  return (result.content ?? []).map((c) => c.text ?? "").join("\n");
}

test("§43 user journey: gateway → route → policy → execute → dashboard is a single accountable flow", async () => {
  const home = mkdtempSync(join(tmpdir(), "nexus-journey-"));
  const registry = ToolRegistry.default(home);
  registry.add(JSON.stringify({
    name: "repoarch", version: "1.0.0",
    description: "Analyze repository architecture",
    capabilities: ["repository-analysis", "architecture"],
    transport: { type: "local", command: ["echo", "analyzed"] }, enabled: true,
  }));
  const deps = {
    registry,
    router: new NexusRouter([new HeuristicRouter(), new SemanticRouter()]),
    policy: new PolicyEngine(),
    approvals: new ApprovalStore(),
    activity: ActivityLog.default(home),
    executor: new ToolExecutor(),
    home,
  };
  const server = buildNexusMcpServer(deps);
  const client = new Client({ name: "journey", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  try {
    const { tools } = await client.listTools();
    assert.ok(tools.some((t) => t.name === "nexus.invoke"), "gateway exposes the full surface");

    const route = await client.callTool({ name: "nexus.route", arguments: { query: "analyze my repository architecture" } });
    const routeText = textOf(route as unknown as ToolResult);
    assert.match(routeText, /repoarch/, "route resolves to the registered tool");
    assert.match(routeText, /provider/, "decision stays explainable");

    const invoke = await client.callTool({ name: "nexus.invoke", arguments: { query: "analyze my repository architecture", tool: "repoarch", args: {} } });
    const invokeText = textOf(invoke as unknown as ToolResult);
    assert.match(invokeText, /Execution exec_/, "invoke reports an executionId");
    assert.match(invokeText, /analyzed/, "the tool actually executed");

    const activity = deps.activity.summary();
    assert.equal(activity.total, 1, "the run lands in telemetry");
    assert.equal(activity.byTool.repoarch, 1);

    const dashboard = await startDashboard({ ...deps, config: normalizeConfig({ home, port: 0, routerProviders: ["heuristic", "semantic"] }) });
    const base = `http://127.0.0.1:${dashboard.port}`;
    try {
      const live = await (await fetch(`${base}/api/route?query=analyze%20my%20repository%20architecture`)).json() as { selected: string };
      assert.equal(live.selected, "repoarch", "dashboard shows the same explainable decision");

      const recent = await (await fetch(`${base}/api/activity`)).json() as { recent: Array<{ executionId: string }> };
      assert.ok(recent.recent.some((r) => r.executionId?.startsWith("exec_")), "activity feed carries the gateway execution");
    } finally {
      await dashboard.close();
    }
  } finally {
    await client.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("§43 user journey: approval gate blocks until an operator resolves it through the gateway", async () => {
  const home = mkdtempSync(join(tmpdir(), "nexus-journey-ap-"));
  const registry = ToolRegistry.default(home);
  registry.add(JSON.stringify({
    name: "git", version: "1.0.0",
    description: "git operations",
    capabilities: ["git"],
    transport: { type: "local", command: ["echo", "committed"] }, enabled: true,
  }));
  const policy = new PolicyEngine({ default: "allow", rules: [{ tool: "git", approvals: ["execute"], blocklists: [] }] });
  const deps = {
    registry,
    router: new NexusRouter([new HeuristicRouter()]),
    policy,
    approvals: new ApprovalStore(),
    activity: ActivityLog.default(home),
    executor: new ToolExecutor(),
    home,
  };
  const server = buildNexusMcpServer(deps);
  const client = new Client({ name: "journey-ap", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  try {
    const blocked = await client.callTool({ name: "nexus.invoke", arguments: { query: "commit changes", tool: "git", args: { input: "x" } } });
    const blockedText = textOf(blocked as unknown as ToolResult);
    assert.match(blockedText, /Approval required/, "approval-gated invoke does not execute");

    const list = await client.callTool({ name: "nexus.approvals", arguments: {} });
    const listText = textOf(list as unknown as ToolResult);
    const match = listText.match(/-\s+(\S+)/);
    assert.ok(match, "the pending approval is listed");
    const id = match![1]!;

    const approved = await client.callTool({ name: "nexus.resolve_approval", arguments: { id, approved: true } });
    assert.match(textOf(approved as unknown as ToolResult), /Approved git/);

    const executed = await client.callTool({ name: "nexus.invoke", arguments: { query: "commit changes", tool: "git", args: { input: "x" } } });
    const executedText = textOf(executed as unknown as ToolResult);
    assert.match(executedText, /committed/, "approved tool executes through the gateway");
  } finally {
    await client.close();
    rmSync(home, { recursive: true, force: true });
  }
});
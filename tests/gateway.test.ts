import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolRegistry } from "../src/registry/registry.ts";
import { HeuristicRouter } from "../src/router/heuristic.ts";
import { SemanticRouter } from "../src/router/semantic.ts";
import { NexusRouter } from "../src/router/index.ts";
import { PolicyEngine } from "../src/policy/policy.ts";
import { ApprovalStore } from "../src/policy/approvals.ts";
import { ActivityLog } from "../src/telemetry/logger.ts";
import { ToolExecutor } from "../src/executor/executor.ts";
import { buildNexusMcpServer, type NexusServerDeps } from "../src/server/server.ts";
import { startHttpGateway } from "../src/server/httpGateway.ts";
import { parseManifest } from "../src/registry/manifest.ts";

interface ToolResult {
  content?: Array<{ text?: string }>;
  isError?: boolean;
}

function makeDeps(homeDir: string): NexusServerDeps {
  const registry = ToolRegistry.default(homeDir);
  registry.add(parseManifest(JSON.stringify({
    name: "echo",
    version: "1.0.0",
    description: "Echo stdin",
    capabilities: ["echo", "test"],
    transport: { type: "local", command: ["echo", "hello-from-tool"] },
    enabled: true,
  })));
  return {
    registry,
    router: new NexusRouter([new HeuristicRouter(), new SemanticRouter()]),
    policy: new PolicyEngine(),
    executor: new ToolExecutor(),
    activity: ActivityLog.default(homeDir),
    approvals: ApprovalStore.load(homeDir),
    home: homeDir,
  };
}

async function call(session: McpServer, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), session.connect(serverTransport)]);
  const result = await client.callTool({ name, arguments: args });
  await client.close();
  return result as unknown as ToolResult;
}

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const result = await client.callTool({ name, arguments: args });
  return result as unknown as ToolResult;
}

function textOf(result: ToolResult): string {
  return (result.content ?? []).map((c) => c.text ?? "").join("\n");
}

function newClient(session: McpServer): { client: Client; close: () => Promise<void> } {
  const client = new Client({ name: "test-client", version: "0.0.0" });
  return { client, close: async () => { await client.close(); } };
}

test("gateway §2: full tool surface is registered (register/list/route/discover/invoke/approvals)", async () => {
  const deps = makeDeps(mkdtempSync(join(tmpdir(), "nexus-gw-")));
  const server = buildNexusMcpServer(deps);
  const { client, close } = newClient(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const expected of [
    "nexus.register_tool", "nexus.remove_tool", "nexus.inspect_tool",
    "nexus.list_tools", "nexus.route", "nexus.discover", "nexus.invoke",
    "nexus.approvals", "nexus.resolve_approval",
  ]) {
    assert.ok(names.includes(expected), `expected ${expected} in gateway surface`);
  }

  assert.match(textOf(await callTool(client, "nexus.list_tools", {})), /echo/);
  const inspectText = textOf(await callTool(client, "nexus.inspect_tool", { name: "echo" }));
  assert.match(inspectText, /"name": "echo"/);
  assert.match(inspectText, /1\.0\.0/);
  assert.equal((await callTool(client, "nexus.inspect_tool", { name: "nope" })).isError, true);

  assert.match(textOf(await callTool(client, "nexus.remove_tool", { name: "echo" })), /Removed tool: echo/);
  assert.equal(deps.registry.get("echo"), undefined);
  assert.equal((await callTool(client, "nexus.remove_tool", { name: "echo" })).isError, true);

  await close();
  rmSync(deps.home, { recursive: true, force: true });
});

test("gateway §2: nexus.invoke executes a local tool and returns an executionId", async () => {
  const deps = makeDeps(mkdtempSync(join(tmpdir(), "nexus-invoke-")));
  const server = buildNexusMcpServer(deps);
  const { client, close } = newClient(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  const texts = textOf(await callTool(client, "nexus.invoke", { query: "echo something", tool: "echo", args: {} }));
  assert.match(texts, /Execution exec_/);
  assert.match(texts, /hello-from-tool/);
  assert.match(texts, /success/);

  const activity = deps.activity.summary();
  assert.equal(activity.total, 1);
  assert.equal(activity.byTool.echo, 1);

  await close();
  rmSync(deps.home, { recursive: true, force: true });
});

test("gateway §2/§10: Streamable HTTP transport serves a remote MCP client end to end", async () => {
  const deps = makeDeps(mkdtempSync(join(tmpdir(), "nexus-http-")));
  const handle = await startHttpGateway(deps, { port: 0, host: "127.0.0.1" });

  const client = new Client({ name: "http-test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(handle.url));
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.some((t) => t.name === "nexus.invoke"), "http gateway exposes the nexus surface");

    const routeText = textOf(await callTool(client, "nexus.route", { query: "echo hello" }));
    assert.match(routeText, /"tool"/);

    const invokeText = textOf(await callTool(client, "nexus.invoke", { query: "echo testing", tool: "echo", args: {} }));
    assert.match(invokeText, /hello-from-tool/, "http gateway executes tools");
  } finally {
    await client.close();
    await handle.close();
    rmSync(deps.home, { recursive: true, force: true });
  }
});

test("gateway §2: unknown request does not crash the gateway and stays accountable", async () => {
  const deps = makeDeps(mkdtempSync(join(tmpdir(), "nexus-idle-")));
  const server = buildNexusMcpServer(deps);

  const text = textOf(await call(server, "nexus.route", { query: "what is the weather in tennessee" }));
  assert.match(text, /null/, "no confident match returns provider fallback");
  rmSync(deps.home, { recursive: true, force: true });
});

test("gateway §2: policy deny blocks execution through the gateway", async () => {
  const homeDir = mkdtempSync(join(tmpdir(), "nexus-deny-"));
  const registry = ToolRegistry.default(homeDir);
  registry.add(parseManifest(JSON.stringify({
    name: "utils",
    version: "1.0.0",
    description: "utility",
    capabilities: ["utils", "test"],
    transport: { type: "local", command: ["echo", "blocked"] },
    enabled: true,
  })));
  const policy = new PolicyEngine({ default: "allow", rules: [{ tool: "utils", approvals: [], blocklists: ["execute"] }] });
  const deps: NexusServerDeps = {
    registry,
    router: new NexusRouter([new HeuristicRouter()]),
    policy,
    executor: new ToolExecutor(),
    activity: ActivityLog.default(homeDir),
    approvals: ApprovalStore.load(homeDir),
    home: homeDir,
  };
  const server = buildNexusMcpServer(deps);

  const text = textOf(await call(server, "nexus.invoke", { query: "run utils with write", tool: "utils", args: { input: "write" } }));
  assert.match(text, /policy/, "deny reaches the client as an explainable block");
  rmSync(homeDir, { recursive: true, force: true });
});
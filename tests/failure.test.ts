import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolExecutor } from "../src/executor/executor.ts";
import { HeuristicRouter } from "../src/router/heuristic.ts";
import { SemanticRouter } from "../src/router/semantic.ts";
import { NexusRouter } from "../src/router/index.ts";
import { ToolRegistry } from "../src/registry/registry.ts";
import type { ToolManifest } from "../src/registry/manifest.ts";

function tool(name: string, transport: ToolManifest["transport"]): ToolManifest {
  return { name, version: "1.0.0", description: name, capabilities: [name], transport, enabled: true };
}

test("connection refused surfaces as error (tool unavailable, §12)", async () => {
  const executor = new ToolExecutor({ timeoutMs: 2000 });
  const result = await executor.execute(
    tool("dead", { type: "http", url: "http://127.0.0.1:1/dead" }),
    {},
  );
  assert.equal(result.status, "error");
  assert.match(result.stderr, /fetch failed|ECONNREFUSED|reason/i);
});

test("HTTP 500 response becomes error with status in stderr (§12)", async () => {
  const server = createServer((_, res) => {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("boom");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const executor = new ToolExecutor({ timeoutMs: 2000 });
    const result = await executor.execute(
      tool("bad", { type: "http", url: `http://127.0.0.1:${port}/x` }),
      {},
    );
    assert.equal(result.status, "error");
    assert.match(result.stderr, /500/);
  } finally {
    server.close();
  }
});

test("HTTP 200 with garbage body surfaces result text, tolerant parsing (§12)", async () => {
  const server = createServer((_, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("{{{ not json ");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const executor = new ToolExecutor({ timeoutMs: 2000 });
    const result = await executor.execute(
      tool("junk", { type: "http", url: `http://127.0.0.1:${port}/x` }),
      {},
    );
    assert.equal(result.status, "success");
    assert.match(result.stdout, /\{\{\{ not json/);
  } finally {
    server.close();
  }
});

test("router recovers from a failing provider and uses the next (§12)", async () => {
  const home = mkdtempSync(join(tmpdir(), "fail-router-"));
  try {
    const reg = new ToolRegistry(join(home, "registry.json"));
    reg.add(JSON.stringify({
      name: "weather", version: "1.0.0", description: "current weather for a city",
      capabilities: ["weather", "forecast"], transport: { type: "local", command: ["echo"] }, enabled: true,
    }));

    const throwing = {
      name: "broken",
      async route() { throw new Error("provider crashed"); },
    };
    const router = new NexusRouter([throwing, new HeuristicRouter(), new SemanticRouter()]);
    const decision = await router.route("weather in berlin", reg.list());
    assert.equal(decision.tool?.name, "weather");
    assert.match(decision.provider, /heuristic|semantic/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("unknown request falls back without crashing (§4 unknown)", async () => {
  const home = mkdtempSync(join(tmpdir(), "fail-unknown-"));
  try {
    const reg = new ToolRegistry(join(home, "registry.json"));
    reg.add(JSON.stringify({
      name: "repoarch", version: "1.0.0", description: "analyze repository architecture",
      capabilities: ["repository-analysis", "architecture"], transport: { type: "local", command: ["echo"] }, enabled: true,
    }));
    const router = new NexusRouter([new HeuristicRouter(), new SemanticRouter()]);
    const decision = await router.route("book a flight to tokyo", reg.list());
    assert.equal(decision.tool, undefined);
    assert.equal(decision.provider, "fallback");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
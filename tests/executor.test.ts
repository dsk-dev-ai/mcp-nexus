import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolExecutor, TransportNotImplementedError } from "../src/executor/executor.ts";
import type { ToolManifest } from "../src/registry/manifest.ts";

function tool(name: string, command: string[]): ToolManifest {
  return {
    name, version: "1.0.0", description: name, capabilities: [name],
    transport: { type: "local", command }, enabled: true,
  };
}

test("executes a successful command", async () => {
  const executor = new ToolExecutor();
  const result = await executor.execute(tool("echo", ["echo", "hello"]), {});
  assert.equal(result.status, "success");
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /hello/);
});

test("reports non-zero exit as error", async () => {
  const executor = new ToolExecutor();
  const result = await executor.execute(tool("false", ["node", "-e", "process.exit(3)"]), {});
  assert.equal(result.status, "error");
  assert.equal(result.exitCode, 3);
});

test("caps execution with a timeout", async () => {
  const executor = new ToolExecutor({ timeoutMs: 150 });
  const result = await executor.execute(
    tool("slow", ["node", "-e", "setTimeout(()=>{}, 5000)"]),
    {},
  );
  assert.equal(result.status, "timeout");
});

test("interpolates {{arg}} tokens", async () => {
  const executor = new ToolExecutor();
  const result = await executor.execute(
    tool("greet", ["node", "-e", "console.log(JSON.stringify(process.argv.slice(2)))", "hello", "{{name}}"]),
    { name: "nexus" },
  );
  assert.match(result.stdout, /"nexus"/);
});

test("rejects http and docker transports in V1", async () => {
  const executor = new ToolExecutor();
  const httpTool = { ...tool("http-thing", ["echo"]), transport: { type: "http" as const, url: "http://localhost" } };
  await assert.rejects(() => executor.execute(httpTool, {}), TransportNotImplementedError);
});
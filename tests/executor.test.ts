import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { spawn } from "node:child_process";
import { ToolExecutor } from "../src/executor/executor.ts";
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

function withServer(handler: (reqBody: string) => { status: number; body: string }, fn: (port: number) => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => { body += c.toString(); });
      req.on("end", () => {
        const out = handler(body);
        res.statusCode = out.status;
        res.end(out.body);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("no port"));
      fn(address.port)
        .then(() => { server.close(); resolve(); })
        .catch((e) => { server.close(); reject(e); });
    });
  });
}

test("http transport POSTs {input: args} and returns response body", async () => {
  await withServer(
    (body) => {
      const parsed = JSON.parse(body) as { input: Record<string, unknown> };
      return { status: 200, body: `echo:${parsed.input.message}` };
    },
    async (port) => {
      const executor = new ToolExecutor();
      const result = await executor.execute({ ...tool("http-thing", []), transport: { type: "http", url: `http://127.0.0.1:${port}/tool` } }, { message: "hi" });
      assert.equal(result.status, "success");
      assert.equal(result.stdout, "echo:hi");
    },
  );
});

test("http transport surfaces non-2xx as error with status", async () => {
  await withServer(
    () => ({ status: 500, body: "boom" }),
    async (port) => {
      const executor = new ToolExecutor();
      const result = await executor.execute({ ...tool("http-thing", []), transport: { type: "http", url: `http://127.0.0.1:${port}/tool` } }, {});
      assert.equal(result.status, "error");
      assert.equal(result.stdout, "boom");
      assert.match(result.stderr, /500/);
    },
  );
});

test("http transport times out on a silent server", async () => {
  const { port, close } = await new Promise<{ port: number; close: () => void }>((resolve, reject) => {
    const server = createNetServer((socket) => {
      // accept but never respond — exercises AbortSignal.timeout
      socket.on("data", () => { /* keep quiet */ });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("no port"));
      resolve({ port: address.port, close: () => server.close() });
    });
  });
  try {
    const executor = new ToolExecutor({ timeoutMs: 200 });
    const result = await executor.execute(
      { ...tool("http-slow", []), transport: { type: "http", url: `http://127.0.0.1:${port}/tool` } },
      {},
    );
    assert.equal(result.status, "timeout");
  } finally {
    close();
  }
});

test("docker transport is wired (skips if docker is unavailable)", async (t) => {
  const probe = await new Promise<boolean>((resolve) => {
    const docker = spawn("docker", ["--version"]);
    docker.on("error", () => resolve(false));
    docker.on("close", (code) => resolve(code === 0));
  });
  if (!probe) {
    t.skip("docker CLI not available");
    return;
  }

  const executor = new ToolExecutor();
  const result = await executor.execute(
    { ...tool("docker-thing", []), transport: { type: "docker" as const, image: "busybox", command: ["echo", "hello-docker"] } },
    {},
  );
  assert.equal(result.status, "success");
  assert.match(result.stdout, /hello-docker/);
});
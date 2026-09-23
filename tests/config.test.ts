import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDotEnv, normalizeConfig, loadDotEnv, DEFAULT_PROVIDERS } from "../src/config.ts";

test("parseDotEnv handles comments, blanks, quotes", () => {
  const env = parseDotEnv(`
# comment
KEY=value
QUOTED="hello world"
SINGLE='a=b'
EMPTY=
`);
  assert.deepEqual(env, {
    KEY: "value",
    QUOTED: "hello world",
    SINGLE: "a=b",
    EMPTY: "",
  });
});

test("normalizeConfig fills defaults and maps router mode to providers", () => {
  const c = normalizeConfig({ home: "/tmp/x" });
  assert.equal(c.port, 3000);
  assert.equal(c.logLevel, "info");
  assert.equal(c.executionTimeoutMs, 30_000);
  assert.equal(c.routerMode, "hybrid");
  assert.deepEqual(c.routerProviders, DEFAULT_PROVIDERS);
});

test("router mode selects provider chains", () => {
  assert.deepEqual(normalizeConfig({ routerMode: "heuristic" }).routerProviders, ["heuristic"]);
  assert.deepEqual(normalizeConfig({ routerMode: "semantic" }).routerProviders, ["heuristic", "semantic"]);
  assert.deepEqual(normalizeConfig({ routerMode: "llm" }).routerProviders, DEFAULT_PROVIDERS);
  assert.deepEqual(normalizeConfig({ routerMode: "hybrid", routerProviders: ["heuristic"] }).routerProviders, ["heuristic"]);
});

test("execution timeout and log level round-trip through normalizeConfig", () => {
  const c = normalizeConfig({ executionTimeoutMs: 5000, logLevel: "debug" });
  assert.equal(c.executionTimeoutMs, 5000);
  assert.equal(c.logLevel, "debug");
});

test("loadDotEnv merges .env without clobbering real process env", () => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-env-"));
  try {
    writeFileSync(join(dir, ".env"), "MCP_NEXUS_PORT=8123\nMCP_NEXUS_LOG_LEVEL=debug\n");
    const prev = process.env.MCP_NEXUS_PORT;
    delete process.env.MCP_NEXUS_PORT;
    loadDotEnv(dir);
    assert.equal(process.env.MCP_NEXUS_PORT, "8123");
    if (prev !== undefined) process.env.MCP_NEXUS_PORT = prev;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
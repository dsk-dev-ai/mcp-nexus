import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolRegistry } from "../src/registry/registry.ts";
import { HeuristicRouter, stem, matches } from "../src/router/heuristic.ts";
import { NexusRouter } from "../src/router/index.ts";
import { LlmRouter } from "../src/router/llm.ts";
import { SemanticRouter } from "../src/router/semantic.ts";

const TOOLS = [
  {
    name: "repoarch", version: "1.0.0",
    description: "Analyze repository architecture, structure and dependencies of a project",
    capabilities: ["repository-analysis", "architecture", "dependencies"],
    transport: { type: "local", command: ["echo"] }, enabled: true,
  },
  {
    name: "dependency-audit", version: "1.0.0",
    description: "Scan dependencies for vulnerable or insecure packages",
    capabilities: ["security", "dependency-audit"],
    transport: { type: "local", command: ["echo"] }, enabled: true,
  },
  {
    name: "ctx", version: "1.0.0",
    description: "Pack a project into a single file for LLM context",
    capabilities: ["context-packing", "codebase-summary"],
    transport: { type: "local", command: ["echo"] }, enabled: true,
  },
];

function withRegistry(fn: (registry: ToolRegistry) => Promise<void>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "nexus-router-"));
  const registry = ToolRegistry.default(home);
  for (const t of TOOLS) registry.add(JSON.stringify(t));
  return fn(registry).finally(() => rmSync(home, { recursive: true, force: true }));
}

function router(): NexusRouter {
  return new NexusRouter([new HeuristicRouter(), new SemanticRouter(), new LlmRouter()]);
}

test("stem handles irregular plurals and suffixes", () => {
  assert.equal(stem("dependencies"), "dependency");
  assert.equal(stem("security"), "secur");
  assert.equal(stem("secure"), "secur");
  assert.equal(stem("changed"), "chang");
  assert.equal(stem("files"), "file");
  assert.equal(matches("dependencies", "dependency"), true);
  assert.equal(matches("secure", "security"), true);
  assert.equal(matches("analyzing", "analyze"), true);
});

test("routes architecture request to repoarch", async () => {
  await withRegistry(async (registry) => {
    const decision = await router().route("analyze my repository architecture", registry.enabled());
    assert.equal(decision.tool?.name, "repoarch");
    assert.equal(decision.provider, "heuristic");
    assert.ok(decision.confidence >= 0.5);
    assert.ok(decision.explanation.includes("architecture"));
  });
});

test("routes vulnerable dependencies to dependency-audit", async () => {
  await withRegistry(async (registry) => {
    const decision = await router().route("check vulnerable dependencies", registry.enabled());
    assert.equal(decision.tool?.name, "dependency-audit");
  });
});

test("routes insecure packages to dependency-audit via stemmed security", async () => {
  await withRegistry(async (registry) => {
    const decision = await router().route("are my npm packages secure", registry.enabled());
    assert.equal(decision.tool?.name, "dependency-audit");
  });
});

test("routes context packing to ctx", async () => {
  await withRegistry(async (registry) => {
    const decision = await router().route("pack this codebase into one file", registry.enabled());
    assert.equal(decision.tool?.name, "ctx");
  });
});

test("unrelated query falls through to fallback with no tool", async () => {
  await withRegistry(async (registry) => {
    const decision = await router().route("what is the weather in tokyo", registry.enabled());
    assert.equal(decision.tool, undefined);
    assert.equal(decision.provider, "fallback");
  });
});

test("explainable routing includes alternatives and confidence", async () => {
  await withRegistry(async (registry) => {
    const decision = await router().route("check dependencies", registry.enabled());
    assert.ok(Array.isArray(decision.alternatives));
    assert.ok(typeof decision.confidence === "number");
  });
});

test("LLM router is unavailable without an API key", async () => {
  const llm = new LlmRouter();
  const result = await llm.route("analyze my repository", []);
  assert.equal(result.reliability, "unavailable");
});
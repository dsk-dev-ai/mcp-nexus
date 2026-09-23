import { test } from "node:test";
import assert from "node:assert/strict";
import { SemanticRouter } from "../src/router/semantic.ts";
import { HeuristicRouter } from "../src/router/heuristic.ts";
import { NexusRouter } from "../src/router/index.ts";
import { ToolRegistry } from "../src/registry/registry.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

function tools(): ReturnType<ToolRegistry["list"]> {
  const home = mkdtempSync(join(tmpdir(), "nexus-semantic-"));
  const registry = ToolRegistry.default(home);
  for (const t of TOOLS) registry.add(JSON.stringify(t));
  const list = registry.list();
  rmSync(home, { recursive: true, force: true });
  return list;
}

test("semantic router recovers from typos the heuristic misses", async () => {
  const catalog = tools();
  const heuristic = await new HeuristicRouter().route("archtecture", catalog);
  const semantic = await new SemanticRouter().route("archtecture", catalog);
  assert.equal(heuristic.decision?.tool?.name, undefined); // no exact token overlap
  assert.equal(semantic.decision?.tool?.name, "repoarch");
  assert.ok(semantic.decision!.confidence >= 0.35);
});

test("semantic router prefers distinctive vocabulary (IDF)", async () => {
  const catalog = tools();
  const result = await new SemanticRouter().route("check vuln dependencies", catalog);
  const decision = result.decision!;
  // "dependencies" is shared with repoarch; "vuln" is distinctive to
  // dependency-audit, tipping the IDF-weighted score and the matched surface.
  assert.equal(decision.tool?.name, "dependency-audit");
  assert.ok(decision.matchedCapabilities.includes("dependency-audit"));
});

test("semantic router defers on unrelated requests", async () => {
  const catalog = tools();
  const result = await new SemanticRouter().route("what is the weather like", catalog);
  assert.equal(result.decision?.tool, undefined);
});

test("full chain uses semantic for a low-precision typo on capability", async () => {
  const catalog = tools();
  const nexus = new NexusRouter([new HeuristicRouter(), new SemanticRouter()]);
  // "vulnerbilities" is far from any single heuristic token but close in bigrams
  const decision = await nexus.route("check for vulnerbilities", catalog);
  assert.equal(decision.tool?.name, "dependency-audit");
});

test("discover returns a ranked minimal surface", async () => {
  const catalog = tools();
  const nexus = new NexusRouter([new HeuristicRouter(), new SemanticRouter()]);
  const { query, surface } = await nexus.discover("check my dependencies", catalog);
  assert.equal(query, "check my dependencies");
  assert.ok(surface.length >= 1);
  assert.equal(surface[0]!.name, "dependency-audit");
  assert.ok(surface[0]!.confidence > 0);
});
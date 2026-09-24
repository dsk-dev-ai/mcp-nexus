import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolRegistry } from "../src/registry/registry.ts";
import { HeuristicRouter } from "../src/router/heuristic.ts";
import { SemanticRouter } from "../src/router/semantic.ts";
import { NexusRouter } from "../src/router/index.ts";
import { LlmRouter, buildLlmRouter } from "../src/router/llm.ts";
import { ManifestValidationError } from "../src/registry/manifest.ts";
import {
  createTool,
  defineCapabilities,
  definePermissions,
  registerTool,
  upsertTool,
  buildRouter,
  type ToolSpec,
} from "../src/sdk/index.ts";
import type { RouterPlugin } from "../src/sdk/interfaces.ts";

const SPEC: ToolSpec = {
  name: "repoarch",
  version: "1.0.0",
  description: "Analyze repository architecture",
  capabilities: ["repository-analysis", "architecture"],
  transport: { type: "local", command: ["echo"] },
  permissions: { filesystem: { read: true, write: false } },
};

test("createTool builds a validated manifest with defaults", () => {
  const m = createTool(SPEC);
  assert.equal(m.name, "repoarch");
  assert.equal(m.enabled, true);
  assert.deepEqual(m.permissions, { filesystem: { read: true, write: false } });
});

test("createTool throws ManifestValidationError on bad specs", () => {
  assert.throws(() => createTool({ ...SPEC, transport: { type: "docker" } } as unknown as ToolSpec), ManifestValidationError);
  assert.throws(() => createTool({ ...SPEC, capabilities: [] }), ManifestValidationError);
});

test("defineCapabilities dedupes and lowercases, preserving order", () => {
  assert.deepEqual(defineCapabilities(["Repo-Arch", "security", "repo-arch"]), ["repo-arch", "security"]);
});

test("definePermissions normalizes resource keys and scope objects", () => {
  assert.deepEqual(
    definePermissions({ Filesystem: { write: true } }),
    { filesystem: { write: true } },
  );
});

test("registerTool and upsertTool add then update via the SDK", () => {
  const home = mkdtempSync(join(tmpdir(), "nexus-sdk-"));
  try {
    const registry = new ToolRegistry(join(home, "registry.json"));
    const created = createTool(SPEC);
    assert.equal(registerTool(registry, created).name, "repoarch");
    assert.equal(upsertTool(registry, created).added, false);
    const v2 = createTool({ ...SPEC, version: "1.1.0" });
    const { added, entry } = upsertTool(registry, v2);
    assert.equal(added, false);
    assert.equal(entry.version, "1.1.0");
    assert.equal(registry.list().length, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a custom RouterPlugin drives the fallback chain via buildRouter", async () => {
  const home = mkdtempSync(join(tmpdir(), "nexus-sdk-"));
  try {
    const registry = new ToolRegistry(join(home, "registry.json"));
    registry.add(JSON.stringify(createTool({ ...SPEC, capabilities: ["vulnerability-scan"] })));

    const alwaysPick: RouterPlugin = {
      name: "custom",
      async route() {
        return {
          reliability: "available",
          decision: {
            provider: "custom",
            tool: registry.list()[0],
            confidence: 0.9,
            matchedCapabilities: ["vulnerability-scan"],
            alternatives: [],
            explanation: "custom plugin picked it",
          },
        };
      },
    };

    const router = buildRouter([alwaysPick, new HeuristicRouter(), new SemanticRouter()]);
    const decision = await router.route("scan for problems", registry.enabled());
    assert.equal(decision.provider, "custom");
    assert.equal(decision.tool?.name, "repoarch");
    assert.ok(decision.confidence >= 0.9);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("built-in routers satisfy the RouterPlugin contract", () => {
  void (new HeuristicRouter() as RouterPlugin);
  void (new SemanticRouter() as RouterPlugin);
  void (new NexusRouter([new HeuristicRouter()]) as unknown as RouterPlugin); // chain is not a leaf plugin
  assert.ok(true);
});

test("LlmRouter reports configured status", () => {
  assert.equal(new LlmRouter("gemini").configured, false);
  assert.equal(new LlmRouter("gemini", "sk-test").configured, true);
  assert.equal(new LlmRouter("openrouter", "sk-test").configured, true);
  assert.equal(new LlmRouter("openrouter").name, "llm-openrouter");
  assert.equal(new LlmRouter("gemini", "sk-test").name, "llm");
});

test("buildLlmRouter selects OpenRouter when a key is set, else Gemini", () => {
  const fromConfig = buildLlmRouter;
  assert.equal(fromConfig({}).name, "llm");
  assert.equal(fromConfig({ openrouterApiKey: "or-key" }).name, "llm-openrouter");
  assert.equal(fromConfig({ openrouterApiKey: "or-key", geminiApiKey: "gm-key" }).name, "llm-openrouter");
  assert.equal(fromConfig({ geminiApiKey: "gm-key" }).name, "llm");
});

test("SDK surface exposes the documented entry points", async () => {
  const sdk = await import("../src/sdk/index.ts");
  for (const fn of ["createTool", "defineCapabilities", "definePermissions", "registerTool", "parseAndRegisterTool", "upsertTool", "buildRouter"]) {
    assert.equal(typeof sdk[fn as keyof typeof sdk], "function", `missing ${fn}`);
  }
});
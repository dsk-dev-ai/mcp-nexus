import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolRegistry, ToolNotFoundError } from "../src/registry/registry.ts";
import { ManifestValidationError } from "../src/registry/manifest.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "nexus-registry-"));
}

const base = {
  version: "1.0.0",
  description: "Analyze repository architecture",
  capabilities: ["repository-analysis", "architecture"],
  transport: { type: "local", command: ["echo", "ok"] },
  enabled: true,
};

test("add, list and get a tool", () => {
  const home = tempHome();
  try {
    const registry = ToolRegistry.default(home);
    registry.add(JSON.stringify({ name: "repoarch", ...base }));
    assert.equal(registry.list().length, 1);
    assert.equal(registry.get("repoarch")?.name, "repoarch");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("duplicate add throws", () => {
  const home = tempHome();
  try {
    const registry = ToolRegistry.default(home);
    registry.add(JSON.stringify({ name: "repoarch", ...base }));
    assert.throws(
      () => registry.add(JSON.stringify({ name: "repoarch", ...base })),
      /already registered/,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("update keeps addedAt and replaces fields", () => {
  const home = tempHome();
  try {
    const registry = ToolRegistry.default(home);
    const added = registry.add(JSON.stringify({ name: "repoarch", ...base }));
    const updated = registry.update(
      JSON.stringify({ ...base, name: "repoarch", description: "new description" }),
    );
    assert.equal(updated.description, "new description");
    assert.equal(updated.addedAt, added.addedAt);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("remove and unknown remove error", () => {
  const home = tempHome();
  try {
    const registry = ToolRegistry.default(home);
    registry.add(JSON.stringify({ name: "repoarch", ...base }));
    registry.remove("repoarch");
    assert.equal(registry.list().length, 0);
    assert.throws(() => registry.remove("repoarch"), ToolNotFoundError);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("persists to disk and reloads", () => {
  const home = tempHome();
  try {
    const registry = ToolRegistry.default(home);
    registry.add(JSON.stringify({ name: "repoarch", ...base }));
    const reloaded = ToolRegistry.default(home);
    assert.ok(reloaded.get("repoarch"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("invalid manifest rejected", () => {
  const home = tempHome();
  try {
    const registry = ToolRegistry.default(home);
    assert.throws(
      () => registry.add(JSON.stringify({ name: "repoarch" })),
      ManifestValidationError,
    );
    assert.throws(
      () => registry.add(JSON.stringify({ name: "repo arch", version: "1", description: "x", capabilities: ["a"], transport: { type: "local", command: ["e"] }, enabled: true })),
      /name must be a string/,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("setEnabled flips active flag", () => {
  const home = tempHome();
  try {
    const registry = ToolRegistry.default(home);
    registry.add(JSON.stringify({ name: "repoarch", ...base }));
    registry.setEnabled("repoarch", false);
    assert.equal(registry.enabled().length, 0);
    assert.equal(registry.list()[0]?.enabled, false);
    assert.equal(existsSync(join(home, "registry.json")), true);
    readFileSync(join(home, "registry.json"), "utf8");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
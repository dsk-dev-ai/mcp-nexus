import { test } from "node:test";
import assert from "node:assert/strict";
import { parseManifest, validateManifest, ManifestValidationError } from "../src/registry/manifest.ts";

test("parses a valid JSON manifest", () => {
  const manifest = parseManifest(JSON.stringify({
    name: "repoarch", version: "1.0.0", description: "analyze", capabilities: ["architecture"],
    transport: { type: "local", command: ["repoarch"] }, enabled: true,
  }));
  assert.equal(manifest.name, "repoarch");
  assert.equal(manifest.transport.type, "local");
});

test("parses a minimal YAML manifest", () => {
  const manifest = parseManifest(`
name: repoarch
version: 1.0.0
description: Analyze repository architecture
capabilities:
  - repository-analysis
  - architecture
transport:
  type: http
  url: http://localhost:8080
enabled: true
`);
  assert.equal(manifest.name, "repoarch");
  assert.ok(manifest.capabilities.includes("architecture"));
  assert.equal(manifest.transport.type, "http");
  assert.equal(manifest.transport.url, "http://localhost:8080");
});

test("rejects missing required fields", () => {
  assert.throws(() => parseManifest(JSON.stringify({ name: "x", version: "1" })), ManifestValidationError);
});

test("rejects invalid transport type", () => {
  assert.throws(
    () => parseManifest(JSON.stringify({
      name: "x", version: "1", description: "d", capabilities: ["c"],
      transport: { type: "carrier-pigeon" }, enabled: true,
    })),
    /transport\.type must be/,
  );
});

test("validateManifest type guard accepts valid input", () => {
  const manifest = {
    name: "ctx", version: "1", description: "pack", capabilities: ["context"],
    transport: { type: "local", command: ["ctx"] }, enabled: true,
  };
  validateManifest(manifest);
  assert.ok(true);
});
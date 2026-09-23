import { test } from "node:test";
import assert from "node:assert/strict";
import { PolicyEngine } from "../src/policy/policy.ts";
import type { ToolManifest } from "../src/registry/manifest.ts";

const tool: ToolManifest = {
  name: "git", version: "1.0.0", description: "git operations",
  capabilities: ["git"],
  transport: { type: "local", command: ["git"] },
  permissions: { filesystem: { read: true, write: false } },
  enabled: true,
};

test("default policy allows", () => {
  const policy = new PolicyEngine();
  const decision = policy.evaluate(tool, ["execute"]);
  assert.equal(decision.action, "allow");
});

test("blocklist denies a scope", () => {
  const policy = new PolicyEngine({
    default: "allow",
    rules: [{ tool: "git", approvals: [], blocklists: ["git.push"] }],
  });
  const decision = policy.evaluate(tool, ["execute", "git.push"]);
  assert.equal(decision.action, "deny");
  assert.ok(decision.reasons.some((r) => r.includes("git.push")));
});

test("approval scope surfaces as approval", () => {
  const policy = new PolicyEngine({
    default: "allow",
    rules: [{ tool: "git", approvals: ["git.commit"], blocklists: [] }],
  });
  const decision = policy.evaluate(tool, ["git.commit"]);
  assert.equal(decision.action, "approval");
});

test("manifest permission write:false denies filesystem.write", () => {
  const policy = new PolicyEngine();
  const decision = policy.evaluate(tool, ["execute", "filesystem.write"]);
  assert.equal(decision.action, "deny");
  assert.ok(decision.reasons.some((r) => r.includes("filesystem.write")));
});

test("default deny enforced when configured", () => {
  const policy = new PolicyEngine({ default: "deny", rules: [] });
  assert.equal(policy.evaluate(tool, ["execute"]).action, "deny");
});
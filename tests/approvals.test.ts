import { test } from "node:test";
import assert from "node:assert/strict";
import { ApprovalStore } from "../src/policy/approvals.ts";
import { PolicyEngine } from "../src/policy/policy.ts";
import type { ToolManifest } from "../src/registry/manifest.ts";

const tool: ToolManifest = {
  name: "git", version: "1.0.0", description: "git operations",
  capabilities: ["git"],
  transport: { type: "local", command: ["git"] },
  permissions: { filesystem: { read: true } },
  enabled: true,
};

function policy(): PolicyEngine {
  return new PolicyEngine({
    default: "allow",
    rules: [{ tool: "git", approvals: ["git.push"], blocklists: [] }],
  });
}

test("approval-gated scope surfaces as approval when not granted", () => {
  const approvals = new ApprovalStore();
  const decision = policy().evaluate(tool, ["execute", "git.push"], approvals);
  assert.equal(decision.action, "approval");
});

test("resolving approval makes the same scope allowed", async () => {
  const approvals = new ApprovalStore();
  const engine = policy();

  const before = engine.evaluate(tool, ["execute", "git.push"], approvals);
  assert.equal(before.action, "approval");

  const pending = approvals.request("git", ["git.push"], before.reasons);
  const resolved = approvals.resolve(pending.id, true);
  assert.equal(resolved?.tool, "git");

  const after = engine.evaluate(tool, ["execute", "git.push"], approvals);
  assert.equal(after.action, "allow");
});

test("list/resolve round-trips and removes pending", () => {
  const approvals = new ApprovalStore();
  const pending = approvals.request("git", ["git.push"], ["requires approval"]);
  assert.equal(approvals.list().length, 1);
  approvals.resolve(pending.id, false);
  assert.equal(approvals.list().length, 0);
});

test("resolving an unknown id returns null", () => {
  const approvals = new ApprovalStore();
  assert.equal(approvals.resolve("nope", true), null);
});

test("grant only covers the tool+scope that was approved", () => {
  const approvals = new ApprovalStore();
  const pending = approvals.request("git", ["git.push"], []);
  approvals.resolve(pending.id, true);
  assert.equal(approvals.isGranted("git", "git.push"), true);
  assert.equal(approvals.isGranted("git", "filesystem.read"), false);
  assert.equal(approvals.isGranted("other", "git.push"), false);
});
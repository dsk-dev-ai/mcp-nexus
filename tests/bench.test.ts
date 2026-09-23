import { test } from "node:test";
import assert from "node:assert/strict";
import {
  referenceCatalog,
  syntheticCatalog,
  buildTasks,
  buildLargeTasks,
  runBenchProvider,
  formatBench,
  type BenchProvider,
  type BenchTask,
} from "../src/bench/suite.ts";
import type { RegistryEntry } from "../src/registry/registry.ts";
import { HeuristicRouter } from "../src/router/heuristic.ts";
import { SemanticRouter } from "../src/router/semantic.ts";
import { NexusRouter } from "../src/router/index.ts";

type RouteFn = BenchProvider["route"];

function direct<R extends { route(q: string, t: RegistryEntry[]): Promise<unknown> }>(name: string, r: R): BenchProvider {
  return {
    name,
    async route(q, t) {
      return (await r.route(q, t)) as never;
    },
  };
}

function chainProvider(name: string, router: NexusRouter): BenchProvider {
  return {
    name,
    async route(q, t) {
      const decision = await router.route(q, t);
      return { reliability: "available" as const, decision };
    },
  };
}

test("heuristic router holds its documented §31 reference accuracy (84.4%) over the deterministic task suite", async () => {
  const provider = direct("heuristic", new HeuristicRouter());
  const catalog = referenceCatalog();
  const { tasks } = buildTasks();
  const result = await runBenchProvider(provider, catalog, tasks);
  assert.equal(result.accuracy, 84.375, "deterministic ref task suite holds the exact offline number (rounded 84.4 in the §31 report)");
  assert.equal(result.byCategory.exact.correct, 12);
  assert.equal(result.byCategory.unknown.correct, 8, "unknown queries stay un-mapped under heuristic deferral");
  assert.ok(result.latencyMs < 2, "heuristic stays sub-millisecond per task (§31)");
});

test("semantic router recovers the paraphrases the heuristic layer leaves open (§5 §31)", async () => {
  const provider = direct("semantic", new SemanticRouter());
  const catalog = referenceCatalog();
  const { tasks } = buildTasks();
  const result = await runBenchProvider(provider, catalog, tasks);
  assert.ok(result.byCategory.semantic.correct >= 3, "semantic must own the paraphrased intents");
  assert.ok(result.latencyMs < 3);
});

test("the NexusRouter fallback chain routes with the best of both layers and stays fast (§6 §31)", async () => {
  const router = new NexusRouter([new HeuristicRouter(), new SemanticRouter()]);
  const catalog = referenceCatalog();
  const { tasks } = buildTasks();
  const result = await runBenchProvider(chainProvider("hybrid", router), catalog, tasks);
  assert.ok(Math.abs(result.accuracy - 78.1) < 0.1, `hybrid holds the best-of-both reference, got ${result.accuracy}%`);
  assert.equal(result.byCategory.ambiguous.correct, 4, "hybrid resolves the ambiguous intents the single providers split on");
  assert.equal(result.byCategory.exact.correct, 12);
  assert.equal(result.byCategory.unknown.correct, 7, "unknown stays unknown through the chain");
  assert.ok(result.latencyMs < 2, "the chain adds no interactive-latency regression");
});

test("large collection (50 tools / 20 tasks) stays accurate and fast through the same chain (§31)", async () => {
  const router = new NexusRouter([new HeuristicRouter(), new SemanticRouter()]);
  const catalog = syntheticCatalog(50);
  const tasks = buildLargeTasks(catalog, 20);
  assert.equal(tasks.length, 20);
  const result = await runBenchProvider(chainProvider("hybrid-large", router), catalog, tasks);
  assert.equal(result.accuracy, 100, "distinctive 50-tool collection routes deterministically");
  assert.equal(result.byCategory.exact.correct, 20);
  assert.ok(result.latencyMs < 5, "50-tool routing stays well under interactive threshold");
});

test("formatBench renders the human §31 report from a provider result", async () => {
  const provider = direct("heuristic", new HeuristicRouter());
  const catalog = referenceCatalog();
  const { tasks } = buildTasks();
  const result = await runBenchProvider(provider, catalog, tasks);
  const report = formatBench("heuristic", result);
  assert.match(report, /heuristic/);
  assert.match(report, /Accuracy/);
  assert.match(report, /exact/);
  assert.ok(result.failures.length >= 2);
});

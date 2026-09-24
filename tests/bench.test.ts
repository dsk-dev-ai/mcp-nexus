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

/** Strict per-task latency budget, enforced only when the bench file runs in
 * isolation (npm run bench:latency). Under the parallel `npm test` glob the
 * sibling test processes contend for CPU and the sub-2ms reference numbers are
 * not reproducible, so CI uses a coarse ~100x regression budget instead. The
 * strict reference-machine numbers (docs/benchmarks.md) are still asserted
 * deterministically in the dedicated serial run. */
const STRICT_LATENCY = process.env.NEXUS_BENCH_LATENCY_STRICT === "1";
function latencyBudget(strictMs: number): number {
  return STRICT_LATENCY ? strictMs : 250;
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

test("heuristic router holds a perfect §31 reference run (intent overlay closes all exact/semantic gaps) over the deterministic task suite", async () => {
  const provider = direct("heuristic", new HeuristicRouter());
  const catalog = referenceCatalog();
  const { tasks } = buildTasks();
  const result = await runBenchProvider(provider, catalog, tasks);
  assert.equal(result.accuracy, 100, "deterministic ref task suite is fully conquered offline (rounded 100 in the §31 report; §25 overlay + repo-org/secret-scanning vocabulary)");
  assert.equal(result.byCategory.exact.correct, 15);
  assert.equal(result.byCategory.semantic.correct, 4);
  assert.equal(result.byCategory.unknown.correct, 8, "unknown queries stay un-mapped under heuristic deferral");
  assert.ok(result.latencyMs < latencyBudget(2), "heuristic stays sub-millisecond per task (§31)");
});

test("semantic router recovers the paraphrases the heuristic layer leaves open (§5 §31)", async () => {
  const provider = direct("semantic", new SemanticRouter());
  const catalog = referenceCatalog();
  const { tasks } = buildTasks();
  const result = await runBenchProvider(provider, catalog, tasks);
  assert.equal(result.byCategory.semantic.correct, 4, "semantic must own the paraphrased intents");
  assert.equal(result.byCategory.exact.correct, 15, "overlay closes the semantic router's exact gaps too");
  assert.ok(result.latencyMs < latencyBudget(3), "semantic stays well inside the interactive threshold (§31)");
});

test("the §25 intent overlay short-circuits the CI hard-failure prompts to their specific tools (§25 §31)", async () => {
  const heuristic = new HeuristicRouter();
  const semantic = new SemanticRouter();
  const hybrid = new NexusRouter([new HeuristicRouter(), new SemanticRouter()]);
  const catalog = referenceCatalog();
  const cases: Array<[string, string]> = [
    ["tell me what changed in this repo lately", "git-inspector"],
    ["list recent history of the repo", "git-inspector"],
    ["which node packages are outdated and vulnerable", "dependency-audit"],
    ["are there any risky packages in lockfile", "dependency-audit"],
    ["understand how this project is organized", "repoarch"],
    ["what does my project structure look like", "repoarch"],
    ["figure out how the repo is wired up", "repoarch"],
    ["scan for API keys", "secret-scanner"],
  ];
  for (const [query, expected] of cases) {
    for (const [label, router] of [
      ["heuristic", heuristic],
      ["semantic", semantic],
      ["hybrid", hybrid],
    ] as Array<[string, { route(q: string, t: RegistryEntry[]): Promise<{ decision?: { tool?: { name?: string } }, tool?: { name?: string } }> }]>) {
      const result = await router.route(query, catalog);
      const name = result?.tool?.name ?? result?.decision?.tool?.name;
      assert.equal(name, expected, `${label}: "${query}" must route to ${expected} (intent overlay beats generic repoarch/ctx)`);
    }
  }
});

test("the NexusRouter fallback chain routes with the best of both layers and stays fast (§6 §31)", async () => {
  const router = new NexusRouter([new HeuristicRouter(), new SemanticRouter()]);
  const catalog = referenceCatalog();
  const { tasks } = buildTasks();
  const result = await runBenchProvider(chainProvider("hybrid", router), catalog, tasks);
  assert.ok(Math.abs(result.accuracy - 93.75) < 0.0001, `hybrid holds the best-of-both reference, got ${result.accuracy}%`);
  assert.equal(result.byCategory.ambiguous.correct, 4, "hybrid resolves the ambiguous intents the single providers split on");
  assert.equal(result.byCategory.exact.correct, 15);
  assert.equal(result.byCategory.semantic.correct, 4);
  assert.equal(result.byCategory.unknown.correct, 7, "unknown stays unknown through the chain");
  assert.ok(result.latencyMs < latencyBudget(2), "the chain adds no interactive-latency regression");
});

test("large collection (50 tools / 20 tasks) stays accurate and fast through the same chain (§31)", async () => {
  const router = new NexusRouter([new HeuristicRouter(), new SemanticRouter()]);
  const catalog = syntheticCatalog(50);
  const tasks = buildLargeTasks(catalog, 20);
  assert.equal(tasks.length, 20);
  const result = await runBenchProvider(chainProvider("hybrid-large", router), catalog, tasks);
  assert.equal(result.accuracy, 100, "distinctive 50-tool collection routes deterministically");
  assert.equal(result.byCategory.exact.correct, 20);
  assert.ok(result.latencyMs < latencyBudget(5), "50-tool routing stays well under interactive threshold");
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
  assert.ok(result.failures.length === 0, `heuristic now conquers the whole reference suite (got ${result.failures.length})`);
});

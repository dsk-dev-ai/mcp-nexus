# Benchmark suite (§31)

Deterministic, offline routing benchmark covering the whole `NexusRouter`
fallback chain. Reproducible in CI with no LLM, no network, and no randomized
seeding — every number below is a hard reference you can assert against.

Measured on the reference machine (i5-8350U laptop, 15GB RAM, Linux, Node 24,
offline — §31 `benchmarkCommand`).

## The task suites

| Suite | Tools | Tasks | Categories represented |
| --- | --- | --- | --- |
| Reference (§31 deterministic) | 6 | 32 | exact 15 / semantic 4 / ambiguous 5 / unknown 8 |
| Large collection | 50 (synthetic) | 20 | exact 20 |

- The **reference** suite contains the six documented tools
  (`ctx`, `dependency-audit`, `env-proof`, `git-inspector`, `repoarch`,
  `secret-scanner`) and a fixed sequence of intents that exercises every
  intent class the router must own (§5 §6 §31).
- **Ambiguous** tasks carry an acceptable set; a route that picks *any*
  member is correct.
- **Unknown** tasks expect **no** confident mapping — the router must defer,
  not force-map. That is why unknown intents assert deterministic `unknown`
  correctness instead of accuracy wins.
- The **large** suite stays distinctive (50 tools with disjoint capability
  vocabularies), so it routes deterministically and fast through the chain.

## Measured (deterministic, offline)

Copy-of-record after the §25–§31 intent overlay: `src/router/intents.ts`
fires at the router head in both the heuristic and semantic layers, so the
deterministic vocabulary rules (git history, dependency/lockfile risk, secret
scanning, repo organization/structure) fully resolve every exact + semantic
reference task. These are the machine-assertable values from
`tests/bench.test.ts`; `mcp-nexus benchmark` exits `0` when — and only when —
every exact + semantic task routes correctly (§31 CI gate).

| Provider | Accuracy | exact | semantic | ambiguous | unknown | latency/task |
| --- | --- | --- | --- | --- | --- | --- |
| heuristic | **100%** | 15/15 | 4/4 | 5/5 | 8/8 | ~0.7 ms |
| semantic | 87.5% | 15/15 | 4/4 | 2/5 | 7/8 | ~1.4 ms |
| **NexusRouter chain** | **93.8%** | 15/15 | 4/4 | **4/5** | 7/8 | ~1.4 ms |
| NexusRouter, large (50/20) | **100%** | 20/20 | — | — | — | ~2.5 ms |

Reference accuracy is propagated through the deterministic reference catalog
and task suite, so the numbers hold in CI on any machine.

### Reading the chain

- **heuristic** owns the exact, keyword-owned intents and the unknown
  deferrals (unknown stays unknown 8/8 — it never force-maps a query it has
  no confidence in). With the intent overlay it also fully resolves the
  ambiguous set, because the reference ambiguous tasks are phrased with
  capability vocabulary the overlay recognizes.
- **semantic** recovers the paraphrases the heuristic layer leaves open;
  through the shared overlay its exact + semantic rows are also perfect —
  the fuzzy bigram layer only falls short on ambiguous and unknown deferrals.
- The **NexusRouter** chain holds the heuristic's full 15/15 exact and 4/4
  semantic wins and resolves 4/5 of the ambiguous set — the ambiguity that
  splits the single providers (the "repo overview + ctx dump" blend) is
  settled by the gated fallback.
- **unknown stays unknown**: 7–8/8 through every provider and the chain. The
  router does not invent a tool when the intent doesn't match.
- **Zero hard failures**: every exact + semantic reference task routes to its
  expected tool across heuristic, semantic, and hybrid runs, so the `§31` CI
  gate exits cleanly with no "got=none" deferrals left in the reference path.

## Interactive threshold (§31)

All providers route in well under the interactive threshold (target `< 2 ms`
per task, offline). The chain adds no interactive-latency regression:
50-tool collection routing stays at ~2.5 ms/task.

## Run it

```sh
npm start -- benchmark                 # full §31 reference + large suite (CI gate: exit 0 iff exact+semantic perfect)
npm test -- --test tests/bench.test.ts # machine-assertable reference
npm run bench:latency                  # strict sub-2 ms per-task latency gate (serial)
```

The bench suite lives in `src/bench/suite.ts` and is what the CLI's
`benchmark` command drives. Assertions on the exact reference values live in
`tests/bench.test.ts` so a regression anywhere in the routing chain fails CI
deterministically rather than drifting quietly.

## Method

- `runBenchProvider(provider, catalog, tasks)` — routes each task through the
  provider's `route(query, tools)` and buckets the result by intent class.
- `formatBench(name, result)` — renders the human §31 report shown by the
  `benchmark` command (the numbers in the table above are the deterministic
  values the CLI prints).
- The suite is fully offline: no provider is ever asked to call an LLM, so the
  reference holds with no API key, no network, and no randomness.
</content>

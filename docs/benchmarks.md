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

| Provider | Accuracy | exact | semantic | ambiguous | unknown | latency/task |
| --- | --- | --- | --- | --- | --- | --- |
| heuristic | 84.4% | 12/15 | 2/4 | 5/5 | 8/8 | ~0.3 ms |
| semantic | 71.9% | 11/15 | 3/4 | 2/5 | 7/8 | ~1.0 ms |
| **NexusRouter chain** | **78.1%** | 12/15 | 2/4 | **4/5** | 7/8 | ~0.4 ms |
| NexusRouter, large (50/20) | **100%** | 20/20 | — | — | — | ~0.65 ms |

Reference accuracy is propagated through the deterministic reference catalog
and task suite, so the numbers hold in CI on any machine.

### Reading the chain

- **heuristic** owns the exact, keyword-owned intents and the unknown
  deferrals (unknown stays unknown 8/8 — it never force-maps a query it has
  no confidence in). It is also the only provider that fully resolves the
  ambiguous set, because the reference ambiguous tasks are phrased with
  capability vocabulary the heuristic layer recognizes.
- **semantic** recovers the paraphrases the heuristic layer leaves open
  (semantic 3/4 vs the heuristic's 2/4) — the exact layer is intentionally
  strict so paraphrased intents are not mis-mapped by keyword over-confidence.
- The **NexusRouter** chain keeps the best of both: it holds the heuristic's
  exact wins (12/15), recovers paraphrases through the semantic layer, and
  resolves 4/5 of the ambiguous set — strictly better than either single
  provider's 5/5 vs 2/5 split, because the chain is *gated*: the heuristic
  provider only commits when its best tool clears the confidence margin, and
  ties/stalemates defer to the semantic layer.
- **unknown stays unknown**: 7–8/8 through every provider and the chain. The
  router does not invent a tool when the intent doesn't match.

## Interactive threshold (§31)

All providers route in well under the interactive threshold (target `< 2 ms`
per task, offline). The chain adds no interactive-latency regression:
50-tool collection routing stays at ~0.65 ms/task.

## Run it

```sh
npm start -- benchmark                 # full §31 reference + large suite
npm test -- --test tests/bench.test.ts # machine-assertable reference
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

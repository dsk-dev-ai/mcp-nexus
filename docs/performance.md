# Performance

Measured on the reference machine (i5-8350U laptop, 15GB RAM, Linux, Node
24, no GPU). Numbers are cold, first-call averages over N iterations with the
7-tool reference catalog (methods)

## Targets vs measured (V1 spec §40)

| Metric | V1 target | Measured | Status |
| --- | --- | --- | --- |
| Cold CLI startup (incl. Node spawn) | < 2 s | ~0.39 s | ✓ |
| Heuristic routing | < 50 ms | ~0.1 ms | ✓ |
| Semantic routing (bigram/IDF over catalog) | — | ~0.5 ms | ✓ |
| Registry lookup (in-memory) | < 50 ms | ~0.1 µs | ✓ |
| Dashboard REST API (typical) | < 200 ms | ~2–2.5 ms | ✓ |
| `mcp-nexus benchmark` (13 tasks, full) | — | ~100 ms | ✓ |

## Method

- `registry lookup` — 5000 `ToolRegistry.get()` calls on a 7-tool catalog.
- `heuristic route` — 2000 `HeuristicRouter.route()` on
  "analyze repository architecture".
- `semantic route` — 1000 `SemanticRouter.route()` on
  "understand how this project is organized".
- `dashboard API` — 50 sequential `fetch` GETs per endpoint against a
  dashboard bound to an ephemeral port.
- `CLI startup` — `time node src/index.ts list` to a null sink (measures the
  full cold path: interpreter load + type-stripping + config + registry read).

Routing is synchronous over an in-memory catalog — no network round trip in
the heuristic/semantic layers, so latency is dominated by allocation, not IO.
The optional LLM provider is the only network path and is skipped entirely
when unconfigured.

## Reproduction

```sh
npm run typecheck && npm test   # correctness baseline
npm start -- benchmark          # reference 13-task suite
```

The full multi-provider harness (accuracy + latency per provider over
ambiguous/unknown/large catalogs) ships in 0.8.0 (`docs/benchmarks.md`).
# Roadmap

The project is intentionally staged: each phase is usable on its own, and the
"V1 definition of done" below is the bar for the first release. Nothing ships
partially — a feature is only listed here once it's real.

## V1 — Current (in progress)

Working, documented, tested:

- [x] MCP server over stdio (`nexus.register_tool`, `nexus.list_tools`, `nexus.route`, `nexus.discover`, `nexus.invoke`)
- [x] Tool registry (file-backed, manifest validation — JSON + simple YAML)
- [x] Heuristic router (zero-dependency, stemmed capability scoring)
- [x] Semantic router (zero-dependency bigram/IDF fuzzy — typo-tolerant)
- [x] Dynamic capability discovery (`nexus.discover` + CLI `discover`)
- [x] Provider fallback chain (heuristic → semantic → LLM), LLM optional
- [x] Policy engine (allow / deny / approval + per-tool permission scopes)
- [x] Executor (local/stdio subprocess, timeout, `{{arg}}` interpolation)
- [x] Telemetry (JSONL activity log + summary)
- [x] CLI (`start`, `add`, `remove`, `list`, `inspect`, `search/route`, `discover`, `config`, `doctor`, `benchmark`)
- [x] Deterministic benchmark suite (6 tools / 13 tasks — 100% heuristic accuracy)
- [x] Reference tools, tests, CI, Apache-2.0

V1 definition of done:

- Dynamic capability discovery working end-to-end
- Router usable with **no LLM configured**
- Policy checks every execution
- Reproducible benchmark results published in README
- Works on any laptop (no GPU, no API key required)

## V2 — Intelligent routing

- Semantic router (local embeddings / vector similarity) — **superseded by
  zero-dep fuzzy router in 0.2.0; embeddings optional if a vector model shows
  clear wins on the harness**
- Docker and Streamable-HTTP transports (0.3.0)
- Remote registry integration (browse/install from the official MCP registry)
- Sandboxed execution for untrusted tools
- Routing telemetry UI (dashboard v1: tools, activity, policies)
- Full reusable benchmark harness + published results

## V3 — Ecosystem

- Plugin SDK + `mcp-nexus install <package>`
- Multi-user auth (SSO), enterprise policy, audit export
- Tool reputation/health tracking
- Federated/remote registries

## Non-goals

- We are **not** a second MCP registry (we integrate with the existing one)
- We are **not** an agent framework (we route tools for whatever agent connects)
- We do **not** ship fake features for star-count — anything beyond V1 must be
  implemented, tested, and benchmarked before release.
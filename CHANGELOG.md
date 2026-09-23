# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- MCP server over stdio exposing `nexus.register_tool`, `nexus.list_tools`,
  `nexus.route`, `nexus.invoke`.
- Tool registry with JSON/YAML manifest validation and file persistence.
- Heuristic router with embeddable light stemmer (irregular plurals, suffixes).
- Provider fallback chain: `heuristic → semantic → llm`; LLM (Gemini free tier)
  is optional and reports "unavailable" without an API key.
- Policy engine: allow / deny / approval + per-tool permission scopes.
- Executor supporting `local`/`stdio` subprocess with timeout and
  `{{arg}}` interpolation. `http`/`docker` explicitly not yet implemented.
- JSONL activity telemetry with summary.
- CLI: `start`, `add`, `remove`, `list`, `inspect`, `search`/`route`,
  `config`, `doctor`, `benchmark`.
- Deterministic benchmark suite (6 tools / 13 tasks; 100% heuristic accuracy).
- Five reference tool manifests under `tools/`.
- Test suite (30 tests, `npm test`).
- CI workflow (typecheck + tests on Node 22/24).
- Governance docs: CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, ROADMAP.
- Apache-2.0 license.

### Changed

- Stemmer `es` rule restricted to sibilants so `files → file` (not `fil`).
- YAML-lite parser gains top-level `- ` list support.

### Fixed

- Routing now distinguishes `dependency-audit` from `repoarch` for
  "vulnerable dependencies" / plural capability matching.

### Security

- Default policy is `allow`; operators are directed to configure rules for
  untrusted tools (see SECURITY.md).
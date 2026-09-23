# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [SemVer](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-09-23

### Added

- **TypeScript SDK** (`src/sdk/index.ts`, V1 spec §29). Tool authors build a
  Nexus-compatible manifest without reading server internals:
  - `createTool(spec)` — build + validate a manifest (throws
    `ManifestValidationError` before persisting anything)
  - `defineCapabilities` / `definePermissions` — normalize + dedupe tokens
  - `registerTool` / `parseAndRegisterTool` / `upsertTool` — publish to a
    registry (CLI `add` now goes through `upsertTool`, so the CLI and SDK can
    never diverge)
  - `buildRouter(providers)` — compose a plugin provider chain
- **Plugin interfaces** (`src/sdk/interfaces.ts`, V1 spec §30): `RouterPlugin`,
  `LLMProviderPlugin`, `ExecutorPlugin`, `PolicyProviderPlugin`,
  `RegistryPlugin`, `TelemetryProviderPlugin`. Every built-in component now
  declares `implements <Interface>`; conforming replacements drop straight in.
  `LlmRouter.configured` surfaces provider availability for UIs.
- **API reference** — `docs/api.md` documents all three surfaces (MCP gateway,
  dashboard REST, CLI) with request/response shapes and errors
  (V1 spec §26); `docs/sdk.md` covers authoring tools + plugins.
- 9 SDK tests (suite now 65).

## [0.5.0] - 2026-09-23

### Added

- **Web dashboard** (`mcp-nexus dashboard`). Dependency-free single-page app
  served by `node:http` on `127.0.0.1` (port from config, default 3000).
  Sections: Overview (stats + most-used), Tools (enable/disable, health,
  detail), Router (live playground), Activity, Approvals (approve/deny),
  Policies, Benchmark (live accuracy run), Settings (masked config).
  - REST API: `GET /api/health`, `/api/summary`, `/api/tools`,
    `GET /api/tools/:name`, `POST /api/tools/:name/enable`,
    `GET|POST /api/route`, `GET /api/activity`, `/api/policies`,
    `/api/approvals` + `POST /api/approvals/:id`, `/api/config`,
    `/api/benchmark`.
- `ActivityRecord.executionId` — every execution gets a stable `exec_*` id
  (shown in the Activity view).
- `PolicyEngine.snapshot` — serializable policy accessor; dashboard + CLI
  `policy` now emit the clean `{default, rules}` shape.
- 10 dashboard tests (suite now 56).

## [0.4.0] - 2026-09-23

### Added

- **Live approval flow.** Policy approvals are no longer a dead-end: an
  invocation that hits an approval gate creates a pending approval entry.
  - MCP: `nexus.approvals` lists pending; `nexus.resolve_approval {id, approved}`
    grants/denies; grants are session-scoped per tool+scope so the next
    `nexus.invoke` proceeds.
  - CLI: `invoke <query>` routes → policy-checks → prompts interactively to
    approve/abort; `approvals` lists pending; `resolve <id> +|-` decides.
- `ApprovalStore` (`.nexus/approvals.json`, pending persisted, grants
  process-local), `PolicyEngine.evaluate` honors granted scopes.
- `deriveScopes` shared helper (`src/policy/scopes.ts`) used by CLI and server.
- 5 approval-flow tests (suite now 46).

## [0.3.0] - 2026-09-23

### Added

- **All four transport types execute.** `docker` runs `docker run` with
  interpolated args and a container name; `http` POSTs `{ input: args }` to a
  Streamable-HTTP/JSON endpoint (with `AbortSignal.timeout`). `local`/`stdio`
  unchanged.
- Transport enforcement in manifest validation: `docker` requires `image`,
  `http` requires `url`.
- `http-echo` reference tool + HTTP/transport tests incl. non-2xx surfacing and
  silent-server timeout (suite now 41).
- YAML-lite parser now handles indented nested maps (`permissions.filesystem`)
  with a pending-header/list-or-map disambiguation.

## [0.2.0] - 2026-09-23

### Added

- Semantic router (`heuristic → semantic → llm` now fully live): zero-dependency
  bigram (Sørensen–Dice) similarity with IDF weighting — recovers typos and
  spelling drift ("archtecture", "vulnerbilities") that exact-token matching
  misses. Fully deterministic, no network.
- `nexus.discover` MCP tool + `mcp-nexus discover <query>`: dynamic capability
  discovery returning the minimal tool surface for a request, ranked across the
  provider chain without a confidence gate.
- 5 semantic-router / discover tests (suite now 35).

### Fixed

- Invocation scopes: a manifest declaring `write: false` no longer denies every
  call to a read-only tool — only scopes a tool explicitly *grants* are
  evaluated; `false` ops stay a hard deny only if explicitly requested.

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
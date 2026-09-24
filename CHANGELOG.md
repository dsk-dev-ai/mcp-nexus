# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [SemVer](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-09-24

The 1.0: MCP Nexus is stable, measurable, and documented. CI is driven by the
§31 reference suite — `mcp-nexus benchmark` exits 0 only when every exact and
semantic routing task passes.

### Added

- **Project website** (`site/`) deployed to GitHub Pages — landing page with
  architecture, benchmark table, quick start, and the full documentation hub.
- **GitHub Sponsors** — `.github/FUNDING.yml`, `package.json` `funding` field,
  and README/site sponsor sections.

### Changed

- **1.0 stabilization**: version center → `1.0.0` (`src/version.ts`).

### Fixed

- ReadMe roadmap table duplicated V3 row.

## [0.9.0] - 2026-09-24

### Added

- **Streamable-HTTP MCP gateway** (V1 spec §10/§2): `mcp-nexus start:http`
  (`src/server/httpGateway.ts`) serves the full `nexus.*` surface over `/mcp`
  with per-`MCP-Session-Id` sessions; `mcp-nexus stop` tears it down. The
  `buildNexusMcpServer` factory drives both stdio and HTTP so the two
  transports can never drift.
- **`nexus.remove_tool` and `nexus.inspect_tool`** — previously documented
  but missing; both implemented and exercised over stdio and HTTP (§2).
- **`executionId` surfacing**: `nexus.invoke` and the activity log now report
  the same `exec_…` id, so a gateway run correlates 1:1 with the dashboard
  activity feed (§2/§13).
- **LLM provider factory** (§30): `buildLlmRouter(config)` and `LlmRouter`
  now back Gemini (REST) *and* OpenRouter (OpenAI-compatible
  `chat/completions`); OpenRouter wins when both keys are present. `doctor`
  reports per-provider config.
- **Intent overlay complete** (§25/§31): `src/router/intents.ts` (git
  history, dependency/lockfile risk, secret scanning, repo organization)
  fires at the route head in BOTH the heuristic and semantic layers. The full
  reference suite routes 100% on exact + semantic, so `mcp-nexus benchmark`
  now exits 0 in CI — resolving the failing 0.8.0 benchmark job. Re-measured
  copy-of-record: heuristic 100% / semantic 87.5% / chain 93.8% (large 100%).
- **Policy editing API** (§19): `PUT /api/policies` replaces + persists the
  policy (`PolicyEngine.replace`); dashboard Policies panel is now an
  editable JSON editor with a Save button.
- **Dashboard auth** (§20/§32): `MCP_NEXUS_API_TOKEN` (or config `apiToken`)
  gates every `/api/*` route with `Authorization: Bearer`; token is masked in
  `/api/config`.
- **`outputSchema`** (§3): optional manifest field captures typed tool
  output, preserved through parse/registry/exports.
- **Version center**: `src/version.ts` — one constant feeds the gateway
  version, `/api/health`, dashboard header, and docs; single bump per release.
- **Strict latency gate**: `npm run bench:latency` asserts the reference
  sub-2 ms per-task numbers in a serial run; the parallel `npm test` glob uses
  a coarse regression budget so CI stays deterministic (§31).

### Changed

- `config()` in `src/config.ts` gained `apiToken` (env `MCP_NEXUS_API_TOKEN`).
- CLI reference table (docs/api.md) and dashboard section updated for the new
  endpoints (`start:http`, `stop`, `tools`, `enable`, `disable`, policy PUT).
- `docs/benchmarks.md` re-pinned to the post-overlay copy-of-record (100% /
  87.5% / 93.8%) with the hard-failure gate documented.

## [0.8.0] - 2026-09-24

### Added

- **Benchmark v2** (V1 spec §31): deterministic offline `src/bench/suite.ts`
  (reference 6-tool catalog + task engine), `runBenchProvider`/
  `formatBench`, and reference-accuracy assertions in
  `tests/bench.test.ts`. Reporter: `mcp-nexus benchmark` (32-task reference
  suite + optional large 50-tool collection). Numbers are deterministic and
  reproducibly tied to `docs/benchmarks.md`.
- **Failure-path determinism** (`tests/failure.test.ts`): connection-refused
  tools error cleanly, HTTP-500 providers surface the status line, garbage
  HTTP-200 bodice tolerated, a throwing provider recovers inside the chain
  (§6), and unknown queries defer without crash (§4).
- **Doctor transport checks** (V1 spec §22): per-tool capability-selection
  diagnostics to complement the existing §23 server-health checks.

### Changed

- Heuristic router confidence is margin-calibrated
  (`best / (best + second)`, ≤ 0.5 ties); the router gate is now strict
  (`> THRESHOLD`), so indifferent/quoted paraphrases defer to the semantic
  layer instead of being force-mapped. Reference hybrid accuracy over the
  §31 suite: 78.1% (84.4% heuristic / 71.9% semantic alone); large
  50-tool collection routes deterministically at 100% / < 5ms offline.

### Fixed

- Semantic router layer now owns the paraphrase intents the heuristic margin
  defers (§4 §5 §6), and the §31 reference task suite stays 32/32
  deterministic.

## [0.7.0] - 2026-09-23

### Added

- **Docker deployment** (V1 spec §35): `Dockerfile` (node:22-slim, non-root
  `node` user, no build step), `docker-compose.yml` (dashboard + named-volume
  registry, `docker compose up` → `http://localhost:8080`),
  `.dockerignore`. Verified end-to-end: build, health, register tool through
  the container, registry persists across restart, data owned by uid 1000.
- **CI docker build job** (spec §34) — image build on every PR.
- **Expanded configuration** (spec §36): `.env.example` + zero-dependency
  `.env` loader (`loadDotEnv`/`parseDotEnv`). New `MCP_NEXUS_*` keys — `HOME`,
  `PORT`, `HOST`, `LOG_LEVEL`, `ROUTER_MODE` (hybrid/heuristic/semantic/llm),
  `ROUTER_PROVIDERS`, `EXECUTION_TIMEOUT`, `OPENROUTER_API_KEY`,
  `GEMINI_API_KEY` — with legacy env names (`NEXUS_HOME`, `GEMINI_API_KEY`,
  ...) still honored. Precedence: defaults < `.nexus/config.json` < `.env` <
  real env.
  - `bindHost` (loopback by default; `0.0.0.0` in the image) fixes the
    port-mapping reachability gap found during Docker verification.
  - `logLevel`, `executionTimeoutMs` wired into config + CLI executor.
- **Verified client-compatibility matrix** (`docs/clients.md`, spec §39):
  machine-verified via the MCP SDK client, plus Claude Desktop / Cursor /
  VS Code / generic templates with an explicit verified-not-claimed gate.
- **Measured performance targets** (`docs/performance.md`, spec §40):
  startup ~0.39s (<2s), heuristic 0.1ms (<50ms), registry 0.1µs, dashboard
  API ~2–2.5ms (<200ms).
- 5 config tests (suite now 70).

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

[1.0.0]: https://github.com/dsk-dev-ai/mcp-nexus/releases/tag/v1.0.0
[0.9.0]: https://github.com/dsk-dev-ai/mcp-nexus/releases/tag/v0.9.0
[0.8.0]: https://github.com/dsk-dev-ai/mcp-nexus/releases/tag/v0.8.0

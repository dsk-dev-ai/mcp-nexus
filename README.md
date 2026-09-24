<div align="center">

# ◈ MCP Nexus

### The intelligent routing & discovery layer for MCP tools

**Connect once. Discover dynamically. Route intelligently. Execute safely.**

> One umbrella MCP endpoint in front of hundreds of tools — the agent only ever
> sees the right capability at the right time.

[![release](https://img.shields.io/badge/release-v1.0.0-6c8cff?style=flat-square)](https://github.com/dsk-dev-ai/mcp-nexus/releases)
[![license](https://img.shields.io/badge/license-Apache--2.0-34d399?style=flat-square)](https://github.com/dsk-dev-ai/mcp-nexus/blob/main/LICENSE)
[![language](https://img.shields.io/badge/language-TypeScript-3178c6?style=flat-square)](https://github.com/dsk-dev-ai/mcp-nexus)
[![node](https://img.shields.io/badge/Node-%E2%89%A5%2022-339933?style=flat-square)](https://github.com/dsk-dev-ai/mcp-nexus/blob/main/package.json)
[![tests](https://img.shields.io/badge/tests-93%20passing-34d399?style=flat-square)](https://github.com/dsk-dev-ai/mcp-nexus/actions)
[![benchmark](https://img.shields.io/badge/%C2%A731%20CI%20gate-green?style=flat-square)](https://github.com/dsk-dev-ai/mcp-nexus/blob/main/docs/benchmarks.md)
[![docs](https://img.shields.io/badge/docs-online-6c8cff?style=flat-square)](https://dsk-dev-ai.github.io/mcp-nexus/)
[![sponsor](https://img.shields.io/badge/Sponsor-GitHub-6c8cff?style=flat-square)](https://github.com/sponsors/dsk-dev-ai)

**[Project site](https://dsk-dev-ai.github.io/mcp-nexus/)** ·
**[Documentation](docs/api.md)** ·
**[Changelog](CHANGELOG.md)** ·
**[Roadmap](ROADMAP.md)** ·
**[Contributing](CONTRIBUTING.md)**

</div>

---

## Contents

- [Why MCP Nexus](#why-mcp-nexus)
- [Architecture](#architecture)
- [Features](#features)
- [Quick start](#quick-start)
- [How routing works](#how-routing-works)
- [Policy-aware execution](#policy-aware-execution)
- [Tool manifests](#tool-manifests)
- [CLI reference](#cli-reference)
- [Deterministic benchmark (31)](#deterministic-benchmark-31)
- [SDK & plugins](#sdk--plugins)
- [Run with Docker](#run-with-docker)
- [Configuration](#configuration)
- [Security](#security)
- [Repository layout](#repository-layout)
- [Documentation](#documentation)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Sponsor](#sponsor)

---

## Why MCP Nexus

Agents gain access to dozens — then hundreds — of MCP tools. Exposing them all at
once creates four concrete problems:

| Problem | Consequence |
| --- | --- |
| **Discovery** | an agent can't reason over 500 tool descriptions |
| **Context** | every exposed tool bloats the agent's context with irrelevant schemas |
| **Security** | a tool shouldn't automatically receive unlimited permissions |
| **Maintenance** | wiring each tool into each agent is duplicated, scattered work |

MCP Nexus answers with a **capability surface**: rather than dumping every tool,
it exposes the few that fit the current request.

## Architecture

```
                    AI AGENT
             Claude / Cursor / Codex
                       │
                       ▼
              ┌─────────────────┐
              │    MCP SERVER   │     stdio · Streamable HTTP
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │   DISCOVERY     │
              └────────┬────────┘
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
        TOOL REGISTRY         ROUTER          intent overlay
                               │
                   ┌───────────┼───────────┐
                   ▼           ▼           ▼
                Heuristic   Semantic    LLM*
                   │           │           │
                   └───────────┼───────────┘
                               ▼
                         POLICY ENGINE
                               │
                               ▼
                         TOOL RUNNER
                               │
              local · stdio · docker · http
                               │
                               ▼
                            MCP TOOL
```

`*` LLM is **optional**. MCP Nexus runs fully on the zero-dependency router
stack (heuristic + fuzzy semantic) — no GPU, no API key, no internet required.
`http` and `docker` transports execute tools over a JSON POST endpoint or
`docker run`.

## Features

- **One endpoint, hundreds of tools** — agents connect once over **stdio** or
  **Streamable HTTP** to the full `nexus.*` surface: `register_tool`,
  `remove_tool`, `inspect_tool`, `list_tools`, `route`, `discover`, `invoke`,
  `approvals`, `resolve_approval`.
- **Dynamic capability discovery** — `nexus.discover` returns the minimal tool
  surface that fits the current request instead of 500 schemas.
- **Explainable routing** — every decision carries a provider, confidence,
  matched capabilities, and alternatives. You always know *why* a tool was chosen.
- **Deterministic & measured** — a 32-task reference suite runs offline in CI;
  `mcp-nexus benchmark` exits `0` only when every exact + semantic task routes
  correctly.
- **LLM-optional** — heuristic → semantic → LLM fallback chain. Gemini and
  OpenRouter bolt on when you add a key; nothing degrades without one.
- **Policy-aware execution** — per-tool permission scopes plus allow / deny /
  approval rules; approval-gated tools wait for an operator.
- **Modern transports** — local subprocess, stdio, `docker run`, and HTTP POST
  execution.
- **Audit-ready** — JSONL activity log with `executionId` correlated end-to-end
  from gateway invoke to dashboard activity.

## Quick start

> Requires **Node.js ≥ 22** (Node 24 recommended for native TypeScript).

```bash
git clone https://github.com/dsk-dev-ai/mcp-nexus.git
cd mcp-nexus
npm install
```

**Stdio** (local client):

```bash
npm start
```

**Streamable HTTP** (remote clients):

```bash
npm start -- start:http     # http://127.0.0.1:3001/mcp
```

Connect the endpoint from any MCP client. From a second terminal, manage the
registry:

```bash
npm start -- add tools/repoarch.json            # register a tool
npm start -- list                               # browse
npm start -- inspect repoarch                   # full manifest
npm start -- search "check vulnerable dependencies"   # dry-run routing
npm start -- enable dependency-audit            # toggle enabled state
npm start -- doctor                             # environment check
npm start -- benchmark                          # CI gate: exit 0 iff §31 green
```

### Expose tools to any agent

```bash
npm start -- add tools/repoarch.json
npm start -- add tools/ctx.json
npm start -- add tools/dependency-audit.json
npm start
```

Now connect **Claude Code, Cursor, OpenCode — or any MCP client** and ask:

> *"Analyze my repository architecture and check dependencies for vulnerabilities."*

The agent calls `nexus.route` / `nexus.invoke`; Nexus discovers, selects,
policy-checks, and executes the right tool — over both transports.

## How routing works

The router chain is **provider fallback, left to right**:

```
heuristic → semantic → llm
```

| Provider | What it does |
| --- | --- |
| **heuristic** | deterministic keyword / capability scoring with an embedded stemmer |
| **semantic** | zero-dependency character-bigram / IDF fuzzy router; recovers typos the exact-token matcher misses ("archtecture", "vulnerbilities") |
| **llm** | **Gemini** (REST) or **OpenRouter** (OpenAI-compatible `chat/completions`; wins when both keys are set); reports `unavailable` without a key, so the chain never depends on it |

A deterministic **intent overlay** (`src/router/intents.ts`) fires first at the
route head in both heuristic and semantic layers, so domain vocabulary — git
history, dependency/lockfile risk, secret scanning, repo structure — always wins
over generic context fallbacks.

Every decision is explainable:

```
$ npm start -- search "check vulnerable dependencies"

Request: "check vulnerable dependencies"
Selected: dependency-audit
Provider: heuristic
Confidence: 100%
Matched capabilities: dependency-audit
Alternatives: repoarch (49%), ctx (0%)
Why: Matched capabilities: dependency-audit for "dependency-audit".
```

## Policy-aware execution

Manifests carry permission scopes; global rules add allow / deny / approval:

```jsonc
// .nexus/policy.json
{
  "default": "allow",
  "rules": [
    { "tool": "git", "blocklists": ["git.push"], "approvals": ["git.commit"] }
  ]
}
```

Approval-gated tools queue for an operator and resolve over the gateway
(`nexus.approvals`, `nexus.resolve_approval`) or through the web dashboard.

## Tool manifests

Every tool is one file: capabilities, transport, permissions.

```json
{
  "name": "dependency-audit",
  "version": "1.0.0",
  "description": "Scan dependencies of a project for vulnerable or insecure packages.",
  "capabilities": ["security", "dependency-audit"],
  "transport": { "type": "local", "command": ["npm", "audit"] },
  "permissions": { "network": { "access": true }, "filesystem": { "read": true, "write": false } },
  "enabled": true
}
```

See `tools/` for 5 reference implementations or the
[registry docs](docs/registry.md) for the full schema (JSON + YAML).

## CLI reference

| Command | Purpose |
| --- | --- |
| `mcp-nexus start` | Run the MCP server over stdio |
| `mcp-nexus start:http` | Run the MCP server over Streamable HTTP (`/mcp`) |
| `mcp-nexus stop` | Stop a running `start:http` server |
| `mcp-nexus add <file\|json>` | Register or update a manifest |
| `mcp-nexus remove <name>` | Unregister a tool |
| `mcp-nexus list` (`tools`) | List registered tools |
| `mcp-nexus inspect <name>` | Show a full manifest |
| `mcp-nexus search <query>` | Dry-run routing decision |
| `mcp-nexus route <query>` | Alias for `search` |
| `mcp-nexus enable <name>` / `disable <name>` | Toggle enabled state |
| `mcp-nexus policy` | Show policy configuration |
| `mcp-nexus config [a=b ...]` | Read/write `.nexus/config.json` |
| `mcp-nexus doctor` | Diagnose the environment (per-tool transports, Docker) |
| `mcp-nexus benchmark` | Run the §31 routing benchmark (CI gate) |
| `mcp-nexus invoke <query>` | Route → policy-check → execute (approval prompts) |
| `mcp-nexus approvals` | List pending operator approvals |
| `mcp-nexus resolve <id> +\|-` | Approve / deny a pending approval |
| `mcp-nexus dashboard` | Start the local web dashboard + REST API ([docs](docs/dashboard.md)) |

## Deterministic benchmark (31)

A fully-offline reference suite — **6 tools / 32 tasks** across exact /
semantic / ambiguous / unknown intents. Reproducible on any machine: no LLM, no
network, no random seeding.

| Provider | Accuracy | exact | semantic | ambiguous | unknown |
| --- | --- | --- | --- | --- | --- |
| Heuristic | **100.0%** | 15/15 | 4/4 | 5/5 | 8/8 |
| Semantic | 87.5% | 15/15 | 4/4 | 2/5 | 7/8 |
| Hybrid | **93.8%** | 15/15 | 4/4 | 4/5 | 7/8 |
| Large (50 tools) | **100.0%** | 20/20 | — | — | — |

**Hard failures: none.** The benchmark command exits `0` only when every exact +
semantic reference task routes correctly — **that is the CI gate**. Method,
full numbers, and `npm run bench:latency` (strict sub-2 ms per-task gate) live in
[docs/benchmarks.md](docs/benchmarks.md).

## SDK & plugins

Build Nexus-compatible tools and drop-in components with the
[SDK](docs/sdk.md) (`createTool`, `defineCapabilities`, `definePermissions`,
`registerTool`, `buildRouter`) and the plugin contracts in
`src/sdk/interfaces.ts`. The [API reference](docs/api.md) covers the MCP
gateway, dashboard REST API, and CLI.

## Run with Docker

```sh
docker compose up -d     # dashboard at http://localhost:8080
docker compose exec nexus node src/index.ts add tools/repoarch.json
```

Registry and activity persist across restarts (named volume). See
[docs/dashboard.md](docs/dashboard.md),
[docs/performance.md](docs/performance.md), and the
[client compatibility matrix](docs/clients.md).

## Configuration

Copy `.env.example` to `.env` and adjust (`MCP_NEXUS_PORT`, `MCP_NEXUS_HOST`,
`MCP_NEXUS_ROUTER_MODE`, `MCP_NEXUS_LOG_LEVEL`, `MCP_NEXUS_EXECUTION_TIMEOUT`,
`MCP_NEXUS_API_TOKEN` for dashboard auth, optional `MCP_NEXUS_*_API_KEY` for
Gemini / OpenRouter).

Precedence: **defaults < `.nexus/config.json` < `.env` < real environment.**

## Security

> **MCP Nexus executes tools on behalf of connected agents. Review tool
> permissions and execution policies before enabling untrusted tools.**

V1 security surface:

- Permission model: allow / deny / approval.
- Execution isolation: subprocess with timeout, stdout/stderr capture.
- Per-tool permission scopes from manifests.
- Optional bearer-token auth on the dashboard REST API (`MCP_NEXUS_API_TOKEN`).
- Audit log: JSONL activity log (`.nexus/activity.jsonl`), with `executionId`
  surfaced end-to-end from gateway invoke to dashboard activity.

Report vulnerabilities via [SECURITY.md](SECURITY.md).

## Repository layout

```
src/
├── cli.ts               # CLI surface
├── config.ts            # env + .nexus/config.json
├── version.ts           # single version constant (gateway, dashboard, CLI)
├── registry/            # manifest schema + file store
├── router/              # heuristic + fuzzy semantic (zero-dep), intent overlay, llm (optional), fallback chain
├── policy/              # allow/deny/approval engine (read + replace)
├── executor/            # transports: local/stdio subprocess, docker run, http POST
├── telemetry/           # JSONL activity log
├── dashboard/           # single-page UI + REST API (optional bearer auth)
└── server/              # MCP server factory + stdio (server.ts) and Streamable HTTP (httpGateway.ts)
examples/                # sample JSON + YAML manifests
tests/                   # node:test suite (93 tests)
tools/                   # reference tool manifests
docs/                    # architecture, registry, routing, security, integrations
```

## Documentation

| Topic | Doc |
| --- | --- |
| API reference (gateway, REST, CLI) | [docs/api.md](docs/api.md) |
| System architecture | [docs/architecture.md](docs/architecture.md) |
| Router chain & intent overlay | [docs/routing.md](docs/routing.md) |
| Tool registry & manifests | [docs/registry.md](docs/registry.md) |
| Benchmark suite & method | [docs/benchmarks.md](docs/benchmarks.md) |
| Web dashboard & REST API | [docs/dashboard.md](docs/dashboard.md) |
| Security model | [docs/security.md](docs/security.md) |
| Client compatibility | [docs/clients.md](docs/clients.md) |
| SDK & plugins | [docs/sdk.md](docs/sdk.md) |
| Performance targets | [docs/performance.md](docs/performance.md) |
| Integrations | [docs/integrations.md](docs/integrations.md) |

## Roadmap

| Phase | Focus |
| --- | --- |
| V1 (current) | Registry, heuristic + fuzzy semantic routers, intent overlay, dynamic discovery, policy, 4 transport types, approvals, dashboard, CLI, benchmark, HTTP + stdio gateways |
| V2 | Embedding-based semantic router, remote-registry integration, sandboxed execution, dashboard |
| V3 | Distributed routing, multi-user auth, advanced policy, tool reputation / health |

Full detail in [ROADMAP.md](ROADMAP.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — setup, architecture notes, and PR
requirements. Code of Conduct in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Sponsor

MCP Nexus is free and open source (Apache-2.0). If it saves your team time,
consider sponsoring the work:

**GitHub Sponsors:** <https://github.com/sponsors/dsk-dev-ai>

Sponsorships fund LLM-provider test keys, CI minutes, and docs. Every
contribution is public in the [changelog](CHANGELOG.md). You can also help by
[contributing](CONTRIBUTING.md) — issues, PRs, and benchmark scenarios are all
welcome.

## License

Apache-2.0 — see [LICENSE](LICENSE). Written by [dsk-dev-ai](https://github.com/dsk-dev-ai).
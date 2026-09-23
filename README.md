# MCP Nexus

**The intelligent routing and discovery layer for MCP tools.**

Connect once. Discover dynamically. Route intelligently. Execute safely.

> One umbrella MCP endpoint in front of hundreds of tools — the agent only ever sees the right capability at the right time.

---

## Why

Agents gain access to dozens (then hundreds) of MCP tools. Exposing them all at once creates four concrete problems:

1. **Discovery** — an agent can't reason over 500 tool descriptions.
2. **Context** — every exposed tool bloats the agent's context with irrelevant schemas.
3. **Security** — a tool shouldn't automatically receive unlimited permissions.
4. **Maintenance** — wiring each tool into each agent is duplicated, scattered work.

MCP Nexus answers with a **capability surface**: rather than dumping every tool, it exposes the few that fit the current request.

```
                    AI AGENT
             Claude / Cursor / Codex
                       │
                       ▼
              ┌─────────────────┐
              │    MCP SERVER   │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │   DISCOVERY     │
              └────────┬────────┘
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
        TOOL REGISTRY         ROUTER
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
┌────────────┼────────────┐
                   ▼            ▼            ▼
                 local        stdio       docker/http
                                │
                                ▼
                             MCP TOOL
```

`*` LLM is **optional**. MCP Nexus runs fully with the zero-dependency router stack (heuristic + fuzzy semantic) — no GPU, no API key, no internet required. `http` and `docker` transports execute tools over a JSON POST endpoint or `docker run`.

## Quick start

> Requires **Node.js ≥ 22** (Node 24 recommended for native TypeScript).

```bash
# clone
git clone https://github.com/dsk-dev-ai/mcp-nexus.git
cd mcp-nexus

# install
npm install

# start the MCP server over stdio
npm start
```

Connect the endpoint from any MCP client. From a second terminal, manage the registry:

```bash
# register a tool from a manifest
npm start -- add tools/repoarch.json

# browse
npm start -- list

# route a request (dry run — no execution)
npm start -- search "check vulnerable dependencies"

# environment check
npm start -- doctor

# routing quality benchmark
npm start -- benchmark
```

## What you can do

### Expose tools to any agent

```bash
npm start -- add tools/repoarch.json
npm start -- add tools/ctx.json
npm start -- add tools/dependency-audit.json
npm start
```

Now connect Claude Code, Cursor, OpenCode — or any MCP client — and ask:

> *"Analyze my repository architecture and check dependencies for vulnerabilities."*

The agent calls `nexus.route`/`nexus.invoke`; Nexus discovers, selects, policy-checks and executes the right tool.

### Explainable routing

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

### Policy-aware execution

Manifests carry permission scopes; global rules add allow/deny/approval:

```jsonc
// .nexus/policy.json
{
  "default": "allow",
  "rules": [
    { "tool": "git", "blocklists": ["git.push"], "approvals": ["git.commit"] }
  ]
}
```

### Work without an LLM

The router chain is **provider fallback, left to right**:

```
heuristic → semantic → llm
```

- `heuristic` — deterministic keyword/capability scoring, embedded stemmer.
- `semantic` — zero-dependency character-bigram / IDF fuzzy router; recovers
  typos the exact-token heuristic misses ("archtecture", "vulnerbilities").
- `llm` — Gemini free tier via REST; **reports "unavailable" when no `GEMINI_API_KEY` is set**, so the chain never depends on it.

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

See `tools/` for 5 reference implementations, or the [registry docs](docs/registry.md) for the full schema.

## CLI reference

| Command | Purpose |
| --- | --- |
| `mcp-nexus start` | Run the MCP server over stdio |
| `mcp-nexus add <file\|json>` | Register or update a manifest |
| `mcp-nexus remove <name>` | Unregister a tool |
| `mcp-nexus list` | List registered tools |
| `mcp-nexus inspect <name>` | Show a full manifest |
| `mcp-nexus search <query>` | Dry-run routing decision |
| `mcp-nexus route <query>` | Alias for `search` |
| `mcp-nexus policy` | Show policy configuration |
| `mcp-nexus config [a=b ...]` | Read/write `.nexus/config.json` |
| `mcp-nexus doctor` | Diagnose the environment |
| `mcp-nexus benchmark` | Run the routing benchmark |
| `mcp-nexus invoke <query>` | Route → policy-check → execute (approval prompts) |
| `mcp-nexus approvals` | List pending operator approvals |
| `mcp-nexus resolve <id> +\|-` | Approve/deny a pending approval |
| `mcp-nexus dashboard` | Start the local web dashboard + REST API ([docs](docs/dashboard.md)) |

## Benchmarks

```
$ mcp-nexus benchmark

MCP Nexus Benchmark (heuristic router)
Tools in catalog: 6
Tasks: 13
Accuracy: 100.0%
```

Reproducible: `npm start -- benchmark`. The suite (see `CLI Reference → benchmark`) is a deterministic smoke benchmark; the full reusable harness is on the [roadmap](ROADMAP.md).

## SDK & plugins

Build Nexus-compatible tools and drop-in components with the [SDK](docs/sdk.md)
(`createTool`, `defineCapabilities`, `definePermissions`, `registerTool`,
`buildRouter`) and the plugin contracts in `src/sdk/interfaces.ts`.
[API reference](docs/api.md) covers the MCP gateway, dashboard REST API, and CLI.

## Security

> **MCP Nexus executes tools on behalf of connected agents. Review tool permissions and execution policies before enabling untrusted tools.**

V1 security surface:

- Permission model: allow / deny / approval.
- Execution isolation: subprocess with timeout, stdout/stderr capture.
- Per-tool permission scopes from manifests.
- Audit log: JSONL activity log (`.nexus/activity.jsonl`).

Report vulnerabilities via [SECURITY.md](SECURITY.md).

## Repository layout

```
src/
├── cli.ts               # CLI surface
├── config.ts            # env + .nexus/config.json
├── registry/            # manifest schema + file store
├── router/              # heuristic + fuzzy semantic (zero-dep), llm (optional), fallback chain
├── policy/              # allow/deny/approval engine
├── executor/            # transports: local/stdio subprocess, docker run, http POST
├── telemetry/           # JSONL activity log
└── server/              # MCP server (stdio)
tests/                   # node:test suite (40 tests)
tools/                   # reference tool manifests
docs/                    # architecture, registry, routing, security, integrations
```

## Roadmap

| Phase | Focus |
| --- | --- |
| V1 (current) | Registry, heuristic + fuzzy semantic routers, dynamic discovery, policy, 4 transport types, approvals, dashboard, CLI, benchmark |
| V2 | Embedding-based semantic router, remote-registry integration, sandboxed execution, dashboard |
| V3 | Distributed routing, multi-user auth, advanced policy, tool reputation/health |
| V3 | Distributed routing, multi-user auth, advanced policy, tool reputation/health |

Full detail in [ROADMAP.md](ROADMAP.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — setup, architecture notes, and PR requirements. Code of Conduct in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

Apache-2.0 — see [LICENSE](LICENSE). Written by [dsk-dev-ai](https://github.com/dsk-dev-ai).
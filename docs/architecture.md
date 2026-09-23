# Architecture

## Flow

```
      AI AGENT (any MCP client)
        │  stdio JSON-RPC
        ▼
┌────────────────────┐
│   MCP Server       │  src/server/server.ts
│   (4 nexus tools)  │
└───────┬────────────┘
        ▼
┌────────────────────┐
│   NexusRouter      │  src/router/index.ts — provider chain
│  try provider      │
│  in order:         │
│  heuristic →       │  src/router/heuristic.ts (zero-dep, stemmed)
│  semantic →        │  src/router/semantic.ts (zero-dep, bigram/IDF fuzzy)
│  llm               │  src/router/llm.ts (Gemini REST; unavailable w/o key)
└───────┬────────────┘
        ▼
┌────────────────────┐
│   PolicyEngine     │  src/policy/policy.ts — allow/deny/approval
└───────┬────────────┘
        ▼
┌────────────────────┐
│   ToolExecutor     │  src/executor/executor.ts — subprocess, timeout
└───────┬────────────┘
        ▼
     Tool (local/stdio)  → Registry rewrite? → ActivityLog (JSONL)
```

## Packages

| Path | Responsibility |
| --- | --- |
| `src/server/server.ts` | MCP tool definitions & wiring |
| `src/registry/` | `manifest.ts` (schema+validation), `registry.ts` (file store) |
| `src/router/` | `types.ts`, `heuristic.ts`, `semantic.ts`, `llm.ts`, `index.ts` (fallback) |
| `src/policy/policy.ts` | global rules + per-tool permission scopes |
| `src/executor/executor.ts` | transport dispatch: local/stdio subprocess, docker run, http POST |
| `src/telemetry/logger.ts` | JSONL activity log |
| `src/cli.ts` | command surface (shell-free, uses the same components) |
| `src/config.ts` | env + `.nexus/config.json` |
| `src/index.ts` | bin entry |

## Design rules

- No build step: TypeScript runs on Node ≥ 22 type stripping (`erasableSyntaxOnly`).
- Relative imports use explicit `.ts` extensions.
- Providers report `"unavailable"` rather than failing → the chain degrades.
- `ToolRegistry` is the single source of truth; everything else reads from it.
- All persistence lives under `NEXUS_HOME` (`.nexus`) and is gitignored.
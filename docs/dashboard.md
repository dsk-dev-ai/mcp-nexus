# Dashboard

`mcp-nexus dashboard` starts a local web UI plus REST API. It is a
dependency-free single-page app served by `node:http`, bound to
`127.0.0.1` only — it is a local operator console, not a public service.

## Running

```sh
mcp-nexus dashboard
# MCP Nexus dashboard: http://127.0.0.1:3000/
# Press Ctrl-C to stop.
```

The port comes from `config.port` (`MCP_NEXUS_PORT` env, default 3000).

## REST API

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/` | Dashboard single-page app |
| GET | `/api/health` | `{status, version, uptime, tools}` |
| GET | `/api/summary` | Aggregate stats: tool counts, calls, success rate, avg latency, pending approvals |
| GET | `/api/tools` | Tools with transport, capabilities, execution count, health |
| GET | `/api/tools/:name` | Full tool record |
| POST | `/api/tools/:name/enable` | `{enabled: bool}` — enable/disable a tool |
| GET | `/api/route?query=...` | Routing playground (explainable decision) |
| POST | `/api/route` | Same, with JSON body `{query}` |
| GET | `/api/activity` | `{summary, recent}` — last 25 executions with execution ids |
| GET | `/api/policies` | Active policy snapshot `{default, rules}` |
| GET | `/api/approvals` | Pending operator approvals |
| POST | `/api/approvals/:id` | `{approved: bool}` — approve/deny a pending approval |
| GET | `/api/config` | Runtime config (API keys masked) |
| GET | `/api/benchmark` | Live benchmark run: per-task results, accuracy, success |

All responses are JSON. Errors return a `{error}` payload with the matching
HTTP status.

## UI sections

- **Overview** — headless stat cards plus a most-used-tools table.
- **Tools** — table with filter, per-tool toggle (enable/disable) and detail
  view showing the full manifest.
- **Router** — live playground: type a natural-language request and see the
  explainable decision (selected tool, provider, confidence, alternatives).
- **Activity** — recent executions with status, router, confidence, and
  latency.
- **Approvals** — pending approval queue with approve/deny buttons
  (mirrors `mcp-nexus approvals`/`resolve`).
- **Policies** — active policy config.
- **Benchmark** — runs the deterministic 13-task suite against the live
  registry and reports accuracy.
- **Settings** — runtime config with secrets masked.

## Security notes

- Binds to loopback only; the daemon never exposes it externally.
- No write path beyond tool enable/disable and approval resolution, both of
  which are equivalent to existing CLI commands.
- API keys are never returned (`/api/config` masks them as `****`).
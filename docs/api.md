# API Reference

MCP Nexus exposes three API surfaces: the MCP gateway (what AI clients talk
to), the dashboard REST API (operator console), and the Python-free TypeScript
SDK described in [docs/sdk.md](sdk.md). Every public endpoint below is
implemented, exercised by tests, and documented with request/response shapes
and errors.

## 1. MCP gateway (stdio)

Run `mcp-nexus start`. The server implements one `stdio` MCP server exposing
`nexus.*` tools. A client connects once and sees the whole registry.

| MCP tool | Input | Output |
| --- | --- | --- |
| `nexus.register_tool` | `{manifest}` | `{result}` or `{error}` |
| `nexus.remove_tool` | `{name}` | `{result}` |
| `nexus.list_tools` | — | `{tools: ToolManifest[]}` |
| `nexus.inspect_tool` | `{name}` | `{tool}` or `{error}` |
| `nexus.route` | `{query}` | explainable `RoutingDecision` |
| `nexus.discover` | `{query}` | `{surface: DiscoveredTool[]}` |
| `nexus.invoke` | `{query, args}` | `{result, executionId}` or `{error}` (args required) |
| `nexus.approvals` | — | `{approvals: PendingApproval[]}` |
| `nexus.resolve_approval` | `{id, approved}` | `{result}` |

Errors: `{error: "<reason>"}` with `isError: true`. Invocation that hits a
policy approval gate returns a pending-approval payload rather than executing.

### Example

```json
{ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": { "name": "nexus.route",
    "arguments": { "query": "analyze my repository architecture" } } }

→ { "result": { "content": [{ "type": "text",
      "text": "{\n  \"provider\": \"heuristic\",\n  \"confidence\": 1,\n  ...}" }] } }
```

## 2. Dashboard REST API

Run `mcp-nexus dashboard`. Bound to `127.0.0.1`, port from config (default
3000). All responses JSON; errors return `{error}` with the matching status.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/` | Single-page dashboard |
| GET | `/api/health` | `{status, version, uptime, tools}` |
| GET | `/api/summary` | Aggregate stats (calls, success rate, avg latency, byTool, byStatus, pending approvals) |
| GET | `/api/tools` | Tools + transport, capabilities, executions, health |
| GET | `/api/tools/:name` | Full tool record |
| POST | `/api/tools/:name/enable` | `{enabled: bool}` |
| GET/POST | `/api/route` | Live routing decision (`?query=` or `{query}`) |
| GET | `/api/activity` | `{summary, recent: ActivityRecord[]}` |
| GET | `/api/policies` | Policy snapshot `{default, rules}` |
| GET | `/api/approvals` | Pending approvals |
| POST | `/api/approvals/:id` | `{approved: bool}` |
| GET | `/api/config` | Config with secrets masked |
| GET | `/api/benchmark` | Live 13-task accuracy run |

### Example

```http
GET /api/tools → 200
[{ "name":"repoarch","version":"1.0.0","enabled":true,
   "transport":"local","capabilities":["repository-analysis","architecture"],
   "executions":12,"health":"healthy" }]
```

Errors: `404 {error: "no route for GET /nope"}`, `500 {error: "<reason>"}`.

## 3. CLI

| Command | Purpose |
| --- | --- |
| `mcp-nexus start` | MCP server over stdio |
| `mcp-nexus add <file\|json>` | Register/update a manifest (SDK-backed) |
| `mcp-nexus remove <name>` | Unregister |
| `mcp-nexus list` | List tools |
| `mcp-nexus inspect <name>` | Show full manifest |
| `mcp-nexus search <query>` / `route` | Dry-run routing decision |
| `mcp-nexus discover <query>` | Capability discovery surface |
| `mcp-nexus policy` | Show policy config |
| `mcp-nexus config [a=b ...]` | Read/write config |
| `mcp-nexus doctor` | Environment diagnostics |
| `mcp-nexus benchmark` | Deterministic routing benchmark |
| `mcp-nexus invoke <query>` | Route → policy → execute (interactive approval) |
| `mcp-nexus approvals` | List pending approvals |
| `mcp-nexus resolve <id> +\|-` | Approve/deny an approval |
| `mcp-nexus dashboard` | Start the dashboard + REST API |

Exit codes: `0` success, `1` error.

## 4. SDK

See [docs/sdk.md](sdk.md): `createTool`, `defineCapabilities`,
`definePermissions`, `registerTool`, `parseAndRegisterTool`, `upsertTool`,
`buildRouter`, plus the `*Plugin` contract interfaces.

## Versioning

`src/server/server.ts` reports the gateway version in `nexus.list_tools`;
`/api/health` reports `version`. Bumped per release (currently 0.6.0).
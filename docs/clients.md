# Supported MCP clients

MCP Nexus speaks the standard MCP protocol over `stdio` on the
`mcp-nexus start` gateway. Any client that can launch a `stdio` MCP server can
connect. This page is a **verified compatibility matrix** — each entry states
how compatibility was established (V1 spec §39). We do not claim a client
works merely because it theoretically supports MCP.

## Verified by automated tests

| Client | Verification |
| --- | --- |
| Any `@modelcontextprotocol/sdk` client | Machine-verified: the test suite drives `Client` against the running gateway — register tools, list, route, invoke, approval grant, discover — in-process (`tests/gateway.test.ts`, approval E2E). |

This is the compatibility floor: if the SDK client works end-to-end, MCP
Nexus exposes a conforming `stdio` server.

## Configuration templates (requires your own manual check)

These are the standard snippets. Run the gateway once, then connect and
tick the box below each client after your first successful invocation.

### Claude Desktop

```json
// claude_desktop_config.json → "mcpServers"
{
  "mcpServers": {
    "mcp-nexus": {
      "command": "node",
      "args": ["/path/to/mcp-nexus/src/index.ts", "start"],
      "env": { "MCP_NEXUS_HOME": "/path/to/nexus-data" }
    }
  }
}
```

Cloud `MCP_NEXUS_PORT` is not needed for the stdio gateway.

### Cursor

Cursor's MCP settings accept a `stdio` command for the server:

```json
{
  "mcpServers": {
    "mcp-nexus": {
      "command": "node",
      "args": ["/path/to/mcp-nexus/src/index.ts", "start"]
    }
  }
}
```

### VS Code (MCP extension / Copilot agent mode)

An MCP config file pointing at the gateway:

```json
// .mcp.json in the workspace root
{
  "servers": {
    "mcp-nexus": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/mcp-nexus/src/index.ts", "start"]
    }
  }
}
```

### Generic stdio MCP client

Launch `/path/to/mcp-nexus/src/index.ts start` as a `stdio` subprocess with
`MCP_NEXUS_HOME` pointing at your data dir. All `nexus.*` tool names are
namespaced to avoid collisions with the client's built-ins.

## Checklist before claiming a client is "supported"

1. Gateway starts (`mcp-nexus doctor`).
2. Client lists `nexus.list_tools` results (registry non-empty).
3. A request routes, passes policy, executes, and the result returns.
4. The activity log records the execution (dashboard Activity tab).

Until a client passes 1–4 in your setup, treat it as "template provided",
not "verified".
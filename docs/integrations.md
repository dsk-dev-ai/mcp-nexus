# Integrations

MCP Nexus is itself an MCP server. Any client that speaks MCP over stdio can
connect to `mcp-nexus start`.

```
MCP CLIENT (Claude Code / Cursor / OpenCode / ...)
        │
        ▼  stdio
   mcp-nexus start
        │
        ▼
   registered tools (nexus.list_tools)
```

## Generic (any MCP client)

```bash
npm start
```

Point your client's MCP server config at:

```jsonc
{
  "mcpServers": {
    "nexus": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-nexus/src/index.ts", "start"],
      "env": {}
    }
  }
}
```

Agent-visible tools: `nexus.register_tool`, `nexus.list_tools`, `nexus.route`,
`nexus.invoke`.

## Client examples

| Client | Location | Status |
| --- | --- | --- |
| Generic MCP client | config above | ✅ tested |
| Claude Code / Cursor / OpenCode | `examples/clients/` | to be added (see CONTRIBUTING "good first issues") |

## Roadmap integrations

- Remote registry installs: `mcp-nexus install <package>` pulling from the
  official MCP registry (V2).
- The official registry remains the discovery source; **Nexus is the routing
  layer, not a second registry.**

To add a client example, open a PR following [CONTRIBUTING.md](../CONTRIBUTING.md).
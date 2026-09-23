# Security

> **MCP Nexus executes tools on behalf of connected agents. Review tool
> permissions and execution policies before enabling untrusted tools.**

## Threat model

The core risk: a connected agent (or a malicious tool) asks Nexus to run
something harmful — read/write files, access the network, run arbitrary
processes. Nexus is the boundary.

## Controls (V1)

| Control | Where | Default |
| --- | --- | --- |
| Tool permissions | manifest `permissions` | per-tool, explicit |
| Global rules | `.nexus/policy.json` | `default: allow` — **configure for untrusted tools** |
| Execution cancellation | `PolicyEngine` → deny / approval | approval blocks execution |
| Process isolation | subprocess, timeout, stdout/stderr capture, `cwd` control | on |
| Audit trail | `.nexus/activity.jsonl` | on (every invocation) |
| Secrets | `.env`, `NEXUS_HOME` gitignored | on |

### Example policy

```json
{
  "default": "allow",
  "rules": [
    { "tool": "git", "blocklists": ["git.push", "git.commit"], "approvals": [] },
    { "tool": "*", "blocklists": ["filesystem.write"], "approvals": [] }
  ]
}
```

`deny` → refuse. `approval` → the pending approval is queued and must be
confirmed by an operator before execution: over the MCP server via
`nexus.approvals` + `nexus.resolve_approval`, or interactively with
`mcp-nexus invoke` (prompt) / `mcp-nexus resolve <id> +`. Approved scopes are
granted for the current process. Evaluate scopes include `execute` plus every
`domain.op` a tool's manifest permissions grant.

## Hardening guidance

- Run Nexus under an unprivileged user and, where possible, a container.
- Do **not** run untrusted tools in privileged contexts — subprocess isolation
  is not a full sandbox (docker sandbox: V2 roadmap).
- Prefer read-only filesystem permissions unless a tool genuinely needs writes.
- Treat `default: allow` as a temporary convenience until you model your tools.

## Responsible disclosure

See [SECURITY.md](../SECURITY.md). Do not open public issues for vulnerabilities.
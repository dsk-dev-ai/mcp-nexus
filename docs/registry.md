# Tool Registry

The registry is a file-backed store at `.nexus/registry.json`. Every tool is a
**manifest** with structured, routing-friendly metadata.

## Manifest schema

```ts
interface ToolManifest {
  name: string;                    // unique, [a-zA-Z0-9._-]
  version: string;                 // semver-ish
  description: string;             // natural language, used by routers
  capabilities: string[];          // non-empty; the routing vocabulary
  inputSchema?: Record<string, unknown>;
  transport: TransportSpec;
  permissions?: Record<string, PermissionScope>; // { read, write, execute }
  health?: { check?: boolean };
  metadata?: Record<string, unknown>;
  enabled: boolean;
}
```

`TransportSpec`:

```ts
{ type: "local" | "stdio"; command: string[] }   // subprocess
{ type: "http"; url: string; command?: string[] } // POST { input: args } to url
{ type: "docker"; image: string; command?: string[] } // docker run image [command]
```

## Capability vocabulary

Routers reason over `capabilities`, not just names. Prefer hyphenated nouns:

- `repository-analysis`, `dependency-audit`, `context-packing`
- `env-validation`, `security`, `git`, `blame`, `history`

The heuristic router splits hyphens and stems words, so a query like
"check vulnerable dependencies" still matches the `dependency-audit` capability.

## CRUD

```bash
npm start -- add   tools/repoarch.json   # register or update
npm start -- remove repoarch            # unregister
npm start -- list                       # table view
npm start -- inspect repoarch           # full manifest
```

## Example

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

## Validation

`validateManifest` enforces required fields, name charset, non-empty
capabilities, and transport type. Manifests may be JSON or the documented
simple-YAML subset (flat scalars, top-level `- ` lists, one nested object).
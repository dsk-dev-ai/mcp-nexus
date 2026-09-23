# SDK

The SDK lets developers create Nexus-compatible tools and drop-in plugin
components without understanding the server internals. It is the supported
extension surface (V1 spec §29, §30) and the same code the CLI uses to
register tools — it is never a parallel, diverging path.

Import from `./src/sdk/index.ts`:

```ts
import {
  createTool,
  defineCapabilities,
  definePermissions,
  registerTool,
  upsertTool,
  buildRouter,
} from "mcp-nexus/src/sdk/index.ts";
```

## buildTool

`createTool(spec)` builds and validates a `ToolManifest`:

```ts
import { createTool } from "mcp-nexus/src/sdk/index.ts";

const repoarch = createTool({
  name: "repoarch",
  version: "1.0.0",
  description: "Analyze repository architecture",
  capabilities: ["repository-analysis", "architecture"],
  transport: { type: "local", command: ["repoarch"] },
  inputSchema: {
    type: "object",
    properties: { depth: { type: "number" } },
  },
  permissions: { filesystem: { read: true, write: false } },
});
```

Invalid specs throw `ManifestValidationError` before anything is persisted.

## defineCapabilities / definePermissions

`defineCapabilities(["Repo-Arch", "security", "repo-arch"])` normalizes and
dedupes capability tokens (`["repo-arch", "security"]`). The router reasons
over these tokens — not just tool names.

`definePermissions({ Filesystem: { write: true } })` normalizes resource keys
and scope objects into `{ filesystem: { write: true } }`. Scopes are optional;
each is `{read?, write?, execute?}`.

## registerTool / upsertTool / parseAndRegisterTool

```ts
import { ToolRegistry } from "mcp-nexus/src/registry/registry.ts";
import { registerTool, upsertTool } from "mcp-nexus/src/sdk/index.ts";

const registry = ToolRegistry.default("./.nexus");
registerTool(registry, repoarch);                       // add (throws if exists)
upsertTool(registry, repoarch);                         // add-or-update (idempotent)
parseAndRegisterTool(registry, rawYamlOrJson);          // parse + register
```

## buildRouter

Compose a plugin provider chain in priority order:

```ts
import { HeuristicRouter } from "mcp-nexus/src/router/heuristic.ts";
import { SemanticRouter } from "mcp-nexus/src/router/semantic.ts";
import { buildRouter } from "mcp-nexus/src/sdk/index.ts";

const router = buildRouter([new HeuristicRouter(), new SemanticRouter()]);
```

The router skips any provider that reports "unavailable" and stops at the
first decision whose confidence clears the 0.5 gate — so no-LLM operation is
the default, not a fallback mode.

## Plugin interfaces

`src/sdk/interfaces.ts` declares the plugin contracts (V1 spec §30). Every
built-in component satisfies one of them, and any conforming replacement can
be dropped in:

| Interface | Contract | Built-in |
| --- | --- | --- |
| `RouterPlugin` | `name`, `route(query, tools)` | `HeuristicRouter`, `SemanticRouter`, `LlmRouter` |
| `LLMProviderPlugin` | `RouterPlugin` + `configured` | `LlmRouter` |
| `ExecutorPlugin` | `execute(tool, args)` | `ToolExecutor` |
| `PolicyProviderPlugin` | `snapshot`, `evaluate(tool, scopes, approvals?)` | `PolicyEngine` |
| `RegistryPlugin` | `list/get/add/update/remove/setEnabled/enabled` | `ToolRegistry` |
| `TelemetryProviderPlugin` | `log`, `summary`, `recent` | `ActivityLog` |

A custom router is just an object:

```ts
import type { RouterPlugin } from "mcp-nexus/src/sdk/interfaces.ts";

const alwaysRepo: RouterPlugin = {
  name: "custom",
  async route(query, tools) {
    return {
      reliability: "available",
      decision: {
        provider: "custom",
        tool: tools.find((t) => t.name === "repoarch"),
        confidence: 0.9,
        matchedCapabilities: [],
        alternatives: [],
        explanation: "custom plugin picked it",
      },
    };
  },
};
```

## Authoring a tool

1. `createTool({ ... })` to get a validated manifest.
2. `upsertTool(registry, manifest)` to publish it.
3. Executors dispatch on `transport.type` (`local`/`stdio`/`docker`/`http`),
   interpolating `{{arg}}` into the command/args — no executor knowledge
   required from the tool author.

Combine with the registry, router, policy engine and executor to build an
embedded gateway — see `src/server/server.ts` for the reference wiring.
SDK tests cover the full surface in `tests/sdk.test.ts`.
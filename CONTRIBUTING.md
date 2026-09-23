# Contributing to MCP Nexus

Thanks for your interest! MCP Nexus is open-source infrastructure for the MCP
ecosystem — contributions that move the project toward its [roadmap](ROADMAP.md)
are very welcome.

## Code of Conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Be
respectful; the project is small and every contribution counts.

## Development setup

```bash
git clone https://github.com/dsk-dev-ai/mcp-nexus.git
cd mcp-nexus
npm install
npm run typecheck
npm test
```

Requirements:

- **Node ≥ 22** (24 recommended — runs TypeScript natively, no build step).
- No preview flags, no Docker required for development.

## How it works (30-second tour)

- `src/server/server.ts` — the MCP server. Adds four tools: `register_tool`,
  `list_tools`, `route`, `invoke`.
- `src/router/` — provider chain. `heuristic.ts` is fully implemented;
  `semantic.ts` is a stub that reports "unavailable"; `llm.ts` needs `GEMINI_API_KEY`.
- `src/registry/` — manifest types + file-backed store.
- `src/policy/`, `src/executor/`, `src/telemetry/` — policy, subprocess runner, activity log.
- `src/cli.ts` — all commands. Tests live in `tests/` (node:test).

## Before you start

1. Open an issue describing the change (or comment on one) so we agree on scope.
2. For anything beyond V1, check it is not marked a V2/V3 item without
   discussion — a feature must be fully implemented, not scaffolded.

## Making changes

```bash
git checkout -b feat/your-feature
# ... code + tests ...
npm run typecheck
npm test          # all must pass
```

Style: native Node ESM, `NodeNext` resolution, **erasable-only TypeScript**
(no enums/namespaces/parameter-properties), explicit `.ts` import extensions,
`noEmit`. Emulating the surrounding code is the best guide.

## Committing

- Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`.
- One concern per commit.

## Pull requests

- Title: `type: short description`.
- Description: what and why — reference the issue if any.
- Keep the diff focused. Contribute the smallest useful slice.
- The CI workflow runs `typecheck` + `test` on Node 22 and 24 — keep it green.

## Good first issues

- Add a router benchmark task or tool fixture
- Add a client example (Claude/Cursor/OpenCode config)
- Improve the YAML-lite manifest parser
- Extend stemmer coverage (see `stem()` — it's deliberately small)
- Documentation: `docs/*`, README demos

Questions? Open a discussion issue.
# Routing

Routing answers one question: **which tool should execute this request?**

## Provider chain

`ROUTER_PROVIDERS=heuristic,semantic,llm` (default). Providers are tried left
to right. A provider that reports "unavailable" is skipped. A decision with
confidence ≥ 0.5 and a tool wins immediately.

```
heuristic ── confident? ──► decision
    │ no
    ▼
semantic  ── (V2: embeddings) currently "unavailable"
    │
    ▼
llm        ── needs GEMINI_API_KEY, else "unavailable"
    │
    ▼
fallback   ── "no confident match", explains and suggests rephrasing
```

> The system **never depends on an LLM**. V1 works fully with heuristic alone.

## Heuristic scoring

For each tool, tokens from `name`, `capabilities`, and `description` are
compared against query tokens:

```
score = nameHits × 1.5 + capHits × 1.2 + descHits × 0.5
```

- Tokens are lowercased and stopword-filtered (fillers like *what/does/my* removed).
- A light embedded stemmer normalizes plurals/suffixes
  (`dependencies→dependency`, `secure↔security`).
- `confidence = bestScore / maxScore`.

## LLM routing (optional)

`src/router/llm.ts` sends the tool catalog + request to Gemini (free tier,
plain REST — no SDK). The model returns a single tool name + confidence +
reason, which is validated against the registry before acceptance. Errors or
missing keys degrade to `"unavailable"`.

## Explainability

Every decision returns:

```jsonc
{
  "tool": "dependency-audit",
  "provider": "heuristic",
  "confidence": 1,
  "matchedCapabilities": ["dependency-audit"],
  "alternatives": [{ "name": "repoarch", "confidence": 0.49, "matchedCapabilities": ["dependencies"] }],
  "explanation": "Matched capabilities: dependency-audit for \"dependency-audit\"."
}
```

Visible via `mcp-nexus search "..."` and the `nexus.route` MCP tool — routing
is debuggable, not a black box.

## Benchmark

`mcp-nexus benchmark` runs a deterministic 6-tool / 13-task suite and reports
accuracy. It is a smoke gate today; the reusable harness is a V2 item.
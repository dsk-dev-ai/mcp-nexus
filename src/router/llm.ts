import type { RouterProvider, RoutingResult, RouterAlternative } from "./types.ts";
import type { RegistryEntry } from "../registry/registry.ts";

const DEFAULT_MODEL =
  process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

const SYSTEM_PROMPT = `You are an MCP tool router. Given a user request and a catalog of tools, respond with ONLY valid JSON:
{"name": "<exact tool name>", "confidence": <0-1>, "reason": "<short reason>"}
Choose the single best tool, or {"name": null, "confidence": 0, "reason": "<why nothing fits>"}.
Never invent tools.`;

/**
 * Optional LLM router (Gemini free tier via REST — no SDK dependency).
 * Reports "unavailable" when no API key is configured, so the router chain
 * degrades gracefully to heuristic/semantic routing.
 */
export class LlmRouter implements RouterProvider {
  readonly name = "llm";
  private readonly apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  async route(query: string, tools: RegistryEntry[]): Promise<RoutingResult> {
    if (!this.apiKey) return { reliability: "unavailable" };

    const catalog = tools
      .map((t) => `- ${t.name}: ${t.description} [capabilities: ${t.capabilities.join(", ")}]`)
      .join("\n");

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent?key=${this.apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [
              {
                role: "user",
                parts: [
                  { text: `Tool catalog:\n${catalog}\n\nUser request: "${query}"` },
                ],
              },
            ],
          }),
        },
      );
      if (!res.ok) return { reliability: "unavailable" };
      const payload = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const json = extractJson(text);
      const parsed = JSON.parse(json) as {
        name?: string | null;
        confidence?: number;
        reason?: string;
      };
      if (!parsed.name) {
        return { reliability: "available", decision: { provider: "llm", confidence: 0, matchedCapabilities: [], alternatives: [], explanation: parsed.reason ?? "LLM declined to route." } };
      }
      const tool = tools.find((t) => t.name === parsed.name);
      if (!tool) {
        return { reliability: "available", decision: { provider: "llm", confidence: 0, matchedCapabilities: [], alternatives: [], explanation: `LLM picked unknown tool "${parsed.name}".` } };
      }
      const decision = {
        provider: "llm",
        tool,
        confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
        matchedCapabilities: tool.capabilities,
        alternatives: [] as RouterAlternative[],
        explanation: parsed.reason ?? "Selected by LLM.",
      };
      return { reliability: "available", decision };
    } catch {
      return { reliability: "unavailable" };
    }
  }
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1]!;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("no JSON in LLM response");
  return text.slice(start, end + 1);
}
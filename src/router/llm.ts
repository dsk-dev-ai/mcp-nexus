import type { RouterProvider, RoutingResult, RouterAlternative } from "./types.ts";
import type { RegistryEntry } from "../registry/registry.ts";
import type { LLMProviderPlugin } from "../sdk/interfaces.ts";
import type { NexusConfig } from "../config.ts";

const DEFAULT_MODEL =
  process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

const SYSTEM_PROMPT = `You are an MCP tool router. Given a user request and a catalog of tools, respond with ONLY valid JSON:
{"name": "<exact tool name>", "confidence": <0-1>, "reason": "<short reason>"}
Choose the single best tool, or {"name": null, "confidence": 0, "reason": "<why nothing fits>"}.
Never invent tools.`;

interface LlmPick {
  name?: string | null;
  confidence?: number;
  reason?: string;
}

/**
 * Optional LLM router. Two pluggable providers are built into V1 (§30):
 *
 * - **Gemini** — free tier via REST (`generativelanguage.googleapis.com`).
 * - **OpenRouter** — OpenAI-compatible `chat/completions` aggregate endpoint,
 *   letting operators route through many hosted/local models.
 *
 * Both report "unavailable" when no API key is configured, so the chain
 * degrades gracefully to heuristic/semantic routing — the V1 requirement that
 * the router work with no LLM configured.
 */
export class LlmRouter implements RouterProvider, LLMProviderPlugin {
  readonly name: string;
  private readonly apiKey?: string;
  private readonly provider: "gemini" | "openrouter";

  constructor(provider: "gemini" | "openrouter", apiKey?: string) {
    this.apiKey = apiKey;
    this.provider = provider;
    this.name = provider === "gemini" ? "llm" : "llm-openrouter";
  }

  /** True when an API key means the provider can actually route. */
  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  async route(query: string, tools: RegistryEntry[]): Promise<RoutingResult> {
    if (!this.apiKey) return { reliability: "unavailable" };

    const catalog = tools
      .map((t) => `- ${t.name}: ${t.description} [capabilities: ${t.capabilities.join(", ")}]`)
      .join("\n");
    const prompt = `Tool catalog:\n${catalog}\n\nUser request: "${query}"`;

    try {
      if (this.provider === "gemini") {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent?key=${this.apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
              contents: [{ role: "user", parts: [{ text: prompt }] }],
            }),
          },
        );
        if (!res.ok) return { reliability: "unavailable" };
        const payload = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        return this.decide(query, tools, text);
      }

      // OpenRouter (OpenAI-compatible chat completions)
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model:
            process.env.OPENROUTER_MODEL ??
            "openai/gpt-4o-mini",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          temperature: 0,
        }),
      });
      if (!res.ok) return { reliability: "unavailable" };
      const payload = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = payload.choices?.[0]?.message?.content ?? "";
      return this.decide(query, tools, text);
    } catch {
      return { reliability: "unavailable" };
    }
  }

  private decide(
    query: string,
    tools: RegistryEntry[],
    text: string,
  ): RoutingResult {
    let parsed: LlmPick;
    try {
      parsed = JSON.parse(extractJson(text)) as LlmPick;
    } catch {
      return { reliability: "available", decision: { provider: this.name, confidence: 0, matchedCapabilities: [], alternatives: [], explanation: "LLM response was not valid JSON." } };
    }
    if (!parsed.name) {
      return { reliability: "available", decision: { provider: this.name, confidence: 0, matchedCapabilities: [], alternatives: [], explanation: parsed.reason ?? "LLM declined to route." } };
    }
    const tool = tools.find((t) => t.name === parsed.name);
    if (!tool) {
      return { reliability: "available", decision: { provider: this.name, confidence: 0, matchedCapabilities: [], alternatives: [], explanation: `LLM picked unknown tool "${parsed.name}".` } };
    }
    const decision = {
      provider: this.name,
      tool,
      confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
      matchedCapabilities: tool.capabilities,
      alternatives: [] as RouterAlternative[],
      explanation: parsed.reason ?? "Selected by LLM.",
    };
    return { reliability: "available", decision };
  }
}

/** Pick the LLM provider by which key is configured (OpenRouter wins if both). */
export function buildLlmRouter(config: Pick<NexusConfig, "geminiApiKey" | "openrouterApiKey">): LlmRouter {
  if (config.openrouterApiKey) return new LlmRouter("openrouter", config.openrouterApiKey);
  return new LlmRouter("gemini", config.geminiApiKey);
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1]!;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("no JSON in LLM response");
  return text.slice(start, end + 1);
}
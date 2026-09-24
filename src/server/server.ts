import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { ToolRegistry } from "../registry/registry.ts";
import type { NexusRouter } from "../router/index.ts";
import type { PolicyEngine } from "../policy/policy.ts";
import type { ToolExecutor } from "../executor/executor.ts";
import type { ActivityLog } from "../telemetry/logger.ts";
import type { ApprovalStore } from "../policy/approvals.ts";
import { deriveScopes } from "../policy/scopes.ts";
import { NEXUS_VERSION } from "../version.ts";

export interface NexusServerDeps {
  registry: ToolRegistry;
  router: NexusRouter;
  policy: PolicyEngine;
  executor: ToolExecutor;
  activity: ActivityLog;
  approvals: ApprovalStore;
  home: string;
}

const target = z.object({}).passthrough();

/**
 * Build the McpServer exposing the nexus surface. Used identically by the stdio
 * gateway and the Streamable-HTTP gateway so both transports run the same
 * tools with the same semantics.
 */
export function buildNexusMcpServer(deps: NexusServerDeps): McpServer {
  const { registry, router, policy, executor, activity, approvals } = deps;
  const server = new McpServer(
    { name: "mcp-nexus", version: NEXUS_VERSION },
    { capabilities: { tools: {} } },
  );

  server.tool(
    "nexus.register_tool",
    "Register a tool manifest (JSON string) into the nexus registry.",
    { manifest: z.string().describe("ToolManifest as a JSON string") },
    async ({ manifest }) => {
      try {
        const entry = registry.update(manifest);
        return { content: [{ type: "text", text: `Updated tool: ${entry.name}` }] };
      } catch {
        const entry = registry.add(manifest);
        return { content: [{ type: "text", text: `Registered tool: ${entry.name}` }] };
      }
    },
  );

  server.tool(
    "nexus.remove_tool",
    "Unregister a tool by exact name from the nexus registry.",
    { name: z.string().describe("exact tool name to remove") },
    async ({ name }) => {
      try {
        registry.remove(name);
        return { content: [{ type: "text", text: `Removed tool: ${name}` }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "nexus.inspect_tool",
    "Show the full manifest of a registered tool by exact name.",
    { name: z.string().describe("exact tool name to inspect") },
    async ({ name }) => {
      const tool = registry.get(name);
      if (!tool) {
        return { content: [{ type: "text", text: `tool "${name}" not found` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(tool, null, 2) }] };
    },
  );

  server.tool(
    "nexus.list_tools",
    "List every tool in the registry with capabilities and transport.",
    {},
    async () => {
      const tools = registry.list();
      const text = tools
        .map((t) => `- ${t.name}${t.enabled ? "" : " [disabled]"}: ${t.description} (${t.capabilities.join(", ")})`)
        .join("\n");
      return { content: [{ type: "text", text: text || "No tools registered." }] };
    },
  );

  server.tool(
    "nexus.route",
    "Route a natural-language request to the best registered tool (no execution).",
    { query: z.string().describe("user request") },
    async ({ query }) => {
      const decision = await router.route(query, registry.enabled());
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            tool: decision.tool?.name ?? null,
            provider: decision.provider,
            confidence: decision.confidence,
            matchedCapabilities: decision.matchedCapabilities,
            alternatives: decision.alternatives,
            explanation: decision.explanation,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    "nexus.discover",
    "Dynamic capability discovery: return the minimal tool surface for a request (top candidate tools + capabilities), without executing anything.",
    { query: z.string().describe("user request") },
    async ({ query }) => {
      const { query: q, surface } = await router.discover(query, registry.enabled());
      const text = surface.length === 0
        ? `No tools found for "${q}". Register tools first via nexus.register_tool.`
        : surface
          .map((t) => `- ${t.name} (via ${t.provider}, ${(t.confidence * 100).toFixed(0)}%): ${t.matchedCapabilities.join(", ") || "no explicit capability match"}`)
          .join("\n");
      return {
        content: [{
          type: "text",
          text: `Request: "${q}"\nMinimal surface:\n${text}\n\nExecute any of these with nexus.invoke (query: "${q}").`,
        }],
      };
    },
  );

  server.tool(
    "nexus.invoke",
    "Route a request to a tool (or target one by name), enforce policy, and execute it.",
    {
      query: z.string().describe("user request used for routing"),
      tool: z.string().optional().describe("target tool name; skips routing when set"),
      args: target.describe("arguments passed to the tool"),
    },
    async ({ query, tool, args }) => {
      const enabled = registry.enabled();
      let selected;
      let provider = "explicit";
      let confidence = 1;

      if (tool) {
        selected = enabled.find((t) => t.name === tool);
      } else {
        const routeDecision = await router.route(query, enabled);
        selected = routeDecision.tool;
        provider = routeDecision.provider;
        confidence = routeDecision.confidence;
      }

      if (!selected) {
        return { content: [{ type: "text", text: "No matching tool found for the request." }] };
      }

      const scopes = deriveScopes(selected);
      const policyDecision = policy.evaluate(selected, scopes, approvals);
      if (policyDecision.action === "deny") {
        return { content: [{ type: "text", text: `Blocked by policy: ${policyDecision.reasons.join("; ")}` }] };
      }
      if (policyDecision.action === "approval") {
        const pending = approvals.request(selected.name, scopes, policyDecision.reasons);
        approvals.persist(deps.home);
        return { content: [{ type: "text", text: `Approval required (${pending.id}): ${policyDecision.reasons.join("; ")}. Approve via nexus.resolve_approval.` }] };
      }

      const result = await executor.execute(selected, args ?? {});
      const executionId = activity.log({
        tool: selected.name,
        status: result.status,
        durationMs: result.durationMs,
        router: provider,
        confidence,
      });

      const texts = ([
        { type: "text" as const, text: `Execution ${executionId}: tool ${selected.name} (${result.status} in ${result.durationMs}ms, via ${provider})` },
        { type: "text" as const, text: result.stdout || "(no stdout)" },
        { type: "text" as const, text: result.stderr ? `stderr: ${result.stderr}` : "" },
      ] as Array<{ type: "text"; text: string }>).filter((c) => c.text !== "");

      return { content: texts };
    },
  );

  server.tool(
    "nexus.approvals",
    "List pending tool-execution approvals that need an operator decision.",
    {},
    async () => {
      const pending = approvals.list();
      const text = pending.length === 0
        ? "No pending approvals."
        : pending.map((a) => `- ${a.id} [${a.tool}] ${a.reasons.join("; ")} (${a.requestedAt})`).join("\n");
      return { content: [{ type: "text", text }] };
    },
  );

  server.tool(
    "nexus.resolve_approval",
    "Approve or deny a pending approval; approvals granted this session skip the approval gate.",
    {
      id: z.string().describe("approval id"),
      approved: z.boolean().describe("true to approve and proceed, false to deny"),
    },
    async ({ id, approved }) => {
      const pending = approvals.resolve(id, approved);
      approvals.persist(deps.home);
      if (!pending) {
        return { content: [{ type: "text", text: `No pending approval "${id}".` }] };
      }
      return { content: [{ type: "text", text: approved ? `Approved ${pending.tool}: ${pending.scopes.join(", ")}` : `Denied ${pending.tool}: ${pending.scopes.join(", ")}` }] };
    },
  );

  return server;
}

/**
 * MCP server over stdio — `mcp-nexus start`. Connects to the parent client's
 * stdin/stdout and stays up until the client hangs up.
 */
export class NexusMCPServer {
  private readonly server: McpServer;

  constructor(deps: NexusServerDeps) {
    this.server = buildNexusMcpServer(deps);
  }

  async connect(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildNexusMcpServer, type NexusServerDeps } from "./server.ts";
import { NEXUS_VERSION } from "../version.ts";

export interface HttpGatewayOptions {
  port?: number;
  host?: string;
}

export interface HttpGatewayHandle {
  close: () => Promise<void>;
  port: number;
  url: string;
}

interface Session {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

/**
 * Streamable-HTTP MCP gateway (§2, §10): serves the full nexus.`*` surface over
 * HTTP so remote MCP clients (Claude Desktop, Cursor, servers on other hosts)
 * can connect with a URL instead of a stdio process. Binds to the configured
 * host/port; the endpoint is GET+POST `/mcp`.
 *
 * Each session keyed by its `McpSessionId` gets its own McpServer instance, so
 * a gateway serves many clients concurrently.
 */
export async function startHttpGateway(
  deps: NexusServerDeps,
  options: HttpGatewayOptions = {},
): Promise<HttpGatewayHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3000;
  const sessions = new Map<string, Session>();

  const makeSession = async (): Promise<Session> => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    const server = buildNexusMcpServer(deps);
    const session: Session = { server, transport };
    transport.onclose = () => {
      sessions.delete(transport.sessionId ?? "");
    };
    await server.connect(transport);
    return session;
  };

  const readBody = (req: IncomingMessage): Promise<unknown> =>
    new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw) return resolve(undefined);
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(undefined);
        }
      });
    });

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}`);
    if (url.pathname !== "/mcp" || !["GET", "POST", "DELETE"].includes(req.method ?? "")) {
      json(res, 404, { error: `no MCP route for ${req.method ?? "?"} ${url.pathname}` });
      return;
    }

    try {
      const sessionIdHeader = req.headers["mcp-session-id"];
      const sessionId = typeof sessionIdHeader === "string" ? sessionIdHeader : undefined;

      if (req.method === "DELETE") {
        if (sessionId && sessions.has(sessionId)) {
          const session = sessions.get(sessionId)!;
          await session.transport.close();
          sessions.delete(sessionId);
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
        return;
      }

      let session = sessionId ? sessions.get(sessionId) : undefined;
      if (sessionId && !session) {
        json(res, 400, { error: "unknown Mcp-Session-Id; start a new session" });
        return;
      }

      if (!session) {
        session = await makeSession();
      }

      const body = await readBody(req);
      // handleRequest sends its own response headers/body per the MCP Streamable
      // HTTP spec (JSON responses and SSE streams).
      await session.transport.handleRequest(req, res, body);

      const generated = session.transport.sessionId;
      if (generated && !sessions.has(generated)) {
        sessions.set(generated, session);
      }
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  return await new Promise<HttpGatewayHandle>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.on("clientError", (_err, socket) => {
      socket.destroy();
    });
    httpServer.listen(port, host, () => {
      httpServer.removeListener("error", reject);
      const addr = httpServer.address() as { port: number };
      resolve({
        close: () =>
          new Promise<void>((resolveClose) => {
            for (const session of sessions.values()) {
              void session.transport.close();
            }
            sessions.clear();
            httpServer.close(() => resolveClose());
          }),
        port: addr.port,
        url: `http://${host}:${addr.port}/mcp`,
      });
    });
  });
}

export { NEXUS_VERSION };
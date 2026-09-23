import { spawn } from "node:child_process";
import type { ToolManifest } from "../registry/manifest.ts";

export interface ExecArgs {
  [key: string]: unknown;
}

export interface ExecResult {
  tool: string;
  status: "success" | "error" | "timeout";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface ExecutorOptions {
  timeoutMs?: number;
  cwd?: string;
}

/** Not-implemented transport error; route escapes to the caller. */
export class TransportNotImplementedError extends Error {}

/**
 * Executes a registered tool. V1 supports `local` (direct command) and `stdio`
 * (command expected to speak MCP over stdio — wrapped, not yet fully wired) via
 * subprocess invocation; `http` and `docker` are explicitly not implemented.
 */
export class ToolExecutor {
  private readonly options: ExecutorOptions;

  constructor(options: ExecutorOptions = {}) {
    this.options = options;
  }

  async execute(tool: ToolManifest, args: ExecArgs): Promise<ExecResult> {
    const startedAt = Date.now();
    const transport = tool.transport;

    if (transport.type === "http" || transport.type === "docker") {
      throw new TransportNotImplementedError(
        `${transport.type} transport is on the roadmap (ROADMAP.md); use local/stdio tools in V1`,
      );
    }

    const command = transport.command ?? [];
    const [bin, ...rest] = command;
    if (!bin) throw new Error(`tool "${tool.name}" has no command`);

    const interpolation = interpolate(rest, args);
    const timeoutMs = this.options.timeoutMs ?? 30_000;

    return new Promise<ExecResult>((resolve) => {
      const child = spawn(bin, interpolation, {
        cwd: this.options.cwd ?? process.cwd(),
        shell: false,
        env: { ...process.env, NEXUS_TOOL: tool.name },
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        resolve({
          tool: tool.name,
          status: "timeout",
          exitCode: null,
          stdout,
          stderr: stderr + "\n[nexus] timed out after " + timeoutMs + "ms",
          durationMs: Date.now() - startedAt,
        });
      }, timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          tool: tool.name,
          status: code === 0 ? "success" : "error",
          exitCode: code,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
        });
      });
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          tool: tool.name,
          status: "error",
          exitCode: null,
          stdout,
          stderr: err.message,
          durationMs: Date.now() - startedAt,
        });
      });
    });
  }
}

/** Replaces `{{key}}` tokens in command args with values from the exec args. */
function interpolate(argv: string[], args: ExecArgs): string[] {
  return argv.map((arg) =>
    arg.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (_, key: string) => {
      const value = args[key];
      if (value === undefined) return "";
      return typeof value === "object" ? JSON.stringify(value) : String(value);
    }),
  );
}
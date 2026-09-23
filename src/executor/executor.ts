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

/**
 * Executes a registered tool across all transport types:
 *
 * - `local`  — run a command on this machine
 * - `stdio`  — run a command that speaks MCP over stdio (same subprocess path)
 * - `docker` — `docker run` a tool image, args interpolated
 * - `http`   — POST `{ input: args }` to a Streamable-HTTP/JSON endpoint
 */
export class ToolExecutor {
  private readonly options: ExecutorOptions;

  constructor(options: ExecutorOptions = {}) {
    this.options = options;
  }

  async execute(tool: ToolManifest, args: ExecArgs): Promise<ExecResult> {
    const startedAt = Date.now();
    switch (tool.transport.type) {
      case "docker":
        return await this.runDocker(tool, args, startedAt);
      case "http":
        return await this.runHttp(tool, args, startedAt);
      case "local":
      case "stdio":
        return await this.runSubprocess(tool, args, startedAt);
    }
  }

  private timeoutMs(): number {
    return this.options.timeoutMs ?? 30_000;
  }

  private completed(
    tool: ToolManifest,
    startedAt: number,
    p: Partial<ExecResult>,
  ): ExecResult {
    return {
      tool: tool.name,
      status: p.status ?? "error",
      exitCode: p.exitCode ?? null,
      stdout: p.stdout ?? "",
      stderr: p.stderr ?? "",
      durationMs: Date.now() - startedAt,
    };
  }

  private async runSubprocess(
    tool: ToolManifest,
    args: ExecArgs,
    startedAt: number,
  ): Promise<ExecResult> {
    const command = tool.transport.command ?? [];
    const [bin, ...rest] = command;
    if (!bin) return this.completed(tool, startedAt, { stderr: `tool "${tool.name}" has no command` });

    const argv = interpolate(rest, args);
    const timeoutMs = this.timeoutMs();
    const cwd = this.options.cwd ?? process.cwd();

    return new Promise<ExecResult>((resolve) => {
      const child = spawn(bin, argv, {
        cwd,
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
        resolve(this.completed(tool, startedAt, {
          status: "timeout",
          stdout,
          stderr: stderr + `\n[nexus] timed out after ${timeoutMs}ms`,
        }));
      }, timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(this.completed(tool, startedAt, {
          status: code === 0 ? "success" : "error",
          exitCode: code,
          stdout,
          stderr,
        }));
      });
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(this.completed(tool, startedAt, { stdout, stderr: err.message }));
      });
    });
  }

  private async runDocker(
    tool: ToolManifest,
    args: ExecArgs,
    startedAt: number,
  ): Promise<ExecResult> {
    const image = tool.transport.image;
    if (!image) return this.completed(tool, startedAt, { stderr: `tool "${tool.name}" (docker) has no image` });

    const command = tool.transport.command ?? [];
    const argv = [
      "run",
      "--rm",
      "--name", `${tool.name}-${process.pid}-${Math.floor(Math.random() * 1e6)}`,
      "-e", "NEXUS_TOOL",
      image,
      ...interpolate(command, args),
    ];
    const timeoutMs = this.timeoutMs();

    return new Promise<ExecResult>((resolve) => {
      const child = spawn("docker", argv, {
        cwd: this.options.cwd,
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
        resolve(this.completed(tool, startedAt, {
          status: "timeout",
          stdout,
          stderr: stderr + `\n[nexus] docker run timed out after ${timeoutMs}ms`,
        }));
      }, timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(this.completed(tool, startedAt, {
          status: code === 0 ? "success" : "error",
          exitCode: code,
          stdout,
          stderr,
        }));
      });
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(this.completed(tool, startedAt, { stdout, stderr: err.message }));
      });
    });
  }

  private async runHttp(
    tool: ToolManifest,
    args: ExecArgs,
    startedAt: number,
  ): Promise<ExecResult> {
    const url = tool.transport.url;
    if (!url) return this.completed(tool, startedAt, { stderr: `tool "${tool.name}" (http) has no url` });

    const target = interpolate([url], args)[0] ?? url;
    const timeoutMs = this.timeoutMs();

    try {
      const response = await fetch(target, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: args }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      return this.completed(tool, startedAt, {
        status: response.ok ? "success" : "error",
        exitCode: null,
        stdout: text,
        stderr: response.ok ? "" : `HTTP ${response.status}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.completed(tool, startedAt, {
        status: message.includes("aborted") || message.includes("timeout") ? "timeout" : "error",
        stderr: message,
      });
    }
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
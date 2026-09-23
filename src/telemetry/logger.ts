import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ActivityRecord {
  executionId: string;
  tool: string;
  status: string;
  durationMs: number;
  router: string;
  confidence: number;
  timestamp: string;
}

export interface ActivitySummary {
  total: number;
  byStatus: Record<string, number>;
  byTool: Record<string, number>;
  avgDurationMs: number;
}

let execCounter = 0;

export function makeExecutionId(): string {
  return `exec_${Date.now().toString(36)}${(execCounter++).toString(36)}`;
}

/**
 * Lightweight JSONL activity log. One record per routed execution.
 * Kept in NEXUS_HOME/activity.jsonl — never in the repository.
 */
export class ActivityLog {
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  static default(homeDir: string): ActivityLog {
    if (!existsSync(homeDir)) mkdirSync(homeDir, { recursive: true });
    return new ActivityLog(join(homeDir, "activity.jsonl"));
  }

  log(record: Omit<ActivityRecord, "timestamp" | "executionId">): void {
    appendFileSync(
      this.file,
      JSON.stringify({
        ...record,
        executionId: makeExecutionId(),
        timestamp: new Date().toISOString(),
      }) + "\n",
    );
  }

  summary(): ActivitySummary {
    const lines = this.read();
    const byStatus: Record<string, number> = {};
    const byTool: Record<string, number> = {};
    let totalMs = 0;

    for (const record of lines) {
      byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;
      byTool[record.tool] = (byTool[record.tool] ?? 0) + 1;
      totalMs += record.durationMs;
    }

    return {
      total: lines.length,
      byStatus,
      byTool,
      avgDurationMs: lines.length ? Math.round(totalMs / lines.length) : 0,
    };
  }

  recent(limit = 10): ActivityRecord[] {
    return this.read().slice(-limit).reverse();
  }

  private read(): ActivityRecord[] {
    if (!existsSync(this.file)) return [];
    const text = readFileSync(this.file, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ActivityRecord);
  }
}
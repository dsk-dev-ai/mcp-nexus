import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface PendingApproval {
  id: string;
  tool: string;
  scopes: string[];
  reasons: string[];
  requestedAt: string;
}

let counter = 0;

/** Processes approval-gated executions. */
export class ApprovalStore {
  private pending: PendingApproval[];
  /** granted once in this process: `${tool}::${scope}` */
  private granted: Set<string>;

  constructor(pending: PendingApproval[] = [], granted: Iterable<string> = []) {
    this.pending = pending;
    this.granted = new Set(granted);
  }

  static load(homeDir: string, file = "approvals.json"): ApprovalStore {
    const path = join(homeDir, file);
    if (!existsSync(path)) return new ApprovalStore();
    try {
      const data = JSON.parse(readFileSync(path, "utf8")) as PendingApproval[];
      return new ApprovalStore(data);
    } catch {
      return new ApprovalStore();
    }
  }

  private save(homeDir: string, file: string): void {
    if (!existsSync(homeDir)) mkdirSync(homeDir, { recursive: true });
    writeFileSync(join(homeDir, file), JSON.stringify(this.pending, null, 2));
  }

  request(tool: string, scopes: string[], reasons: string[]): PendingApproval {
    const approval: PendingApproval = {
      id: `ap-${Date.now().toString(36)}-${(counter++).toString(36)}`,
      tool,
      scopes,
      reasons,
      requestedAt: new Date().toISOString(),
    };
    this.pending.unshift(approval);
    return approval;
  }

  list(): PendingApproval[] {
    return [...this.pending];
  }

  resolve(id: string, approved: boolean): PendingApproval | null {
    const index = this.pending.findIndex((a) => a.id === id);
    if (index === -1) return null;
    const removed = this.pending.splice(index, 1);
    const approval = removed[0];
    if (approval === undefined) return null;
    if (approved) {
      for (const scope of approval.scopes) {
        this.granted.add(`${approval.tool}::${scope}`);
      }
    }
    return approval;
  }

  isGranted(tool: string, scope: string): boolean {
    return this.granted.has(`${tool}::${scope}`);
  }

  /** Persist pending approvals (granted set is process-local by design). */
  persist(homeDir: string, file = "approvals.json"): void {
    this.save(homeDir, file);
  }
}
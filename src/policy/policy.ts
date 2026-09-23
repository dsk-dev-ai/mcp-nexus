import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolManifest } from "../registry/manifest.ts";
import type { ApprovalStore } from "./approvals.ts";
import type { PolicyProviderPlugin } from "../sdk/interfaces.ts";

export type PolicyAction = "allow" | "deny" | "approval";

export interface PolicyRule {
  tool: string;
  /** Capabilities or scopes that need explicit approval */
  approvals: string[];
  /** Capabilities or scopes that are always denied */
  blocklists: string[];
}

export interface PolicyConfig {
  default: PolicyAction;
  rules: PolicyRule[];
}

export interface PolicyDecision {
  action: PolicyAction;
  reasons: string[];
}

const EMPTY: PolicyConfig = { default: "allow", rules: [] };

/**
 * Policy engine. Applies global rules on top of per-tool permission scopes.
 * Default is "allow" in V1; the README warns operators to configure rules for
 * untrusted tools. Approval-based scopes surface as "approval" and must be
 * confirmed by the caller before execution.
 */
export class PolicyEngine implements PolicyProviderPlugin {
  private readonly config: PolicyConfig;

  constructor(config: PolicyConfig = EMPTY) {
    this.config = config;
  }

  /** Serializable snapshot of the active policy. */
  get snapshot(): PolicyConfig {
    return this.config;
  }

  static load(homeDir: string): PolicyEngine {
    const file = join(homeDir, "policy.json");
    if (!existsSync(file)) return new PolicyEngine();
    try {
      const config = JSON.parse(readFileSync(file, "utf8")) as PolicyConfig;
      return new PolicyEngine(config);
    } catch {
      return new PolicyEngine();
    }
  }

  save(homeDir: string): void {
    if (!existsSync(homeDir)) mkdirSync(homeDir, { recursive: true });
    writeFileSync(join(homeDir, "policy.json"), JSON.stringify(this.config, null, 2));
  }

  evaluate(tool: ToolManifest, scopes: string[], approvals?: ApprovalStore): PolicyDecision {
    const reasons: string[] = [];
    const rule = this.config.rules.find((r) => r.tool === tool.name || r.tool === "*");

    if (rule) {
      for (const scope of scopes) {
        if (rule.blocklists.includes(scope)) {
          return { action: "deny", reasons: [`${tool.name}: ${scope} is blocked by policy`] };
        }
        if (rule.approvals.includes(scope)) {
          reasons.push(`${tool.name}: ${scope} requires approval`);
        }
      }
    }

    if (reasons.length > 0) {
      // every approval-gated scope already granted this session? then proceed
      const allGranted = rule!.approvals.every((scope) =>
        !scopes.includes(scope) || approvals?.isGranted(tool.name, scope),
      );
      return { action: allGranted ? "allow" : "approval", reasons };
    }

    const permissions = tool.permissions ?? {};
    for (const scope of scopes) {
      const [domain, op] = scope.split(".");
      if (!domain) continue;
      const level = permissions[domain];
      if (level && op && level[op as keyof typeof level] === false) {
        return { action: "deny", reasons: [`${domain}.${op} denied by tool manifest`] };
      }
    }

    return { action: this.config.default, reasons: reasons.length ? reasons : ["allowed by policy"] };
  }
}
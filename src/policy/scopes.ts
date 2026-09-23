import type { PermissionScope } from "../registry/manifest.ts";

/**
 * A tool's invocation scope is what its manifest explicitly *grants* (truthy
 * ops). Ops declared `false` are the tool declaring what it will not do — they
 * read as "no such capability granted", not as a deny trigger on every call.
 */
export function deriveScopes(tool: { permissions?: Record<string, PermissionScope> }): string[] {
  const scopes = ["execute"];
  for (const [domain, ops] of Object.entries(tool.permissions ?? {})) {
    for (const [op, granted] of Object.entries(ops)) {
      if (granted === true) scopes.push(`${domain}.${op}`);
    }
  }
  return scopes;
}
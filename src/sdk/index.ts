import { validateManifest, type ToolManifest, type PermissionScope } from "../registry/manifest.ts";
import type { RegistryEntry, ToolRegistry } from "../registry/registry.ts";
import { NexusRouter } from "../router/index.ts";
import type { RouterPlugin } from "./interfaces.ts";

/**
 * Public developer SDK (V1 spec §29). A tool author can build a valid
 * Nexus-compatible manifest, register it into a registry, and hand the
 * connection over — without understanding the server internals.
 */

export interface ToolSpec {
  name: string;
  version: string;
  description: string;
  capabilities: string[];
  transport: ToolManifest["transport"];
  inputSchema?: Record<string, unknown>;
  permissions?: Record<string, PermissionScope>;
  health?: { check?: boolean };
  metadata?: Record<string, unknown>;
  enabled?: boolean;
}

/**
 * Build and validate a tool manifest from a friendly spec object.
 * Throws ManifestValidationError when the spec is not deployable.
 */
export function createTool(spec: ToolSpec): ToolManifest {
  const manifest: ToolManifest = {
    name: spec.name,
    version: spec.version,
    description: spec.description,
    capabilities: defineCapabilities(spec.capabilities),
    transport: spec.transport,
    enabled: spec.enabled ?? true,
  };
  if (spec.inputSchema) manifest.inputSchema = spec.inputSchema;
  if (spec.permissions) manifest.permissions = definePermissions(spec.permissions);
  if (spec.health) manifest.health = spec.health;
  if (spec.metadata) manifest.metadata = spec.metadata;
  validateManifest(manifest);
  return manifest;
}

/** Declare capability tokens the router reasons over. Dedupes preserving order. */
export function defineCapabilities(capabilities: string[]): string[] {
  return [...new Set(capabilities.map((c) => c.trim().toLowerCase()).filter(Boolean))];
}

/** Declare permission scopes (all optional: `read`, `write`, `execute`). */
export function definePermissions(permissions: Record<string, PermissionScope>): Record<string, PermissionScope> {
  const out: Record<string, PermissionScope> = {};
  for (const [resource, scope] of Object.entries(permissions)) {
    out[resource.trim().toLowerCase()] = { ...scope };
  }
  return out;
}

/** Register a built manifest (or raw JSON/YAML) into a registry. */
export function registerTool(registry: ToolRegistry, manifest: ToolManifest | string): RegistryEntry {
  return registry.add(manifest);
}

/** Parse + register a raw manifest, throwing ManifestValidationError on bad input. */
export function parseAndRegisterTool(registry: ToolRegistry, raw: string): RegistryEntry {
  return registry.add(raw);
}

/** Register or update a tool by manifest (idempotent for the CLI `add` path). */
export function upsertTool(
  registry: ToolRegistry,
  manifest: ToolManifest | string,
): { added: boolean; entry: RegistryEntry } {
  try {
    return { added: false, entry: registry.update(manifest) };
  } catch {
    return { added: true, entry: registry.add(manifest) };
  }
}

/** Compose the default provider chain in priority order. */
export function buildRouter(providers: RouterPlugin[]): NexusRouter {
  return new NexusRouter(providers);
}

export type { ToolManifest } from "../registry/manifest.ts";
export type { RegistryEntry, ToolRegistry } from "../registry/registry.ts";
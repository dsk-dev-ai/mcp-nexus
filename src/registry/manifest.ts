export interface PermissionScope {
  read?: boolean;
  write?: boolean;
  execute?: boolean;
}

export interface TransportSpec {
  type: "stdio" | "http" | "docker" | "local";
  /** Command + args for `local` and `stdio` transports */
  command?: string[];
  /** URL for `http` transport */
  url?: string;
  /** Image for `docker` transport */
  image?: string;
}

export interface ToolManifest {
  name: string;
  version: string;
  description: string;
  /** Declared capabilities — the router reasons over these, not just names */
  capabilities: string[];
  /** Optional JSON schema describing tool arguments */
  inputSchema?: Record<string, unknown>;
  transport: TransportSpec;
  permissions?: Record<string, PermissionScope>;
  health?: { check?: boolean };
  metadata?: Record<string, unknown>;
  enabled: boolean;
}

const REQUIRED: Array<keyof ToolManifest> = [
  "name",
  "version",
  "description",
  "capabilities",
  "transport",
  "enabled",
];

export class ManifestValidationError extends Error {}

export function validateManifest(m: unknown): asserts m is ToolManifest {
  if (typeof m !== "object" || m === null) {
    throw new ManifestValidationError("manifest must be an object");
  }
  const manifest = m as Partial<ToolManifest>;
  for (const key of REQUIRED) {
    if (manifest[key] === undefined) {
      throw new ManifestValidationError(`missing required field: ${key}`);
    }
  }
  if (typeof manifest.name !== "string" || /[^a-z0-9._-]/i.test(manifest.name)) {
    throw new ManifestValidationError(
      "name must be a string matching [a-zA-Z0-9._-]",
    );
  }
  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) {
    throw new ManifestValidationError("capabilities must be a non-empty array");
  }
  const transport = manifest.transport as TransportSpec | undefined;
  if (!transport || !["stdio", "http", "docker", "local"].includes(transport.type)) {
    throw new ManifestValidationError("transport.type must be stdio, http, docker or local");
  }
  if ((transport.type === "local" || transport.type === "stdio") && !transport.command?.length) {
    throw new ManifestValidationError(`${transport.type} transport requires a command`);
  }
}

export function parseManifest(text: string): ToolManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    try {
      parsed = yamlLite(text);
    } catch {
      throw new ManifestValidationError("manifest must be valid JSON or simple YAML");
    }
  }
  validateManifest(parsed);
  return parsed;
}

/** Minimal YAML subset parser for flat and single-nested manifests. */
function yamlLite(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let currentKey: string | null = null;
  const currentNested: Record<string, unknown> = {};

  for (const raw of text.split("\n")) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = raw.match(/^\s*/)?.[0].length ?? 0;
    const line = raw.trim();
    if (indent === 0) {
      const colon = line.indexOf(":");
      if (colon === -1) throw new Error(`invalid line: ${line}`);
      currentKey = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trim();
      if (value === "" || value === "|") {
        out[currentKey] = currentNested;
      } else {
        out[currentKey] = coerce(value);
      }
    } else if (currentKey) {
      const colon = line.indexOf(":");
      const key = colon === -1 ? line : line.slice(0, colon).trim();
      const rawValue = colon === -1 ? "true" : line.slice(colon + 1).trim();
      currentNested[key] = rawValue === "" || rawValue === "true" ? true : coerce(rawValue);
    }
  }
  return out;
}

function coerce(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^[-\[]/.test(value)) {
    try {
      return JSON.parse(value.replaceAll("'", '"'));
    } catch {
      return value;
    }
  }
  return value.replaceAll("'", "").replaceAll('"', "");
}
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
  if (transport.type === "docker" && !transport.image) {
    throw new ManifestValidationError("docker transport requires an image");
  }
  if (transport.type === "http" && !transport.url) {
    throw new ManifestValidationError("http transport requires a url");
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

/** Minimal YAML subset parser: flat scalars, "- " lists, indented nested objects. */
function yamlLite(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // stack of { indent, obj } map scopes we are currently inside
  const stack: Array<{ indent: number; obj: Record<string, unknown> }> = [{ indent: -1, obj: out }];
  // a `key:` line with no value: either a nested map or a list, decided on the
  // next deeper line
  let pending: { indent: number; key: string; parent: Record<string, unknown> } | null = null;

  const parentFor = (indent: number): Record<string, unknown> => {
    while (stack.length > 1 && stack[stack.length - 1]!.indent >= indent) stack.pop();
    return stack[stack.length - 1]!.obj;
  };

  for (const raw of text.split("\n")) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = raw.match(/^\s*/)?.[0].length ?? 0;
    const line = raw.trim();

    // deeper line arriving after a header: commit it as map or list
    if (pending && indent > pending.indent) {
      const { key, parent } = pending;
      if (line.startsWith("- ")) {
        const item = coerce(line.slice(2));
        const existing = parent[key];
        if (Array.isArray(existing)) existing.push(item);
        else parent[key] = [item];
        continue; // still inside the list — header stays pending
      }
      const nested: Record<string, unknown> = {};
      parent[key] = nested;
      stack.push({ indent: pending.indent, obj: nested });
      pending = null;
    } else if (pending && indent <= pending.indent) {
      pending = null; // header was an empty value
      if (line.startsWith("- ")) {
        const parent = parentFor(indent);
        throw new Error("list item must follow a key: line on its own indent");
      }
    }

    if (line.startsWith("- ")) {
      throw new Error("list item must follow a 'key:' line at a deeper indent");
    }

    const colon = line.indexOf(":");
    if (colon === -1) throw new Error(`invalid line: ${line}`);
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    const parent = parentFor(indent);

    if (value === "" || value === "|") {
      pending = { indent, key, parent };
    } else {
      parent[key] = coerce(value);
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifest, validateManifest, type ToolManifest } from "./manifest.ts";
import type { RegistryPlugin } from "../sdk/interfaces.ts";

export type RegistryEntry = ToolManifest & { addedAt: string };

export class ToolNotFoundError extends Error {}

export class ToolRegistry implements RegistryPlugin {
  private tools: Map<string, RegistryEntry>;
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
    this.tools = new Map(this.load());
  }

  static default(homeDir: string): ToolRegistry {
    if (!existsSync(homeDir)) mkdirSync(homeDir, { recursive: true });
    return new ToolRegistry(join(homeDir, "registry.json"));
  }

  private load(): Array<[string, RegistryEntry]> {
    if (!existsSync(this.file)) return [];
    try {
      const data = JSON.parse(readFileSync(this.file, "utf8")) as RegistryEntry[];
      return data.map((entry) => [entry.name, entry]);
    } catch {
      return [];
    }
  }

  private persist(): void {
    const dir = this.file.replace(/[^/]+$/, "");
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.file, JSON.stringify([...this.tools.values()], null, 2));
  }

  list(): RegistryEntry[] {
    return [...this.tools.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): RegistryEntry | undefined {
    return this.tools.get(name);
  }

  add(manifest: string | ToolManifest): RegistryEntry {
    const parsed = typeof manifest === "string" ? parseManifest(manifest) : manifest;
    validateManifest(parsed);
    if (this.tools.has(parsed.name)) {
      throw new Error(`tool "${parsed.name}" already registered`);
    }
    const entry: RegistryEntry = { ...parsed, addedAt: new Date().toISOString() };
    this.tools.set(parsed.name, entry);
    this.persist();
    return entry;
  }

  update(manifest: string | ToolManifest): RegistryEntry {
    const parsed = typeof manifest === "string" ? parseManifest(manifest) : manifest;
    validateManifest(parsed);
    if (!this.tools.has(parsed.name)) {
      throw new ToolNotFoundError(`tool "${parsed.name}" is not registered`);
    }
    const entry: RegistryEntry = { ...parsed, addedAt: this.tools.get(parsed.name)!.addedAt };
    this.tools.set(parsed.name, entry);
    this.persist();
    return entry;
  }

  remove(name: string): void {
    if (!this.tools.delete(name)) {
      throw new ToolNotFoundError(`tool "${name}" is not registered`);
    }
    this.persist();
  }

  setEnabled(name: string, enabled: boolean): RegistryEntry {
    const entry = this.tools.get(name);
    if (!entry) throw new ToolNotFoundError(`tool "${name}" is not registered`);
    const updated: RegistryEntry = { ...entry, enabled };
    this.tools.set(name, updated);
    this.persist();
    return updated;
  }

  enabled(): RegistryEntry[] {
    return this.list().filter((t) => t.enabled);
  }
}
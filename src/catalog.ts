// The raidcom command catalogue (spec/raidcom-catalog.json, produced by scripts/generate-catalog.mjs) and the
// model limits (spec/limits.json).
import { loadJson } from "./config.js";

/** A value that follows an option: a placeholder (<ldev#>), a literal (auto) or a choice of either. */
export interface ValueSpec {
  k: "ph" | "lit" | "choice";
  v?: string;
  alts?: { k: "ph" | "lit"; v: string }[];
  opt?: boolean;
  rep?: boolean;
}

export type Node =
  | { t: "flag"; name: string; values: ValueSpec[] }
  | { t: "seq"; items: Node[] }
  | { t: "alt"; alts: Node[] }
  | { t: "opt"; item: Node }
  | { t: "grp"; item: Node };

export interface Form {
  title: string;
  usage: string;
  ast: Node;
}

export interface FlagShape {
  /** Fewest values the option takes. */
  min: number;
  /** Most values it takes; null for "one or more" lists. */
  max: number | null;
  placeholders?: string[];
  literals?: string[];
  /** Set when the option accepts only these words. */
  enum?: string[];
}

export interface Command {
  action: string;
  object: string;
  summary: string;
  supported: string[];
  async: boolean;
  forms: Form[];
  flags: Record<string, FlagShape>;
  options: Record<string, { usage: string; summary: string; hints?: string[] }>;
  examples: { text: string; command: string }[];
}

export interface CatalogFile {
  source: string;
  generated: string;
  commands: Record<string, Command>;
}

export interface ModelLimits {
  label: string;
  aliases?: string[];
  serial: [number, number];
  ldev: [number, number];
  pool: [number, number];
  lun: [number, number];
  portColumns: string;
  portLetters: string;
  portColumnsLimited?: { cols: string; letters: string };
}

/** Actions that only read. Everything else changes the storage system or its monitoring state. */
const READ_ACTIONS = new Set(["get", "discover", "check", "send"]);
/** Actions that remove configuration or data. */
const DESTRUCTIVE_ACTIONS = new Set(["delete", "initialize", "unmap", "disconnect"]);

export const isReadOnly = (c: Command) => READ_ACTIONS.has(c.action);
export const isDestructive = (c: Command) => DESTRUCTIVE_ACTIONS.has(c.action);
export const commandName = (c: Command) => `${c.action} ${c.object}`;

export class Catalog {
  readonly commands: Map<string, Command>;
  readonly models: Map<string, ModelLimits>;
  readonly source: string;
  readonly generated: string;
  private readonly aliases = new Map<string, string>();

  constructor(catalogPath: string, limitsPath: string) {
    const file = loadJson<CatalogFile>(catalogPath, "command catalogue");
    this.source = file.source;
    this.generated = file.generated;
    this.commands = new Map(Object.entries(file.commands));
    const limits = loadJson<{ models: Record<string, ModelLimits> }>(limitsPath, "model limits");
    this.models = new Map(Object.entries(limits.models));
    for (const [id, m] of this.models) {
      this.aliases.set(squash(id), id);
      this.aliases.set(squash(m.label), id);
      for (const a of m.aliases ?? []) this.aliases.set(squash(a), id);
    }
  }

  /** "raidcom add lun", "add lun" or "lun add" → the catalogue entry. */
  find(name: string): Command | undefined {
    const words = name.trim().toLowerCase().replace(/^raidcom\s+/, "").split(/\s+/).filter(Boolean);
    if (words.length !== 2) return undefined;
    return this.commands.get(`${words[0]} ${words[1]}`) ?? this.commands.get(`${words[1]} ${words[0]}`);
  }

  /** Names close to a mistyped one, for error messages. */
  suggest(name: string, n = 4): string[] {
    // edit distance costs length × length; a name this long matches nothing anyway
    if (name.length > 64) return [];
    const words = name.trim().toLowerCase().replace(/^raidcom\s+/, "").split(/\s+/).filter(Boolean);
    const target = words.join(" ");
    const scored = [...this.commands.keys()].map((k) => {
      let score = distance(k, target);
      // sharing the object or the action with the request makes a name a better suggestion
      const [a, o] = k.split(" ");
      if (words.includes(o)) score -= 3;
      if (words.includes(a)) score -= 1;
      return { k, score };
    });
    return scored.sort((x, y) => x.score - y.score).slice(0, n).map((x) => x.k);
  }

  model(id: string | undefined): { id: string; limits: ModelLimits } | undefined {
    if (!id) return undefined;
    const key = this.aliases.get(squash(id));
    const limits = key ? this.models.get(key) : undefined;
    return key && limits ? { id: key, limits } : undefined;
  }
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Levenshtein distance. */
export function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

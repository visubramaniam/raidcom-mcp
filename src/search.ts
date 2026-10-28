// BM25 ranking over the raidcom catalogue, with a confidence signal so the model knows when to build straight
// away and when to describe candidates first.
import { type Command, commandName } from "./catalog.js";

// Field weights, applied by repeating tokens (BM25F-lite): a word in the command name says more than one in a
// long option description.
const WEIGHTS = { name: 5, summary: 3, flags: 1, optionText: 0.5, examples: 3, questions: 3 } as const;

const K1 = 1.2;
const B = 0.75;

const STOPWORDS = new Set(
  "a an and are as at be by can do does for from give how i in is it me my of on or the this to what when where which with all any please need want would like using use raidcom".split(" "),
);

// What people say vs. the words in the catalogue.
const SYNONYMS: Record<string, string[]> = {
  group: ["grp"], groups: ["grp"],
  volume: ["ldev"], volumes: ["ldev"], vol: ["ldev"], dpvol: ["ldev", "dp"], disk: ["ldev"], luns: ["lun", "ldev"],
  hostgroup: ["host_grp"], "host-group": ["host_grp"], iscsi: ["iscsi", "hba_iscsi"], target: ["host_grp", "iscsi"],
  wwn: ["hba_wwn"], wwpn: ["hba_wwn"], initiator: ["hba_wwn", "hba_iscsi"], hba: ["hba_wwn"],
  nqn: ["host_nqn"], nvme: ["nvm_subsystem", "namespace", "host_nqn"], namespace: ["namespace", "nvm_subsystem"], subsystem: ["nvm_subsystem"],
  present: ["lun"], map: ["lun"], mapping: ["lun"], unmap: ["lun"], path: ["lun", "path"], paths: ["lun", "path"],
  thin: ["dp_pool", "pool", "ldev"], dp: ["dp_pool", "pool"], hdp: ["dp_pool", "pool"], hdt: ["pool"], tiering: ["pool"],
  capacity: ["ldev", "pool"], space: ["pool"], free: ["ldev", "pool"],
  fibre: ["port"], fc: ["port"], port: ["port"], ports: ["port"],
  resize: ["extend"], expand: ["extend"], grow: ["extend", "dp_pool"], enlarge: ["extend"],
  format: ["initialize"], wipe: ["initialize"], erase: ["initialize"],
  nickname: ["ldev", "modify"], label: ["modify"], rename: ["modify", "rename"],
  asynchronous: ["command_status"], async: ["command_status"], status: ["command_status"], progress: ["command_status"], finished: ["command_status"], complete: ["command_status"], completion: ["command_status"],
  error: ["error_message", "command_status"], errors: ["error_message", "command_status"],
  lock: ["lock", "resource"], unlock: ["unlock", "resource"], locking: ["lock", "resource"],
  replication: ["copy_grp", "device_grp", "journal"], mirror: ["copy_grp"], pair: ["copy_grp", "device_grp"], ur: ["journal"], gad: ["quorum", "journal", "copy_grp"], quorum: ["quorum"],
  snapshot: ["snapshot", "snap_pool"], thinimage: ["snapshot", "snap_pool"], hti: ["snapshot", "snap_pool"],
  external: ["external_grp", "external_storage"], virtualize: ["external_grp"], virtualization: ["external_grp", "external_storage"],
  quota: ["qos_grp"], qos: ["qos_grp"], throttle: ["qos_grp", "spm_wwn"], priority: ["spm_wwn", "spm_group"],
  parity: ["parity_grp"], raid: ["parity_grp"], pg: ["parity_grp"], drive: ["drive"], drives: ["drive"], disks_: ["drive"],
  cache: ["clpr"], partition: ["clpr"], cpu: ["system"], license: ["license"], licence: ["license"],
  chap: ["chap_user"], secret: ["chap_user"], password: ["chap_user"],
  serial: ["system"], model: ["system"], firmware: ["system"], version: ["system"], info: ["system", "get"],
  inventory: ["get"], report: ["get"], audit: ["get"], list: ["get"], show: ["get"], display: ["get"], view: ["get"], find: ["get"], check: ["get"],
  remove: ["delete"], destroy: ["delete"], unregister: ["delete"], decommission: ["delete"],
  create: ["add"], make: ["add"], provision: ["add"], register: ["add"], new: ["add"], attach: ["add"],
  change: ["modify"], update: ["modify"], edit: ["modify"], set: ["modify"], enable: ["modify"], disable: ["modify"],
  block: ["modify", "ldev"], restore: ["modify", "ldev"], reclaim: ["modify", "ldev"], zero: ["modify", "ldev"],
  commanddevice: ["ldev", "modify"], "command-device": ["ldev", "modify"],
};

/** The action a request most likely wants, from its verbs. */
const ACTION_VERBS: Record<string, string[]> = {
  add: ["create", "add", "make", "provision", "register", "new", "attach", "build", "allocate", "assign", "map", "present", "expose", "give"],
  delete: ["delete", "remove", "destroy", "unregister", "decommission", "drop", "unmap", "detach", "unpresent"],
  get: ["show", "list", "display", "get", "view", "find", "which", "what", "status", "report", "inventory", "how", "many", "check", "see"],
  modify: ["change", "update", "modify", "edit", "set", "enable", "disable", "rename", "block", "restore"],
  extend: ["extend", "expand", "grow", "resize", "enlarge"],
  initialize: ["format", "initialize", "wipe", "erase", "reformat"],
  lock: ["lock"], unlock: ["unlock"],
};

/** Lower-cased words of a request. Underscores split, so `host_grp` matches "host grp". */
export function words(text: string): string[] {
  return text.toLowerCase().replace(/[_]/g, " ").split(/[^a-z0-9#-]+/).map((w) => w.replace(/^-+|-+$/g, "")).filter(Boolean);
}

const stem = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

function tokenize(text: string): string[] {
  return words(text).filter((w) => !STOPWORDS.has(w)).map(stem);
}

function intentOf(query: string): string | undefined {
  const w = words(query);
  for (const [action, verbs] of Object.entries(ACTION_VERBS)) if (w.some((x) => verbs.includes(x))) return action;
  return undefined;
}

interface Doc {
  command: Command;
  name: string;
  tf: Map<string, number>;
  len: number;
}

export interface Hit {
  command: Command;
  name: string;
  score: number;
  matched: string[];
}

export interface SearchResult {
  hits: Hit[];
  confidence: "high" | "medium" | "low";
  reason: string;
}

export class CommandIndex {
  private docs: Doc[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;

  constructor(commands: Iterable<Command>, questions: Record<string, string[]> = {}) {
    for (const command of commands) {
      const name = commandName(command);
      const tf = new Map<string, number>();
      const add = (text: string, weight: number) => {
        for (const t of tokenize(text)) tf.set(t, (tf.get(t) ?? 0) + weight);
      };
      add(name, WEIGHTS.name);
      add(command.object, WEIGHTS.name);
      add(command.summary, WEIGHTS.summary);
      add(Object.keys(command.flags).join(" "), WEIGHTS.flags);
      add(Object.values(command.options).map((o) => o.summary).join(" "), WEIGHTS.optionText);
      add(command.examples.map((e) => e.text).join(" "), WEIGHTS.examples);
      add((questions[name] ?? []).join(" "), WEIGHTS.questions);
      const len = [...tf.values()].reduce((a, b) => a + b, 0);
      this.docs.push({ command, name, tf, len });
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.avgLen = this.docs.reduce((a, d) => a + d.len, 0) / Math.max(this.docs.length, 1);
  }

  /** Query terms with synonyms added at half weight. */
  private terms(query: string): Map<string, number> {
    const out = new Map<string, number>();
    for (const w of words(query)) {
      if (STOPWORDS.has(w)) continue;
      out.set(stem(w), Math.max(out.get(stem(w)) ?? 0, 1));
      for (const s of Object.hasOwn(SYNONYMS, w) ? SYNONYMS[w] : []) for (const t of tokenize(s)) out.set(t, Math.max(out.get(t) ?? 0, 0.5));
    }
    return out;
  }

  search(query: string, opts: { limit?: number; action?: string; object?: string } = {}): SearchResult {
    const terms = this.terms(query);
    const intent = intentOf(query);
    const N = this.docs.length;
    const hits: Hit[] = [];
    for (const d of this.docs) {
      if (opts.action && d.command.action !== opts.action) continue;
      if (opts.object && d.command.object !== opts.object) continue;
      let score = 0;
      const matched: string[] = [];
      for (const [t, w] of terms) {
        const f = d.tf.get(t);
        if (!f) continue;
        const df = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        score += w * idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / this.avgLen)));
        matched.push(t);
      }
      if (score <= 0) continue;
      // The verb in the request decides between `add lun` and `get lun`.
      if (intent) score *= d.command.action === intent ? 1.35 : 0.8;
      hits.push({ command: d.command, name: d.name, score, matched });
    }
    hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const limit = opts.limit ?? 10;
    const top = hits[0];
    const second = hits[1];
    let confidence: SearchResult["confidence"] = "low";
    let reason = "no command matched";
    if (top) {
      const lead = second ? top.score / second.score : 10;
      const coverage = [...terms.entries()].filter(([, w]) => w === 1).filter(([t]) => top.matched.includes(t)).length / Math.max([...terms.values()].filter((w) => w === 1).length, 1);
      if (lead >= 1.25 && coverage >= 0.6) { confidence = "high"; reason = `the top result leads the next by ${lead.toFixed(2)}x and matches most of the request's words`; }
      // a tie at the top is never better than low, however many words matched
      else if (lead >= 1.1) { confidence = "medium"; reason = `the top result leads by ${lead.toFixed(2)}x and matches ${(coverage * 100).toFixed(0)}% of the request's words`; }
      else reason = `the top results are close (${lead.toFixed(2)}x) and match ${(coverage * 100).toFixed(0)}% of the request's words`;
    }
    return { hits: hits.slice(0, limit), confidence, reason };
  }
}

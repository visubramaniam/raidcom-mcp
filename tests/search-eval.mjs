// Offline evaluation of command search. Run after `npm run build`:  node tests/search-eval.mjs
// Scores the tuning set and the held-out set, and exits with an error if a score falls below its regression
// threshold. Raise the thresholds when search improves; never lower them to make a change pass.
//   EXAMPLES=0  measure plain BM25 without the example questions (thresholds not checked)
import { readFileSync } from "node:fs";
import { Catalog } from "../dist/catalog.js";
import { CommandIndex } from "../dist/search.js";
import { TUNING, HELD_OUT } from "./cases.mjs";

const THRESHOLDS = {
  "Tuning set": { top1: 32, top3: 38 },
  "Held-out set": { top1: 21, top3: 26 },
};

const catalog = new Catalog(new URL("../spec/raidcom-catalog.json", import.meta.url).pathname, new URL("../spec/limits.json", import.meta.url).pathname);
for (const [, want] of [...TUNING, ...HELD_OUT]) for (const id of want) if (!catalog.commands.has(id)) throw new Error(`Unknown expected command ${id}`);
const examples = JSON.parse(readFileSync(new URL("../spec/examples.json", import.meta.url), "utf8"));
for (const id of Object.keys(examples)) if (!id.startsWith("_") && !catalog.commands.has(id)) throw new Error(`Unknown example key ${id}`);
const index = new CommandIndex(catalog.commands.values(), process.env.EXAMPLES === "0" ? {} : examples);
const checking = process.env.EXAMPLES !== "0";
const failures = [];
// How often the top result is right when search says its confidence is high, over both sets. The model builds
// straight away on a high-confidence result, so this must stay high.
const MIN_HIGH_PRECISION = 0.85;
const high = { n: 0, right: 0 };

function evaluate(label, cases) {
  const rankOf = (list, want) => { const i = list.findIndex((id) => want.includes(id)); return i < 0 ? Infinity : i + 1; };
  const s = { top1: 0, top3: 0, mrr: 0 };
  const misses = [];
  for (const [q, want] of cases) {
    const r = index.search(q, { limit: 10 });
    const rank = rankOf(r.hits.map((h) => h.name), want);
    if (rank === 1) s.top1++;
    if (r.confidence === "high") {
      high.n++;
      if (rank === 1) high.right++;
    }
    if (rank <= 3) s.top3++;
    if (rank < Infinity) s.mrr += 1 / rank;
    if (rank > 1) misses.push(`  #${rank === Infinity ? "-" : rank}  ${q}  (want ${want.join(" | ")}; got ${r.hits.slice(0, 3).map((h) => h.name).join(", ")})`);
  }
  console.log(`${label}: ${cases.length} requests, top1 ${s.top1}, top3 ${s.top3}, MRR ${(s.mrr / cases.length).toFixed(3)}`);
  if (process.env.VERBOSE) misses.forEach((m) => console.log(m));
  const t = THRESHOLDS[label];
  if (checking && t) {
    if (s.top1 < t.top1) failures.push(`${label}: top1 ${s.top1} < ${t.top1}`);
    if (s.top3 < t.top3) failures.push(`${label}: top3 ${s.top3} < ${t.top3}`);
  }
}

evaluate("Tuning set", TUNING);
evaluate("Held-out set", HELD_OUT);
const precision = high.n ? high.right / high.n : 1;
console.log(`High confidence: right ${high.right} of ${high.n} (${(precision * 100).toFixed(0)}%)`);
if (checking && precision < MIN_HIGH_PRECISION) failures.push(`high-confidence precision ${precision.toFixed(2)} < ${MIN_HIGH_PRECISION}`);
if (failures.length) {
  console.error(`Search regression:\n${failures.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}

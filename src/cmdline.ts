// Parses a raidcom command line someone already has into a BuildRequest, so it can be checked and explained
// with the same rules the builder uses. Nothing is executed and nothing is passed to a shell: the text is split
// into words here, and anything that would make a shell do more than run raidcom is rejected.
import type { Catalog } from "./catalog.js";
import type { BuildRequest, GlobalOptions, OptionValue } from "./builder.js";

export interface ParsedLine {
  request?: BuildRequest;
  errors: string[];
  warnings: string[];
}

/** Splits on whitespace, honouring single and double quotes. Returns undefined for unbalanced quotes. */
export function splitWords(line: string): string[] | undefined {
  const words: string[] = [];
  let cur = "";
  let started = false;
  let quote: string | null = null;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started || cur) words.push(cur);
      cur = "";
      started = false;
    } else {
      cur += ch;
      started = true;
    }
  }
  if (quote) return undefined;
  if (started || cur) words.push(cur);
  return words;
}

const instanceFlag = /^-I(H|M|TC|SI)?(\d+)?$/;

export function parseCommandLine(catalog: Catalog, line: string): ParsedLine {
  const errors: string[] = [];
  const warnings: string[] = [];
  let text = line.trim().replace(/^(\$|#)\s*/, "");
  // Several lines are a script, not one command. A trailing backslash continues a command onto the next line.
  text = text.replace(/\\\r?\n\s*/g, " ");
  if (/\r|\n/.test(text)) return { errors: ["Pass one raidcom command at a time (found several lines)."], warnings };
  // Outside quotes, these let a shell run something other than raidcom.
  const outside = text.replace(/'[^']*'|"[^"]*"/g, "");
  if (/[;|&<>`]|\$\(|\$\{/.test(outside)) {
    return { errors: ["The command contains a shell operator (; | & < > ` or $( ). Only a plain raidcom command can be checked."], warnings };
  }
  const words = splitWords(text);
  if (!words) return { errors: ["The command has an unclosed quote."], warnings };
  if (words[0] !== "raidcom") return { errors: [`The command must start with "raidcom", not "${words[0] ?? ""}".`], warnings };
  if (words.length < 3 || words[1].startsWith("-") || words[2].startsWith("-")) {
    return { errors: ["Expected `raidcom <action> <object> ...`, for example `raidcom get ldev -ldev_id 100`. Login, logout and script (-zt) forms are not part of the catalogue."], warnings };
  }
  const cmd = catalog.find(`${words[1]} ${words[2]}`);
  if (!cmd) return { errors: [`Unknown raidcom command "${words[1]} ${words[2]}". Closest: ${catalog.suggest(`${words[1]} ${words[2]}`).join(", ")}.`], warnings };

  const options: Record<string, OptionValue> = Object.create(null);
  const global: GlobalOptions = {};
  const rest = words.slice(3);
  for (let i = 0; i < rest.length; ) {
    const w = rest[i];
    if (!/^-[A-Za-z]/.test(w)) {
      errors.push(`Unexpected "${w}": a value must follow the option it belongs to. ${i === 0 ? "" : `(After ${rest[i - 1]}.)`}`.trim());
      i++;
      continue;
    }
    // Options of the command win over global options of the same name.
    const own = cmd.flags[w] ?? Object.entries(cmd.flags).find(([k]) => k.toLowerCase() === w.toLowerCase())?.[1];
    if (!own) {
      const mi = instanceFlag.exec(w);
      if (mi) {
        if (mi[2] === undefined) errors.push(`${w} needs an instance number, for example -I0 or -IH0.`);
        else global.instance = Number(mi[2]);
        if (mi[1]) global.pair_type = mi[1] as GlobalOptions["pair_type"];
        i++;
        continue;
      }
      const next = rest[i + 1];
      const hasValue = next !== undefined && !/^-[A-Za-z]/.test(next);
      if (w === "-s" && hasValue) { global.serial = next; i += 2; continue; }
      if (w === "-u" && hasValue) { global.unit = Number(next); i += 2; continue; }
      if (w === "-fx") { global.fx = true; i++; continue; }
      if (w === "-nomsg") { global.nomsg = true; i++; continue; }
      if (w === "-checkmode" && hasValue) { global.checkmode = next as "precheck"; i += 2; continue; }
      if (w === "-store" && hasValue) { global.store = next; i += 2; continue; }
      if (w === "-login") {
        warnings.push("-login and its user name and password were left out; run raidcom -login separately so credentials stay out of command text.");
        // exactly the two words after -login are the user name and password, whatever they look like
        i += 3;
        continue;
      }
      if (w === "-logout") { warnings.push("-logout was left out."); i++; continue; }
    }
    // collect the values that follow
    const max = own ? own.max : null;
    const values: string[] = [];
    let j = i + 1;
    while (j < rest.length && !/^-[A-Za-z]/.test(rest[j]) && (max === null || values.length < max)) values.push(rest[j++]);
    if (Object.hasOwn(options, w)) warnings.push(`${w} was given twice; the last value is used`);
    options[w] = values.length ? values : true;
    i = j;
  }
  return { request: { command: `${cmd.action} ${cmd.object}`, options, global }, errors, warnings };
}

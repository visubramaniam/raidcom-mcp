#!/usr/bin/env node
// Builds the release artefacts into release/: the npm package (.tgz) and SHA256SUMS. The package is smoke-tested
// by tests/smoke/package-smoke.mjs before it is attached to a release or published.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "release");
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
execFileSync("npm", ["pack", "--pack-destination", out, "--silent"], { cwd: root, stdio: ["ignore", "inherit", "inherit"] });
const sums = readdirSync(out)
  .filter((f) => f.endsWith(".tgz"))
  .map((f) => `${createHash("sha256").update(readFileSync(join(out, f))).digest("hex")}  ${f}`);
writeFileSync(join(out, "SHA256SUMS"), sums.join("\n") + "\n");
console.log(sums.join("\n"));

#!/usr/bin/env node
// Renames the starter to your project, once, right after "Use this template".
//
//   node scripts/rename.mjs --name acme-billing --title "Acme Billing" --module github.com/acme/acme-billing
//
// --name    kebab-case project name: package name, image names (<name>-api,
//           <name>-web), JWT audience, OpenTelemetry service names, and the
//           local database user, password and name (dashes become underscores).
// --title   what people read in the UI, the emails and the API docs.
// --module  Go module path of the repository (the API's module is <module>/apps/api).
//
// Afterwards: `make setup && make generate && make test lint`, then commit.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { name: { type: "string" }, title: { type: "string" }, module: { type: "string" } },
});
const { name, title, module: modulePath } = values;

if (!name || !title || !modulePath) {
  console.error('Usage: node scripts/rename.mjs --name my-app --title "My App" --module github.com/me/my-app');
  process.exit(1);
}
if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
  console.error(`--name must be kebab-case (letters, digits, dashes), got "${name}"`);
  process.exit(1);
}
if (!/^[\w.-]+(\/[\w.-]+)+$/.test(modulePath)) {
  console.error(`--module must look like github.com/owner/repo, got "${modulePath}"`);
  process.exit(1);
}

const database = name.replaceAll("-", "_");

// Most specific first. The database rules match whole constructs, because
// "starter" is also an ordinary word in the docs.
const RULES = [
  [/github\.com\/gersongams\/fullstack-starter/g, modulePath],
  [/gersongams\/fullstack-starter/g, modulePath.split("/").slice(-2).join("/")],
  [/fullstack-starter/g, name],
  [/Fullstack Starter/g, title],
  [/starter-(api|web)/g, `${name}-$1`],
  [/postgres:\/\/starter:starter@([^/\s]+)\/starter/g, `postgres://${database}:${database}@$1/${database}`],
  [/POSTGRES_(USER|PASSWORD|DB): starter\b/g, `POSTGRES_$1: ${database}`],
  [/-U starter -d starter\b/g, `-U ${database} -d ${database}`],
  [/all set to `starter`/g, `all set to \`${database}\``],
];

const SKIP_DIRS = new Set([".git", "node_modules", ".next", ".turbo", "bin", "test-results", "playwright-report"]);
const SKIP_FILES = new Set(["pnpm-lock.yaml", "rename.mjs"]);

let changed = 0;
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(path);
      continue;
    }
    if (SKIP_FILES.has(entry)) continue;
    const buffer = readFileSync(path);
    if (buffer.includes(0)) continue; // binary
    const before = buffer.toString("utf8");
    let after = before;
    for (const [pattern, replacement] of RULES) after = after.replace(pattern, replacement);
    if (after !== before) {
      writeFileSync(path, after);
      changed += 1;
    }
  }
}
walk(".");

console.log(`Renamed to ${name} ("${title}", ${modulePath}) in ${changed} files.`);
console.log("Next: make setup && make generate && make test lint, then commit.");
console.log("Generated files (openapi/, apps/web/src/lib/api/gen, apps/api/internal/db/dbgen) are refreshed by make generate.");

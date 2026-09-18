// CODEMOD (v0.17): replace serverError( → apiError( across all API routes
// so auth errors map to 401/403 instead of 500. apiError is behavior-identical
// to serverError for non-auth failures.

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "src/app/api");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

let changedFiles = 0;
let replacements = 0;
for (const file of walk(ROOT)) {
  const src = readFileSync(file, "utf8");
  if (!src.includes("serverError")) continue;
  const next = src.replace(/\bserverError\b/g, "apiError");
  if (next !== src) {
    writeFileSync(file, next);
    changedFiles++;
    replacements += (src.match(/\bserverError\b/g) ?? []).length;
  }
}
console.log(`codemod: ${changedFiles} files, ${replacements} replacements`);

// Audits src/ for literal className="..." strings that repeat verbatim
// across the codebase — a signal (not proof) that something should be a
// shared component or a constant in src/lib/*Styles.ts, the pattern this
// app already uses for STICKY_THEAD_CLASSNAME/TEXT_INPUT_CLASSNAME/etc.
//
// This is a manual dev tool, not a CI check: a high count doesn't
// automatically mean "extract it" (e.g. "flex-1" alone repeats constantly
// and means nothing — see README below), so results need a human read
// before acting on them. Run after a UI-heavy feature lands, or whenever
// you suspect copy-paste has crept back in:
//
//   node scripts/find-duplicate-classnames.mjs
//   node scripts/find-duplicate-classnames.mjs 5      # only show 5+ occurrences
//
// What to actually do with the output: for each string near the top,
// check how many DISTINCT files it spans (a repeat within one file is a
// much weaker signal than the same string in 5 unrelated files), then
// look at a couple of call sites — is this one real design decision
// (a card look, a button style, a status badge) or just a handful of
// generic Tailwind utilities that happen to coincide? Only the former is
// worth a shared component/constant.
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const MIN_OCCURRENCES = Number(process.argv[2]) >= 1 ? Number(process.argv[2]) : 3;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk("src");
const counts = new Map(); // exact className string -> { total, files: string[] }

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const re = /className="([^"]+)"/g;
  const perFile = new Map();
  let match;
  while ((match = re.exec(text))) {
    const cls = match[1].trim();
    if (!cls) continue;
    perFile.set(cls, (perFile.get(cls) ?? 0) + 1);
  }
  for (const [cls, n] of perFile) {
    if (!counts.has(cls)) counts.set(cls, { total: 0, files: [] });
    const entry = counts.get(cls);
    entry.total += n;
    entry.files.push(`${file.replace(/\\/g, "/")}${n > 1 ? ` (x${n})` : ""}`);
  }
}

const results = [...counts.entries()]
  .filter(([, v]) => v.total >= MIN_OCCURRENCES)
  .sort((a, b) => b[1].total - a[1].total || b[0].length - a[0].length);

for (const [cls, v] of results) {
  console.log(`\n[${v.total}x, ${v.files.length} files] ${cls}`);
  for (const f of v.files) console.log(`    ${f}`);
}
console.log(`\n\n${results.length} distinct className strings with ${MIN_OCCURRENCES}+ occurrences.`);

// How the app's version number is worked out (user decision, 2026-09-27):
// "MAJOR.PR" — MAJOR is the first number of package.json's "version" (only
// ever changed by hand, for 2.0 etc.), PR is the number of the GitHub pull
// request the build comes from: the newest "Merge pull request #N" commit in
// its history. Every merge into main or production is such a commit, so
// staging shows the last PR merged into main and production shows its
// promotion PR — numbers skip, but each one points straight at a PR.
//
// Pure functions only: vite.config.ts calls this at build time (with git's
// commit subjects) and bakes the result into the bundle; see appVersion.ts
// for how it's displayed.

/** Matches GitHub's merge-commit subject, "Merge pull request #103 from owner/branch". */
const MERGE_SUBJECT = /^Merge pull request #(\d+)\b/;

/** The PR number of the first (newest) merge-commit subject in `subjects`, or null if there's none. */
export function latestMergedPr(subjects: string[]): number | null {
  for (const subject of subjects) {
    const match = MERGE_SUBJECT.exec(subject.trim());
    if (match) return Number(match[1]);
  }
  return null;
}

/**
 * "1.103" from package.json's "1.0.0" and the newest merged PR #103. Without
 * any merge commit (no git history available) it's just the major number,
 * e.g. "1".
 */
export function versionNumber(packageVersion: string, subjects: string[]): string {
  const major = packageVersion.split(".")[0] || "0";
  const pr = latestMergedPr(subjects);
  return pr === null ? major : `${major}.${pr}`;
}

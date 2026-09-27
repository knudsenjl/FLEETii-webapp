// The app's version as shown on /about (2026-09-27): "MAJOR.PR", e.g.
// "1.103" — see versionNumber.ts for how it's worked out. The values are
// baked in at build time by vite.config.ts's `define` (version, commit,
// build moment); this module only formats them for display.
import { formatDanishDate, utcToDanishParts } from "./time";

/** The first 7 characters of a commit hash (git's usual short form), or "" if unknown. */
export function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}

/** True unless VITE_DATA_SOURCE is explicitly the production adaptor — the same "anything else is the test default" convention as TestCenterPage.tsx. */
const isTestEnvironment = import.meta.env.VITE_DATA_SOURCE !== "2hire-production-adaptor";

/** Everything /about shows about this build. */
export const APP_VERSION_INFO = {
  /** e.g. "1.103". */
  version: __APP_VERSION__,
  /** e.g. "a4daa28", or "" when the build had no commit information. */
  commit: shortCommit(__APP_COMMIT__),
  /** The build's Danish calendar date, e.g. "27.09.2026". */
  builtOn: formatDanishDate(utcToDanishParts(__APP_BUILT_AT__).date),
  isTestEnvironment,
};

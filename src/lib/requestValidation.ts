// Tiny, dependency-free helper for validating untrusted JSON request bodies
// in the Netlify Functions (see netlify/functions/*.mts). Netlify Functions
// import this via an explicit ".js" specifier (requestValidation.js) even
// though the source is .ts — that's the standard TypeScript/Node16-ESM
// convention for importing a .ts file's compiled output, and lets the
// functions be typechecked under tsconfig.functions.json.

/**
 * Returns the trimmed string, or undefined if the value isn't a string at
 * all. Use this instead of `value?.trim()` on anything parsed from a request
 * body — a malicious or malformed request can send any JSON type for a field
 * the server expects to be a string, and calling .trim() on a number/object/
 * array throws instead of failing validation cleanly.
 */
export function asTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

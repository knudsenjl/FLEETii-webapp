/** Returns the trimmed string, or undefined if the value isn't a string at all (wrong JSON type or missing). */
export function asTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

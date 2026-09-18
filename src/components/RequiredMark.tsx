/** The red "*" marker next to a required field's label — previously
 * hand-copied across 10 call sites (RequiredFieldRow.tsx has its own
 * identical inline copy too, kept as-is since it's the actual source of
 * this convention). */
export function RequiredMark() {
  return <span className="ml-0.5 text-red-600">*</span>;
}

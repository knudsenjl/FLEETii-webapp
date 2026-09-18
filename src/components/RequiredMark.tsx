/** The red "*" marker next to a required field's label — previously
 * hand-copied across 10 call sites, plus RequiredFieldRow.tsx's own
 * identical inline copy. */
export function RequiredMark() {
  return <span className="ml-0.5 text-red-600">*</span>;
}

/** A full-screen invisible layer that closes an open popover/menu when
 * clicked outside it — previously hand-copied across 7 call sites (plus
 * FieldInfoButton.tsx's own identical inline copy, kept as-is since it's
 * the source of that specific combo). */
export function ClickOutsideOverlay({ onClick }: { onClick: () => void }) {
  return <div className="fixed inset-0 z-10" onClick={onClick} />;
}

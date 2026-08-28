// Small green circle badge for the bottom-right corner of a square grid
// button (AdminFrontpage.tsx / CostumerDetailsPage.tsx's AFDELINGER/
// KØRETØJER/BRUGERE buttons), showing how many rows the button's own table
// holds for the costumer in scope. Parent needs `relative` positioning.
// Renders nothing while count is still null (still loading) — unlike the
// red "pending installations" badge elsewhere, this one has nothing to
// hide at zero, so a genuine 0 is shown just like any other count.
export function CountBadge({ count }: { count: number | null }) {
  if (count === null) return null;

  return (
    <span className="absolute bottom-1 right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-green-600 px-1 text-xs font-semibold text-white">
      {count}
    </span>
  );
}

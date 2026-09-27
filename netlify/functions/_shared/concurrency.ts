// A small "at most N at a time" map for Functions that do one slow thing per
// item: the bulk imports (auth user + profile + welcome e-mail per row) and
// the 2hire signal backfill. One-at-a-time made a few dozen import rows run
// past Netlify's Function time limit; everything-at-once would hammer SMTP
// and 2hire. Results keep the input order, so row numbers still match.

/**
 * Runs `worker` over `items` with at most `concurrency` calls in flight and
 * returns the results in input order. A worker that throws rejects the whole
 * call — workers that must not abort the batch should catch their own errors.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lane = async () => {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, lane));
  return results;
}

/** Full-page "not loaded yet" placeholder — shown while a detail page's own
 * record (booking/customer/user/vehicle/order) is still being fetched. */
export function PageLoading({ label }: { label: string }) {
  return <div className="flex h-svh items-center justify-center bg-brand-50 text-brand-600">{label}</div>;
}

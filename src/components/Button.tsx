import type { ButtonHTMLAttributes } from "react";

/** Visual treatment: "secondary" is the app's default outline action button
 * (bordered, brand-tinted); "danger" is the red destructive-action look. */
type ButtonVariant = "secondary" | "danger";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  secondary: "border border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100",
  danger: "border-2 border-red-600 bg-white text-red-600 hover:bg-red-50",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** The rounded-full/text-xs/min-h-11 mobile button shape used in a couple
   * of booking-flow screens, as opposed to the default rounded-lg/text-sm
   * shape. Kept as a prop (not a `className` override) because Tailwind
   * utilities of equal specificity don't reliably override each other by
   * source order, so "rounded-lg" from the base classes could win over a
   * caller's "rounded-full" depending on generated CSS order. */
  pill?: boolean;
}

/** Shared action button. Centralizes the outline ("secondary") and
 * destructive ("danger") button looks that were previously hand-copied
 * across ~70 call sites — pass layout-only classes (`w-full`, `flex-1`,
 * `flex items-center justify-center gap-2`, etc.) via `className`; they
 * don't collide with anything the variant/shape classes set, so plain
 * concatenation is safe. */
export function Button({ variant = "secondary", pill = false, className = "", ...props }: ButtonProps) {
  const shape = pill ? "min-h-11 rounded-full text-xs" : "rounded-lg px-2 py-1.5 text-sm";
  return (
    <button
      className={`${shape} font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`.trim()}
      {...props}
    />
  );
}

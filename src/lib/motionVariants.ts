/** Standard page-entry animation (fade in while sliding up slightly) shared
 * by every page shell's motion.main plus a few standalone motion elements —
 * spread directly onto a motion.* component: `<motion.main {...fadeInUp}>`. */
export const fadeInUp = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as const },
};

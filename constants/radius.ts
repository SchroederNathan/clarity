/**
 * Corner radii. The app had six different card radii (26, 28, 30, 32, 36, 42)
 * doing the same job; this collapses them to two — `lg` for a compact card and
 * `xl` for a hero card — so corners across a screen match.
 *
 * Pair every non-capsule radius with `borderCurve: 'continuous'`.
 *
 * Use `full` for anything circular (avatars, circle buttons, pills) instead of
 * half the element's height: a hardcoded half breaks silently when the size
 * changes.
 */
export const radius = {
  /** Chips, focus pills, thin bars. */
  xs: 6,
  /** Text inputs, small tiles. */
  sm: 12,
  /** Icon beds and square tiles. */
  md: 20,
  /** Compact cards: counters, drills, rows, notices. */
  lg: 28,
  /** Hero cards: speaking score, daily goal, skill detail. */
  xl: 36,
  /** Capsules and circles. */
  full: 9999,
} as const;

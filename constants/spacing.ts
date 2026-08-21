/**
 * The one spacing scale, on a 4-point grid. Every padding, margin, and gap in
 * the app comes from here.
 *
 * `md` (12) and `xl` (20) are named steps rather than "between" values because
 * the app leans on both heavily — 12 for row internals, 20 for card padding.
 *
 * Rules:
 *   - Prefer `gap` over margins so a container owns its own rhythm.
 *   - Screen edge padding is `spacing.lg`. Pick one and keep it.
 *   - A layout that wants a value between steps uses the nearest step. The grid
 *     is the point. Genuine optical nudges (centering a glyph in its bed) may
 *     stay inline with a comment saying why.
 */
export const spacing = {
  /** Hairline: a value and its unit, an icon and its label. */
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  /** Screen edge padding, and the default gap between cards. */
  lg: 16,
  /** Padding inside a card. */
  xl: 20,
  xxl: 24,
  xxxl: 32,
  xxxxl: 48,
} as const;

/** Bottom padding on a scroll view so content clears the floating tab bar.
 * Not a spacing step: it is the tab bar's height plus breathing room. */
export const TAB_BAR_SCROLL_INSET = 140;

/**
 * The design system's single entry point. Import tokens from here, not from the
 * individual files:
 *
 *   import { colors, spacing, type, radius } from '@/constants/theme';
 *
 * Components import tokens; screens import components. A screen reaching for
 * `spacing` to lay out its own children is fine; a screen defining a button
 * color is drift — that value belongs in `colors` or in the component.
 *
 * This module is pure (no React), so `lib/` and the bun test scripts can import
 * it. To resolve colors for the current scheme, use `useTheme()` from
 * `@/hooks/use-theme`.
 *
 * There is deliberately no `shadows` token set: the app's depth comes from
 * liquid glass, and it uses no shadows anywhere. Adding an unused elevation
 * scale would be an abstraction nothing adopts.
 */

export { colors, type ColorSchemeName, type ThemeColors } from './colors';
export { fontAssets, fonts } from './fonts';
export { motion, springs } from './motion';
export { radius } from './radius';
export { spacing, TAB_BAR_SCROLL_INSET } from './spacing';
export { type, type TypeVariant } from './typography';

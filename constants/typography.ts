/**
 * The type ramp. Named steps, mirroring the Apple text-style sizes so the app
 * feels native, rendered in SF Pro Rounded.
 *
 * Each step carries a size, a default face, and its optical tracking. Nothing
 * carries color: `colors` is keyed by scheme and resolves at render time, so a
 * static style object can't hold ink. Components apply color from `useTheme()`.
 *
 * Weight comes from `fontFamily`, never `fontWeight` — each SF Pro Rounded file
 * is a single face, and pairing one with a mismatched `fontWeight` makes iOS
 * synthesize the weight or fall back to the system font.
 *
 * Render these through `<ThemedText variant="..." />` so screens never touch
 * `fontSize`. Pass `weight` to override the default face at the same size.
 *
 * `lineHeight` is set only on the `prose` steps. Multi-line copy needs it; a
 * single-line label doesn't, and setting it there shifts the text in its box.
 */

import type { TextStyle } from 'react-native';

import { fonts } from './fonts';

export const type = {
  /** Screen-level heading outside a navigation header. */
  largeTitle: { fontSize: 34, fontFamily: fonts.bold, letterSpacing: -0.5 },
  /** Section hero, and the big number in a results header. */
  title: { fontSize: 22, fontFamily: fonts.bold, letterSpacing: -0.3 },
  title3: { fontSize: 20, fontFamily: fonts.semibold, letterSpacing: -0.3 },
  /** The default for anything that names something: card titles, row labels. */
  headline: { fontSize: 17, fontFamily: fonts.semibold, letterSpacing: -0.2 },
  body: { fontSize: 17, fontFamily: fonts.regular },
  callout: { fontSize: 16, fontFamily: fonts.semibold, letterSpacing: -0.2 },
  subhead: { fontSize: 15, fontFamily: fonts.semibold },
  /** Captions, units, meta rows. The most-used step in the app. */
  footnote: { fontSize: 13, fontFamily: fonts.medium },
  caption: { fontSize: 12, fontFamily: fonts.medium },
  /** All-caps label above a value. Tracking is wide because it is uppercase. */
  eyebrow: { fontSize: 12, fontFamily: fonts.bold, letterSpacing: 1 },
  /** Smallest readable step: day letters, tiny pills. */
  micro: { fontSize: 10, fontFamily: fonts.semibold, letterSpacing: 0.5 },

  /** A counter card's hero number. Heavier and larger than `title` because it
   * is the whole point of its card; the label beside it is the caption. */
  displayValue: { fontSize: 26, fontFamily: fonts.heavy, letterSpacing: -0.5 },

  // --- Prose: multi-line copy, so these carry leading ---
  bodyProse: { fontSize: 17, fontFamily: fonts.regular, lineHeight: 24 },
  subheadProse: { fontSize: 15, fontFamily: fonts.regular, lineHeight: 21 },
  footnoteProse: { fontSize: 13, fontFamily: fonts.regular, lineHeight: 19 },
} as const satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;

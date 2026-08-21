/**
 * The accents a reader can be graded against.
 *
 * This is not a cosmetic setting. Azure grades pronunciation against a reference
 * accent, and the wrong one is scored as an error: the same British reading of
 * the same sentence measured 80 accuracy against `en-US` and 100 against
 * `en-GB`. A user with a non-American accent was losing twenty points to the
 * default.
 *
 * The list is short on purpose. Every locale here was measured against the live
 * short-audio endpoint and behaves distinctly. Eight further English locales
 * (`en-IE`, `en-NZ`, `en-ZA`, `en-SG`, `en-PH`, `en-HK`, `en-NG`, `en-KE`)
 * returned byte-identical scores to each other across two different speakers,
 * so they appear to share one fallback model and are left out rather than
 * offered as five distinct choices that do the same thing.
 *
 * PURE module — no React. Safe under bun.
 */

import type { AccentLocale } from '@/types/settings';

export type Accent = {
  locale: AccentLocale;
  /** What the user calls their accent, not the locale code. */
  label: string;
  /** Country or region, for the row's secondary line. */
  region: string;
};

/**
 * `en-US` is first and is the default. Beyond fair scoring it is also the ONLY
 * locale that returns phoneme SYMBOLS: every other English locale returns the
 * phoneme tier with scores but empty symbol strings, under both the IPA and SAPI
 * alphabets. Syllable scores survive everywhere because the grapheme is always
 * present. `PHONEME_DETAIL_LOCALES` is what the UI reads to say so out loud
 * rather than letting the feature quietly disappear.
 */
export const ACCENTS: readonly Accent[] = [
  { locale: 'en-US', label: 'American', region: 'United States' },
  { locale: 'en-GB', label: 'British', region: 'United Kingdom' },
  { locale: 'en-AU', label: 'Australian', region: 'Australia' },
  { locale: 'en-CA', label: 'Canadian', region: 'Canada' },
  { locale: 'en-IN', label: 'Indian', region: 'India' },
] as const;

export const DEFAULT_ACCENT: AccentLocale = 'en-US';

/** Locales that return per-sound (phoneme) symbols, measured, not assumed. */
export const PHONEME_DETAIL_LOCALES: readonly AccentLocale[] = ['en-US'] as const;

export function hasPhonemeDetail(locale: AccentLocale): boolean {
  return PHONEME_DETAIL_LOCALES.includes(locale);
}

export function accentFor(locale: AccentLocale): Accent {
  return ACCENTS.find((accent) => accent.locale === locale) ?? ACCENTS[0];
}

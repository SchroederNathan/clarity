/**
 * Every color in the app, keyed by color scheme. One map, no exceptions — if a
 * screen or component needs a color, it names one of these tokens.
 *
 * Read it through `useTheme()` (`hooks/use-theme.ts`) rather than indexing by
 * scheme at each call site. This module stays pure (no React) so token files,
 * `lib/`, and the bun test scripts can import it.
 *
 * Groups, in the order a screen is built:
 *   surfaces  — what sits behind content (background, card, glass)
 *   fills     — tinted beds inside a surface (icon tiles, chips, circle buttons)
 *   inverse   — the near-black button/badge that flips in dark mode
 *   text      — the four-step ink ramp
 *   lines     — dividers and meter tracks
 *   status    — accent, and the delta/focus semantics from the metrics spec
 */

const light = {
  // --- Surfaces ---
  /** Screen background. Painted by the navigation theme, so screens don't set it. */
  background: '#F4F4F6',
  /** An opaque raised surface. */
  card: '#FFFFFF',
  /** Tint layered over `GlassView` so glass reads as a card, not a smear. */
  glassTint: 'rgba(255,255,255,0.45)',
  /** Heavier glass tint for controls that sit over live content. */
  glassTintStrong: 'rgba(255,255,255,0.72)',
  /** Stand-in for glass where liquid glass is unavailable. */
  glassFallback: 'rgba(255,255,255,0.96)',

  // --- Fills ---
  /** Opaque bed behind an icon or chip. */
  fill: '#F1F1F4',
  /** A step darker than `fill`, for circle buttons that need to read as pressable. */
  fillStrong: '#EDEDF0',
  /** Translucent bed, for use over glass where an opaque fill would block it. */
  fillTranslucent: 'rgba(17,17,20,0.08)',

  // --- Inverse ---
  /** Primary button and badge surface: near-black on light, near-white on dark. */
  inverseSurface: '#1C1C21',
  /** Label on `inverseSurface`. */
  inverseLabel: '#FFFFFF',
  /** `inverseSurface` with the contrast dropped, for a disabled primary button. */
  inverseSurfaceMuted: 'rgba(17,17,20,0.18)',

  // --- Text ---
  /** Primary ink. Every value and title. Never colored by how good it is. */
  foreground: '#111114',
  /** Labels, captions, supporting copy. */
  secondary: '#77777E',
  /** Units, timestamps, and the "flat or declining" delta. */
  tertiary: '#9A9AA0',
  /** Text deliberately pushed back, e.g. teleprompter words not yet spoken. */
  dimmed: '#B9B9BE',

  // --- Lines ---
  divider: 'rgba(17,17,20,0.08)',
  /** Unfilled portion of a tick meter or ring. */
  track: 'rgba(17,17,20,0.12)',
  /** A border meant to be seen as a border — the dashed "add your own" row.
   * Heavier than `divider`, which only has to separate two things. */
  outline: 'rgba(17,17,20,0.25)',
  /** A filled bar for a day other than today. */
  bar: '#C4C4CC',
  /** Stub bar for a day with no data. */
  barEmpty: '#E6E6EB',

  // --- Status ---
  accent: '#3478F6',
  /** Accent at reading-ahead strength, behind the spoken word in a passage. */
  accentFaded: '#AECBFA',
  /** Tinted bed behind an accent glyph or an accent-labelled button. */
  accentBg: 'rgba(52,120,246,0.12)',
  /** Only for an improving delta, and for live in-session "on target". */
  positive: '#23A55A',
  positiveBg: '#E7F6EC',
  /** Live in-session "drifting", never a score. */
  warn: '#FF9F0A',
  /** Only the single FOCUS pill on the weakest skill. */
  focus: '#A96400',
  focusBg: '#FDEFDC',
  /** Form validation only. Never a metric — no metric may render red. */
  danger: '#FF3B30',

  // --- On artwork ---
  // Deliberately fixed in both schemes: a passage card is its own dark artwork
  // surface, so its text does not follow the app's ink ramp.
  onArtwork: '#FFFFFF',
  onArtworkMuted: 'rgba(255,255,255,0.75)',
  /** Translucent white bed for a control sitting on artwork. */
  artworkFill: 'rgba(255,255,255,0.22)',
} as const;

const dark: Record<keyof typeof light, string> = {
  background: '#0B0B0D',
  card: '#1A1A1E',
  glassTint: 'rgba(10,10,12,0.55)',
  glassTintStrong: 'rgba(30,30,34,0.72)',
  glassFallback: 'rgba(26,26,30,0.96)',

  fill: 'rgba(255,255,255,0.08)',
  fillStrong: '#2A2A2F',
  fillTranslucent: 'rgba(255,255,255,0.10)',

  inverseSurface: '#F2F2F5',
  inverseLabel: '#111114',
  inverseSurfaceMuted: 'rgba(255,255,255,0.22)',

  foreground: '#FFFFFF',
  secondary: '#9E9EA6',
  tertiary: '#7C7C84',
  dimmed: '#5A5A62',

  divider: 'rgba(255,255,255,0.10)',
  track: 'rgba(255,255,255,0.16)',
  outline: 'rgba(255,255,255,0.28)',
  bar: '#4A4A52',
  barEmpty: 'rgba(255,255,255,0.10)',

  accent: '#4C8DFF',
  accentFaded: '#2E4A79',
  accentBg: 'rgba(76,141,255,0.18)',
  positive: '#2ECC71',
  positiveBg: 'rgba(46,204,113,0.16)',
  warn: '#FF9F0A',
  focus: '#F0B458',
  focusBg: 'rgba(240,180,88,0.16)',
  danger: '#FF453A',

  onArtwork: '#FFFFFF',
  onArtworkMuted: 'rgba(255,255,255,0.75)',
  artworkFill: 'rgba(255,255,255,0.22)',
};

export const colors = { light, dark } as const;

/** One scheme's colors. Widened to `string` so the two maps are interchangeable —
 * `as const` alone would pin each key to its own literal and split the types. */
export type ThemeColors = { readonly [K in keyof typeof light]: string };

export type ColorSchemeName = keyof typeof colors;

/** Session-screen constants that aren't design tokens. Session colors moved into
 * `constants/colors.ts` — they were a second palette describing the same
 * surfaces, so the two drifted (two greens, two near-blacks, two card tints). */

/** Aa button presets for the live reading text. Sizes, not a type ramp step: the
 * user picks one, and the teleprompter scales to it. */
export const TELEPROMPTER_TEXT_SIZES = [28, 34, 40] as const;

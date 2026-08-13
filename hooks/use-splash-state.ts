import { useState } from 'react';

/**
 * Splash reveal state for the root layout.
 *
 * Two flags, flipped in order by the splash overlay:
 * - `revealed` flips when the splash logo animation ends; content starts
 *   staggering in beneath the fade (consumed via IntroRevealProvider).
 * - `splashDone` flips when the fade completes and the overlay unmounts;
 *   only then is the app interactive (consumed via AppReadyProvider).
 */
export function useSplashState() {
  const [revealed, setRevealed] = useState(false);
  const [splashDone, setSplashDone] = useState(false);

  return { revealed, setRevealed, splashDone, setSplashDone };
}

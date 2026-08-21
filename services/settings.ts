/**
 * The app's settings singleton, plus the two reads that need to work OUTSIDE
 * React.
 *
 * `getAccentLocale()` is the important one: the practice engine resolves the
 * Azure locale inside `stop()`, which is not a render, so it cannot come from a
 * hook.
 */

import { createSettingsStore } from '@/lib/settings-store';
import { kv } from '@/services/kv';
import type { AccentLocale, Settings } from '@/types/settings';

const store = createSettingsStore(kv);

export const getSettings = store.getSettings;
export const subscribe = store.subscribe;
export const setSetting = store.set;
export const resetSettings = store.reset;

/** The accent to grade against, readable from outside React. */
export function getAccentLocale(): AccentLocale {
  return getSettings().accentLocale;
}

export type { Settings };

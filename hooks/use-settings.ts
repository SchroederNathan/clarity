import { useCallback, useSyncExternalStore } from 'react';

import { getSettings, setSetting, subscribe } from '@/services/settings';
import type { Settings } from '@/types/settings';

/** The current settings, re-rendering on every successful write. */
export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}

/**
 * A setter for one field, plus the current value.
 *
 * Returns the write's success so a screen can tell the user when a preference
 * did not stick, instead of showing a control that silently reverts on the next
 * launch.
 */
export function useSetting<K extends keyof Settings>(
  key: K,
): [Settings[K], (value: Settings[K]) => boolean] {
  const settings = useSettings();
  const set = useCallback((value: Settings[K]) => setSetting(key, value), [key]);
  return [settings[key], set];
}

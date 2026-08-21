/**
 * The settings store: hydration, validation, and writes.
 *
 * PURE module. The key-value backend is injected as `KvBackend` (the same
 * interface `lib/history-store.ts` defines), so this runs under bun in
 * `scripts/test-settings.ts`. `services/settings.ts` owns the singleton and the
 * React glue.
 *
 * Two properties carried over from the history store, for the same reasons:
 *
 *  1. `getSettings()` returns a STABLE reference whose identity changes only
 *     after a successful write. `useSyncExternalStore` requires it.
 *  2. A value that cannot be validated is replaced by its default rather than
 *     read back. A settings file is not worth failing a launch over, and a
 *     corrupt accent code must not reach the Azure request as a locale.
 */

import { ACCENTS, DEFAULT_ACCENT } from '@/constants/accents';
import type { KvBackend } from '@/lib/history-store';
import type { AccentLocale, Settings } from '@/types/settings';

const SETTINGS_KEY = {
  accentLocale: 'set/accentLocale',
  improveClarity: 'set/improveClarity',
} as const;

/**
 * `improveClarity` defaults to ON.
 *
 * Not an arbitrary choice: `expo-observe` already dispatches performance and
 * error metrics from release builds today, so ON is the state the app is
 * actually in. Defaulting it OFF would show every existing user a switch that
 * misdescribes their install.
 */
export const DEFAULT_SETTINGS: Settings = {
  accentLocale: DEFAULT_ACCENT,
  improveClarity: true,
};

function parseAccentLocale(raw: string | undefined): AccentLocale {
  if (raw == null) return DEFAULT_SETTINGS.accentLocale;
  const match = ACCENTS.find((accent) => accent.locale === raw);
  return match ? match.locale : DEFAULT_SETTINGS.accentLocale;
}

export type SettingsStore = {
  /** Stable snapshot. Identity changes only on a successful write. */
  getSettings(): Settings;
  subscribe(listener: () => void): () => void;
  /**
   * Persist one field. Returns false when the write could not be verified, in
   * which case the snapshot is left alone: a switch that flips in the UI and
   * reverts on next launch is worse than one that does not move.
   */
  set<K extends keyof Settings>(key: K, value: Settings[K]): boolean;
  /** Testing/reset seam: drop every stored setting back to its default. */
  reset(): void;
};

export function createSettingsStore(kv: KvBackend): SettingsStore {
  const listeners = new Set<() => void>();
  let snapshot: Settings | null = null;

  const hydrate = (): Settings => {
    if (snapshot) return snapshot;
    let improveClarity = DEFAULT_SETTINGS.improveClarity;
    let accentLocale = DEFAULT_SETTINGS.accentLocale;
    try {
      const stored = kv.getBoolean(SETTINGS_KEY.improveClarity);
      if (typeof stored === 'boolean') improveClarity = stored;
      accentLocale = parseAccentLocale(kv.getString(SETTINGS_KEY.accentLocale));
    } catch {
      // A backend that cannot be read yields the defaults, which is a working
      // app rather than a failed launch.
    }
    snapshot = { accentLocale, improveClarity };
    return snapshot;
  };

  const emit = () => {
    for (const listener of listeners) listener();
  };

  return {
    getSettings: hydrate,

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    set(key, value) {
      const current = hydrate();
      if (current[key] === value) return true;
      try {
        kv.set(SETTINGS_KEY[key], value);
        // Memory equals disk: confirm by reading back, not by assuming the
        // write landed.
        const readBack =
          key === 'improveClarity'
            ? kv.getBoolean(SETTINGS_KEY.improveClarity)
            : parseAccentLocale(kv.getString(SETTINGS_KEY.accentLocale));
        if (readBack !== value) return false;
      } catch {
        return false;
      }
      snapshot = { ...current, [key]: value };
      emit();
      return true;
    },

    reset() {
      try {
        for (const key of Object.values(SETTINGS_KEY)) kv.remove(key);
      } catch {
        // Best effort; the snapshot below is what callers observe.
      }
      snapshot = { ...DEFAULT_SETTINGS };
      emit();
    },
  };
}

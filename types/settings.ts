/**
 * User settings. Small, flat, and versioned by nothing: every field has a
 * default, and an unreadable value falls back to it rather than failing the
 * read (see `lib/settings-store.ts`).
 */

/** The English locales offered in Settings. See `constants/accents.ts`. */
export type AccentLocale = 'en-US' | 'en-GB' | 'en-AU' | 'en-CA' | 'en-IN';

export type Settings = {
  /**
   * The accent pronunciation is graded against. Passed straight to Azure as the
   * recognition locale, so this changes real scores.
   */
  accentLocale: AccentLocale;
  /**
   * The user's answer to "use my data to improve Clarity".
   *
   * NOT WIRED TO ANYTHING YET. It is stored and shown, and nothing reads it, so
   * the Settings copy deliberately states the preference rather than describing
   * a behaviour the app does not currently have. To connect it, call
   * `Observe.configure({ integrations: Observe.getIntegrations(), dispatchingEnabled: value })`
   * — passing the existing integrations back is required, because expo-observe
   * throws if the router integration changes after the tree has mounted.
   */
  improveClarity: boolean;
};

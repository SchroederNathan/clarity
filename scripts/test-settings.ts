/**
 * Self-tests for the settings store. Pure JS — run with:
 *   bun scripts/test-settings.ts
 */

import { ACCENTS, accentFor, hasPhonemeDetail } from '@/constants/accents';
import { createMemoryKv } from '@/lib/history-store';
import { createSettingsStore, DEFAULT_SETTINGS } from '@/lib/settings-store';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: unknown) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${label}`, detail !== undefined ? JSON.stringify(detail) : '');
  }
}

function assertEq<T>(actual: T, expected: T, label: string) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
  );
}

function section(name: string) {
  console.log(`\n== ${name}`);
}

// ---------------------------------------------------------------------------
section('defaults');
{
  const store = createSettingsStore(createMemoryKv());
  assertEq(store.getSettings().accentLocale, 'en-US', 'accent defaults to en-US');
  assertEq(store.getSettings().improveClarity, true, 'improveClarity defaults on');
  assertEq(store.getSettings(), DEFAULT_SETTINGS, 'snapshot equals the documented defaults');
}

// ---------------------------------------------------------------------------
section('snapshot identity is stable');
{
  const store = createSettingsStore(createMemoryKv());
  const first = store.getSettings();
  assert(store.getSettings() === first, 'repeated reads return the SAME reference');
  store.set('accentLocale', 'en-GB');
  assert(store.getSettings() !== first, 'identity changes after a write');
  const second = store.getSettings();
  // A no-op write must not churn the reference: useSyncExternalStore would
  // re-render every subscriber for nothing.
  store.set('accentLocale', 'en-GB');
  assert(store.getSettings() === second, 'writing the same value does not churn identity');
}

// ---------------------------------------------------------------------------
section('writes persist and notify');
{
  const kv = createMemoryKv();
  const store = createSettingsStore(kv);
  let notified = 0;
  const unsubscribe = store.subscribe(() => notified++);

  assert(store.set('accentLocale', 'en-IN'), 'accent write reported success');
  assertEq(store.getSettings().accentLocale, 'en-IN', 'accent applied');
  assertEq(notified, 1, 'subscriber notified once');

  assert(store.set('improveClarity', false), 'toggle write reported success');
  assertEq(store.getSettings().improveClarity, false, 'toggle applied');
  assertEq(notified, 2, 'subscriber notified again');

  unsubscribe();
  store.set('accentLocale', 'en-AU');
  assertEq(notified, 2, 'unsubscribed listener stops hearing');

  // Same backend, fresh store: this is what the next app launch sees.
  const reloaded = createSettingsStore(kv);
  assertEq(reloaded.getSettings().accentLocale, 'en-AU', 'accent survives a reload');
  assertEq(reloaded.getSettings().improveClarity, false, 'toggle survives a reload');
}

// ---------------------------------------------------------------------------
section('a corrupt accent never reaches the Azure request');
{
  const kv = createMemoryKv();
  // Whatever put this here, it is not a locale we support, and it would be sent
  // verbatim as the recognition language.
  kv.set('set/accentLocale', 'klingon');
  const store = createSettingsStore(kv);
  assertEq(store.getSettings().accentLocale, 'en-US', 'unknown locale falls back to the default');

  const kv2 = createMemoryKv();
  kv2.set('set/accentLocale', '');
  assertEq(
    createSettingsStore(kv2).getSettings().accentLocale,
    'en-US',
    'empty locale falls back too',
  );
}

// ---------------------------------------------------------------------------
section('an unverifiable write leaves the snapshot alone');
{
  const kv = createMemoryKv();
  const store = createSettingsStore(kv);
  const before = store.getSettings();
  let notified = 0;
  store.subscribe(() => notified++);

  // A backend that accepts writes and drops them. Memory must equal disk, so
  // the snapshot must NOT move: a control that flips and then reverts on the
  // next launch is worse than one that does not move at all.
  const broken = { ...kv, set: () => {} };
  const brokenStore = createSettingsStore(broken);
  assertEq(brokenStore.set('accentLocale', 'en-GB'), false, 'write reports failure');
  assertEq(brokenStore.getSettings().accentLocale, 'en-US', 'snapshot unchanged after a lost write');

  // A backend that throws must not take the app down either.
  const throwing = {
    ...kv,
    set: () => {
      throw new Error('disk full');
    },
  };
  const throwingStore = createSettingsStore(throwing);
  assertEq(throwingStore.set('improveClarity', false), false, 'throwing write reports failure');
  assertEq(throwingStore.getSettings().improveClarity, true, 'snapshot unchanged');

  assertEq(store.getSettings(), before, 'the healthy store was untouched throughout');
  assertEq(notified, 0, 'and never notified');
}

// ---------------------------------------------------------------------------
section('an unreadable backend still boots');
{
  const throwing = {
    ...createMemoryKv(),
    getString: () => {
      throw new Error('unreadable');
    },
    getBoolean: () => {
      throw new Error('unreadable');
    },
  };
  const store = createSettingsStore(throwing);
  assertEq(store.getSettings(), DEFAULT_SETTINGS, 'hydration degrades to defaults, does not throw');
}

// ---------------------------------------------------------------------------
section('reset');
{
  const kv = createMemoryKv();
  const store = createSettingsStore(kv);
  store.set('accentLocale', 'en-CA');
  store.set('improveClarity', false);
  store.reset();
  assertEq(store.getSettings(), DEFAULT_SETTINGS, 'reset restores defaults');
  assertEq(
    createSettingsStore(kv).getSettings(),
    DEFAULT_SETTINGS,
    'and clears the stored keys, so a reload agrees',
  );
}

// ---------------------------------------------------------------------------
section('accent catalog');
{
  assertEq(ACCENTS[0].locale, 'en-US', 'en-US is first and is the default');
  assert(new Set(ACCENTS.map((a) => a.locale)).size === ACCENTS.length, 'locales are unique');
  assert(
    ACCENTS.every((a) => /^en-[A-Z]{2}$/.test(a.locale)),
    'every locale is a well-formed BCP-47 English tag',
  );
  assert(
    ACCENTS.every((a) => a.label.length > 0 && a.region.length > 0),
    'every accent has a label and a region',
  );

  // Measured against the live endpoint: only en-US returns phoneme SYMBOLS.
  // If this ever changes, the Settings note is what goes stale.
  assert(hasPhonemeDetail('en-US'), 'en-US has phoneme detail');
  assertEq(
    ACCENTS.filter((a) => hasPhonemeDetail(a.locale)).map((a) => a.locale),
    ['en-US'],
    'and it is the only one, which is what the Settings note claims',
  );

  assertEq(accentFor('en-GB').label, 'British', 'accentFor resolves a known locale');
  assertEq(
    accentFor('nonsense' as never).locale,
    'en-US',
    'accentFor falls back rather than returning undefined',
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

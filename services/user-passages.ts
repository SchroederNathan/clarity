/**
 * User-authored passages, stored one key per passage in the same MMKV instance
 * as session history.
 *
 * Hydration stays synchronous because `getAnyPassage` (`lib/passage-catalog.ts`)
 * resolves ids outside React during the first render.
 *
 * Per-key storage matters more here than for sessions: a lost session record
 * costs a data point, a lost custom passage costs the user text they typed
 * themselves. One unparseable entry can no longer take the whole library with it.
 */

import { File, Paths } from 'expo-file-system';

import { KEY, META_KEY } from '@/lib/history-schema';
import { tokenizePassage } from '@/lib/passage-text';
import { kv } from '@/services/kv';
import type { CustomPassage } from '@/types/session';

/** Base/blob gradient pairs assigned round-robin; alphas stay < 1 so the
 * cards' glass material reads through (same convention as PASSAGES). */
const ARTWORK_PRESETS: CustomPassage['artwork'][] = [
  {
    base: ['rgba(50,120,246,0.92)', 'rgba(40,70,190,0.85)'],
    blob: ['rgba(140,220,255,0.9)', 'rgba(90,160,255,0.55)'],
  },
  {
    base: ['rgba(220,90,40,0.92)', 'rgba(180,50,100,0.85)'],
    blob: ['rgba(255,220,140,0.92)', 'rgba(255,140,110,0.55)'],
  },
  {
    base: ['rgba(40,160,110,0.92)', 'rgba(20,110,140,0.85)'],
    blob: ['rgba(190,255,210,0.9)', 'rgba(90,230,190,0.5)'],
  },
  {
    base: ['rgba(140,60,220,0.92)', 'rgba(80,50,180,0.85)'],
    blob: ['rgba(255,180,230,0.92)', 'rgba(190,130,255,0.55)'],
  },
  {
    base: ['rgba(200,60,70,0.92)', 'rgba(150,40,130,0.85)'],
    blob: ['rgba(255,190,160,0.92)', 'rgba(255,120,160,0.55)'],
  },
  {
    base: ['rgba(30,130,170,0.92)', 'rgba(30,80,180,0.85)'],
    blob: ['rgba(170,250,255,0.9)', 'rgba(110,190,255,0.55)'],
  },
];

let passages: readonly CustomPassage[] | null = null;
const listeners = new Set<() => void>();

const passageKey = (id: string) => `${KEY.passage}${id}`;

/** Enough of a shape check that one bad entry can't crash the Practice tab. */
function parsePassage(raw: unknown): CustomPassage | null {
  if (raw == null || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== 'string' || typeof p.text !== 'string' || p.text.length === 0) return null;
  if (typeof p.title !== 'string') return null;
  const artwork = p.artwork as CustomPassage['artwork'] | undefined;
  if (!artwork || !Array.isArray(artwork.base) || !Array.isArray(artwork.blob)) return null;
  return {
    id: p.id,
    title: p.title,
    text: p.text,
    targetWpm: typeof p.targetWpm === 'number' && p.targetWpm > 0 ? p.targetWpm : 150,
    duration: typeof p.duration === 'string' ? p.duration : '~1 min',
    artwork,
    category: 'custom',
    custom: true,
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0,
  };
}

/** One-time import of the pre-MMKV `passages.json`. The file is left in place as
 * a backup, and the guard clears with the store so it can re-run. */
function migrateLegacy() {
  if (kv.getBoolean(META_KEY.migratedPassagesV1) === true) return;
  try {
    const file = new File(Paths.document, 'user', 'passages.json');
    if (file.exists) {
      const parsed = JSON.parse(file.textSync()) as { passages?: unknown };
      const rows = Array.isArray(parsed.passages) ? parsed.passages : [];
      for (const row of rows) {
        const passage = parsePassage(row);
        if (passage) write(passage);
      }
    }
  } catch (error) {
    console.warn('[user-passages] legacy migration failed', error);
  }
  kv.set(META_KEY.migratedPassagesV1, true);
}

/**
 * Total by construction. `lib/passage-catalog.ts` calls `getAnyPassage` outside
 * React during the first render, so anything thrown here red-screens the app on
 * launch rather than surfacing in an error boundary. Starting empty is what the
 * previous file-backed store did, and it degrades to "no custom passages" rather
 * than "no app".
 */
function hydrate(): readonly CustomPassage[] {
  if (passages) return passages;
  const out: CustomPassage[] = [];
  try {
    migrateLegacy();
    for (const key of kv.getAllKeys()) {
      if (!key.startsWith(KEY.passage)) continue;
      const raw = kv.getString(key);
      if (raw == null) continue;
      try {
        const passage = parsePassage(JSON.parse(raw));
        if (passage) out.push(passage);
        else console.warn(`[user-passages] dropping unreadable entry ${key}`);
      } catch {
        console.warn(`[user-passages] dropping unparseable entry ${key}`);
      }
    }
  } catch (error) {
    console.warn('[user-passages] failed to hydrate, starting empty', error);
  }
  passages = out.sort((a, b) => a.createdAt - b.createdAt);
  return passages;
}

/** Write and verify. Returns false when the passage did not reach disk, so the
 * caller never shows the user text that wasn't saved. */
function write(passage: CustomPassage): boolean {
  const key = passageKey(passage.id);
  const json = JSON.stringify(passage);
  try {
    kv.set(key, json);
    if (kv.getString(key) !== json) throw new Error('verify mismatch');
    return true;
  } catch (error) {
    console.warn('[user-passages] failed to persist', error);
    return false;
  }
}

export function getCustomPassages(): readonly CustomPassage[] {
  return hydrate();
}

export function getCustomPassage(id: string | undefined): CustomPassage | undefined {
  return hydrate().find((p) => p.id === id);
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function addPassage(input: {
  title: string;
  text: string;
  targetWpm: number;
}): CustomPassage | null {
  const existing = hydrate();
  const createdAt = Date.now();
  const wordCount = tokenizePassage(input.text).words.length;
  const minutes = Math.max(1, Math.round(wordCount / input.targetWpm));
  const passage: CustomPassage = {
    id: `custom-${createdAt.toString(36)}`,
    title: input.title.trim(),
    text: input.text.trim(),
    targetWpm: input.targetWpm,
    duration: `~${minutes} min${minutes > 1 ? 's' : ''}`,
    artwork: ARTWORK_PRESETS[existing.length % ARTWORK_PRESETS.length],
    category: 'custom',
    custom: true,
    createdAt,
  };
  if (!write(passage)) return null;
  passages = [...existing, passage];
  for (const listener of listeners) listener();
  return passage;
}

export function removePassage(id: string) {
  kv.remove(passageKey(id));
  passages = hydrate().filter((p) => p.id !== id);
  for (const listener of listeners) listener();
}

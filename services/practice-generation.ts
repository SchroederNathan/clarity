/**
 * "Practice all" on the Home trouble-words card: asks the /api/practice-passage
 * route for a short passage that works every word in, then holds the result in
 * memory for the session route to resolve by id.
 *
 * Deliberately NOT persisted: this is throwaway drill content, not something
 * the user authored, so it stays out of their library. Session records
 * snapshot `contentTitle` at write time, so history survives the passage being
 * gone after a relaunch (the same contract as deleted custom passages).
 */

// NOTE: uses the global fetch (Expo's WinterCG fetch on SDK 57+), which
// resolves relative URLs against the dev server / hosting origin. `expo/fetch`
// resolves them against file:/// and would 404 here.
import { tokenizePassage } from '@/lib/passage-text';
import type { Passage } from '@/types/session';

/** Matches the editor's "Slow" pace option: these are the user's hardest words. */
const TARGET_WPM = 120;

/** Same base/blob alpha-<1 convention as PASSAGES and user-passage artwork. */
const ARTWORK: Passage['artwork'] = {
  base: ['rgba(50,120,246,0.92)', 'rgba(40,70,190,0.85)'],
  blob: ['rgba(140,220,255,0.9)', 'rgba(90,160,255,0.55)'],
};

let current: Passage | null = null;

/** Resolver for lib/passage-catalog.ts; only the latest generation is live. */
export function getGeneratedPassage(id: string | undefined): Passage | undefined {
  return current && current.id === id ? current : undefined;
}

export async function generateWordPracticePassage(
  words: readonly string[],
): Promise<Passage> {
  const response = await fetch('/api/practice-passage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ words }),
  });

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : 'Passage generation is unavailable right now.';
    throw new Error(message);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof (payload as { title?: unknown }).title !== 'string' ||
    typeof (payload as { text?: unknown }).text !== 'string'
  ) {
    throw new Error('The generated passage was incomplete.');
  }

  const { title, text } = payload as { title: string; text: string };
  const wordCount = tokenizePassage(text).words.length;
  const minutes = Math.max(1, Math.round(wordCount / TARGET_WPM));

  current = {
    id: `generated-${Date.now().toString(36)}`,
    title: title.trim(),
    text: text.trim(),
    duration: `~${minutes} min${minutes > 1 ? 's' : ''}`,
    artwork: ARTWORK,
    targetWpm: TARGET_WPM,
  };
  return current;
}

/**
 * `__DEV__`-only debug surface, driven from the Metro JS debugger over CDP.
 *
 * iOS simulators have no `SFSpeechRecognizer`, so a real practice session cannot
 * run on one. Seeding is therefore the only way to exercise Analytics, streaks,
 * and the skill profile on a simulator at all.
 *
 * Every method returns plain JSON-serializable data so `Runtime.evaluate` can
 * ship it back over the wire.
 */

import { makeRecordKey } from '@/lib/history-schema';
import type { HistoryStore } from '@/lib/history-store';
import { speakingScore } from '@/lib/score';
import {
  recordDayKey,
  speakingSummary,
  startOfLocalDay,
  wordsMastered,
  wordsToMaster,
} from '@/lib/stats';
import { setNowOverride } from '@/services/clock';
import { DRILLS } from '@/constants/drills';
import { PASSAGES } from '@/constants/passages';
import { TOPICS } from '@/constants/topics';
import { RECORD_SCHEMA_VERSION, type SessionRecord, type WordStat } from '@/types/history';

/** Deterministic PRNG so the same seed produces the same ids and therefore the
 * same storage keys — re-seeding is then an idempotent no-op rather than a
 * doubled history. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY_MS = 86_400_000;

export type SeedOptions = {
  days?: number;
  seed?: number;
  /** Anchor instant; the generator only uses its calendar day. */
  now?: number;
  /** Chance a given day has any practice at all, so streaks and gaps are real. */
  practiceChance?: number;
};

/**
 * Generate believable multi-mode history ending today.
 *
 * Realism is the point: skills trend upward with jitter, pace converges on
 * target, fillers decay, `wordCounts` stays consistent with `accuracy` so the
 * Articulation caption agrees with its score, and both `source` values appear so
 * the Azure-only intonation branch is exercised.
 */
export function generateHistory(options: SeedOptions = {}): SessionRecord[] {
  const days = options.days ?? 45;
  const rand = mulberry32(options.seed ?? 1);
  const practiceChance = options.practiceChance ?? 0.78;
  // Anchored to local midnight, NOT to the current instant. `completedAt` feeds
  // the storage key, so anchoring on Date.now() made every re-seed produce fresh
  // keys and silently double the history instead of being a no-op.
  const today = startOfLocalDay(options.now ?? Date.now());
  const tzOffsetMinutes = new Date().getTimezoneOffset();

  const passages = PASSAGES.map((p) => ({ id: p.id, title: p.title, targetWpm: p.targetWpm, mode: 'passage' as const }));
  const drills = DRILLS.map((d) => ({ id: d.id, title: d.title, targetWpm: d.targetWpm, mode: 'drill' as const }));
  const content = [...passages, ...drills];

  const out: SessionRecord[] = [];
  let seq = 0;

  for (let d = days - 1; d >= 0; d--) {
    if (rand() > practiceChance) continue;
    const sessions = 1 + Math.floor(rand() * 2.4);
    // 0 at the start of the window, 1 today: everything trends along this.
    const progress = (days - 1 - d) / Math.max(1, days - 1);

    for (let s = 0; s < sessions; s++) {
      const freestyle = rand() < 0.15;
      const item = content[Math.floor(rand() * content.length)];
      const topic = TOPICS[Math.floor(rand() * TOPICS.length)];
      const source: 'azure' | 'live' = rand() < 0.7 ? 'azure' : 'live';

      // Late morning through evening, never straddling midnight. Derived from the
      // day anchor and the PRNG only, so a given (days, seed) pair always yields
      // the same timestamps — and therefore the same keys — within a calendar day.
      const completedAt = today - d * DAY_MS + 10 * 3_600_000 + Math.floor(rand() * 8 * 3_600_000);
      const durationMs = Math.round((70 + rand() * 200) * 1_000);

      const drift = (base: number, span: number) =>
        Math.max(0, Math.min(100, Math.round(base + span * progress + (rand() - 0.5) * 9)));
      const accuracy = freestyle ? 0 : drift(72, 16);
      const fluency = drift(70, 15);
      const intonation = drift(68, 14);

      const targetWpm = freestyle ? 150 : item.targetWpm;
      // Converges on target as the window progresses.
      const paceWpm = Math.round(targetWpm * (1 + (1 - progress) * (rand() - 0.45) * 0.35));
      const fillerCount = Math.max(0, Math.round((5 - 3.5 * progress) + (rand() - 0.5) * 2));

      const totalWords = 60 + Math.floor(rand() * 120);
      const good = freestyle ? 0 : Math.round((accuracy / 100) * totalWords);
      const remainder = freestyle ? 0 : totalWords - good;
      const mispronounced = Math.round(remainder * 0.6);
      const omitted = remainder - mispronounced;
      const spokenWords = freestyle ? Math.round(durationMs / 60_000 * paceWpm) : good + mispronounced;

      seq += 1;
      const record: SessionRecord = {
        v: RECORD_SCHEMA_VERSION,
        id: makeRecordKey(completedAt, seq),
        seq,
        completedAt,
        tzOffsetMinutes,
        mode: freestyle ? 'freestyle' : item.mode,
        endedReason: 'completed',
        durationMs,
        accuracy,
        fluency,
        completeness: freestyle ? 0 : drift(80, 14),
        intonation,
        paceWpm,
        targetWpm,
        fillerCount,
        spokenWords,
        pauseCount: freestyle ? undefined : Math.max(0, Math.round(4 - 2.5 * progress + (rand() - 0.5) * 2)),
        longestPauseMs: freestyle ? undefined : Math.round(1_500 + rand() * 2_600),
        source,
        wordCounts: { good, mispronounced, omitted, inserted: fillerCount },
        challengingWords: freestyle ? [] : ['pickled', 'peppers', 'sixth', 'rural'].slice(0, 1 + Math.floor(rand() * 3)),
      };
      if (freestyle) record.topicId = topic.id;
      else record.passageId = item.id;
      record.contentTitle = freestyle ? topic.title : item.title;
      out.push(record);
    }
  }

  return out.sort((a, b) => a.completedAt - b.completedAt);
}

/** Per-word aggregates to pair with `generateHistory`. Deterministic for a
 * given seed, and shaped so the home screen has something to say: a few words
 * qualify for "Words to master" (seen ≥ 3, streak broken, misses outstanding),
 * a few count as mastered (once missed, now on a clean streak), and the rest
 * are reliably clean. */
export function generateWordStats(options: { seed?: number; now?: number } = {}): WordStat[] {
  const rand = mulberry32(options.seed ?? 1);
  const now = options.now ?? Date.now();
  const day = (n: number) => now - n * DAY_MS;

  const make = (
    word: string,
    kind: 'struggling' | 'mastered' | 'clean',
  ): WordStat => {
    const seen = 4 + Math.floor(rand() * 8);
    if (kind === 'struggling') {
      const clean = Math.floor(seen * (0.2 + rand() * 0.4));
      const missed = seen - clean;
      const mispronounced = Math.max(1, Math.round(missed * 0.7));
      return {
        word, seen, clean, mispronounced,
        omitted: missed - mispronounced,
        cleanStreak: Math.floor(rand() * 2),
        everMissed: true,
        firstSeenAt: day(30 + Math.floor(rand() * 10)),
        lastSeenAt: day(Math.floor(rand() * 3)),
      };
    }
    if (kind === 'mastered') {
      return {
        word, seen, clean: seen - 2, mispronounced: 2, omitted: 0,
        cleanStreak: 3 + Math.floor(rand() * 4),
        everMissed: true,
        firstSeenAt: day(35 + Math.floor(rand() * 8)),
        lastSeenAt: day(1 + Math.floor(rand() * 4)),
      };
    }
    return {
      word, seen, clean: seen, mispronounced: 0, omitted: 0,
      cleanStreak: seen, everMissed: false,
      firstSeenAt: day(20 + Math.floor(rand() * 15)),
      lastSeenAt: day(Math.floor(rand() * 5)),
    };
  };

  return [
    make('pickled', 'struggling'),
    make('peppers', 'struggling'),
    make('sixth', 'struggling'),
    make('rural', 'struggling'),
    make('thoroughly', 'struggling'),
    make('phenomenon', 'mastered'),
    make('squirrel', 'mastered'),
    make('brewery', 'mastered'),
    make('statistics', 'clean'),
    make('particular', 'clean'),
  ];
}

export function installDevHandle(store: HistoryStore) {
  const handle = {
    /** All records, newest last. */
    records: () =>
      store.getRecords().map((r) => ({
        id: r.id,
        day: recordDayKey(r),
        mode: r.mode,
        endedReason: r.endedReason,
        title: r.contentTitle,
        minutes: +(r.durationMs / 60_000).toFixed(2),
        spokenWords: r.spokenWords,
        // The derived score, never a stored one.
        score: speakingScore(r),
      })),
    stats: () => store.getStats(),
    summary: () => speakingSummary(store.getRecords(), Date.now()),
    words: () => ({
      all: store.getWordStats(),
      toMaster: wordsToMaster(store.getWordStats(), 5),
      mastered: wordsMastered(store.getWordStats()),
    }),
    quarantine: () => store.getQuarantine(),
    /** Plant believable history. Idempotent for a given seed. */
    seed: (days = 45, seed = 1) => {
      const records = generateHistory({ days, seed });
      let imported = 0;
      for (const record of records) if (store.addRecord(record)) imported += 1;
      return { generated: records.length, imported, ...store.getStats() };
    },
    clear: () => {
      store.clearAll();
      return store.getStats();
    },
    export: () => store.exportHistory(),
    import: (json: string, mode: 'merge' | 'replace' = 'merge') => store.importHistory(json, mode),
    /** Pin the shared clock to test a midnight rollover without waiting. */
    setNow: (ms: number | null) => {
      setNowOverride(ms);
      return ms;
    },
  };

  (globalThis as unknown as { __clarity: typeof handle }).__clarity = handle;
}

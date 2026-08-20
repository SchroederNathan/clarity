/**
 * Derived practice statistics: streaks, daily/weekly goal progress, the EWMA
 * skill profile that drives recommendations, and the windowed aggregates the
 * Home and Analytics screens consume.
 *
 * PURE module: runs under bun for scripts/test-stats.ts. All "today" math takes
 * an explicit `now` timestamp so tests are deterministic — and in the app that
 * `now` comes from the one shared clock (`services/clock.ts`), so every screen
 * agrees about which day it is.
 */

import { SKILL_ORDER } from '@/constants/metrics';
import { FILLER_BIGRAMS, FILLER_UNIGRAMS } from '@/lib/fillers';
import {
  cleanWordPct,
  isScorable,
  sessionSkills,
  skillCaptions,
  skillWindow,
  speakingScore,
  type RawMeasures,
} from '@/lib/score';
import type {
  SessionRecord,
  SkillEstimate,
  SkillKey,
  SkillProfile,
  WordCounts,
  WordStat,
} from '@/types/history';

export const DAILY_GOAL_MINUTES = 20;

const DAY_MS = 86_400_000;

/** Local-calendar day key, YYYY-MM-DD, in the DEVICE's current timezone. Use
 * this for "today" and for the day axis; use `recordDayKey` for a record. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Day key at a GIVEN offset, in the minutes `Date.getTimezoneOffset()` returns
 * (positive west of UTC). Deliberately does not consult the device zone, so it
 * is deterministic regardless of where the test or the user is.
 */
export function dayKeyAt(ms: number, tzOffsetMinutes: number): string {
  const d = new Date(ms - tzOffsetMinutes * 60_000);
  const m = `${d.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${d.getUTCDate()}`.padStart(2, '0');
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

/**
 * The day the user actually practiced, in the timezone they were in.
 *
 * This is the fix for a real bug: bucketing by the device's *current* zone meant
 * flying west or a DST change retroactively shifted past evening sessions onto
 * the previous day, silently breaking or double-counting a streak the user had
 * already earned.
 */
export function recordDayKey(record: SessionRecord): string {
  return record.tzOffsetMinutes == null
    ? dayKey(record.completedAt)
    : dayKeyAt(record.completedAt, record.tzOffsetMinutes);
}

/** Inverse of `dayKey`: local midnight for that calendar day.
 *
 * Must not be `new Date(key)` — that parses YYYY-MM-DD as UTC midnight, which
 * lands on the previous local day in any negative-offset timezone. Day math
 * that only takes differences survives the offset; anything that displays or
 * re-keys the result does not. */
export function dayKeyToMs(key: string): number {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day).getTime();
}

/** Local midnight at or before `ms`. */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Local midnight `days` from the calendar day containing `ms` (negative goes
 * back).
 *
 * Every day walk-back MUST go through this rather than subtracting `DAY_MS`.
 * Records are bucketed by local calendar day, but a fixed 86,400,000 ms step is
 * an hour off across a DST transition: stepping back one "day" from 00:30 on the
 * morning after spring-forward lands at 23:30 two days earlier, so the day in
 * between is never probed — silently shortening a streak and making the day
 * chart plot one day twice while dropping another.
 */
export function startOfLocalDayOffset(ms: number, days: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
}

/** Day key `days` from the calendar day containing `ms`. DST-safe; see above. */
export function dayKeyOffset(ms: number, days: number): string {
  return dayKey(startOfLocalDayOffset(ms, days));
}

/**
 * Ms from `ms` to the next local midnight. Clamped so a skewed device clock
 * can't produce a tight timer loop. DST-safe: constructing the next day in local
 * time absorbs the offset change, so the "day" can legitimately be 23 or 25h.
 */
export function msUntilNextLocalMidnight(ms: number): number {
  const d = new Date(ms);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return Math.min(Math.max(next - ms, 1_000), 25 * 60 * 60 * 1_000);
}

function minutesByDay(records: readonly SessionRecord[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of records) {
    const key = recordDayKey(r);
    map.set(key, (map.get(key) ?? 0) + r.durationMs / 60_000);
  }
  return map;
}

export function minutesOnDay(records: readonly SessionRecord[], dayMs: number): number {
  const key = dayKey(dayMs);
  let total = 0;
  for (const r of records) {
    if (recordDayKey(r) === key) total += r.durationMs / 60_000;
  }
  return total;
}

/** Today's goal completion, 0–1. */
export function todayProgress(records: readonly SessionRecord[], now: number): number {
  return Math.min(minutesOnDay(records, now) / DAILY_GOAL_MINUTES, 1);
}

/** Goal-met flags for the 5 days before today, oldest first — exactly the
 * shape WeeklyProgress's `history` prop expects. */
export function weeklyHistory(records: readonly SessionRecord[], now: number): boolean[] {
  const byDay = minutesByDay(records);
  const out: boolean[] = [];
  for (let i = 5; i >= 1; i--) {
    out.push((byDay.get(dayKeyOffset(now, -i)) ?? 0) >= DAILY_GOAL_MINUTES);
  }
  return out;
}

/** Consecutive days with ≥1 session, counting back from today — or from
 * yesterday when today has none yet (an empty morning doesn't break it). */
export function streak(records: readonly SessionRecord[], now: number): number {
  const days = new Set(records.map(recordDayKey));
  // Offset of the day the run starts from, relative to today's calendar day.
  let offset = 0;
  if (!days.has(dayKey(now))) {
    offset = -1;
    if (!days.has(dayKeyOffset(now, offset))) return 0;
  }
  let count = 0;
  while (days.has(dayKeyOffset(now, offset - count))) count++;
  return count;
}

// --- Skill profile -----------------------------------------------------------

const EWMA_ALPHA = 0.3;
const EWMA_WINDOW = 30;
/** A skill needs this many samples before recommendations trust it. */
export const SKILL_KNOWN_SAMPLES = 3;

export const SKILL_KEYS: readonly SkillKey[] = SKILL_ORDER;

/** EWMA (α=0.3) per skill over the most recent ≤30 records, oldest→newest,
 * seeded with each skill's first eligible sample. Eligibility comes from
 * `sessionSkills` so recommendations and the displayed scores agree on which
 * skills a session actually measured. */
export function skillProfile(records: readonly SessionRecord[]): SkillProfile {
  const recent = [...records].sort((a, b) => a.completedAt - b.completedAt).slice(-EWMA_WINDOW);

  const profile = {} as SkillProfile;
  for (const key of SKILL_KEYS) {
    const estimate: SkillEstimate = { value: 0, samples: 0 };
    for (const r of recent) {
      const x = sessionSkills(r)[key];
      if (x == null) continue;
      estimate.value =
        estimate.samples === 0 ? x : EWMA_ALPHA * x + (1 - EWMA_ALPHA) * estimate.value;
      estimate.samples += 1;
    }
    profile[key] = estimate;
  }
  return profile;
}

// --- Windows -----------------------------------------------------------------

/**
 * Records completed within [since, until). HALF-OPEN on purpose: with both ends
 * inclusive, a record landing exactly on a window boundary was counted in both
 * "this week" and "last week", inflating its own delta.
 */
export function recordsBetween(
  records: readonly SessionRecord[],
  since: number,
  until: number,
): SessionRecord[] {
  return records.filter((r) => r.completedAt >= since && r.completedAt < until);
}

/**
 * Everything from `since` onward, with no upper bound.
 *
 * The CURRENT window must use this rather than `[since, now)`: `now` comes from a
 * clock that only advances at midnight and on foreground, so it can lag a
 * just-saved session by hours — and bounding by it would make a session the user
 * just finished missing from this week's numbers.
 */
export function recordsSince(
  records: readonly SessionRecord[],
  since: number,
): SessionRecord[] {
  return records.filter((r) => r.completedAt >= since);
}

export type DayScore = {
  dayKey: string;
  /** null on days with no scorable session — the chart renders an empty stub
   * rather than a zero-height bar. */
  score: number | null;
  /**
   * How many of the five skills the day was scored on. A freestyle-only day
   * scores 3, a passage-plus-Azure day 5, so the bars are NOT directly
   * comparable; the chart marks the partial ones instead of plotting them as
   * equals.
   */
  skillCount: number;
  /** Sessions on the day, including ones excluded from scoring, so a day whose
   * only session was too short reads "practiced, not scored" rather than empty. */
  sessions: number;
  /** Rounded practice minutes on the day, for detail surfaces like a chart
   * tooltip. Includes unscorable sessions for the same reason `sessions` does. */
  minutes: number;
};

/** Rounded practice minutes across a list of sessions. */
function sumMinutes(list: readonly SessionRecord[]): number {
  return Math.round(list.reduce((sum, r) => sum + r.durationMs / 60_000, 0));
}

/** Per-day speaking score for the last `days` days ending today, oldest first. */
export function dailySpeakingScores(
  records: readonly SessionRecord[],
  days: number,
  now: number,
): DayScore[] {
  const byDay = new Map<string, SessionRecord[]>();
  for (const r of records) {
    const key = recordDayKey(r);
    const list = byDay.get(key) ?? [];
    list.push(r);
    byDay.set(key, list);
  }

  const out: DayScore[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKeyOffset(now, -i);
    const list = byDay.get(key) ?? [];
    const window = skillWindow(list);
    out.push({
      dayKey: key,
      score: list.length ? speakingScore(list) : null,
      skillCount: SKILL_ORDER.filter((k) => window[k].samples > 0).length,
      sessions: list.length,
      minutes: sumMinutes(list),
    });
  }
  return out;
}

export type WeekScore = {
  /** dayKeys of the bucket's first and last day, both inclusive. */
  startKey: string;
  endKey: string;
  /** null when the week has no scorable session. */
  score: number | null;
  /** Skills the week was scored on — same partial-coverage semantics as
   * `DayScore.skillCount`. */
  skillCount: number;
  sessions: number;
  minutes: number;
};

/**
 * Per-week speaking score over the whole history, oldest first, for the
 * all-time chart. Buckets are 7 calendar days aligned so the LAST bucket ends
 * today — daily bars over months of history are unreadable, and a partial
 * "this week" bucket at the end would dip for no reason other than being
 * half-elapsed.
 *
 * Scores derive from the bucket's records via `speakingScore`, never from a
 * stored per-day value, for the same reason `dailySpeakingScores` does.
 */
export function weeklySpeakingScores(
  records: readonly SessionRecord[],
  now: number,
): WeekScore[] {
  if (records.length === 0) return [];
  const first = startOfLocalDay(records[0].completedAt);
  const spanDays = Math.max(1, Math.round((startOfLocalDay(now) - first) / 86_400_000) + 1);
  const weeks = Math.ceil(spanDays / 7);

  const out: WeekScore[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const endOffset = -(w * 7);
    const startOffset = endOffset - 6;
    const start = startOfLocalDayOffset(now, startOffset);
    // The current bucket is unbounded above: `now` only advances at midnight
    // and on foreground, so bounding by it would drop a just-saved session.
    const list =
      w === 0
        ? recordsSince(records, start)
        : recordsBetween(records, start, startOfLocalDayOffset(now, endOffset + 1));
    const window = skillWindow(list);
    out.push({
      startKey: dayKeyOffset(now, startOffset),
      endKey: dayKeyOffset(now, endOffset),
      score: list.length ? speakingScore(list) : null,
      skillCount: SKILL_ORDER.filter((k) => window[k].samples > 0).length,
      sessions: list.length,
      minutes: sumMinutes(list),
    });
  }
  return out;
}

/**
 * The raw measures behind a window's skill captions.
 *
 * Restricted to scorable sessions: a caption must annotate exactly the sessions
 * its skill was scored on, or the caption and the number it sits under describe
 * different things.
 */
export function windowRawMeasures(records: readonly SessionRecord[]): RawMeasures {
  const scored = records.filter(isScorable);
  if (scored.length === 0) {
    return { cleanPct: null, avgWpm: null, targetWpm: null, fillers: null, pauses: null, longestPauseMs: null };
  }

  const totalCounts = scored.reduce<WordCounts>(
    (acc, r) => ({
      good: acc.good + r.wordCounts.good,
      mispronounced: acc.mispronounced + r.wordCounts.mispronounced,
      omitted: acc.omitted + r.wordCounts.omitted,
      inserted: acc.inserted + r.wordCounts.inserted,
    }),
    { good: 0, mispronounced: 0, omitted: 0, inserted: 0 },
  );

  // Only sessions that actually measured pace should move the average.
  const paced = scored.filter((r) => r.paceWpm > 0);
  const mean = (values: number[]) =>
    values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;

  const paused = scored.filter((r) => r.pauseCount != null);
  const pauseMean = mean(paused.map((r) => r.pauseCount!));

  return {
    cleanPct: cleanWordPct(totalCounts),
    avgWpm: mean(paced.map((r) => r.paceWpm)),
    targetWpm: mean(paced.map((r) => r.targetWpm)),
    fillers: Math.round(scored.reduce((s, r) => s + r.fillerCount, 0) / scored.length),
    pauses: pauseMean == null ? null : Math.round(pauseMean),
    longestPauseMs: paused.length
      ? Math.max(...paused.map((r) => r.longestPauseMs ?? 0))
      : null,
  };
}

/**
 * The highest-scoring session, ties broken by most recent — null when there's no
 * scorable history yet. Ranks by the derived speaking score, never a persisted
 * one, so records written under an older formula rank correctly.
 *
 * Unscorable sessions are skipped rather than treated as 0: the previous version
 * seeded `bestScore = -1` and coalesced `speakingScore(r) ?? 0`, so an unscorable
 * record beat the sentinel and became the user's "best" at zero.
 */
export function bestSession(records: readonly SessionRecord[]): SessionRecord | null {
  let best: SessionRecord | null = null;
  let bestScore = -1;
  for (const r of records) {
    const score = speakingScore(r);
    if (score == null) continue;
    if (score > bestScore || (score === bestScore && best != null && r.completedAt > best.completedAt)) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

/** Sorted distinct local-calendar days on which anything was practiced. */
function practiceDays(records: readonly SessionRecord[]): string[] {
  return [...new Set(records.map(recordDayKey))].sort();
}

/** The longest run of consecutive practice days, with its bounds — the date
 * range under the Records "Longest streak" row. null with no history. */
export function longestStreakRange(
  records: readonly SessionRecord[],
): { startMs: number; endMs: number; length: number } | null {
  const days = practiceDays(records);
  if (days.length === 0) return null;

  let best = { start: days[0], end: days[0], length: 1 };
  let runStart = days[0];
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    const gap = Math.round((dayKeyToMs(days[i]) - dayKeyToMs(days[i - 1])) / DAY_MS);
    if (gap === 1) {
      run += 1;
    } else {
      runStart = days[i];
      run = 1;
    }
    if (run > best.length) best = { start: runStart, end: days[i], length: run };
  }

  return {
    startMs: dayKeyToMs(best.start),
    endMs: dayKeyToMs(best.end),
    length: best.length,
  };
}

/** All-time effort. No `bestOverall`: `bestSession` is the one definition of
 * "best", so there is no second one to drift from it. */
export type Totals = {
  minutes: number;
  sessions: number;
  longestStreak: number;
};

export function totals(records: readonly SessionRecord[]): Totals {
  let minutes = 0;
  for (const r of records) minutes += r.durationMs / 60_000;
  return {
    minutes,
    sessions: records.length,
    longestStreak: longestStreakRange(records)?.length ?? 0,
  };
}

// --- Words -------------------------------------------------------------------

function isFillerWord(word: string): boolean {
  return FILLER_UNIGRAMS.has(word) || FILLER_BIGRAMS.has(word);
}

/**
 * Words to practice, worst first, from the running per-word aggregates.
 *
 * Requires a few sightings before judging: a word missed once out of one attempt
 * is noise, not a weakness. Ranks by miss rate rather than raw frequency, so a
 * word the user reliably fumbles outranks a common word they usually get right.
 */
export function wordsToMaster(
  stats: readonly WordStat[],
  n: number,
  minSeen = 3,
): { word: string; count: number }[] {
  return stats
    .filter((s) => s.seen >= minSeen && s.cleanStreak < 2 && s.seen > s.clean)
    .filter((s) => !isFillerWord(s.word))
    .map((s) => ({ stat: s, missRate: (s.seen - s.clean) / s.seen }))
    .sort((a, b) => b.missRate - a.missRate || b.stat.seen - a.stat.seen)
    .slice(0, n)
    .map(({ stat }) => ({ word: stat.word, count: stat.seen - stat.clean }));
}

/** Words that used to be missed and are now reliably clean — the "Words
 * mastered" counter. A word never missed doesn't count: nothing was mastered. */
export function wordsMastered(stats: readonly WordStat[], streakToMaster = 3): number {
  return stats.filter((s) => s.everMissed && s.cleanStreak >= streakToMaster).length;
}

/**
 * Frequency-ranked trouble words straight off the records. Retained for history
 * written before per-word aggregates existed; `wordsToMaster` is the real answer.
 *
 * Filters fillers at READ time on purpose: excluding them at write time only
 * helps new records, and history already on disk has "um" baked into
 * `challengingWords`. Unscorable sessions are skipped too — a silent take
 * otherwise contributes the passage's first five words as things to master.
 */
export function topChallengingWords(
  records: readonly SessionRecord[],
  n: number,
): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of records) {
    if (!isScorable(r)) continue;
    for (const word of r.challengingWords) {
      const key = word.toLowerCase();
      if (isFillerWord(key)) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([word, count]) => ({ word, count }));
}

// --- The rolling summary -----------------------------------------------------

export const WINDOW_DAYS = 7;

export type SpeakingSummary = {
  /** True when there's no history at all — screens show an empty state. */
  empty: boolean;
  score: number | null;
  scoreDelta: number | null;
  days: DayScore[];
  skills: Record<SkillKey, SkillEstimate>;
  skillDeltas: Partial<Record<SkillKey, number>>;
  captions: Partial<Record<SkillKey, string>>;
  minutes: number;
  sessions: number;
  streak: number;
  /** null when there is no prior window to compare against — notably the
   * "All time" range, whose comparison window is empty by construction. */
  minutesDelta: number | null;
  sessionsDelta: number | null;
  streakDelta: number | null;
};

/**
 * The rolling picture of a user's speaking, derived once and shared by Home and
 * Analytics so the two screens can never show different figures for the same
 * week.
 *
 * The window is CALENDAR-aligned, not a rolling 168 hours, so the score is
 * computed from exactly the days the chart plots and the whole thing advances on
 * the same midnight tick as the streak and the goal ring. A rolling window would
 * slide continuously while everything around it jumped.
 */
export function speakingSummary(
  records: readonly SessionRecord[],
  now: number,
  windowDays: number = WINDOW_DAYS,
  /**
   * Days to plot. Defaults to the whole window, which keeps the invariant that
   * the score is computed from exactly the days shown. Only the all-time range
   * passes something smaller — hundreds of bars are unreadable — and the screen
   * says so in the section subtitle rather than letting the chart imply it covers
   * the same span as the number above it.
   */
  chartDays: number = windowDays,
): SpeakingSummary {
  // Calendar-stepped, not `now - n * DAY_MS`: a DST transition inside the window
  // otherwise shifts the boundary by an hour and moves a session between windows.
  const weekStart = startOfLocalDayOffset(now, -(windowDays - 1));
  const thisWeek = recordsSince(records, weekStart);
  const priorStart = startOfLocalDayOffset(weekStart, -windowDays);
  const lastWeek = recordsBetween(records, priorStart, weekStart);

  /**
   * Whether there is a real prior window to compare against.
   *
   * On the "All time" range `windowDays` spans from the first session to today,
   * so the prior window ends before any record exists and is empty by
   * construction. Subtracting zero there produced a delta equal to the value it
   * sat beside — 312 min with a "+312 min" badge. A delta needs both sides
   * measured; with nothing prior, there is no change to report.
   */
  const hasPrior = lastWeek.length > 0;

  const score = speakingScore(thisWeek);
  const priorScore = speakingScore(lastWeek);

  const skills = skillWindow(thisWeek);
  const priorSkills = skillWindow(lastWeek);
  const skillDeltas: Partial<Record<SkillKey, number>> = {};
  for (const key of SKILL_ORDER) {
    // A delta needs both sides measured; "improved from nothing" isn't a fact.
    if (skills[key].samples > 0 && priorSkills[key].samples > 0) {
      skillDeltas[key] = skills[key].value - priorSkills[key].value;
    }
  }

  const minutes = sumMinutes(thisWeek);
  const currentStreak = streak(records, now);

  return {
    empty: records.length === 0,
    score,
    scoreDelta: score != null && priorScore != null ? score - priorScore : null,
    days: dailySpeakingScores(records, Math.min(chartDays, windowDays), now),
    skills,
    skillDeltas,
    captions: skillCaptions(windowRawMeasures(thisWeek), 'window'),
    minutes,
    minutesDelta: hasPrior ? minutes - sumMinutes(lastWeek) : null,
    sessions: thisWeek.length,
    sessionsDelta: hasPrior ? thisWeek.length - lastWeek.length : null,
    streak: currentStreak,
    streakDelta: hasPrior ? currentStreak - streak(records, weekStart) : null,
  };
}

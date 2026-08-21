/**
 * Session scoring: sentence-based audio chunking for Azure's 30s cap,
 * word-count-weighted aggregation of chunk assessments, per-word verdict
 * mapping back onto the passage's display tokens, and the live-fallback
 * result builder used when Azure is unavailable or fails.
 *
 * PURE module (types only from azure-assessment, itself pure): runs under bun
 * for the self-test scripts.
 */

import { normalizeToken, type TokenizedPassage } from '@/lib/passage-text';
import { clampScore, fillerScore, paceScore, PAUSE_MIN_MS, speakingScore } from '@/lib/score';
import type {
  ResultPhoneme,
  ResultSyllable,
  ResultWord,
  SessionResult,
  WordVerdict,
} from '@/types/session';
import { mapAssessedWords } from './assessment-mapping';
import type { CommittedInsertion, RefWordStatus, WordCommit } from './alignment';
import type { AzureWordResult, ChunkAssessment } from './azure-assessment';

/** The bundler injects `__DEV__`; bun does not, and this module runs there for
 * the self-tests. */
const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__;

/** Azure short-audio caps assessment audio at 30s — pack chunks to 28s. */
export const MAX_CHUNK_MS = 28_000;
/**
 * Padding around a chunk's audio span.
 *
 * Both were far tighter (150/350) and clipped boundary words. A chunk begins
 * where the previous one's last word was timed to end, and that timestamp
 * carries real error: interpolated across an utterance when the recognizer gave
 * only span timings, and lagging the audio outright when it gave none. Too
 * little lead cuts the first word's onset consonant off, and Azure grades a
 * beheaded word as a mispronunciation. Overlapping into a neighbour is cheap by
 * comparison: `EnableMiscue` reports the intruding word as an Insertion, which
 * `mapAssessedWords` anchors and discards.
 */
const CHUNK_LEAD_MS = 400;
const CHUNK_TAIL_MS = 600;

export type SentenceChunk = {
  /** Recording segment (pause/resume cycle) the audio lives in. */
  segmentIndex: number;
  /** Audio span within that segment. */
  startMs: number;
  endMs: number;
  /** Display-token range covered ([start, end)). */
  displayStart: number;
  displayEnd: number;
  /** Matchable-word range covered ([start, end)). */
  matchableStart: number;
  matchableEnd: number;
  referenceText: string;
  /** Matchable word count (aggregation weight). */
  matchableCount: number;
};

/**
 * Build <=28s assessment chunks by greedy-packing read sentences, using the
 * aligner's commit timestamps. Chunks never span recording-segment
 * boundaries; trailing sentences with no matched words are excluded (their
 * words stay 'omitted' locally).
 *
 * @param segmentDurationsMs Audio duration per recording segment (0 = unknown).
 * @param segmentActiveStartMs Active-session ms at each segment's start, used
 *   to convert wall-clock commit times into within-segment offsets when the
 *   recognizer gave no timings.
 */
export function buildChunks(
  tokenized: TokenizedPassage,
  timeline: (WordCommit | null)[],
  segmentDurationsMs: number[],
  segmentActiveStartMs: number[],
): SentenceChunk[] {
  const displayToMatchable = new Map<number, number>();
  tokenized.matchableIndices.forEach((displayIdx, matchableIdx) => {
    displayToMatchable.set(displayIdx, matchableIdx);
  });

  const resolveEndMs = (commit: WordCommit): number => {
    if (commit.endMsInSegment != null) return commit.endMsInSegment;
    const segStart = segmentActiveStartMs[commit.segmentIndex] ?? 0;
    return Math.max(0, commit.atActiveMs - segStart);
  };

  type SentenceInfo = {
    displayStart: number;
    displayEnd: number;
    matchableStart: number;
    matchableEnd: number;
    segmentIndex: number;
    startMs: number;
    endMs: number;
    hasCommits: boolean;
  };

  const sentences: SentenceInfo[] = [];
  let lastReadIndex = -1;
  let carrySegment = 0;
  let carryEndMs = 0;

  tokenized.sentences.forEach((sentence) => {
    let matchableStart = Number.MAX_SAFE_INTEGER;
    let matchableEnd = -1;
    const commits: WordCommit[] = [];
    for (let d = sentence.start; d < sentence.end; d++) {
      const m = displayToMatchable.get(d);
      if (m == null) continue;
      matchableStart = Math.min(matchableStart, m);
      matchableEnd = Math.max(matchableEnd, m + 1);
      const commit = timeline[m];
      if (commit) commits.push(commit);
    }
    if (matchableEnd < 0) {
      // Punctuation-only sentence — fold into nothing.
      matchableStart = 0;
      matchableEnd = 0;
    }

    let segmentIndex = carrySegment;
    let endMs = carryEndMs;
    let startMs = carryEndMs;
    if (commits.length > 0) {
      // A sentence's audio lives in the segment of its last commit.
      const lastCommit = commits[commits.length - 1];
      segmentIndex = lastCommit.segmentIndex;
      const sameSegment = commits.filter((c) => c.segmentIndex === segmentIndex);
      endMs = Math.max(...sameSegment.map(resolveEndMs));
      startMs = segmentIndex === carrySegment ? carryEndMs : 0;
      carrySegment = segmentIndex;
      carryEndMs = endMs;
      lastReadIndex = sentences.length;
    } else {
      startMs = carryEndMs;
      endMs = carryEndMs; // zero-length span; folded into a neighbor chunk
    }

    sentences.push({
      displayStart: sentence.start,
      displayEnd: sentence.end,
      matchableStart,
      matchableEnd,
      segmentIndex,
      startMs,
      endMs,
      hasCommits: commits.length > 0,
    });
  });

  if (lastReadIndex < 0) return [];

  const chunks: SentenceChunk[] = [];
  let current: SentenceInfo[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const seg = current[0].segmentIndex;
    const segDuration = segmentDurationsMs[seg] ?? 0;
    const rawStart = Math.max(0, current[0].startMs - CHUNK_LEAD_MS);
    let rawEnd = current[current.length - 1].endMs + CHUNK_TAIL_MS;
    if (segDuration > 0) rawEnd = Math.min(rawEnd, segDuration);
    rawEnd = Math.min(rawEnd, rawStart + MAX_CHUNK_MS); // hard cap
    const displayStart = current[0].displayStart;
    const displayEnd = current[current.length - 1].displayEnd;
    const matchableStart = Math.min(
      ...current.filter((s) => s.matchableEnd > s.matchableStart).map((s) => s.matchableStart),
    );
    const matchableEnd = Math.max(
      ...current.filter((s) => s.matchableEnd > s.matchableStart).map((s) => s.matchableEnd),
    );
    if (!Number.isFinite(matchableStart) || matchableEnd <= matchableStart) {
      current = [];
      return;
    }
    if (rawEnd > rawStart) {
      chunks.push({
        segmentIndex: seg,
        startMs: rawStart,
        endMs: rawEnd,
        displayStart,
        displayEnd,
        matchableStart,
        matchableEnd,
        referenceText: tokenized.words.slice(displayStart, displayEnd).join(' '),
        matchableCount: matchableEnd - matchableStart,
      });
    }
    current = [];
  };

  for (let i = 0; i <= lastReadIndex; i++) {
    const s = sentences[i];
    if (current.length > 0) {
      const sameSegment = current[0].segmentIndex === s.segmentIndex;
      const spanMs =
        s.endMs + CHUNK_TAIL_MS - Math.max(0, current[0].startMs - CHUNK_LEAD_MS);
      if (!sameSegment || spanMs > MAX_CHUNK_MS) flush();
    }
    current.push(s);
  }
  flush();

  return chunks;
}

/** Re-exported so existing call sites keep importing scoring primitives from
 * here; the definitions live in `lib/score.ts`, which sits below this module. */
export { fillerScore, paceScore };

/**
 * Words the recognizer actually heard: those assessed as spoken, clean or not.
 * Omissions were never uttered and insertions are fillers, so neither counts.
 *
 * This is what separates a real attempt from silence, and it rides on the
 * `SessionResult` so the results screen's eligibility gate sees the same measure
 * the persisted record is judged by.
 */
export function spokenWordCount(words: readonly ResultWord[]): number {
  return words.filter((w) => w.status === 'good' || w.status === 'mispronounced').length;
}

/**
 * Pauses over `PAUSE_MIN_MS` between spoken words — the raw measure behind the
 * Flow caption, which previously had none because this was never recorded.
 *
 * Reads the same aligner commit timeline `buildChunks` consumes, with the same
 * two-tier time resolution (recognizer timings when present, otherwise the
 * active-ms coordinate). Commits are SORTED first: they are stored per reference
 * word but arrive per utterance, so several words share an arrival time and the
 * raw series can appear to move backwards.
 *
 * Two honest limits. Active ms excludes paused time, so a deliberate mic-off
 * pause is correctly not counted as a disfluency. And under the fallback the gap
 * is attributed to the first word of the burst that ended it, so the count and
 * length are right while the placement within an utterance is coarse.
 */
export function pauseStats(
  timeline: readonly (WordCommit | null)[],
  segmentActiveStartMs: readonly number[],
): { pauseCount: number; longestPauseMs: number } {
  const times: number[] = [];
  for (const commit of timeline) {
    if (!commit) continue;
    if (commit.endMsInSegment != null) {
      times.push((segmentActiveStartMs[commit.segmentIndex] ?? 0) + commit.endMsInSegment);
    } else {
      times.push(commit.atActiveMs);
    }
  }
  times.sort((a, b) => a - b);

  let pauseCount = 0;
  let longestPauseMs = 0;
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap >= PAUSE_MIN_MS) {
      pauseCount += 1;
      longestPauseMs = Math.max(longestPauseMs, gap);
    }
  }
  return { pauseCount, longestPauseMs };
}

/** A spoken word's span on the session's active-ms timeline. */
export type WordTiming = { startMs: number; endMs: number };

/**
 * Pauses from real word spans, which is what Azure's per-word offsets give us.
 *
 * Strictly better than `pauseStats`, and different in kind: that one only has
 * END times, so it measures end-to-end gaps and counts each word's own duration
 * as part of the silence before it. With a start and an end per word the gap is
 * the actual silence between them.
 */
export function pauseStatsFromTimings(timings: readonly WordTiming[]): {
  pauseCount: number;
  longestPauseMs: number;
} {
  const sorted = [...timings].sort((a, b) => a.startMs - b.startMs);
  let pauseCount = 0;
  let longestPauseMs = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].startMs - sorted[i - 1].endMs;
    if (gap >= PAUSE_MIN_MS) {
      pauseCount += 1;
      longestPauseMs = Math.max(longestPauseMs, gap);
    }
  }
  return { pauseCount, longestPauseMs };
}

/** A pace measurement needs a span this long to mean anything. */
const MIN_PACE_SPAN_MS = 2_000;

/**
 * Words per minute over the span actually spent speaking: first word's onset to
 * last word's release.
 *
 * The old measure divided matched words by the WHOLE active session, which was
 * biased low twice over. Time before the first word and after the last one is
 * not reading time, and it went straight into the denominator: three seconds of
 * getting settled on a 20-second read cost 15% of the measured pace. And the
 * numerator counted only words live alignment matched, so every word the
 * recognizer missed made the reader look slower than they were. `paceScore`
 * reaches zero at 0.4x target, so neither bias was cosmetic.
 *
 * Returns 0 when there is not enough signal, which callers already treat as
 * "pace was not measured" rather than as a bad pace.
 */
export function paceWpmFromTimings(timings: readonly WordTiming[]): number {
  if (timings.length < 2) return 0;
  let earliest = Infinity;
  let latest = -Infinity;
  for (const t of timings) {
    earliest = Math.min(earliest, t.startMs);
    latest = Math.max(latest, t.endMs);
  }
  const spanMs = latest - earliest;
  if (!Number.isFinite(spanMs) || spanMs < MIN_PACE_SPAN_MS) return 0;
  return Math.round(timings.length / (spanMs / 60_000));
}

/**
 * Everything known about one display token before it becomes a `ResultWord`.
 * Carries the whole Azure detail tier, not just a verdict and a score, so the
 * phoneme data survives assembly instead of being dropped on the floor.
 */
type VerdictCell = Omit<ResultWord, 'word' | 'status'> & { verdict: WordVerdict };

/**
 * Base per-display-token verdicts from live alignment. Punctuation-only
 * tokens inherit their preceding word's verdict so omitted runs render
 * contiguously.
 */
function baseVerdicts(
  tokenized: TokenizedPassage,
  statuses: RefWordStatus[],
): VerdictCell[] {
  const displayToMatchable = new Map<number, number>();
  tokenized.matchableIndices.forEach((displayIdx, matchableIdx) => {
    displayToMatchable.set(displayIdx, matchableIdx);
  });
  const out: VerdictCell[] = [];
  let previous: WordVerdict = 'good';
  for (let d = 0; d < tokenized.words.length; d++) {
    const m = displayToMatchable.get(d);
    if (m == null) {
      out.push({ verdict: previous });
      continue;
    }
    const verdict: WordVerdict = statuses[m] === 'matched' ? 'good' : 'omitted';
    out.push({ verdict });
    previous = verdict;
  }
  return out;
}

/** Assemble ResultWord[] from per-display verdicts plus spliced insertions. */
function assembleWords(
  tokenized: TokenizedPassage,
  verdicts: VerdictCell[],
  insertionsAfterDisplay: Map<number, ResultWord[]>,
): ResultWord[] {
  const out: ResultWord[] = [];
  const leading = insertionsAfterDisplay.get(-1);
  if (leading) out.push(...leading);
  tokenized.words.forEach((word, d) => {
    const { verdict, ...detail } = verdicts[d];
    out.push({ word, status: verdict, ...detail });
    const after = insertionsAfterDisplay.get(d);
    if (after) out.push(...after);
  });
  return out;
}

function insertionSpliceMap(
  tokenized: TokenizedPassage,
  insertions: CommittedInsertion[],
  filter: (i: CommittedInsertion) => boolean,
): Map<number, ResultWord[]> {
  const map = new Map<number, ResultWord[]>();
  for (const ins of insertions) {
    if (!filter(ins)) continue;
    const displayIdx =
      ins.afterMatchableIndex >= 0 ? tokenized.matchableIndices[ins.afterMatchableIndex] : -1;
    const list = map.get(displayIdx) ?? [];
    list.push({ word: ins.raw, status: 'inserted' });
    map.set(displayIdx, list);
  }
  return map;
}

export type ResultBuildParams = {
  tokenized: TokenizedPassage;
  statuses: RefWordStatus[];
  insertions: CommittedInsertion[];
  /** Live-derived pace, used when Azure supplied no word timings. */
  paceWpm: number;
  targetWpm: number;
  fillerCount: number;
  discourseMarkerCount?: number;
  durationMs: number;
  audioUri: string | null;
  waveform: number[];
  pauseCount?: number;
  longestPauseMs?: number;
};

/**
 * Where each recording segment sits, so a word's offset inside an assessed chunk
 * can be placed on two other timelines: the session's active-ms clock (for pace
 * and pauses) and the concatenated playback WAV (for replaying one word).
 */
export type SegmentGeometry = {
  /** Audio duration of each segment; 0 where the file was missing. Segments are
   * concatenated in index order, so the durations before segment N are exactly
   * its offset in the playable WAV. */
  durationsMs: readonly number[];
  /** Active-session ms at each segment's start. */
  activeStartMs: readonly number[];
};

/**
 * Aggregate Azure chunk assessments into a SessionResult. Returns null when
 * every chunk failed (caller then uses the live fallback). Chunks that
 * individually failed keep their live verdicts.
 */
export function buildAzureResult(
  params: ResultBuildParams & {
    chunks: SentenceChunk[];
    assessments: (ChunkAssessment | null)[];
    /** Omit to keep the live pace and pause measures. */
    segments?: SegmentGeometry;
  },
): SessionResult | null {
  const { tokenized, chunks, assessments, statuses, segments } = params;

  const succeeded = chunks
    .map((chunk, i) => ({ chunk, assessment: assessments[i] }))
    .filter((c): c is { chunk: SentenceChunk; assessment: ChunkAssessment } => c.assessment != null);
  if (succeeded.length === 0) return null;

  const verdicts = baseVerdicts(tokenized, statuses);
  const azureInsertions = new Map<number, ResultWord[]>();
  /** Spoken-word spans on the active-ms clock, for pace and pauses. */
  const timings: WordTiming[] = [];
  let unanchored = 0;

  for (const { chunk, assessment } of succeeded) {
    // Reference tokens this chunk covers, punctuation-only tokens excluded.
    const refDisplayIndices: number[] = [];
    const refNorms: string[] = [];
    for (let d = chunk.displayStart; d < chunk.displayEnd; d++) {
      if (tokenized.norms[d] === '') continue;
      refDisplayIndices.push(d);
      refNorms.push(tokenized.norms[d]);
    }

    // Anchored by TEXT: Azure and the tokenizer disagree about compounds, and a
    // positional walk silently shifted every verdict after the first
    // disagreement onto the wrong word.
    const mapped = mapAssessedWords(refDisplayIndices, refNorms, assessment.words);
    unanchored += mapped.unanchored;

    // A word's chunk-relative offset, placed on the two timelines that matter.
    const activeBase = (segments?.activeStartMs[chunk.segmentIndex] ?? 0) + chunk.startMs;
    const playbackBase =
      (segments?.durationsMs.slice(0, chunk.segmentIndex).reduce((sum, d) => sum + d, 0) ?? 0) +
      chunk.startMs;

    for (const [displayIndex, word] of mapped.words) {
      const cell: VerdictCell = { verdict: word.verdict };
      if (word.score != null) cell.score = clampScore(word.score);
      if (word.phonemes) cell.phonemes = word.phonemes;
      if (word.syllables) cell.syllables = word.syllables;
      if (word.prosody) cell.prosody = word.prosody;
      // Azure's offsets are the only accurate word timings in the pipeline. The
      // recognizer's are interpolated across an utterance at best and event
      // arrival times at worst, so prefer these for playback, pace, and pauses.
      if (segments && word.startMs != null && word.endMs != null) {
        cell.audioStartMs = playbackBase + word.startMs;
        cell.audioEndMs = playbackBase + word.endMs;
        timings.push({ startMs: activeBase + word.startMs, endMs: activeBase + word.endMs });
      }
      verdicts[displayIndex] = cell;
    }

    for (const insertion of mapped.insertions) {
      const list = azureInsertions.get(insertion.afterDisplay) ?? [];
      list.push({ word: insertion.word, status: 'inserted' });
      azureInsertions.set(insertion.afterDisplay, list);
    }
  }

  if (IS_DEV && unanchored > 0) {
    console.warn(
      `[scoring] ${unanchored} assessed word(s) anchored to no reference token. ` +
        'Their detail is dropped; surrounding verdicts are unaffected.',
    );
  }

  // Re-run punctuation inheritance now that Azure adjusted verdicts.
  let previous: WordVerdict = 'good';
  for (let d = 0; d < tokenized.words.length; d++) {
    if (tokenized.norms[d] === '') verdicts[d] = { ...verdicts[d], verdict: previous };
    else previous = verdicts[d].verdict;
  }

  const words = assembleWords(tokenized, verdicts, azureInsertions);

  // Word-count-weighted aggregation.
  const totalWeight = succeeded.reduce((sum, c) => sum + c.chunk.matchableCount, 0);
  const weighted = (pick: (a: ChunkAssessment) => number) =>
    succeeded.reduce((sum, c) => sum + pick(c.assessment) * c.chunk.matchableCount, 0) /
    totalWeight;

  const accuracy = clampScore(weighted((a) => a.accuracyScore));
  const fluency = clampScore(weighted((a) => a.fluencyScore));

  const prosodyChunks = succeeded.filter((c) => c.assessment.prosodyScore != null);
  const prosodyWeight = prosodyChunks.reduce((sum, c) => sum + c.chunk.matchableCount, 0);
  const intonation =
    prosodyWeight > 0
      ? clampScore(
          prosodyChunks.reduce(
            (sum, c) => sum + c.assessment.prosodyScore! * c.chunk.matchableCount,
            0,
          ) / prosodyWeight,
        )
      : fluency;

  // Completeness: Azure judged only the chunks it saw; cap by how much of the
  // whole passage was actually spoken (good or mispronounced = attempted).
  const azureCompleteness = weighted((a) => a.completenessScore);
  const totalRefWords = tokenized.matchableIndices.length;
  const attempted = tokenized.matchableIndices.filter(
    (d) => verdicts[d].verdict === 'good' || verdicts[d].verdict === 'mispronounced',
  ).length;
  const completeness = clampScore(
    Math.min(azureCompleteness, (100 * attempted) / Math.max(1, totalRefWords)),
  );

  // Pace and pauses prefer Azure's word spans over the live measures, which
  // were derived from recognition-event arrival times. Both fall back to the
  // live values when Azure returned no timings, so a region or locale that
  // omits them changes nothing.
  const azurePace = paceWpmFromTimings(timings);
  const paceWpm = azurePace > 0 ? azurePace : params.paceWpm;
  const azurePauses = timings.length >= 2 ? pauseStatsFromTimings(timings) : null;
  const pauseCount = azurePauses?.pauseCount ?? params.pauseCount ?? null;
  const longestPauseMs = azurePauses?.longestPauseMs ?? params.longestPauseMs ?? null;

  // The score is the mean of the five skills below it (see lib/score.ts), so
  // the hero number always reconciles with the skill rows the UI prints.
  const scored = {
    accuracy,
    fluency,
    completeness,
    intonation,
    paceWpm,
    targetWpm: params.targetWpm,
    fillerCount: params.fillerCount,
    durationMs: params.durationMs,
    source: 'azure',
  } as const;

  return {
    ...scored,
    overallScore: speakingScore(scored) ?? 0,
    discourseMarkerCount: params.discourseMarkerCount,
    words,
    spokenWords: spokenWordCount(words),
    audioUri: params.audioUri,
    waveform: params.waveform,
    pauseCount,
    longestPauseMs,
  };
}

/**
 * Live-derived fallback result (no Azure key / all chunks failed). Verdicts
 * come from alignment (matched = good, everything else = omitted, filler
 * insertions spliced); the numeric scores are documented proxies.
 */
export function buildLiveFallbackResult(params: ResultBuildParams): SessionResult {
  const { tokenized, statuses } = params;
  const verdicts = baseVerdicts(tokenized, statuses);
  // Splice only filler insertions in live mode — raw recognition noise would
  // clutter the breakdown without Azure's judgment to back it.
  const insertions = insertionSpliceMap(tokenized, params.insertions, (i) => i.filler);
  const words = assembleWords(tokenized, verdicts, insertions);

  const totalRefWords = Math.max(1, tokenized.matchableIndices.length);
  const matched = statuses.filter((s) => s === 'matched').length;
  const matchedRatio = matched / totalRefWords;

  const pace = paceScore(params.paceWpm, params.targetWpm);

  // Proxies: without Azure there is no pronunciation signal, so accuracy
  // leans on how reliably the recognizer matched the reference, fluency on
  // pace steadiness, and intonation is a neutral 70.
  const completeness = clampScore(100 * matchedRatio);
  const accuracy = Math.min(95, clampScore(70 + 25 * matchedRatio));
  const fluency = Math.min(95, clampScore(0.6 * pace + 0.4 * accuracy));
  const intonation = 70;

  // `source: 'live'` makes sessionSkills drop intonation, so the placeholder 70
  // above never reaches the score — it scores on Articulation, Flow, Pacing,
  // and Fillers.
  const scored = {
    accuracy,
    fluency,
    completeness,
    intonation,
    paceWpm: params.paceWpm,
    targetWpm: params.targetWpm,
    fillerCount: params.fillerCount,
    durationMs: params.durationMs,
    source: 'live',
  } as const;

  return {
    ...scored,
    overallScore: speakingScore(scored) ?? 0,
    discourseMarkerCount: params.discourseMarkerCount,
    words,
    spokenWords: spokenWordCount(words),
    audioUri: params.audioUri,
    waveform: params.waveform,
    pauseCount: params.pauseCount ?? null,
    longestPauseMs: params.longestPauseMs ?? null,
  };
}

/** Conversational default when no reference text sets a target. */
export const FREESTYLE_TARGET_WPM = 150;

export type FreestyleResultParams = {
  transcript: string;
  paceWpm: number;
  fillerCount: number;
  discourseMarkerCount?: number;
  durationMs: number;
  audioUri: string | null;
  waveform: number[];
};

/**
 * Freestyle (no reference text) result. Azure's scripted assessment doesn't
 * apply, so the scores are documented live proxies: pace vs a conversational
 * 150wpm, filler rate, and a fluency blend of the two. Accuracy/completeness
 * are 0 and intonation the neutral 70 — the results UI hides all three in
 * freestyle mode.
 */
export function buildFreestyleResult(params: FreestyleResultParams): SessionResult {
  const pace = paceScore(params.paceWpm, FREESTYLE_TARGET_WPM);
  const filler = fillerScore(params.fillerCount, params.durationMs);
  const fluency = clampScore(0.55 * pace + 0.45 * filler);

  // `mode: 'freestyle'` plus `source: 'live'` makes sessionSkills drop both
  // accuracy and intonation, so the 0 and the placeholder 70 below never reach
  // the score — freestyle scores on Flow, Pacing, and Fillers alone.
  const scored = {
    mode: 'freestyle',
    accuracy: 0,
    fluency,
    completeness: 0,
    intonation: 70,
    paceWpm: params.paceWpm,
    targetWpm: FREESTYLE_TARGET_WPM,
    fillerCount: params.fillerCount,
    durationMs: params.durationMs,
    source: 'live',
  } as const;

  return {
    ...scored,
    overallScore: speakingScore(scored) ?? 0,
    discourseMarkerCount: params.discourseMarkerCount,
    transcript: params.transcript,
    words: [],
    // No reference text, so the committed transcript is the only evidence of
    // what was actually said.
    spokenWords: params.transcript.trim().split(/\s+/).filter(Boolean).length,
    audioUri: params.audioUri,
    waveform: params.waveform,
    // Freestyle keeps only per-utterance finals, with no per-word commits, so
    // there is no honest pause resolution. Null degrades the Flow caption away
    // rather than inventing a measure.
    pauseCount: null,
    longestPauseMs: null,
  };
}

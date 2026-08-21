/**
 * Anchored incremental, reference-aware alignment between live
 * speech-recognition transcripts and a tokenized passage.
 *
 * Design (see plan):
 * - Final results commit an anchor (`anchorRef` into the reference words,
 *   `anchorTranscriptLen` into the transcript tokens). Every result event
 *   re-aligns all *pending* (post-anchor) tokens from the anchor, which
 *   absorbs interim retro-mutations for free.
 * - A banded dynamic-programming pass absorbs substitutions, omissions,
 *   insertions, repeated words, and small recognizer rewrites without losing
 *   the passage frontier.
 * - Unmatched transcript tokens are insertion candidates; only insertions
 *   committed by a FINAL result feed the filler counter.
 * - The last matched token of an interim result is treated as "partial"
 *   (currently being spoken): the frontier points AT it, not past it.
 *
 * PURE module: no react / react-native imports, so it runs under bun for
 * the self-test scripts.
 */

// Filler lexicon (shared with the freestyle session), applied here to
// final-committed insertions only (words that did NOT match the reference —
// "so" spoken where the passage says "so" is never a filler).
import { DISCOURSE_MARKERS, FILLER_BIGRAMS, FILLER_UNIGRAMS } from '@/lib/fillers';
import { normalizeToken, type TokenizedPassage } from '@/lib/passage-text';

/** Kept as a public compatibility constant for the self-tests and callers. */
export const SKIP_TOLERANCE = 4;

const ALIGNMENT_LOOKAHEAD = 12;
const INSERTION_COST = 0.92;
const DELETION_COST = 0.78;
const SUBSTITUTION_COST = 1.62;

const WPM_WINDOW_MS = 15_000;
/** No live WPM until this much active time has elapsed. */
const WPM_MIN_ELAPSED_MS = 5_000;
/** ...and until the sample window spans at least this long. */
const WPM_MIN_SPAN_MS = 2_000;

export type TranscriptSegmentTiming = {
  /** Ms offset of the utterance start within the current recording segment. */
  startTimeMillis: number;
  /** Ms offset of the utterance end within the current recording segment. */
  endTimeMillis: number;
  /** The text portion covered by this timing span. */
  segment: string;
};

export type AlignerEvent = {
  transcript: string;
  isFinal: boolean;
  /** Active-session ms (pauses excluded) when the event arrived — wall-clock fallback for timestamps. */
  atActiveMs: number;
  /** Recognizer-provided timings, relative to the current recording segment's audio. */
  segments?: TranscriptSegmentTiming[];
};

export type RefWordStatus = 'unspoken' | 'matched' | 'skipped';

export type WordCommit = {
  /** Index into the tokenized passage's matchable words. */
  matchableIndex: number;
  /** Index into the tokenized passage's display words. */
  displayIndex: number;
  /** Recording segment (pause/resume cycle) this word was heard in. */
  segmentIndex: number;
  /** Ms offset within that segment's audio, when the recognizer provided timings. */
  endMsInSegment: number | null;
  /** Active-session ms at commit (wall-clock fallback). */
  atActiveMs: number;
};

export type CommittedInsertion = {
  /** Normalized token. */
  norm: string;
  /** Raw token as transcribed. */
  raw: string;
  segmentIndex: number;
  endMsInSegment: number | null;
  atActiveMs: number;
  /** Last matched matchable index before this insertion; -1 when none. */
  afterMatchableIndex: number;
  /** Whether the scored filler lexicon matched this insertion (bigrams flag both tokens). */
  filler: boolean;
  /** An ambiguous discourse marker (`like`, `so`, `well`). Reported to the AI
   * coach, never scored — see lib/fillers.ts. */
  discourseMarker: boolean;
};

type Token = { raw: string; norm: string; endMs: number | null };

type MatchKind = 'exact' | 'fuzzy' | 'prefix';

type AlignmentMatch = {
  token: Token;
  refIdx: number;
  kind: MatchKind;
};

type AlignmentInsertion = {
  token: Token;
  afterRef: number;
};

type AlignmentResult = {
  matches: AlignmentMatch[];
  skippedRefs: number[];
  insertionRuns: AlignmentInsertion[][];
  refPos: number;
  lastMatch: number | null;
  provisionalRef: number | null;
  fullMatchCount: number;
  exactMatchCount: number;
  partialFraction: number;
  cost: number;
};

type DpStep =
  | { kind: 'match'; matchKind: MatchKind }
  | { kind: 'substitute' }
  | { kind: 'insert' }
  | { kind: 'delete' };

type DpCell = {
  cost: number;
  previousI: number;
  previousJ: number;
  step: DpStep | null;
};

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = new Array<number>(b.length + 1);
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * A compact phonetic key. It is intentionally conservative: it is only a
 * fallback for recognizer spellings such as "nite"/"night", never the primary
 * match signal.
 */
function phoneticKey(input: string): string {
  const value = input
    .replace(/^kn/, 'n')
    .replace(/^wr/, 'r')
    .replace(/^wh/, 'w')
    .replace(/ph/g, 'f')
    .replace(/ght/g, 't')
    .replace(/ck/g, 'k')
    .replace(/qu/g, 'k')
    .replace(/[aeiouy]/g, '')
    .replace(/(.)\1+/g, '$1');
  return value.slice(0, 6);
}

function matchCost(
  token: Token,
  reference: string,
  allowPrefix: boolean,
): { cost: number; kind: MatchKind | null } {
  if (token.norm === reference) return { cost: 0, kind: 'exact' };

  if (
    allowPrefix &&
    token.norm.length >= 2 &&
    reference.startsWith(token.norm)
  ) {
    return { cost: 0.12, kind: 'prefix' };
  }

  const distance = editDistance(token.norm, reference);
  const ratio = distance / Math.max(token.norm.length, reference.length, 1);
  if (ratio <= 0.34) {
    return { cost: 0.42 + ratio, kind: 'fuzzy' };
  }

  if (
    token.norm.length >= 3 &&
    reference.length >= 3 &&
    phoneticKey(token.norm) === phoneticKey(reference)
  ) {
    return { cost: 0.7, kind: 'fuzzy' };
  }

  return { cost: SUBSTITUTION_COST, kind: null };
}

/**
 * Split a transcript into normalized tokens. When recognizer segment timings
 * are provided, per-token end times are interpolated across each span.
 */
export function tokenizeTranscript(
  transcript: string,
  segments?: TranscriptSegmentTiming[],
): Token[] {
  const out: Token[] = [];
  const pushTokens = (text: string, startMs: number | null, endMs: number | null) => {
    const raws = text.split(/\s+/).filter(Boolean);
    raws.forEach((raw, i) => {
      const norm = normalizeToken(raw);
      if (!norm) return;
      let tokenEnd: number | null = null;
      if (startMs != null && endMs != null) {
        tokenEnd = startMs + ((endMs - startMs) * (i + 1)) / raws.length;
      }
      out.push({ raw, norm, endMs: tokenEnd });
    });
  };

  const usable = segments?.filter((s) => s.segment.trim().length > 0) ?? [];
  if (usable.length > 0) {
    for (const seg of usable) {
      pushTokens(seg.segment, seg.startTimeMillis, seg.endTimeMillis);
    }
    if (out.length > 0) return out;
  }
  pushTokens(transcript, null, null);
  return out;
}

type PendingAlignment = {
  matchedRefs: number[];
  skippedRefs: number[];
  /** Ref position after consuming all pending tokens. */
  refPos: number;
  /** Last matched matchable index (including a prefix-matched partial), or null. */
  lastMatch: number | null;
  /** Reference word visually associated with the trailing interim token. */
  provisionalRef: number | null;
  /** Full (non-prefix) matches only. */
  fullMatchCount: number;
  /** Recognizer-observed 0..1 progress through the provisional word. */
  partialFraction: number;
};

const EMPTY_PENDING: PendingAlignment = {
  matchedRefs: [],
  skippedRefs: [],
  refPos: 0,
  lastMatch: null,
  provisionalRef: null,
  fullMatchCount: 0,
  partialFraction: 0,
};

export class PassageAligner {
  private readonly refNorms: string[];
  private readonly refDisplay: number[];
  private readonly displayWordCount: number;

  /** Committed status per matchable index. */
  private committed: RefWordStatus[];
  /** Commit metadata per matchable index (matched words only). */
  readonly timeline: (WordCommit | null)[];
  readonly committedInsertions: CommittedInsertion[] = [];

  private anchorRef = 0;
  private anchorTranscriptLen = 0;
  /** Norms of the committed transcript prefix — detects utterance resets. */
  private anchorNorms: string[] = [];
  private committedMatched = 0;
  private lastCommittedMatch = -1;
  private segmentIndex = 0;
  private pending: PendingAlignment;
  private interim = false;

  fillerCount = 0;
  /** Ambiguous markers in committed insertions. Not part of any score. */
  discourseMarkerCount = 0;

  private wpmSamples: { atMs: number; matched: number }[] = [];

  constructor(private readonly tokenized: TokenizedPassage) {
    this.refNorms = tokenized.matchableIndices.map((d) => tokenized.norms[d]);
    this.refDisplay = tokenized.matchableIndices.slice();
    this.displayWordCount = tokenized.words.length;
    this.committed = new Array(this.refNorms.length).fill('unspoken');
    this.timeline = new Array(this.refNorms.length).fill(null);
    this.pending = { ...EMPTY_PENDING };
  }

  get totalMatchable(): number {
    return this.refNorms.length;
  }

  /** Matched words, committed + pending (full matches only). */
  get matchedCount(): number {
    return this.committedMatched + this.pending.fullMatchCount;
  }

  get isComplete(): boolean {
    return Math.max(this.anchorRef, this.pending.refPos) >= this.refNorms.length;
  }

  /**
   * Display index of the first word not yet fully spoken. During an interim
   * result the last matched word counts as partial (frontier points at it).
   */
  get currentWordIndex(): number {
    if (this.interim && this.pending.provisionalRef != null) {
      return this.refDisplay[this.pending.provisionalRef];
    }
    const frontier = Math.max(this.anchorRef, this.pending.refPos);
    return frontier < this.refDisplay.length ? this.refDisplay[frontier] : this.displayWordCount;
  }

  /** Recognizer-derived fraction for the current provisional word. */
  get currentWordFraction(): number {
    return this.interim ? this.pending.partialFraction : 0;
  }

  /** Called when a new recognition session begins (start/resume/auto-restart). */
  beginSegment(segmentIndex: number): void {
    this.segmentIndex = segmentIndex;
    this.anchorTranscriptLen = 0;
    this.anchorNorms = [];
    this.pending = { ...EMPTY_PENDING, refPos: this.anchorRef };
    this.interim = false;
  }

  private alignPending(tokens: Token[], isFinal: boolean): AlignmentResult {
    const pendingTokens = tokens.slice(this.anchorTranscriptLen);
    const referenceEnd = Math.min(
      this.refNorms.length,
      this.anchorRef + pendingTokens.length + ALIGNMENT_LOOKAHEAD,
    );
    const references = this.refNorms.slice(this.anchorRef, referenceEnd);
    const rows = pendingTokens.length + 1;
    const columns = references.length + 1;
    const dp: DpCell[][] = Array.from({ length: rows }, () =>
      Array.from({ length: columns }, () => ({
        cost: Number.POSITIVE_INFINITY,
        previousI: -1,
        previousJ: -1,
        step: null,
      })),
    );
    dp[0][0].cost = 0;

    const update = (
      i: number,
      j: number,
      cost: number,
      previousI: number,
      previousJ: number,
      step: DpStep,
    ) => {
      if (cost < dp[i][j].cost - 1e-9) {
        dp[i][j] = { cost, previousI, previousJ, step };
      }
    };

    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < columns; j++) {
        const cell = dp[i][j];
        if (!Number.isFinite(cell.cost)) continue;

        if (i < pendingTokens.length) {
          update(i + 1, j, cell.cost + INSERTION_COST, i, j, { kind: 'insert' });
        }
        if (j < references.length) {
          update(i, j + 1, cell.cost + DELETION_COST, i, j, { kind: 'delete' });
        }
        if (i < pendingTokens.length && j < references.length) {
          const comparison = matchCost(
            pendingTokens[i],
            references[j],
            !isFinal && i === pendingTokens.length - 1,
          );
          update(
            i + 1,
            j + 1,
            cell.cost + comparison.cost,
            i,
            j,
            comparison.kind
              ? { kind: 'match', matchKind: comparison.kind }
              : { kind: 'substitute' },
          );
        }
      }
    }

    // Consume every transcript token, but never pay for trailing reference
    // deletions that do not help explain the audio.
    let endJ = 0;
    for (let j = 1; j < columns; j++) {
      if (dp[pendingTokens.length][j].cost < dp[pendingTokens.length][endJ].cost) {
        endJ = j;
      }
    }

    const steps: { step: DpStep; tokenIndex: number; refIndex: number }[] = [];
    let i = pendingTokens.length;
    let j = endJ;
    while (i > 0 || j > 0) {
      const cell = dp[i][j];
      if (!cell.step) break;
      steps.push({
        step: cell.step,
        tokenIndex: cell.previousI,
        refIndex: cell.previousJ,
      });
      i = cell.previousI;
      j = cell.previousJ;
    }
    steps.reverse();

    const matches: AlignmentMatch[] = [];
    const skippedRefs: number[] = [];
    const insertionRuns: AlignmentInsertion[][] = [];
    let currentInsertionRun: AlignmentInsertion[] | null = null;
    let lastMatch: number | null = null;
    let provisionalRef: number | null = null;
    let partialFraction = 0;
    let exactMatchCount = 0;

    const addInsertion = (token: Token, afterRef: number) => {
      if (!currentInsertionRun) {
        currentInsertionRun = [];
        insertionRuns.push(currentInsertionRun);
      }
      currentInsertionRun.push({ token, afterRef });
    };

    for (const entry of steps) {
      const absoluteRef = this.anchorRef + entry.refIndex;
      switch (entry.step.kind) {
        case 'match': {
          const token = pendingTokens[entry.tokenIndex];
          const matchKind = entry.step.matchKind;
          matches.push({ token, refIdx: absoluteRef, kind: matchKind });
          lastMatch = absoluteRef;
          provisionalRef = absoluteRef;
          currentInsertionRun = null;
          if (matchKind === 'exact') exactMatchCount++;
          if (matchKind === 'prefix') {
            partialFraction = Math.max(
              0.15,
              Math.min(0.92, token.norm.length / Math.max(this.refNorms[absoluteRef].length, 1)),
            );
          } else {
            partialFraction = 0.82;
          }
          break;
        }
        case 'substitute': {
          skippedRefs.push(absoluteRef);
          provisionalRef = absoluteRef;
          partialFraction = 0.58;
          addInsertion(pendingTokens[entry.tokenIndex], lastMatch ?? this.lastCommittedMatch);
          break;
        }
        case 'insert':
          addInsertion(pendingTokens[entry.tokenIndex], lastMatch ?? this.lastCommittedMatch);
          break;
        case 'delete':
          skippedRefs.push(absoluteRef);
          currentInsertionRun = null;
          break;
      }
    }

    return {
      matches,
      skippedRefs,
      insertionRuns,
      refPos: this.anchorRef + endJ,
      lastMatch,
      provisionalRef,
      fullMatchCount: matches.filter((match) => match.kind !== 'prefix').length,
      exactMatchCount,
      partialFraction,
      cost: dp[pendingTokens.length][endJ].cost,
    };
  }

  /**
   * Score a recognizer alternative without changing alignment state. Higher is
   * better. Exact reference progress dominates raw recognizer confidence.
   */
  scoreEvent(event: AlignerEvent, confidence = 0): number {
    const tokens = tokenizeTranscript(event.transcript, event.segments);
    const hasStablePrefix =
      tokens.length >= this.anchorTranscriptLen &&
      this.anchorNorms.every((norm, index) => tokens[index]?.norm === norm);
    const candidateTokens = hasStablePrefix
      ? tokens
      : tokens.slice(0);
    const originalAnchorLength = this.anchorTranscriptLen;
    if (!hasStablePrefix) this.anchorTranscriptLen = 0;
    const alignment = this.alignPending(candidateTokens, event.isFinal);
    this.anchorTranscriptLen = originalAnchorLength;

    const insertionCount = alignment.insertionRuns.reduce((sum, run) => sum + run.length, 0);
    return (
      alignment.exactMatchCount * 4 +
      (alignment.fullMatchCount - alignment.exactMatchCount) * 2.1 -
      alignment.skippedRefs.length * 0.7 -
      insertionCount * 1.1 -
      alignment.cost * 0.35 +
      Math.max(0, confidence) * 0.25
    );
  }

  handleEvent(event: AlignerEvent): void {
    const tokens = tokenizeTranscript(event.transcript, event.segments);

    // Android continuous mode resets the transcript after each final result:
    // a shrunken token list, or a committed prefix that no longer matches,
    // means a new utterance started. (On iOS the transcript accumulates for
    // the whole session and finals are stable, so the prefix always matches.)
    if (
      tokens.length < this.anchorTranscriptLen ||
      !this.anchorNorms.every((norm, i) => tokens[i]?.norm === norm)
    ) {
      this.anchorTranscriptLen = 0;
      this.anchorNorms = [];
    }

    const alignment = this.alignPending(tokens, event.isFinal);

    if (event.isFinal) {
      for (const m of alignment.matches) {
        if (m.kind === 'prefix') continue; // never commit a prefix guess
        if (this.committed[m.refIdx] !== 'matched') {
          this.committed[m.refIdx] = 'matched';
          this.committedMatched++;
        }
        this.timeline[m.refIdx] = {
          matchableIndex: m.refIdx,
          displayIndex: this.refDisplay[m.refIdx],
          segmentIndex: this.segmentIndex,
          endMsInSegment: m.token.endMs,
          atActiveMs: event.atActiveMs,
        };
      }
      for (const s of alignment.skippedRefs) {
        if (this.committed[s] === 'unspoken') this.committed[s] = 'skipped';
      }
      for (const run of alignment.insertionRuns) {
        // Filler detection: greedy bigrams first, then unigrams.
        let i = 0;
        const fillerAt = new Array<boolean>(run.length).fill(false);
        while (i < run.length) {
          if (
            i + 1 < run.length &&
            FILLER_BIGRAMS.has(`${run[i].token.norm} ${run[i + 1].token.norm}`)
          ) {
            this.fillerCount++;
            fillerAt[i] = true;
            fillerAt[i + 1] = true;
            i += 2;
          } else {
            if (FILLER_UNIGRAMS.has(run[i].token.norm)) {
              this.fillerCount++;
              fillerAt[i] = true;
            }
            i += 1;
          }
        }
        run.forEach((entry, j) => {
          const discourseMarker = !fillerAt[j] && DISCOURSE_MARKERS.has(entry.token.norm);
          if (discourseMarker) this.discourseMarkerCount++;
          this.committedInsertions.push({
            norm: entry.token.norm,
            raw: entry.token.raw,
            segmentIndex: this.segmentIndex,
            endMsInSegment: entry.token.endMs,
            atActiveMs: event.atActiveMs,
            afterMatchableIndex: entry.afterRef,
            filler: fillerAt[j],
            discourseMarker,
          });
        });
      }
      this.anchorRef = alignment.refPos;
      this.anchorTranscriptLen = tokens.length;
      this.anchorNorms = tokens.map((t) => t.norm);
      if (alignment.lastMatch != null) this.lastCommittedMatch = alignment.lastMatch;
      this.pending = { ...EMPTY_PENDING, refPos: alignment.refPos };
      this.interim = false;
    } else {
      this.pending = {
        matchedRefs: alignment.matches.reduce<number[]>((refs, match) => {
          if (match.kind !== 'prefix') refs.push(match.refIdx);
          return refs;
        }, []),
        skippedRefs: alignment.skippedRefs,
        refPos: alignment.refPos,
        lastMatch: alignment.lastMatch,
        provisionalRef: alignment.provisionalRef,
        fullMatchCount: alignment.fullMatchCount,
        partialFraction: alignment.partialFraction,
      };
      this.interim = true;
    }
  }

  /**
   * Per-matchable-word statuses: committed alignment overlaid with the last
   * pending interim (so a stop() before the trailing final still counts what
   * was clearly heard).
   */
  refWordStatuses(): RefWordStatus[] {
    const statuses = this.committed.slice();
    for (const m of this.pending.matchedRefs) {
      if (statuses[m] === 'unspoken') statuses[m] = 'matched';
    }
    for (const s of this.pending.skippedRefs) {
      if (statuses[s] === 'unspoken') statuses[s] = 'skipped';
    }
    return statuses;
  }

  /** Push a WPM sample (~1Hz from the engine's tick loop). */
  recordWpmSample(atActiveMs: number): void {
    this.wpmSamples.push({ atMs: atActiveMs, matched: this.matchedCount });
    const cutoff = atActiveMs - WPM_WINDOW_MS - 500;
    while (this.wpmSamples.length > 0 && this.wpmSamples[0].atMs < cutoff) {
      this.wpmSamples.shift();
    }
  }

  /** Trailing-window live WPM; 0 until there's enough signal. */
  getLiveWpm(nowActiveMs: number): number {
    if (nowActiveMs < WPM_MIN_ELAPSED_MS) return 0;
    const windowStart = nowActiveMs - WPM_WINDOW_MS;
    let baseline: { atMs: number; matched: number } | null = null;
    for (const sample of this.wpmSamples) {
      if (sample.atMs >= windowStart) {
        baseline = sample;
        break;
      }
      baseline = sample; // keep the last sample before the window as the base
    }
    if (!baseline) return 0;
    const spanMs = nowActiveMs - baseline.atMs;
    if (spanMs < WPM_MIN_SPAN_MS) return 0;
    const words = this.matchedCount - baseline.matched;
    return Math.max(0, Math.round((words / spanMs) * 60_000));
  }

  reset(): void {
    this.committed = new Array(this.refNorms.length).fill('unspoken');
    this.timeline.fill(null);
    this.committedInsertions.length = 0;
    this.anchorRef = 0;
    this.anchorTranscriptLen = 0;
    this.anchorNorms = [];
    this.committedMatched = 0;
    this.lastCommittedMatch = -1;
    this.segmentIndex = 0;
    this.pending = { ...EMPTY_PENDING };
    this.interim = false;
    this.fillerCount = 0;
    this.discourseMarkerCount = 0;
    this.wpmSamples = [];
  }
}

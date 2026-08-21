import type { SharedValue } from 'react-native-reanimated';

import type { SessionMode, SkillKey } from './history';

/** Library grouping for the Practice tab. */
export type PassageCategory =
  | 'stories'
  | 'news'
  | 'narration'
  | 'poetry'
  | 'twisters'
  | 'drill'
  | 'custom';

/** A practice passage: home-card metadata plus the reading content. */
export type Passage = {
  id: string;
  title: string;
  /** Display duration for cards, e.g. "~2 mins". */
  duration: string;
  artwork: {
    base: [string, string];
    blob: [string, string];
  };
  /** Full reference text. Paragraphs separated by "\n\n". */
  text: string;
  targetWpm: number;
  category?: PassageCategory;
  /** Skills this content trains — matched against the weakest-skill profile. */
  skills?: SkillKey[];
};

/** A user-authored passage persisted by services/user-passages.ts. */
export type CustomPassage = Passage & {
  custom: true;
  createdAt: number;
};

export type PracticeStatus =
  | 'idle'
  | 'listening'
  | 'paused'
  | 'processing'
  | 'done'
  | 'error';

export type PracticeErrorCode =
  | 'permission-denied'
  | 'recognition-unavailable'
  | 'no-speech'
  | 'unknown';

export type PracticeError = {
  code: PracticeErrorCode;
  message: string;
};

export type WordVerdict = 'good' | 'mispronounced' | 'omitted' | 'inserted';

/** One sound inside a word, as Azure scored it. */
export type ResultPhoneme = {
  /** IPA symbol the word expects here. */
  phoneme: string;
  /** 0–100; null when Azure returned the phoneme without a score. */
  score: number | null;
  /**
   * What Azure thought it actually heard, best first, when that differs from
   * `phoneme`. This is the difference between "this word scored 42" and "you
   * said /s/ where this word wants /ʃ/", so it is the one field the word detail
   * view is built around.
   */
  heard?: { phoneme: string; score: number }[];
};

export type ResultSyllable = {
  syllable: string;
  /** The letters this syllable covers, when Azure supplied them. */
  grapheme?: string;
  score: number | null;
};

/** Per-word prosody flags. Present only where Azure flagged something. */
export type ResultProsody = {
  unexpectedBreak?: boolean;
  missingBreak?: boolean;
  monotone?: boolean;
};

export type ResultWord = {
  word: string;
  status: WordVerdict;
  /** Azure per-word AccuracyScore 0–100; absent for inserted words and live-fallback results. */
  score?: number;
  /** Azure phoneme tier. Absent under the live fallback, and on any word Azure
   * did not assess. */
  phonemes?: ResultPhoneme[];
  syllables?: ResultSyllable[];
  prosody?: ResultProsody;
  /**
   * Where this word sits in the session's playable WAV, so the results screen
   * can replay the user saying this exact word. Ms into `SessionResult.audioUri`.
   */
  audioStartMs?: number;
  audioEndMs?: number;
};

/** Below this a phoneme is worth pointing at. Azure's own word-level
 * mispronunciation threshold sits around 60, so this matches it: a callout
 * should name a sound the user can hear is off. */
export const PHONEME_WEAK_MAX = 60;

/** The weakest sound in a word, or null when nothing is clearly weakest. A
 * phoneme has to be both low and the low one to earn a callout. */
export function weakestPhoneme(word: ResultWord): ResultPhoneme | null {
  const scored = (word.phonemes ?? []).filter(
    (p): p is ResultPhoneme & { score: number } => p.score != null,
  );
  if (scored.length === 0) return null;
  const weakest = scored.reduce((low, p) => (p.score < low.score ? p : low), scored[0]);
  return weakest.score < PHONEME_WEAK_MAX ? weakest : null;
}

export type SessionResult = {
  /** Defaults to 'passage' when absent (pre-freestyle results). */
  mode?: SessionMode;
  /** Freestyle only: the full recognized transcript. */
  transcript?: string;
  /** 0–100 blended score (pronunciation + pace + fillers). */
  overallScore: number;
  accuracy: number;
  fluency: number;
  completeness: number;
  intonation: number;
  paceWpm: number;
  targetWpm: number;
  fillerCount: number;
  /**
   * Ambiguous discourse markers (`like`, `so`, `well`). Counted and passed to
   * the AI coach, deliberately NOT scored: telling a filler `so` from a
   * connective `so` needs syntax the app does not have, and a count we cannot
   * stand behind must not move a number the user is judged by.
   */
  discourseMarkerCount?: number;
  words: ResultWord[];
  /** Playable WAV (segments concatenated across pauses); null when unavailable. */
  audioUri: string | null;
  /** Active speaking time, pauses excluded. */
  durationMs: number;
  /** Silences over `PAUSE_MIN_MS` between spoken words — the raw measure behind
   * the Flow caption. null when the session had no per-word timings to measure
   * (freestyle keeps only per-utterance finals). */
  pauseCount?: number | null;
  longestPauseMs?: number | null;
  /**
   * Words the recognizer actually heard. Carried on the result — not just the
   * persisted record — because the results screen scores the live `SessionResult`
   * directly, and `isScorable` treats a missing `spokenWords` as "trust it".
   * Without this the eligibility gate silently passed here while the same session
   * was excluded everywhere else, so Results showed a confident score for a
   * session that appears nowhere in Home or Analytics.
   */
  spokenWords: number;
  /** ~30 normalized 0..1 amplitude buckets for the playback pill. */
  waveform: number[];
  /** 'live' when Azure was unavailable/failed and scores are derived from live data. */
  source: 'azure' | 'live';
};

export type PracticeSession = {
  status: PracticeStatus;
  /** Non-null exactly when status === 'error'. */
  error: PracticeError | null;
  /** Active time excluding pauses; ticks ~every 250ms. */
  elapsedMs: number;
  /** Rolling-window WPM; 0 until enough signal (~5s). Updates ~1Hz. */
  liveWpm: number;
  /** Live filler-word count. */
  fillerCount: number;
  /** Display tokens from tokenizePassage — the single source of truth for word indices. */
  words: string[];
  /** Frontier: index of the first word not yet fully spoken. */
  currentWordIndex: number;
  /** 0..1 progress through the current word, animated on the UI runtime. */
  currentWordFraction: SharedValue<number>;
  /** 0..1 smoothed mic level, written on the UI-thread-safe path for the waveform. */
  meterLevel: SharedValue<number>;
  /** Populated when status === 'done' (same value stop() resolves with). */
  result: SessionResult | null;
  /** Requests permissions and begins listening. NOT called automatically on mount. */
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  /** Abort and reset to a fresh listening session. */
  restart(): void;
  /** Abandon the session entirely (dismiss): stop everything, discard recordings. */
  cancel(): void;
  /** Ends the session: → 'processing' → 'done'. Resolves with the final result. */
  stop(): Promise<SessionResult>;
};

/** Freestyle (impromptu) session: same lifecycle as PracticeSession but the
 * live surface is a growing transcript instead of a passage frontier. */
export type FreestyleSession = {
  status: PracticeStatus;
  error: PracticeError | null;
  elapsedMs: number;
  liveWpm: number;
  fillerCount: number;
  /** Committed (final-result) transcript so far. */
  finalTranscript: string;
  /** In-flight interim tail, replaced as the recognizer refines it. */
  interimTranscript: string;
  meterLevel: SharedValue<number>;
  result: SessionResult | null;
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  restart(): void;
  cancel(): void;
  stop(): Promise<SessionResult>;
};

export type LiveWordState = 'spoken' | 'current' | 'upcoming';

/** Derive a word's live render state from the frontier index. */
export function getWordState(index: number, currentWordIndex: number): LiveWordState {
  if (index < currentWordIndex) return 'spoken';
  if (index === currentWordIndex) return 'current';
  return 'upcoming';
}

export type ResultPlayback = {
  isPlaying: boolean;
  /** Playback position; updates ~4Hz while playing. */
  positionMs: number;
  toggle(): void;
};

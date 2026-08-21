export type SpeechCoachStats = {
  /** 'passage' | 'drill' read against a reference text; 'freestyle' impromptu. */
  mode: 'passage' | 'drill' | 'freestyle';
  /** Freestyle only: the recognized transcript, capped for the prompt. */
  transcriptExcerpt?: string;
  overallScore: number;
  accuracy: number;
  fluency: number;
  completeness: number;
  intonation: number;
  paceWpm: number;
  targetWpm: number;
  fillerCount: number;
  /** Ambiguous markers (`like`, `so`, `well`). Measured but NOT scored, so the
   * prompt is told to treat it as an observation, not a penalty. */
  discourseMarkerCount?: number;
  durationSeconds: number;
  /** Silences over 1.5s between spoken words. Absent when the session had no
   * usable word timings. */
  pauseCount?: number;
  longestPauseSeconds?: number;
  assessmentSource: 'azure' | 'live';
  wordCounts: {
    good: number;
    mispronounced: number;
    omitted: number;
    inserted: number;
  };
  challengingWords: string[];
  /**
   * The specific sounds that scored worst, e.g. `{ word: 'measure', phoneme:
   * 'ʒ', heard: 'z', score: 38 }`. This is the only part of the payload that
   * lets a tip name a sound instead of restating a score, so it is worth the
   * tokens.
   */
  weakSounds?: {
    word: string;
    /** IPA symbol the word expects. */
    phoneme: string;
    /** IPA the assessment thought it heard instead, when it differed. */
    heard?: string;
    score: number;
  }[];
  /** Per-word prosody flags Azure raised, as counts. */
  prosodyFlags?: {
    unexpectedBreaks?: number;
    missingBreaks?: number;
    monotoneWords?: number;
  };
};

export type AiCoachingTip = {
  title: string;
  guidance: string;
  evidence: string;
};

export type AiCoachingBreakdown = {
  summary: string;
  tips: AiCoachingTip[];
};

/** In-flight snapshot of the breakdown while the response streams in. */
export type PartialAiCoachingBreakdown = {
  summary?: string;
  tips?: (Partial<AiCoachingTip> | undefined)[];
};

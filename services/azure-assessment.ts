/**
 * The Azure Pronunciation Assessment RESPONSE: its wire types and its parser.
 *
 * Split out from `azure-pronunciation.ts` because that module imports
 * `expo/fetch`, which drags react-native in and cannot load under bun. The
 * parsing is the part with real judgement in it (see `parseProsody`), so it is
 * the part that most needs a test against a captured response.
 *
 * PURE module: no react-native, no network. Runs under bun for the self-tests.
 */

export type AzureSpeechConfig = {
  key: string;
  region: string;
  /** BCP-47, default en-US. Set from the user's accent so a non-American
   * pronunciation isn't graded against a General American reference. */
  locale?: string;
};

export type AzureErrorType = 'None' | 'Omission' | 'Insertion' | 'Mispronunciation';

/** Azure reports offsets and durations in ticks of 100ns. */
const TICKS_PER_MS = 10_000;

/** One phoneme of a word, with the alternatives Azure considered. */
export type AzurePhoneme = {
  /** IPA symbol (we request `PhonemeAlphabet: IPA`). */
  phoneme: string;
  accuracyScore: number | null;
  /** Ms offset within the POSTed chunk audio. */
  startMs: number | null;
  durationMs: number | null;
  /**
   * Azure's ranked candidates for this slot, best first. When the top candidate
   * is NOT the expected phoneme, it is the closest thing the API gives us to
   * "here is what you actually said" — which is what makes a correction
   * actionable instead of just a low score.
   */
  alternatives?: { phoneme: string; score: number }[];
};

export type AzureSyllable = {
  /** Syllable in the requested alphabet. */
  syllable: string;
  /** The letters of the written word this syllable covers, when supplied. */
  grapheme?: string;
  accuracyScore: number | null;
  startMs: number | null;
  durationMs: number | null;
};

/** Per-word prosody notes. Present only where Azure flagged something. */
export type AzureProsodyFeedback = {
  /** An audible break where the text implies none. */
  unexpectedBreak?: boolean;
  /** A break the text implies that the speaker ran through. */
  missingBreak?: boolean;
  /** Flat delivery on a word that should carry stress. */
  monotone?: boolean;
};

export type AzureWordResult = {
  word: string;
  accuracyScore: number | null;
  errorType: AzureErrorType;
  /** Ms offset within the POSTed chunk audio; null when Azure omitted timing. */
  startMs: number | null;
  durationMs: number | null;
  syllables?: AzureSyllable[];
  phonemes?: AzurePhoneme[];
  prosody?: AzureProsodyFeedback;
};

export type ChunkAssessment = {
  accuracyScore: number;
  fluencyScore: number;
  completenessScore: number;
  /** Absent in some regions/locales — callers fall back to fluency. */
  prosodyScore: number | null;
  pronScore: number;
  words: AzureWordResult[];
};

const REQUEST_TIMEOUT_MS = 30_000;

/** UTF-8 → base64, dependency-free (Hermes lacks Buffer; btoa chokes on non-Latin-1). */
export function utf8ToBase64(input: string): string {
  const bytes: number[] = [];
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += table[b0 >> 2];
    out += table[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? table[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? table[b2 & 0x3f] : '=';
  }
  return out;
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toErrorType(value: unknown): AzureErrorType {
  switch (value) {
    case 'Omission':
    case 'Insertion':
    case 'Mispronunciation':
      return value;
    default:
      return 'None';
  }
}

function ticksToMs(value: unknown): number | null {
  const ticks = toNumber(value);
  return ticks == null ? null : Math.round(ticks / TICKS_PER_MS);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Record<string, unknown> => record(row) != null);
}

/** `Assessment` fields sit under `PronunciationAssessment` on some responses and
 * inline on others; every reader here accepts both. */
function assessmentOf(node: Record<string, unknown>): Record<string, unknown> {
  return record(node.PronunciationAssessment) ?? node;
}

function parseSyllables(word: Record<string, unknown>): AzureSyllable[] | undefined {
  const parsed = rows(word.Syllables).map((s) => {
    const sa = assessmentOf(s);
    return {
      syllable: typeof s.Syllable === 'string' ? s.Syllable : '',
      ...(typeof s.Grapheme === 'string' && s.Grapheme.length > 0
        ? { grapheme: s.Grapheme }
        : {}),
      accuracyScore: toNumber(sa.AccuracyScore),
      startMs: ticksToMs(s.Offset),
      durationMs: ticksToMs(s.Duration),
    };
  });
  // A syllable counts as usable when it has EITHER a symbol or a grapheme.
  // Filtering on the symbol alone silently dropped the whole syllable tier for
  // every non-US accent: those locales return the syllable structure and its
  // score with an EMPTY `Syllable` string but a real `Grapheme` ("deep"), which
  // is exactly what the UI prints. Measured against the live endpoint, not
  // assumed.
  const usable = parsed.filter((s) => s.syllable.length > 0 || s.grapheme != null);
  return usable.length > 0 ? usable : undefined;
}

function parsePhonemes(word: Record<string, unknown>): AzurePhoneme[] | undefined {
  const parsed = rows(word.Phonemes).map((p) => {
    const pa = assessmentOf(p);
    const alternatives = rows(pa.NBestPhonemes)
      .map((n) => ({
        phoneme: typeof n.Phoneme === 'string' ? n.Phoneme : '',
        score: toNumber(n.Score) ?? 0,
      }))
      .filter((n) => n.phoneme.length > 0);
    return {
      phoneme: typeof p.Phoneme === 'string' ? p.Phoneme : '',
      accuracyScore: toNumber(pa.AccuracyScore),
      startMs: ticksToMs(p.Offset),
      durationMs: ticksToMs(p.Duration),
      ...(alternatives.length > 0 ? { alternatives } : {}),
    };
  });
  const usable = parsed.filter((p) => p.phoneme.length > 0);
  return usable.length > 0 ? usable : undefined;
}

/**
 * Prosody notes for one word.
 *
 * The shape here was derived from real `en-US` responses, because guessing it
 * wrong is worse than not reading it. Two traps, both observed on clean speech:
 *
 *  - `Break.MissingBreak.Confidence` is `1.0` on almost EVERY word, while the
 *    same node's `ErrorTypes` correctly reads `["None"]`. Reading the confidence
 *    as a flag marks a whole passage as running through its punctuation.
 *  - `Intonation.ErrorTypes` reads `["Monotone"]` on every word — it lists the
 *    check performed, not the verdict — while `Intonation.Monotone.Confidence`
 *    is `0.0`. Reading `ErrorTypes` alone marks every word as flat.
 *
 * So breaks come from `ErrorTypes` only, and monotone needs `ErrorTypes` AND a
 * real confidence. Neither branch fires on the samples above, which is correct:
 * that speech had no break errors.
 */
const MONOTONE_MIN_CONFIDENCE = 0.5;

function errorTypes(node: Record<string, unknown> | null): string[] {
  const value = node?.ErrorTypes;
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function parseProsody(word: Record<string, unknown>): AzureProsodyFeedback | undefined {
  // `Feedback` sits on the word itself in observed responses; older/other
  // shapes nest it under `PronunciationAssessment`.
  const prosody = record(
    record(word.Feedback)?.Prosody ??
      record(record(word.PronunciationAssessment)?.Feedback)?.Prosody,
  );
  if (!prosody) return undefined;

  const breakErrors = errorTypes(record(prosody.Break));
  const intonation = record(prosody.Intonation);
  const monotoneConfidence = toNumber(record(intonation?.Monotone)?.Confidence);

  const out: AzureProsodyFeedback = {};
  if (breakErrors.includes('UnexpectedBreak')) out.unexpectedBreak = true;
  if (breakErrors.includes('MissingBreak')) out.missingBreak = true;
  if (
    errorTypes(intonation).includes('Monotone') &&
    monotoneConfidence != null &&
    monotoneConfidence >= MONOTONE_MIN_CONFIDENCE
  ) {
    out.monotone = true;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/** Parse a `format=detailed` recognition response with assessment scores. Exported for tests. */
export function parseAssessmentResponse(json: unknown): ChunkAssessment | null {
  const root = record(json);
  if (!root || root.RecognitionStatus !== 'Success') return null;
  const nbest = rows(root.NBest)[0];
  if (!nbest) return null;

  // Scores appear either at the NBest root or nested under PronunciationAssessment.
  const pa = assessmentOf(nbest);
  const accuracyScore = toNumber(pa.AccuracyScore) ?? toNumber(nbest.AccuracyScore);
  const fluencyScore = toNumber(pa.FluencyScore) ?? toNumber(nbest.FluencyScore);
  const completenessScore = toNumber(pa.CompletenessScore) ?? toNumber(nbest.CompletenessScore);
  const pronScore = toNumber(pa.PronScore) ?? toNumber(nbest.PronScore);
  const prosodyScore = toNumber(pa.ProsodyScore) ?? toNumber(nbest.ProsodyScore);
  if (accuracyScore == null || pronScore == null) return null;

  const words: AzureWordResult[] = rows(nbest.Words).map((w) => {
    const wpa = assessmentOf(w);
    const syllables = parseSyllables(w);
    const phonemes = parsePhonemes(w);
    const prosody = parseProsody(w);
    return {
      word: typeof w.Word === 'string' ? w.Word : '',
      accuracyScore: toNumber(wpa.AccuracyScore) ?? toNumber(w.AccuracyScore),
      errorType: toErrorType(wpa.ErrorType ?? w.ErrorType),
      startMs: ticksToMs(w.Offset),
      durationMs: ticksToMs(w.Duration),
      ...(syllables ? { syllables } : {}),
      ...(phonemes ? { phonemes } : {}),
      ...(prosody ? { prosody } : {}),
    };
  });

  return {
    accuracyScore,
    fluencyScore: fluencyScore ?? accuracyScore,
    completenessScore: completenessScore ?? 100,
    prosodyScore,
    pronScore,
    words,
  };
}


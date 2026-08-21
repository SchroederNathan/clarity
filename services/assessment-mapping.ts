/**
 * Anchoring Azure's assessed words back onto the passage's own display tokens.
 *
 * This used to be a positional walk: the Nth non-Insertion word Azure returned
 * became the verdict for the Nth reference token in the chunk. That assumes the
 * two sides tokenize identically, and nothing checked it. They do not. Azure
 * splits `deep-sea` into `deep` + `sea`, so from that word onward every verdict
 * in the chunk landed on its neighbour: a flubbed word rendered clean, the
 * innocent word after it rendered orange, and the last real score fell off the
 * end into a silent `break`. Two of five built-in passages contain hyphenated
 * compounds, and AI-generated and user-typed passages are unbounded.
 *
 * So anchoring is by TEXT, not position:
 *   - one to one when the normalized forms agree;
 *   - many Azure words to one reference token when Azure split a compound
 *     (`deep` + `sea` -> `deep-sea`);
 *   - one Azure word to many reference tokens when it merged them;
 *   - a short forward probe when a reference token was not assessed at all.
 *
 * An Azure word that anchors nowhere is DROPPED rather than consumed. Dropping
 * costs one word's detail; consuming shifts every verdict after it. Unanchored
 * counts are reported so a caller can tell a clean map from a scramble.
 *
 * PURE module: no react-native, no network. Runs under bun for the self-tests.
 */

import { normalizeToken } from '@/lib/passage-text';
import type { ResultPhoneme, ResultProsody, ResultSyllable, WordVerdict } from '@/types/session';
import type {
  AzureErrorType,
  AzurePhoneme,
  AzureSyllable,
  AzureWordResult,
} from './azure-assessment';

/**
 * The subset of an Azure word this module needs, so the mapper is testable
 * without constructing whole assessment responses. `AzureWordResult` satisfies
 * it structurally.
 */
export type AssessedWord = {
  word: string;
  accuracyScore: number | null;
  errorType: AzureErrorType;
  startMs?: number | null;
  durationMs?: number | null;
  syllables?: AzureSyllable[];
  phonemes?: AzurePhoneme[];
  prosody?: ResultProsody;
};

/** Type-only check that the wire shape still fits the mapper's input, so a
 * change to `AzureWordResult` fails the build here rather than at the call. */
type _WireFitsMapperInput = AzureWordResult extends AssessedWord ? true : never;

/**
 * Wire shape to app shape. `accuracyScore` becomes `score`, and Azure's ranked
 * candidates become `heard` only when the top candidate is NOT the expected
 * phoneme — a candidate list that agrees with the reference says nothing worth
 * showing, and rendering it would imply an error that isn't there.
 */
function toResultPhoneme(phoneme: AzurePhoneme): ResultPhoneme {
  const best = phoneme.alternatives?.[0];
  const disagrees = best != null && best.phoneme !== phoneme.phoneme;
  return {
    phoneme: phoneme.phoneme,
    score: phoneme.accuracyScore,
    ...(disagrees ? { heard: phoneme.alternatives } : {}),
  };
}

function toResultSyllable(syllable: AzureSyllable): ResultSyllable {
  return {
    syllable: syllable.syllable,
    ...(syllable.grapheme != null ? { grapheme: syllable.grapheme } : {}),
    score: syllable.accuracyScore,
  };
}

/** Everything learned about one reference token from an assessment. */
export type MappedWord = {
  verdict: WordVerdict;
  /** Merged accuracy, absent when Azure scored none of the parts. */
  score?: number;
  phonemes?: ResultPhoneme[];
  syllables?: ResultSyllable[];
  prosody?: ResultProsody;
  /** Ms within the assessed chunk's audio. */
  startMs?: number;
  endMs?: number;
};

export type MappedAssessment = {
  /** Keyed by display-token index. Tokens absent from the map were not assessed
   * and must keep whatever verdict live alignment gave them. */
  words: Map<number, MappedWord>;
  /** Insertions, anchored after a display index (-1 = before the chunk's first). */
  insertions: { word: string; afterDisplay: number }[];
  /** Azure words that anchored to no reference token. */
  unanchored: number;
};

/**
 * How far ahead of the cursor a reference token may be found. Small on purpose:
 * a long probe turns a tokenization disagreement into a plausible-looking but
 * wrong match, which is the failure this module exists to prevent.
 */
const PROBE_AHEAD = 3;

/** How many Azure words may be glued together to satisfy one reference token.
 * `mother-in-law` is the realistic worst case. */
const MAX_MERGE = 4;

function severity(verdict: WordVerdict): number {
  switch (verdict) {
    case 'omitted':
      return 3;
    case 'mispronounced':
      return 2;
    case 'inserted':
      return 1;
    case 'good':
      return 0;
  }
}

function verdictOf(errorType: AzureErrorType): WordVerdict {
  switch (errorType) {
    case 'Omission':
      return 'omitted';
    case 'Mispronunciation':
      return 'mispronounced';
    default:
      return 'good';
  }
}

/**
 * Fold the Azure words covering one reference token into a single verdict.
 *
 * The verdict is the WORST of the parts, and the score is the LOWEST. Both
 * follow from what the pair is for: the verdict colors the word, the score sits
 * next to it, and a mean score would print a comfortable 62 beside an orange
 * word whose second syllable scored 30. The lowest part is also the one the
 * detail view is going to point at.
 */
function fold(parts: readonly AssessedWord[]): MappedWord {
  let verdict: WordVerdict = 'good';
  let score: number | null = null;
  const phonemes: ResultPhoneme[] = [];
  const syllables: ResultSyllable[] = [];
  let prosody: ResultProsody | undefined;
  let startMs: number | null = null;
  let endMs: number | null = null;

  for (const part of parts) {
    const partVerdict = verdictOf(part.errorType);
    if (severity(partVerdict) > severity(verdict)) verdict = partVerdict;
    if (part.accuracyScore != null) {
      score = score == null ? part.accuracyScore : Math.min(score, part.accuracyScore);
    }
    if (part.phonemes) phonemes.push(...part.phonemes.map(toResultPhoneme));
    if (part.syllables) syllables.push(...part.syllables.map(toResultSyllable));
    if (part.prosody) prosody = { ...prosody, ...part.prosody };
    if (part.startMs != null) {
      startMs = startMs == null ? part.startMs : Math.min(startMs, part.startMs);
      if (part.durationMs != null) {
        const partEnd = part.startMs + part.durationMs;
        endMs = endMs == null ? partEnd : Math.max(endMs, partEnd);
      }
    }
  }

  // An omitted word was never uttered, so a score and an audio span would both
  // be describing silence.
  if (verdict === 'omitted') {
    return { verdict, ...(prosody ? { prosody } : {}) };
  }

  return {
    verdict,
    ...(score != null ? { score } : {}),
    ...(phonemes.length > 0 ? { phonemes } : {}),
    ...(syllables.length > 0 ? { syllables } : {}),
    ...(prosody ? { prosody } : {}),
    ...(startMs != null ? { startMs } : {}),
    ...(endMs != null ? { endMs } : {}),
  };
}

/**
 * Anchor `assessed` onto `refDisplayIndices` by normalized text.
 *
 * @param refDisplayIndices Display-token indices covered by this chunk, in
 *   reading order, punctuation-only tokens already excluded.
 * @param refNorms Normalized form of each entry in `refDisplayIndices`.
 */
export function mapAssessedWords(
  refDisplayIndices: readonly number[],
  refNorms: readonly string[],
  assessed: readonly AssessedWord[],
): MappedAssessment {
  const words = new Map<number, MappedWord>();
  const insertions: { word: string; afterDisplay: number }[] = [];
  let unanchored = 0;

  /** Next reference token that has not been consumed. */
  let cursor = 0;
  /** Display index the last consumed reference token sat at. */
  let lastConsumed = -1;

  for (let i = 0; i < assessed.length; i++) {
    const current = assessed[i];

    if (current.errorType === 'Insertion') {
      insertions.push({ word: current.word, afterDisplay: lastConsumed });
      continue;
    }

    const norm = normalizeToken(current.word);
    // Azure occasionally returns a bare punctuation token; it anchors to nothing
    // and is not a failure to report.
    if (norm === '') continue;

    const limit = Math.min(cursor + PROBE_AHEAD + 1, refNorms.length);
    let anchored = false;

    for (let probe = cursor; probe < limit && !anchored; probe++) {
      const reference = refNorms[probe];
      if (reference === '') continue;

      // One Azure word, one reference token.
      if (reference === norm) {
        words.set(refDisplayIndices[probe], fold([current]));
        lastConsumed = refDisplayIndices[probe];
        cursor = probe + 1;
        anchored = true;
        break;
      }

      // Azure split one reference token across consecutive words.
      if (reference.startsWith(norm)) {
        let glued = norm;
        const parts: AssessedWord[] = [current];
        let k = i;
        while (
          glued !== reference &&
          parts.length < MAX_MERGE &&
          k + 1 < assessed.length &&
          assessed[k + 1].errorType !== 'Insertion'
        ) {
          const nextNorm = normalizeToken(assessed[k + 1].word);
          if (nextNorm === '' || !reference.startsWith(glued + nextNorm)) break;
          glued += nextNorm;
          parts.push(assessed[k + 1]);
          k += 1;
        }
        if (glued === reference) {
          words.set(refDisplayIndices[probe], fold(parts));
          lastConsumed = refDisplayIndices[probe];
          cursor = probe + 1;
          i = k; // the glued parts are consumed
          anchored = true;
          break;
        }
      }

      // Azure merged consecutive reference tokens into one word.
      if (norm.startsWith(reference)) {
        let glued = reference;
        let end = probe;
        while (glued !== norm && end + 1 < refNorms.length) {
          const nextRef = refNorms[end + 1];
          if (nextRef === '' || !norm.startsWith(glued + nextRef)) break;
          glued += nextRef;
          end += 1;
        }
        if (glued === norm && end > probe) {
          // The single verdict applies to every token it covered. There is no
          // honest way to split one score across them.
          const folded = fold([current]);
          for (let r = probe; r <= end; r++) words.set(refDisplayIndices[r], folded);
          lastConsumed = refDisplayIndices[end];
          cursor = end + 1;
          anchored = true;
          break;
        }
      }
    }

    if (!anchored) unanchored += 1;
  }

  return { words, insertions, unanchored };
}

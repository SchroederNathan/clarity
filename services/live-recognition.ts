import { normalizeToken, type TokenizedPassage } from '@/lib/passage-text';
import {
  PassageAligner,
  type AlignerEvent,
  type TranscriptSegmentTiming,
} from '@/services/alignment';

export type LiveRecognitionHypothesis = {
  transcript: string;
  confidence: number;
  segments?: TranscriptSegmentTiming[];
};

/**
 * Words too common to be worth a hint. Both recognizers already predict these
 * perfectly, and every slot one of them takes is a slot denied to the rare word
 * that actually needs help. The list is deliberately short: only words that are
 * frequent AND phonetically unremarkable.
 */
const UNHELPFUL_HINTS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'had',
  'has', 'have', 'he', 'her', 'his', 'i', 'in', 'is', 'it', 'its', 'not', 'of',
  'on', 'or', 'she', 'that', 'the', 'their', 'them', 'then', 'there', 'they',
  'this', 'to', 'was', 'we', 'were', 'what', 'when', 'which', 'who', 'will',
  'with', 'you', 'your',
]);

/** How far past the frontier a hint is still about the near future. Beyond this
 * the reader has not arrived yet, and by the time they do the hints will have
 * been rebuilt. */
const HINT_HORIZON_WORDS = 60;

/**
 * Bias the generic platform recognizer toward the known passage. Both Apple
 * and Android expect short phrases, so this sends the upcoming bigrams and the
 * upcoming distinctive words rather than the passage as one long string.
 *
 * Ordering is the whole point, and it used to be wrong. The old version emitted
 * EVERY remaining unigram before its first bigram, so on any passage over ~100
 * words the 100-slot budget was spent before a single phrase was reached, and it
 * filled with `the`, `through`, `once`. Measured on the five built-in passages,
 * four of them got zero bigrams at the start of a read.
 *
 * Now the budget is spent near the frontier and phrase-first:
 *   1. bigrams inside the horizon, in reading order (phrases bias best);
 *   2. distinctive unigrams inside the horizon;
 *   3. distinctive unigrams beyond it, if room remains.
 */
export function buildContextualStrings(
  tokenized: TokenizedPassage,
  fromDisplayIndex: number,
  limit = 100,
): string[] {
  const words = tokenized.norms;
  const start = Math.max(0, Math.min(fromDisplayIndex, words.length));
  const horizon = Math.min(words.length, start + HINT_HORIZON_WORDS);

  const unique: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string): boolean => {
    if (candidate.length < 2 || seen.has(candidate)) return true;
    seen.add(candidate);
    unique.push(candidate);
    return unique.length < limit;
  };

  const distinctive = (index: number): boolean => {
    const word = words[index];
    return word.length >= 2 && !UNHELPFUL_HINTS.has(word);
  };

  for (let i = start; i + 1 < horizon; i++) {
    if (!words[i] || !words[i + 1]) continue;
    if (!add(`${words[i]} ${words[i + 1]}`)) return unique;
  }
  for (let i = start; i < horizon; i++) {
    if (distinctive(i) && !add(words[i])) return unique;
  }
  for (let i = horizon; i < words.length; i++) {
    if (distinctive(i) && !add(words[i])) return unique;
  }
  return unique;
}

/**
 * How much a hypothesis that carries word timings is worth.
 *
 * Timings are not a nicety. Azure's assessment needs an audio window that
 * actually contains the sentence being graded, and the window is cut from these
 * timestamps; without them the engine falls back to recognition-event arrival
 * times, which lag the audio and can hand Azure the wrong seconds entirely.
 *
 * On both platforms the recognizer attaches segments only to the FIRST
 * alternative, so preferring a rescored alternative silently threw the timings
 * away. This bonus is small enough that a clearly better transcript still wins,
 * and large enough that a near-tie keeps the timings.
 */
const TIMED_HYPOTHESIS_BONUS = 3.5;

function hasUsableTimings(hypothesis: LiveRecognitionHypothesis): boolean {
  return (hypothesis.segments ?? []).some((s) => s.segment.trim().length > 0);
}

/**
 * Rerank all native hypotheses against the known passage. Native confidence
 * is only a tie-breaker because confidence is absent/zero on many interims.
 */
export function selectBestHypothesis(
  hypotheses: LiveRecognitionHypothesis[],
  aligner: PassageAligner,
  isFinal: boolean,
  atActiveMs: number,
): LiveRecognitionHypothesis | null {
  let best: LiveRecognitionHypothesis | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const hypothesis of hypotheses) {
    const event: AlignerEvent = {
      transcript: hypothesis.transcript,
      isFinal,
      atActiveMs,
      segments: hypothesis.segments,
    };
    const score =
      aligner.scoreEvent(event, hypothesis.confidence) +
      (hasUsableTimings(hypothesis) ? TIMED_HYPOTHESIS_BONUS : 0);
    if (score > bestScore) {
      best = hypothesis;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Reattach the first alternative's timings to a rescored one, when doing so is
 * demonstrably safe.
 *
 * Safe means the two hypotheses tokenize to the same words. That happens more
 * often than it sounds: alternatives frequently differ only in punctuation or
 * casing, which `normalizeToken` erases. When the words match, the timed spans
 * describe the same audio and carry over exactly; when they do not, this returns
 * the hypothesis untouched rather than pinning one utterance's timestamps onto
 * another's words.
 */
export function withBorrowedTimings(
  chosen: LiveRecognitionHypothesis,
  hypotheses: readonly LiveRecognitionHypothesis[],
): LiveRecognitionHypothesis {
  if (hasUsableTimings(chosen)) return chosen;

  const norms = (text: string) =>
    text.split(/\s+/).map(normalizeToken).filter(Boolean).join(' ');
  const target = norms(chosen.transcript);

  for (const candidate of hypotheses) {
    if (candidate === chosen || !hasUsableTimings(candidate)) continue;
    if (norms(candidate.transcript) === target) {
      return { ...chosen, segments: candidate.segments };
    }
  }
  return chosen;
}

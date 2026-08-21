/**
 * Self-tests for assessment-to-reference anchoring and the timing-derived
 * measures. Pure JS — run with:
 *   bun scripts/test-scoring.ts
 */

import { tokenizePassage } from '@/lib/passage-text';
import { PassageAligner } from '@/services/alignment';
import {
  mapAssessedWords,
  type AssessedWord,
} from '@/services/assessment-mapping';
import {
  parseAssessmentResponse,
  type ChunkAssessment,
} from '@/services/azure-assessment';
import {
  buildAzureResult,
  buildChunks,
  paceWpmFromTimings,
  pauseStatsFromTimings,
} from '@/services/scoring';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: unknown) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${label}`, detail !== undefined ? JSON.stringify(detail) : '');
  }
}

function assertEq<T>(actual: T, expected: T, label: string) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
  );
}

function section(name: string) {
  console.log(`\n== ${name}`);
}

/** An assessed word, with the fields a test does not care about defaulted. */
const w = (
  word: string,
  accuracyScore: number | null,
  errorType: AssessedWord['errorType'] = 'None',
  extra: Partial<AssessedWord> = {},
): AssessedWord => ({ word, accuracyScore, errorType, ...extra });

/** Reference side of a mapping test, from plain passage text. */
function reference(text: string) {
  const tokenized = tokenizePassage(text);
  const refDisplayIndices: number[] = [];
  const refNorms: string[] = [];
  tokenized.words.forEach((_, d) => {
    if (tokenized.norms[d] === '') return;
    refDisplayIndices.push(d);
    refNorms.push(tokenized.norms[d]);
  });
  return { tokenized, refDisplayIndices, refNorms };
}

// ---------------------------------------------------------------------------
section('mapping: one to one');
{
  const { refDisplayIndices, refNorms } = reference('Alpha beta gamma.');
  const mapped = mapAssessedWords(refDisplayIndices, refNorms, [
    w('Alpha', 95),
    w('beta', 40, 'Mispronunciation'),
    w('gamma', null, 'Omission'),
  ]);
  assertEq(mapped.unanchored, 0, 'everything anchored');
  assertEq(mapped.words.get(0)?.verdict, 'good', 'word 0 good');
  assertEq(mapped.words.get(1)?.verdict, 'mispronounced', 'word 1 mispronounced');
  assertEq(mapped.words.get(1)?.score, 40, 'score carried');
  assertEq(mapped.words.get(2)?.verdict, 'omitted', 'word 2 omitted');
  assertEq(mapped.words.get(2)?.score, undefined, 'an omitted word gets no score');
}

// ---------------------------------------------------------------------------
section('mapping: a split compound no longer shifts its neighbours');
{
  // THE regression. Azure returns `deep` + `sea` for the single token
  // `deep-sea`. The old positional walk moved every verdict after it one word
  // to the right: the flubbed word rendered clean, the next word took its
  // orange, and the last score fell off the end.
  const { refDisplayIndices, refNorms } = reference('The deep-sea vents glow with heat.');
  const mapped = mapAssessedWords(refDisplayIndices, refNorms, [
    w('The', 98),
    w('deep', 95),
    w('sea', 93),
    w('vents', 31, 'Mispronunciation'),
    w('glow', 96),
    w('with', 97),
    w('heat', 92),
  ]);

  assertEq(mapped.unanchored, 0, 'no word left unanchored');
  assertEq(mapped.words.size, 6, 'six reference tokens mapped');
  assertEq(mapped.words.get(1)?.verdict, 'good', 'the compound itself is clean');
  assertEq(mapped.words.get(1)?.score, 93, 'compound takes the LOWEST of its parts');
  assertEq(mapped.words.get(2)?.verdict, 'mispronounced', 'the error lands on "vents"');
  assertEq(mapped.words.get(2)?.score, 31, 'with its own score');
  assertEq(mapped.words.get(3)?.verdict, 'good', '"glow" is no longer blamed');
  assertEq(mapped.words.get(5)?.score, 92, 'the last score is no longer dropped');
}

// ---------------------------------------------------------------------------
section('mapping: a mispronounced part makes the whole compound orange');
{
  const { refDisplayIndices, refNorms } = reference('A mineral-rich vent.');
  const mapped = mapAssessedWords(refDisplayIndices, refNorms, [
    w('A', 99),
    w('mineral', 90),
    w('rich', 25, 'Mispronunciation'),
    w('vent', 95),
  ]);
  assertEq(mapped.words.get(1)?.verdict, 'mispronounced', 'worst part wins the verdict');
  assertEq(mapped.words.get(1)?.score, 25, 'and the lowest score, so the two agree');
  assertEq(mapped.words.get(2)?.verdict, 'good', 'the following word is untouched');
}

// ---------------------------------------------------------------------------
section('mapping: merged reference tokens');
{
  const { refDisplayIndices, refNorms } = reference('It is an other day.');
  const mapped = mapAssessedWords(refDisplayIndices, refNorms, [
    w('It', 96),
    w('is', 97),
    w('another', 55, 'Mispronunciation'),
    w('day', 94),
  ]);
  assertEq(mapped.unanchored, 0, 'the merge anchored');
  assertEq(mapped.words.get(2)?.verdict, 'mispronounced', 'both covered tokens flagged');
  assertEq(mapped.words.get(3)?.verdict, 'mispronounced', 'second covered token too');
  assertEq(mapped.words.get(4)?.verdict, 'good', '"day" keeps its own verdict');
}

// ---------------------------------------------------------------------------
section('mapping: an unmatchable word is dropped, not consumed');
{
  const { refDisplayIndices, refNorms } = reference('Alpha beta gamma delta.');
  const mapped = mapAssessedWords(refDisplayIndices, refNorms, [
    w('Alpha', 95),
    w('zzzz', 20, 'Mispronunciation'), // anchors nowhere
    w('beta', 90),
    w('gamma', 91),
    w('delta', 92),
  ]);
  assertEq(mapped.unanchored, 1, 'the stray word is reported');
  assertEq(mapped.words.get(1)?.score, 90, '"beta" keeps its OWN score');
  assertEq(mapped.words.get(3)?.score, 92, 'and nothing downstream shifted');
}

// ---------------------------------------------------------------------------
section('mapping: insertions anchor after the last consumed word');
{
  const { refDisplayIndices, refNorms } = reference('Alpha beta gamma.');
  const mapped = mapAssessedWords(refDisplayIndices, refNorms, [
    w('um', null, 'Insertion'),
    w('Alpha', 95),
    w('beta', 90),
    w('uh', null, 'Insertion'),
    w('gamma', 91),
  ]);
  assertEq(
    mapped.insertions,
    [
      { word: 'um', afterDisplay: -1 },
      { word: 'uh', afterDisplay: 1 },
    ],
    'leading insertion before the first word, the other after "beta"',
  );
}

// ---------------------------------------------------------------------------
section('mapping: phoneme and syllable detail survives the fold');
{
  const { refDisplayIndices, refNorms } = reference('Measure it.');
  const mapped = mapAssessedWords(refDisplayIndices, refNorms, [
    w('Measure', 42, 'Mispronunciation', {
      syllables: [
        { syllable: 'mɛ', grapheme: 'mea', accuracyScore: 88, startMs: 0, durationMs: 100 },
        { syllable: 'ʒɚ', grapheme: 'sure', accuracyScore: 30, startMs: 100, durationMs: 150 },
      ],
      phonemes: [
        { phoneme: 'm', accuracyScore: 95, startMs: 0, durationMs: 40 },
        {
          phoneme: 'ʒ',
          accuracyScore: 28,
          startMs: 120,
          durationMs: 60,
          alternatives: [
            { phoneme: 'z', score: 71 },
            { phoneme: 'ʒ', score: 28 },
          ],
        },
      ],
      prosody: { monotone: true },
    }),
    w('it', 96),
  ]);

  const word = mapped.words.get(0);
  assertEq(word?.phonemes?.length, 2, 'both phonemes carried');
  assertEq(word?.phonemes?.[1].phoneme, 'ʒ', 'expected phoneme preserved');
  assertEq(word?.phonemes?.[1].score, 28, 'phoneme score preserved');
  assertEq(
    word?.phonemes?.[1].heard?.[0].phoneme,
    'z',
    'the phoneme actually heard is surfaced',
  );
  assertEq(
    word?.phonemes?.[0].heard,
    undefined,
    'no `heard` when the top candidate agrees with the reference',
  );
  assertEq(word?.syllables?.[1].grapheme, 'sure', 'syllable graphemes carried');
  assertEq(word?.prosody, { monotone: true }, 'prosody carried');
}

// ---------------------------------------------------------------------------
section('pauses from word spans');
{
  // Gaps are silence BETWEEN words. The old end-to-end measure counted each
  // word's own duration as part of the gap before it.
  const stats = pauseStatsFromTimings([
    { startMs: 0, endMs: 400 },
    { startMs: 500, endMs: 900 }, // 100ms gap: a beat
    { startMs: 3000, endMs: 3400 }, // 2100ms gap: a pause
    { startMs: 3500, endMs: 3900 },
    { startMs: 7000, endMs: 7400 }, // 3100ms gap: the longest
  ]);
  assertEq(stats.pauseCount, 2, 'two pauses over the 1.5s floor');
  assertEq(stats.longestPauseMs, 3100, 'longest is the real silence, not span-to-span');

  // A word's own length must never register as a pause.
  const slow = pauseStatsFromTimings([
    { startMs: 0, endMs: 2000 },
    { startMs: 2100, endMs: 4000 },
  ]);
  assertEq(slow.pauseCount, 0, 'a long word is not a pause');

  assertEq(pauseStatsFromTimings([]).pauseCount, 0, 'empty input is safe');
}

// ---------------------------------------------------------------------------
section('pace from word spans');
{
  // Ten words spanning exactly 5s = 120wpm, regardless of dead air around them.
  const timings = Array.from({ length: 10 }, (_, i) => ({
    startMs: i * 500,
    endMs: i * 500 + 300,
  }));
  timings[9] = { startMs: 4700, endMs: 5000 };
  assertEq(paceWpmFromTimings(timings), 120, '10 words over 5s = 120wpm');

  // The same words, but the session also held 8s of silence before and after.
  // Nothing about the measurement may change: that was the old bias.
  const offset = timings.map((t) => ({ startMs: t.startMs + 8000, endMs: t.endMs + 8000 }));
  assertEq(paceWpmFromTimings(offset), 120, 'dead air outside the speech is excluded');

  assertEq(paceWpmFromTimings([{ startMs: 0, endMs: 300 }]), 0, 'one word is not a pace');
  assertEq(
    paceWpmFromTimings([
      { startMs: 0, endMs: 200 },
      { startMs: 300, endMs: 500 },
    ]),
    0,
    'too short a span is reported as unmeasured, not as a wild pace',
  );
}

// ---------------------------------------------------------------------------
section('buildAzureResult: Azure timings override the live pace and pauses');
{
  const text = 'Alpha beta gamma. Delta epsilon zeta.';
  const tokenized = tokenizePassage(text);
  const aligner = new PassageAligner(tokenized);
  aligner.beginSegment(0);
  aligner.handleEvent({
    transcript: 'alpha beta gamma delta epsilon zeta',
    isFinal: true,
    atActiveMs: 12_000,
    segments: [
      { startTimeMillis: 0, endTimeMillis: 11_500, segment: 'alpha beta gamma delta epsilon zeta' },
    ],
  });
  const chunks = buildChunks(tokenized, aligner.timeline, [13_000], [0]);
  assertEq(chunks.length, 1, 'single chunk');

  // Six words from 0ms to 4300ms (last onset 4000 + 300ms) = 84wpm, with a
  // 1700ms silence in the middle. The live pace passed in is deliberately wrong.
  const starts = [0, 500, 1000, 3000, 3500, 4000];
  const assessment: ChunkAssessment = {
    accuracyScore: 90,
    fluencyScore: 85,
    completenessScore: 100,
    prosodyScore: 80,
    pronScore: 88,
    words: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'].map((word, i) => ({
      word,
      accuracyScore: 90,
      errorType: 'None' as const,
      startMs: starts[i],
      durationMs: 300,
    })),
  };

  const withSegments = buildAzureResult({
    tokenized,
    statuses: aligner.refWordStatuses(),
    insertions: aligner.committedInsertions,
    paceWpm: 42, // the biased live measure
    targetWpm: 120,
    fillerCount: 0,
    durationMs: 13_000,
    audioUri: 'file:///tmp/x.wav',
    waveform: [],
    pauseCount: 99,
    longestPauseMs: 99_999,
    chunks,
    assessments: [assessment],
    segments: { durationsMs: [13_000], activeStartMs: [0] },
  });

  assert(withSegments !== null, 'result built');
  // Chunk starts at 0 (lead clamped), so word offsets map straight through.
  assertEq(withSegments!.paceWpm, 84, 'pace recomputed from Azure spans, not the live 42');
  assertEq(withSegments!.pauseCount, 1, 'the one real pause, not the live 99');
  assertEq(withSegments!.longestPauseMs, 1700, 'measured silence between words');
  assertEq(withSegments!.words[0].audioStartMs, 0, 'playback offset on the first word');
  assert(
    withSegments!.words[5].audioEndMs != null,
    'playback offsets reach the last word',
  );

  // Omit the geometry and every live measure must survive untouched: a region
  // that returns no offsets changes nothing.
  const withoutSegments = buildAzureResult({
    tokenized,
    statuses: aligner.refWordStatuses(),
    insertions: aligner.committedInsertions,
    paceWpm: 42,
    targetWpm: 120,
    fillerCount: 0,
    durationMs: 13_000,
    audioUri: null,
    waveform: [],
    pauseCount: 3,
    longestPauseMs: 2_500,
    chunks,
    assessments: [assessment],
  });
  assertEq(withoutSegments!.paceWpm, 42, 'live pace kept when Azure timings are unused');
  assertEq(withoutSegments!.pauseCount, 3, 'live pause count kept');
  assertEq(withoutSegments!.words[0].audioStartMs, undefined, 'no playback offsets');
}

// ---------------------------------------------------------------------------
section('parser: a real en-US phoneme response');
{
  // Captured from the live short-audio endpoint with the request this app now
  // sends. Two shapes in here would break a parser written from the docs alone:
  // every field sits INLINE on the word rather than under
  // `PronunciationAssessment`, and the prosody node reports
  // `MissingBreak.Confidence: 1.0` and `Intonation.ErrorTypes: ["Monotone"]` on
  // clean, non-monotone speech.
  const raw = require('./fixtures/azure-phoneme-response.json');
  const parsed = parseAssessmentResponse(raw);

  assert(parsed !== null, 'a real response parses');
  assertEq(parsed!.accuracyScore, 88, 'chunk accuracy read from the NBest root');
  assertEq(parsed!.prosodyScore, 90.8, 'prosody score read');
  assertEq(parsed!.words.length, 3, 'all words parsed');

  const [first, compound, worst] = parsed!.words;
  assertEq(first.word, 'the', 'word text');
  assertEq(first.accuracyScore, 88, 'inline AccuracyScore found');
  assertEq(first.errorType, 'None', 'inline ErrorType found');
  assertEq(first.startMs, 40, 'ticks converted to ms (400000 ticks = 40ms)');
  assertEq(first.durationMs, 90, 'duration converted to ms');
  assertEq(first.syllables?.[0].syllable, 'ðə', 'IPA syllable parsed');
  assertEq(first.syllables?.[0].grapheme, 'the', 'grapheme parsed');
  assertEq(first.phonemes?.[0].phoneme, 'ð', 'IPA phoneme parsed');
  assertEq(first.phonemes?.[0].accuracyScore, 79, 'phoneme score parsed');
  assertEq(
    first.phonemes?.[0].alternatives?.[0],
    { phoneme: 's', score: 100 },
    'NBestPhonemes parsed, best candidate first',
  );

  // Azure did NOT split this hyphenated compound: it returns one word matching
  // the reference token, which is why the text-anchored mapper is a no-op here.
  assertEq(compound.word, 'deep-sea', 'hyphenated compound returned whole');

  // The prosody traps. Neither must fire on this speech.
  assertEq(
    parsed!.words.filter((w) => w.prosody?.monotone).length,
    0,
    'Intonation.ErrorTypes ["Monotone"] with 0.0 confidence is NOT monotone',
  );
  assertEq(
    parsed!.words.filter((w) => w.prosody?.missingBreak).length,
    0,
    'MissingBreak.Confidence 1.0 with ErrorTypes ["None"] is NOT a missing break',
  );
  assertEq(worst.word, 'northern', 'the low-scoring word is present');
  assertEq(worst.accuracyScore, 26, 'and keeps its low score');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

/**
 * Self-tests for WAV parsing/slicing/concat/downsampling and the scoring
 * chunker + aggregation. Pure JS — run with:
 *   bun scripts/test-wav.ts
 */

import { tokenizePassage } from '@/lib/passage-text';
import { PassageAligner } from '@/services/alignment';
import type { ChunkAssessment } from '@/services/azure-assessment';
import { speakingScore } from '@/lib/score';
import {
  buildAzureResult,
  buildChunks,
  buildLiveFallbackResult,
  fillerScore,
  MAX_CHUNK_MS,
  paceScore,
} from '@/services/scoring';
import {
  buildWavHeader,
  concatWavs,
  downsampleWaveform,
  parseWavHeader,
  sliceWav,
  wavDurationMs,
} from '@/services/wav';

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

/** Synthesize a 16kHz/16-bit/mono WAV: sine of the given amplitude profile. */
function makeWav(durationMs: number, amplitude: (tMs: number) => number): Uint8Array {
  const sampleRate = 16_000;
  const samples = Math.round((durationMs / 1000) * sampleRate);
  const data = new Uint8Array(samples * 2);
  const view = new DataView(data.buffer);
  for (let i = 0; i < samples; i++) {
    const tMs = (i / sampleRate) * 1000;
    const value = Math.round(amplitude(tMs) * 32767 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
    view.setInt16(i * 2, value, true);
  }
  const out = new Uint8Array(44 + data.length);
  out.set(buildWavHeader({ channels: 1, sampleRate, bitsPerSample: 16 }, data.length), 0);
  out.set(data, 44);
  return out;
}

// ---------------------------------------------------------------------------
section('parseWavHeader roundtrip');
{
  const wav = makeWav(2000, () => 0.5);
  const f = parseWavHeader(wav);
  assertEq(f.sampleRate, 16_000, 'sample rate');
  assertEq(f.channels, 1, 'channels');
  assertEq(f.bitsPerSample, 16, 'bits');
  assertEq(f.blockAlign, 2, 'block align');
  assertEq(f.byteRate, 32_000, 'byte rate');
  assertEq(f.dataOffset, 44, 'data offset');
  assertEq(f.dataByteLength, 64_000, 'data length');
  assertEq(wavDurationMs(wav), 2000, 'duration');
}

section('parseWavHeader walks extra chunks');
{
  // Insert a LIST chunk between fmt and data.
  const base = makeWav(100, () => 0.2);
  const f = parseWavHeader(base);
  const listBody = new Uint8Array(10).fill(0x20);
  const out = new Uint8Array(base.length + 8 + listBody.length);
  out.set(base.subarray(0, 36), 0); // RIFF..fmt chunk
  let pos = 36;
  out.set([0x4c, 0x49, 0x53, 0x54], pos); // "LIST"
  new DataView(out.buffer).setUint32(pos + 4, listBody.length, true);
  out.set(listBody, pos + 8);
  pos += 8 + listBody.length;
  out.set(base.subarray(36), pos); // data chunk onwards
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  const parsed = parseWavHeader(out);
  assertEq(parsed.dataByteLength, f.dataByteLength, 'data found after LIST chunk');
  assertEq(parsed.dataOffset, f.dataOffset + 8 + listBody.length, 'offset shifted');
}

section('sliceWav');
{
  const wav = makeWav(10_000, () => 0.5);
  const slice = sliceWav(wav, 1000, 3500);
  const f = parseWavHeader(slice);
  assertEq(wavDurationMs(slice), 2500, 'slice duration');
  assertEq(f.dataOffset, 44, 'fresh canonical header');
  assertEq(f.dataByteLength % f.blockAlign, 0, 'block aligned');
  assertEq(slice.length, 44 + f.dataByteLength, 'no trailing junk');

  // Odd millisecond boundaries stay block-aligned.
  const odd = sliceWav(wav, 333.33, 777.77);
  const fo = parseWavHeader(odd);
  assertEq(fo.dataByteLength % fo.blockAlign, 0, 'odd-ms slice block aligned');

  // Clamping.
  const clamped = sliceWav(wav, 8000, 20_000);
  assertEq(wavDurationMs(clamped), 2000, 'end clamped to file');
  const empty = sliceWav(wav, 5000, 5000);
  assertEq(parseWavHeader(empty).dataByteLength, 0, 'zero-length slice');
}

section('concatWavs');
{
  const a = makeWav(1000, () => 0.3);
  const b = makeWav(2000, () => 0.6);
  const merged = concatWavs([a, b]);
  assertEq(wavDurationMs(merged), 3000, 'concat duration adds');
  const f = parseWavHeader(merged);
  assertEq(f.sampleRate, 16_000, 'format preserved');

  const single = concatWavs([a]);
  assertEq(wavDurationMs(single), 1000, 'single concat is identity-shaped');

  // Mismatched formats throw.
  const other = new Uint8Array(44 + 4);
  other.set(buildWavHeader({ channels: 2, sampleRate: 44_100, bitsPerSample: 16 }, 4), 0);
  let threw = false;
  try {
    concatWavs([a, other]);
  } catch {
    threw = true;
  }
  assert(threw, 'mismatched formats throw');
}

section('downsampleWaveform');
{
  // Quiet first half, loud second half.
  const wav = makeWav(3000, (t) => (t < 1500 ? 0.05 : 0.9));
  const buckets = downsampleWaveform(wav, 30);
  assertEq(buckets.length, 30, '30 buckets');
  assert(buckets.every((v) => v >= 0 && v <= 1), 'normalized 0..1');
  const firstHalf = buckets.slice(0, 14).reduce((a2, b2) => a2 + b2, 0) / 14;
  const secondHalf = buckets.slice(16).reduce((a2, b2) => a2 + b2, 0) / 14;
  assert(secondHalf > firstHalf * 3, 'loud half reads louder', { firstHalf, secondHalf });
  assert(Math.max(...buckets) === 1, 'peak-normalized');
}

// ---------------------------------------------------------------------------
section('scoring: paceScore / fillerScore');
{
  assertEq(paceScore(150, 150), 100, 'on target');
  assertEq(paceScore(160, 150), 100, 'within +10%');
  assertEq(paceScore(189, 179), 100, '+5.6% still inside the ±10% score band');
  // Callers exclude pace entirely when it wasn't measured, so 0 is never averaged
  // in as a real reading.
  assertEq(paceScore(0, 150), 0, 'unmeasured pace scores 0');
  assert(paceScore(100, 150) < paceScore(140, 150), 'slower is worse');
  // No floor any more: the old floor of 30 on pace and fillers together meant the
  // speaking score could never realistically drop below ~45.
  assertEq(paceScore(90, 150), 40, '0.6x ratio → 40');
  assertEq(paceScore(45, 150), 0, '0.3x ratio bottoms out');
  assertEq(paceScore(300, 150), 0, 'racing at 2x target bottoms out');
  assertEq(paceScore(165, 150), 100, 'still inside the +10% band');

  assertEq(fillerScore(0, 60_000), 100, 'no fillers');
  assertEq(fillerScore(3, 60_000), 70, '3/min → 70');
  assertEq(fillerScore(10, 60_000), 0, '10/min bottoms out');
  assertEq(fillerScore(20, 60_000), 0, 'and stays there');

  // Equal weighting across the five skills, so each moves the score by 1/5.
  const flat = {
    accuracy: 80, fluency: 80, intonation: 80,
    paceWpm: 150, targetWpm: 150, fillerCount: 0, durationMs: 60_000,
    source: 'azure' as const,
  };
  assertEq(speakingScore(flat), 88, 'mean of 80/80/100/100/80');
  assertEq(speakingScore({ ...flat, accuracy: 60 }), 84, 'a 20pt skill drop moves the score 4pt');
}

section('scoring: buildChunks packs sentences <=28s and respects segments');
{
  // 3 sentences; speak s1+s2 in segment 0, s3 in segment 1 (after a pause).
  const text = 'One two three. Four five six. Seven eight nine.';
  const tokenized = tokenizePassage(text);
  const a = new PassageAligner(tokenized);
  a.beginSegment(0);
  a.handleEvent({
    transcript: 'one two three four five six',
    isFinal: true,
    atActiveMs: 5000,
    segments: [{ startTimeMillis: 200, endTimeMillis: 4800, segment: 'one two three four five six' }],
  });
  a.beginSegment(1);
  a.handleEvent({
    transcript: 'seven eight nine',
    isFinal: true,
    atActiveMs: 9000,
    segments: [{ startTimeMillis: 100, endTimeMillis: 2400, segment: 'seven eight nine' }],
  });

  const chunks = buildChunks(tokenized, a.timeline, [6000, 3000], [0, 5000]);
  assertEq(chunks.length, 2, 'two chunks (segment boundary forces split)');
  assertEq(chunks[0].segmentIndex, 0, 'chunk 0 in segment 0');
  assertEq(chunks[1].segmentIndex, 1, 'chunk 1 in segment 1');
  assertEq(chunks[0].referenceText, 'One two three. Four five six.', 'reference text spans packed sentences');
  assertEq(chunks[1].referenceText, 'Seven eight nine.', 'segment-1 reference');
  assert(chunks[0].startMs === 0 && chunks[0].endMs <= 6000, 'chunk 0 audio span within segment');
  assert(chunks[1].endMs <= 3000, 'chunk 1 clamped to segment duration');
  assert(chunks.every((c) => c.endMs - c.startMs <= MAX_CHUNK_MS), 'under 28s cap');
}

section('scoring: long readings split into multiple <=28s chunks');
{
  const sentences = Array.from({ length: 10 }, (_, s) =>
    Array.from({ length: 8 }, (_, w) => `w${s}x${w}`).join(' ') + '.',
  );
  const tokenized = tokenizePassage(sentences.join(' '));
  const a = new PassageAligner(tokenized);
  a.beginSegment(0);
  // Each sentence takes 8s: total 80s in one segment. Android-style: each
  // final result is its own utterance (transcript resets between finals).
  for (let s = 0; s < 10; s++) {
    const words = Array.from({ length: 8 }, (_, w) => `w${s}x${w}`).join(' ');
    a.handleEvent({
      transcript: words,
      isFinal: true,
      atActiveMs: (s + 1) * 8000,
      segments: [{ startTimeMillis: s * 8000, endTimeMillis: (s + 1) * 8000, segment: words }],
    });
  }
  assertEq(a.matchedCount, 80, 'equal-length utterance resets detected (all 80 words matched)');
  const chunks = buildChunks(tokenized, a.timeline, [81_000], [0]);
  assert(chunks.length >= 3, `80s of audio → >=3 chunks (got ${chunks.length})`);
  assert(chunks.every((c) => c.endMs - c.startMs <= MAX_CHUNK_MS), 'every chunk under cap');
  // Chunks tile the sentence list without gaps.
  assertEq(chunks[0].displayStart, 0, 'first chunk starts at word 0');
  for (let i = 1; i < chunks.length; i++) {
    assertEq(chunks[i].displayStart, chunks[i - 1].displayEnd, `chunk ${i} contiguous`);
  }
  assertEq(chunks[chunks.length - 1].displayEnd, tokenized.words.length, 'covers all read words');
}

section('scoring: unread trailing sentences excluded');
{
  const tokenized = tokenizePassage('First one here. Second two there. Third three gone.');
  const a = new PassageAligner(tokenized);
  a.beginSegment(0);
  a.handleEvent({
    transcript: 'first one here second two there',
    isFinal: true,
    atActiveMs: 4000,
    segments: [{ startTimeMillis: 0, endTimeMillis: 3800, segment: 'first one here second two there' }],
  });
  const chunks = buildChunks(tokenized, a.timeline, [5000], [0]);
  assertEq(chunks.length, 1, 'one chunk');
  assertEq(chunks[0].displayEnd, 6, 'unread trailing sentence excluded');
}

section('scoring: azure aggregation + word mapping');
{
  const tokenized = tokenizePassage('Alpha beta gamma. Delta epsilon zeta.');
  const a = new PassageAligner(tokenized);
  a.beginSegment(0);
  a.handleEvent({
    transcript: 'alpha beta gamma delta epsilon zeta',
    isFinal: true,
    atActiveMs: 4000,
    segments: [{ startTimeMillis: 0, endTimeMillis: 3800, segment: 'alpha beta gamma delta epsilon zeta' }],
  });
  const chunks = buildChunks(tokenized, a.timeline, [5000], [0]);
  assertEq(chunks.length, 1, 'single chunk');

  const assessment: ChunkAssessment = {
    accuracyScore: 90,
    fluencyScore: 85,
    completenessScore: 100,
    prosodyScore: 80,
    pronScore: 88,
    words: [
      { word: 'alpha', accuracyScore: 95, errorType: 'None', startMs: 0, durationMs: 400 },
      {
        word: 'beta',
        accuracyScore: 45,
        errorType: 'Mispronunciation',
        startMs: 450,
        durationMs: 400,
      },
      { word: 'gamma', accuracyScore: null, errorType: 'Omission', startMs: null, durationMs: null },
      { word: 'um', accuracyScore: null, errorType: 'Insertion', startMs: 900, durationMs: 200 },
      { word: 'delta', accuracyScore: 92, errorType: 'None', startMs: 1150, durationMs: 400 },
      { word: 'epsilon', accuracyScore: 91, errorType: 'None', startMs: 1600, durationMs: 400 },
      { word: 'zeta', accuracyScore: 90, errorType: 'None', startMs: 2050, durationMs: 400 },
    ],
  };

  const result = buildAzureResult({
    tokenized,
    statuses: a.refWordStatuses(),
    insertions: a.committedInsertions,
    paceWpm: 120,
    targetWpm: 120,
    fillerCount: 1,
    durationMs: 4000,
    audioUri: 'file:///tmp/x.wav',
    waveform: Array.from({ length: 30 }, () => 0.5),
    chunks,
    assessments: [assessment],
  });

  assert(result !== null, 'azure result built');
  if (result) {
    assertEq(result.source, 'azure', 'source azure');
    assertEq(result.accuracy, 90, 'accuracy from chunk');
    assertEq(result.fluency, 85, 'fluency from chunk');
    assertEq(result.intonation, 80, 'prosody → intonation');
    const statuses = result.words.map((w) => `${w.word}:${w.status}`);
    assertEq(
      statuses,
      [
        'Alpha:good',
        'beta:mispronounced',
        'gamma.:omitted',
        'um:inserted',
        'Delta:good',
        'epsilon:good',
        'zeta.:good',
      ],
      'per-word verdicts with insertion spliced',
    );
    assertEq(result.words[1].score, 45, 'mispronounced keeps azure score');
    // completeness capped by attempted/total = 5/6.
    assert(result.completeness <= 84, `completeness capped by omission (got ${result.completeness})`);
    // The score is the mean of the five skills, not a weighted pron blend:
    // accuracy 90, fluency 85, pace 100 (on target), fillers 40 (one filler over
    // the 10s minimum duration → 6/min → 100 - 60), intonation 80 → 79.
    assertEq(result.overallScore, 79, 'score is the mean of the five skills');
    // `overallScore` is the raw formula. `speakingScore` additionally applies the
    // eligibility gate, and this fixture speaks only five words, so it is
    // excluded — the two agreeing unconditionally would mean the gate is not
    // reaching the result path at all, which was the bug on the results screen.
    assertEq(speakingScore(result), null, 'the shared definition gates this fixture out');
    // 10s keeps the filler rate identical (fillerScore floors duration at 10s),
    // so the expected 79 is unchanged and only the gate flips.
    assertEq(
      result.overallScore,
      speakingScore({ ...result, spokenWords: 40, durationMs: 10_000 }),
      'builder and the shared score definition agree on a scorable session',
    );
  }
}

section('scoring: all-chunks-failed returns null; live fallback works');
{
  const tokenized = tokenizePassage('Alpha beta gamma delta.');
  const a = new PassageAligner(tokenized);
  a.beginSegment(0);
  a.handleEvent({ transcript: 'alpha beta um gamma', isFinal: true, atActiveMs: 3000 });
  const chunks = buildChunks(tokenized, a.timeline, [4000], [0]);

  const nullResult = buildAzureResult({
    tokenized,
    statuses: a.refWordStatuses(),
    insertions: a.committedInsertions,
    paceWpm: 100,
    targetWpm: 120,
    fillerCount: a.fillerCount,
    durationMs: 3000,
    audioUri: null,
    waveform: Array.from({ length: 30 }, () => 0.4),
    chunks,
    assessments: chunks.map(() => null),
  });
  assertEq(nullResult, null, 'all chunks failed → null');

  const live = buildLiveFallbackResult({
    tokenized,
    statuses: a.refWordStatuses(),
    insertions: a.committedInsertions,
    paceWpm: 100,
    targetWpm: 120,
    fillerCount: a.fillerCount,
    durationMs: 3000,
    audioUri: null,
    waveform: Array.from({ length: 30 }, () => 0.4),
  });
  assertEq(live.source, 'live', 'live source');
  assertEq(live.fillerCount, 1, 'filler carried');
  const wordStatuses = live.words.map((w) => `${w.word}:${w.status}`);
  assertEq(
    wordStatuses,
    ['Alpha:good', 'beta:good', 'um:inserted', 'gamma:good', 'delta.:omitted'],
    'live verdicts with filler spliced',
  );
  assertEq(live.completeness, 75, '3/4 matched → 75');
  assert(live.overallScore > 0 && live.overallScore <= 100, 'overall in range');
  assert(live.intonation === 70, 'neutral intonation proxy');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

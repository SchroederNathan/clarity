/**
 * Azure Speech Pronunciation Assessment over the short-audio REST endpoint.
 *
 * Each chunk POSTs raw WAV bytes (16kHz/16-bit/mono PCM — exactly what the
 * recognition recorder persists) with the assessment params in the
 * base64-encoded `Pronunciation-Assessment` header. The short-audio endpoint
 * caps audio at 30s, so callers chunk to <=28s (services/scoring.ts).
 *
 * Granularity is PHONEME, not word: the same request that returns a word's
 * accuracy also returns its syllables and its individual phonemes, each scored,
 * plus the phonemes the speaker most likely produced instead. That per-sound
 * detail is the only thing in the response that tells a user WHAT to change, so
 * we ask for it once here rather than inferring it later.
 *
 * Any failure (network, non-2xx, NoMatch, malformed JSON) resolves to `null`
 * for that chunk — the engine NEVER dead-ends on Azure.
 *
 * The response types and parser live in `azure-assessment.ts`, which is pure and
 * therefore testable; this module is only the transport.
 */

import { fetch } from 'expo/fetch';

import {
  parseAssessmentResponse,
  utf8ToBase64,
  type AzureSpeechConfig,
  type ChunkAssessment,
} from './azure-assessment';

export * from './azure-assessment';

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Assess one <=30s WAV chunk against its reference text.
 * Resolves `null` on any failure or NoMatch.
 */
export async function assessChunk(
  wavBytes: Uint8Array,
  referenceText: string,
  config: AzureSpeechConfig,
): Promise<ChunkAssessment | null> {
  const locale = config.locale ?? 'en-US';
  const url = `https://${config.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(locale)}&format=detailed`;
  const assessmentParams = utf8ToBase64(
    JSON.stringify({
      ReferenceText: referenceText,
      GradingSystem: 'HundredMark',
      // Phoneme granularity also returns the word and syllable tiers, so this
      // is a superset of what word granularity gave us, at the same cost.
      Granularity: 'Phoneme',
      PhonemeAlphabet: 'IPA',
      // Ranked candidate phonemes per slot: the "you said X, the word wants Y"
      // signal behind the per-word detail sheet.
      NBestPhonemeCount: 5,
      Dimension: 'Comprehensive',
      EnableMiscue: 'True',
      EnableProsodyAssessment: 'True',
    }),
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  // Copy into a fresh ArrayBuffer-backed view so the body satisfies BodyInit
  // regardless of the source buffer's typing (ArrayBufferLike).
  const body: Uint8Array<ArrayBuffer> = new Uint8Array(wavBytes);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': config.key,
        'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
        'Pronunciation-Assessment': assessmentParams,
        Accept: 'application/json',
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      if (__DEV__) console.warn(`[azure] chunk failed: HTTP ${response.status}`);
      return null;
    }
    return parseAssessmentResponse(await response.json());
  } catch (error) {
    if (__DEV__) console.warn('[azure] chunk failed:', error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Azure's free (F0) tier throttles at 20 requests per minute, so chunks run a
 * few at a time rather than all at once or strictly one after another. A
 * 200-word passage is roughly four chunks: sequentially that was four full
 * audio uploads end to end, with the user watching a spinner the whole time.
 */
const MAX_CONCURRENT_CHUNKS = 3;

/**
 * Assess all chunks, at most `MAX_CONCURRENT_CHUNKS` in flight. Results stay in
 * chunk order. Per-chunk failures yield `null` entries; the caller aggregates
 * whatever succeeded.
 */
export async function assessSession(
  chunks: { wavBytes: Uint8Array; referenceText: string }[],
  config: AzureSpeechConfig,
): Promise<(ChunkAssessment | null)[]> {
  const results: (ChunkAssessment | null)[] = new Array(chunks.length).fill(null);
  let next = 0;

  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= chunks.length) return;
      const chunk = chunks[index];
      results[index] = await assessChunk(chunk.wavBytes, chunk.referenceText, config);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_CHUNKS, chunks.length) }, worker),
  );
  return results;
}

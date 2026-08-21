/**
 * Single-word playback for the results word detail and the Home "Words to
 * master" card.
 *
 * Two sources, one player:
 *   - `speakWord` fetches the correct pronunciation from /api/pronounce (a
 *     hosted TTS model) as an MP3, cached by word.
 *   - `playOwnAttempt` cuts the word straight out of the session's own recording
 *     using Azure's per-word offsets, so the user can hear what they actually
 *     said next to the model.
 *
 * They share one module-level expo-audio player deliberately. Hearing the target
 * and then your own attempt is the whole comparison, and it only works if the
 * second clip REPLACES the first rather than playing over it.
 */

// NOTE: uses the global fetch (Expo's WinterCG fetch on SDK 57+), which
// resolves relative URLs against the dev server / hosting origin. `expo/fetch`
// resolves them against file:/// and would 404 here.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';

import { sliceWav } from '@/services/wav';

// Mirrors RESULT_PLAYBACK_AUDIO_MODE in hooks/use-result-playback.ts:
// 'doNotMix' is the only interruptionMode that resets the AVAudioSession mode
// speech recognition leaves behind, so playback comes out of the main speaker.
const PRONUNCIATION_AUDIO_MODE = {
  allowsRecording: false,
  playsInSilentMode: true,
  interruptionMode: 'doNotMix',
  shouldRouteThroughEarpiece: false,
} as const;

/**
 * Padding around a word cut from the session recording. Azure's offsets are
 * tight to the phonation, and a clip that starts exactly on a stop consonant
 * loses its release — it sounds clipped even when the reading was clean.
 */
const CLIP_PAD_MS = 120;

let player: AudioPlayer | null = null;

function clipFile(word: string): File {
  return new File(Paths.cache, `pronounce-${encodeURIComponent(word.toLowerCase())}.mp3`);
}

async function fetchPronunciation(word: string, file: File): Promise<void> {
  const response = await fetch('/api/pronounce', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word }),
  });

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : 'Pronunciation audio is unavailable right now.';
    throw new Error(message);
  }

  file.write(new Uint8Array(await response.arrayBuffer()));
}

async function play(uri: string): Promise<void> {
  try {
    await setAudioModeAsync(PRONUNCIATION_AUDIO_MODE);
  } catch {
    // Non-fatal: playback still happens, possibly on the wrong output route.
  }
  player?.remove();
  player = createAudioPlayer(uri);
  player.play();
}

/**
 * Fetches (or reuses) the word's model pronunciation and starts playback.
 * Resolves once playback has started, so callers can clear their loading state;
 * it does not wait for the clip to finish.
 */
export async function speakWord(word: string): Promise<void> {
  const file = clipFile(word);
  if (!file.exists) await fetchPronunciation(word, file);
  await play(file.uri);
}

/**
 * Plays one word out of the session's own recording.
 *
 * `sessionAudioUri` is the concatenated WAV the results screen already plays,
 * and the offsets come from `ResultWord.audioStartMs` / `audioEndMs`, which were
 * placed on that same timeline in `buildAzureResult`. Throws when the slice
 * cannot be produced so the caller can hide the control rather than play silence.
 */
export async function playOwnAttempt(
  sessionAudioUri: string,
  startMs: number,
  endMs: number,
): Promise<void> {
  const source = new File(sessionAudioUri);
  if (!source.exists) throw new Error('That recording is no longer available.');

  const clip = sliceWav(
    await source.bytes(),
    Math.max(0, startMs - CLIP_PAD_MS),
    endMs + CLIP_PAD_MS,
  );
  // One reused path: the clip is only ever the most recently tapped word.
  const out = new File(Paths.cache, 'attempt-word.wav');
  try {
    if (out.exists) out.delete();
  } catch {
    // Overwriting below is enough.
  }
  out.write(clip);
  await play(out.uri);
}

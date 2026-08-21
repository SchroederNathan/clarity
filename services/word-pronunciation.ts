/**
 * Tap-to-hear pronunciation for the Home "Words to master" card.
 *
 * The clip comes from the /api/pronounce route (a hosted TTS model) as an MP3,
 * lands in the cache directory keyed by the word, and plays through a single
 * module-level expo-audio player so rapid taps replace the clip instead of
 * layering playback.
 */

// NOTE: uses the global fetch (Expo's WinterCG fetch on SDK 57+), which
// resolves relative URLs against the dev server / hosting origin. `expo/fetch`
// resolves them against file:/// and would 404 here.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';

// Mirrors RESULT_PLAYBACK_AUDIO_MODE in hooks/use-result-playback.ts:
// 'doNotMix' is the only interruptionMode that resets the AVAudioSession mode
// speech recognition leaves behind, so playback comes out of the main speaker.
const PRONUNCIATION_AUDIO_MODE = {
  allowsRecording: false,
  playsInSilentMode: true,
  interruptionMode: 'doNotMix',
  shouldRouteThroughEarpiece: false,
} as const;

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

/**
 * Fetches (or reuses) the word's clip and starts playback. Resolves once
 * playback has started, so callers can clear their loading state; it does not
 * wait for the clip to finish.
 */
export async function speakWord(word: string): Promise<void> {
  const file = clipFile(word);
  if (!file.exists) await fetchPronunciation(word, file);

  try {
    await setAudioModeAsync(PRONUNCIATION_AUDIO_MODE);
  } catch {
    // Non-fatal: playback still happens, possibly on the wrong output route.
  }

  player?.remove();
  player = createAudioPlayer(file.uri);
  player.play();
}

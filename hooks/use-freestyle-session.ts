import { useEffect, useMemo, useRef, useState } from 'react';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import { File, Paths } from 'expo-file-system';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

import { countDiscourseMarkers, countFillers } from '@/lib/fillers';
import { tokenizeTranscript } from '@/services/alignment';
import { claimEngine, releaseEngine } from '@/services/recognition-owner';
import { buildFreestyleResult } from '@/services/scoring';
import {
  concatWavs,
  downsampleWaveform,
  waveformFromMeterHistory,
  wavDurationMs,
} from '@/services/wav';
import type {
  FreestyleSession,
  PracticeError,
  PracticeErrorCode,
  PracticeStatus,
  SessionResult,
} from '@/types/session';

/**
 * The freestyle (impromptu) session engine: the same expo-speech-recognition
 * lifecycle as use-practice-session.real.ts (segments across pause/resume,
 * volume metering, transient-error auto-restart, on-device → network retry)
 * WITHOUT the passage aligner — there is no reference text. The live surface
 * is the transcript itself; fillers come from the shared lexicon applied to
 * final results; scoring is the live-proxy freestyle builder.
 */

const TICK_MS = 250;
const WPM_EVERY_TICKS = 4; // 1Hz
const MAX_CONSECUTIVE_AUTO_RESTARTS = 5;
const AUDIO_END_TIMEOUT_MS = 3_000;
const METER_HISTORY_CAP = 4_096;

// Rolling-window live WPM (mirrors the aligner's constants).
const WPM_WINDOW_MS = 15_000;
const WPM_MIN_ELAPSED_MS = 5_000;
const WPM_MIN_SPAN_MS = 2_000;

type RecognitionMode = 'on-device' | 'network';

type WpmSample = { atActiveMs: number; words: number };

type Machine = {
  status: PracticeStatus;
  sessionId: string;
  mode: RecognitionMode;
  retriedNetwork: boolean;
  expectEnd: boolean;
  stopping: boolean;
  startedCount: number;
  endedCount: number;
  recSession: number;
  segmentUris: (string | null)[];
  audioPending: number[];
  accumulatedActiveMs: number;
  listeningSinceWall: number | null;
  autoRestarts: number;
  lastTransientError: { code: string; message: string } | null;
  meterEma: number;
  meterHistory: number[];
  /** Raw text of each committed final result, in order. */
  finalParts: string[];
  /** Total normalized word count across final results. */
  finalWordCount: number;
  fillerCount: number;
  /** Ambiguous markers. Reported to the coach, never scored. */
  discourseMarkerCount: number;
  wpmSamples: WpmSample[];
  result: SessionResult | null;
};

function deleteSegmentFiles(m: Machine) {
  for (const uri of m.segmentUris) {
    if (!uri) continue;
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      // best effort
    }
  }
  m.segmentUris = [];
}

function makeSessionId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(16)}`;
}

export function useFreestyleSession(): FreestyleSession {
  const [status, setStatus] = useState<PracticeStatus>('idle');
  const [error, setError] = useState<PracticeError | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [liveWpm, setLiveWpm] = useState(0);
  const [fillerCount, setFillerCount] = useState(0);
  const [finalTranscript, setFinalTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [result, setResult] = useState<SessionResult | null>(null);
  const meterLevel = useSharedValue(0);

  const instanceIdRef = useRef<symbol | null>(null);
  if (instanceIdRef.current === null) {
    instanceIdRef.current = Symbol('freestyle-session');
  }
  const instanceId = instanceIdRef.current;
  const mounted = useRef(true);

  const machineRef = useRef<Machine | null>(null);
  if (machineRef.current === null) {
    machineRef.current = {
      status: 'idle',
      sessionId: makeSessionId(),
      mode: 'on-device',
      retriedNetwork: false,
      expectEnd: false,
      stopping: false,
      startedCount: 0,
      endedCount: 0,
      recSession: -1,
      segmentUris: [],
      audioPending: [],
      accumulatedActiveMs: 0,
      listeningSinceWall: null,
      autoRestarts: 0,
      lastTransientError: null,
      meterEma: 0,
      meterHistory: [],
      finalParts: [],
      finalWordCount: 0,
      fillerCount: 0,
      discourseMarkerCount: 0,
      wpmSamples: [],
      result: null,
    };
  }

  const activeMs = () => {
    const m = machineRef.current!;
    return (
      m.accumulatedActiveMs + (m.listeningSinceWall != null ? Date.now() - m.listeningSinceWall : 0)
    );
  };

  const setStatusSafe = (next: PracticeStatus) => {
    machineRef.current!.status = next;
    if (mounted.current) setStatus(next);
  };

  const getLiveWpm = (m: Machine, atActiveMs: number): number => {
    if (atActiveMs < WPM_MIN_ELAPSED_MS || m.wpmSamples.length === 0) return 0;
    const oldest = m.wpmSamples[0];
    const spanMs = atActiveMs - oldest.atActiveMs;
    if (spanMs < WPM_MIN_SPAN_MS) return 0;
    const words = m.finalWordCount - oldest.words;
    return Math.max(0, Math.round(words / (spanMs / 60_000)));
  };

  const recordWpmSample = (m: Machine, atActiveMs: number) => {
    m.wpmSamples.push({ atActiveMs, words: m.finalWordCount });
    while (m.wpmSamples.length > 1 && m.wpmSamples[0].atActiveMs < atActiveMs - WPM_WINDOW_MS) {
      m.wpmSamples.shift();
    }
  };

  const fail = (code: PracticeErrorCode, message: string) => {
    const m = machineRef.current!;
    if (m.status === 'done') return;
    m.expectEnd = true;
    m.listeningSinceWall = null;
    meterLevel.value = withTiming(0, { duration: 160 });
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      // recognizer may already be inactive
    }
    if (mounted.current) setError({ code, message });
    setStatusSafe('error');
  };

  const startRecognition = (mode: RecognitionMode) => {
    const m = machineRef.current!;
    m.recSession += 1;
    m.segmentUris[m.recSession] = null;
    m.expectEnd = false;
    m.startedCount += 1;
    ExpoSpeechRecognitionModule.start({
      lang: 'en-US',
      interimResults: true,
      continuous: true,
      // No reference to rerank against — take the recognizer's best.
      maxAlternatives: 1,
      requiresOnDeviceRecognition: mode === 'on-device',
      addsPunctuation: true,
      iosTaskHint: 'dictation',
      volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
      recordingOptions: {
        persist: true,
        outputDirectory: Paths.cache.uri,
        outputFileName: `freestyle-${m.sessionId}-seg${m.recSession}.wav`,
        outputSampleRate: 16000,
        outputEncoding: 'pcmFormatInt16',
      },
    });
  };

  const resetMachine = (m: Machine) => {
    m.sessionId = makeSessionId();
    m.retriedNetwork = false;
    m.stopping = false;
    m.recSession = -1;
    m.segmentUris = [];
    m.audioPending = [];
    m.accumulatedActiveMs = 0;
    m.listeningSinceWall = null;
    m.autoRestarts = 0;
    m.lastTransientError = null;
    m.meterHistory = [];
    m.finalParts = [];
    m.finalWordCount = 0;
    m.fillerCount = 0;
    m.discourseMarkerCount = 0;
    m.wpmSamples = [];
    m.result = null;
    if (mounted.current) {
      setElapsedMs(0);
      setLiveWpm(0);
      setFillerCount(0);
      setFinalTranscript('');
      setInterimTranscript('');
      setResult(null);
      setError(null);
    }
    meterLevel.value = withTiming(0, { duration: 120 });
  };

  // ---- native events ------------------------------------------------------

  useSpeechRecognitionEvent('result', (event) => {
    const m = machineRef.current!;
    if (m.status !== 'listening' && m.status !== 'processing' && m.status !== 'paused') return;
    const transcript = event.results?.[0]?.transcript ?? '';
    if (transcript.trim().length === 0 && !event.isFinal) return;
    m.autoRestarts = 0; // real progress — reset the restart budget
    m.lastTransientError = null;

    if (event.isFinal) {
      const trimmed = transcript.trim();
      if (trimmed.length > 0) {
        m.finalParts.push(trimmed);
        const norms = tokenizeTranscript(trimmed).map((t) => t.norm);
        m.finalWordCount += norms.length;
        m.fillerCount += countFillers(norms);
        m.discourseMarkerCount += countDiscourseMarkers(norms);
      }
      if (mounted.current) {
        setFinalTranscript(m.finalParts.join(' '));
        setInterimTranscript('');
        setFillerCount(m.fillerCount);
      }
    } else if (mounted.current) {
      setInterimTranscript(transcript);
    }
  });

  useSpeechRecognitionEvent('volumechange', (event) => {
    const m = machineRef.current!;
    if (m.status !== 'listening') return;
    const level = Math.max(0, Math.min(1, (event.value + 2) / 12));
    m.meterEma = m.meterEma * 0.6 + level * 0.4;
    meterLevel.value = m.meterEma;
    if (m.meterHistory.length < METER_HISTORY_CAP) m.meterHistory.push(m.meterEma);
  });

  useSpeechRecognitionEvent('audiostart', (event) => {
    const m = machineRef.current!;
    m.segmentUris[m.recSession] = event.uri ?? null;
    m.audioPending.push(m.recSession);
  });

  useSpeechRecognitionEvent('audioend', (event) => {
    const m = machineRef.current!;
    const segment = m.audioPending.shift();
    if (segment != null && event.uri) m.segmentUris[segment] = event.uri;
  });

  useSpeechRecognitionEvent('error', (event) => {
    const m = machineRef.current!;
    if (event.error === 'aborted') return; // always self-inflicted
    if (m.stopping) return;

    if (event.error === 'not-allowed') {
      fail('permission-denied', event.message || 'Microphone or speech recognition permission was denied.');
      return;
    }

    if (event.error === 'language-not-supported' || event.error === 'service-not-allowed') {
      if (m.mode === 'on-device' && !m.retriedNetwork) {
        m.retriedNetwork = true;
        m.mode = 'network';
        return; // the trailing `end` event performs the restart
      }
      fail('recognition-unavailable', event.message || 'Speech recognition is unavailable on this device.');
      return;
    }

    if (m.status === 'listening') {
      m.lastTransientError = { code: event.error, message: event.message };
    }
  });

  useSpeechRecognitionEvent('end', () => {
    const m = machineRef.current!;
    m.endedCount += 1;
    if (m.status !== 'listening' || m.expectEnd) return;
    if (m.endedCount < m.startedCount) return;
    if (m.mode === 'on-device' && !m.retriedNetwork && m.lastTransientError) {
      m.retriedNetwork = true;
      m.mode = 'network';
      m.lastTransientError = null;
      startRecognition(m.mode);
      return;
    }
    m.autoRestarts += 1;
    if (m.autoRestarts > MAX_CONSECUTIVE_AUTO_RESTARTS) {
      const transient = m.lastTransientError;
      fail(
        transient?.code === 'no-speech' || transient?.code === 'speech-timeout'
          ? 'no-speech'
          : 'recognition-unavailable',
        transient?.message || 'Speech recognition kept stopping unexpectedly.',
      );
      return;
    }
    startRecognition(m.mode);
  });

  // ---- low-frequency metrics loop -----------------------------------------

  useEffect(() => {
    let tick = 0;
    const interval = setInterval(() => {
      const m = machineRef.current!;
      tick += 1;
      if (m.status !== 'listening') return;
      const active = activeMs();
      setElapsedMs(active);
      if (tick % WPM_EVERY_TICKS === 0) {
        recordWpmSample(m, active);
        setLiveWpm(getLiveWpm(m, active));
      }
    }, TICK_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- unmount cleanup ------------------------------------------------------

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const m = machineRef.current!;
      releaseEngine(instanceId);
      if (m.status === 'listening' || m.status === 'paused') {
        m.expectEnd = true;
        meterLevel.value = withTiming(0, { duration: 120 });
        try {
          ExpoSpeechRecognitionModule.abort();
        } catch {
          // already inactive
        }
        deleteSegmentFiles(m);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  // ---- processing (stop) ----------------------------------------------------

  const waitForAudioQuiet = async (timeoutMs: number) => {
    const m = machineRef.current!;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (m.audioPending.length === 0 && m.endedCount >= m.startedCount) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  const finishProcessing = async (): Promise<SessionResult> => {
    const m = machineRef.current!;
    const durationMs = Math.max(1, Math.round(m.accumulatedActiveMs));
    const paceWpm =
      m.finalWordCount > 0 && durationMs >= 1_000
        ? Math.round(m.finalWordCount / (durationMs / 60_000))
        : 0;

    let audioUri: string | null = null;
    let waveform: number[] | null = null;
    try {
      const loaded = await Promise.all(
        m.segmentUris.map(async (uri): Promise<Uint8Array | null> => {
          if (!uri) return null;
          try {
            const file = new File(uri);
            if (!file.exists) return null;
            const bytes = await file.bytes();
            wavDurationMs(bytes); // validates the header
            return bytes;
          } catch {
            return null;
          }
        }),
      );
      const playable = loaded.filter((b): b is Uint8Array => b != null);
      if (playable.length > 0) {
        const full = playable.length === 1 ? playable[0] : concatWavs(playable);
        const out = new File(Paths.cache, `freestyle-${m.sessionId}-full.wav`);
        try {
          if (out.exists) out.delete();
        } catch {
          // ignore
        }
        out.write(full);
        audioUri = out.uri;
        waveform = downsampleWaveform(full, 30);
      }
    } catch (e) {
      if (__DEV__) console.warn('[freestyle] audio processing failed:', e);
      audioUri = null;
      waveform = null;
    }

    return buildFreestyleResult({
      transcript: m.finalParts.join(' '),
      paceWpm,
      fillerCount: m.fillerCount,
      discourseMarkerCount: m.discourseMarkerCount,
      durationMs,
      audioUri,
      waveform: waveform ?? waveformFromMeterHistory(m.meterHistory),
    });
  };

  // ---- public API -----------------------------------------------------------

  const api = useMemo(() => {
    const accumulate = () => {
      const m = machineRef.current!;
      if (m.listeningSinceWall != null) {
        m.accumulatedActiveMs += Date.now() - m.listeningSinceWall;
        m.listeningSinceWall = null;
      }
    };

    return {
      async start() {
        const m = machineRef.current!;
        if (m.status === 'listening' || m.status === 'processing') return;
        claimEngine(instanceId);
        resetMachine(m);
        if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
          fail(
            'recognition-unavailable',
            'Speech recognition is not available on this device (simulators usually lack it; try a physical device).',
          );
          return;
        }
        try {
          const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
          if (!permission.granted) {
            fail('permission-denied', 'Microphone and speech recognition access are required to practice.');
            return;
          }
        } catch (e) {
          fail('unknown', e instanceof Error ? e.message : 'Failed to request permissions.');
          return;
        }
        m.listeningSinceWall = Date.now();
        setStatusSafe('listening');
        try {
          startRecognition(m.mode);
        } catch (e) {
          fail('recognition-unavailable', e instanceof Error ? e.message : 'Could not start speech recognition.');
        }
      },

      pause() {
        const m = machineRef.current!;
        if (m.status !== 'listening') return;
        m.expectEnd = true;
        meterLevel.value = withTiming(0, { duration: 160 });
        accumulate();
        setStatusSafe('paused');
        try {
          ExpoSpeechRecognitionModule.stop(); // graceful: final result + audioend
        } catch {
          // already stopped
        }
      },

      resume() {
        const m = machineRef.current!;
        if (m.status !== 'paused') return;
        m.listeningSinceWall = Date.now();
        setStatusSafe('listening');
        startRecognition(m.mode);
      },

      restart() {
        const m = machineRef.current!;
        m.expectEnd = true;
        try {
          ExpoSpeechRecognitionModule.abort();
        } catch {
          // already inactive
        }
        deleteSegmentFiles(m);
        resetMachine(m);
        m.listeningSinceWall = Date.now();
        setStatusSafe('listening');
        // Give the native recognizer a beat to tear down before restarting.
        setTimeout(() => {
          const current = machineRef.current!;
          if (current.status === 'listening' && current.recSession === -1) {
            startRecognition(current.mode);
          }
        }, 300);
      },

      cancel() {
        const m = machineRef.current!;
        m.expectEnd = true;
        meterLevel.value = withTiming(0, { duration: 120 });
        accumulate();
        try {
          ExpoSpeechRecognitionModule.abort();
        } catch {
          // already inactive
        }
        deleteSegmentFiles(m);
        releaseEngine(instanceId);
        setStatusSafe('idle');
      },

      async stop(): Promise<SessionResult> {
        const m = machineRef.current!;
        if (m.status === 'done' && m.result) return m.result;
        m.expectEnd = true;
        m.stopping = true;
        meterLevel.value = withTiming(0, { duration: 160 });
        accumulate();
        setStatusSafe('processing');
        try {
          ExpoSpeechRecognitionModule.stop();
        } catch {
          // already stopped
        }
        await waitForAudioQuiet(AUDIO_END_TIMEOUT_MS);

        let finalResult: SessionResult;
        try {
          finalResult = await finishProcessing();
        } catch (e) {
          if (__DEV__) console.warn('[freestyle] processing failed entirely:', e);
          finalResult = buildFreestyleResult({
            transcript: m.finalParts.join(' '),
            paceWpm: 0,
            fillerCount: m.fillerCount,
            discourseMarkerCount: m.discourseMarkerCount,
            durationMs: Math.max(1, Math.round(m.accumulatedActiveMs)),
            audioUri: null,
            waveform: waveformFromMeterHistory(m.meterHistory),
          });
        }

        m.result = finalResult;
        if (mounted.current) setResult(finalResult);
        setStatusSafe('done');
        releaseEngine(instanceId);
        deleteSegmentFiles(m);
        return finalResult;
      },
    };
    // machineRef is stable for the life of the session screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  return {
    status,
    error,
    elapsedMs,
    liveWpm,
    fillerCount,
    finalTranscript,
    interimTranscript,
    meterLevel,
    result,
    ...api,
  };
}

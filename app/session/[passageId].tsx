import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LiveWpm } from '@/components/session/live-wpm';
import { PracticeControls } from '@/components/session/practice-controls';
import { SessionTopBar } from '@/components/session/session-top-bar';
import {
  Teleprompter,
  type TeleprompterColors,
} from '@/components/session/teleprompter';
import { PASSAGES } from '@/constants/passages';
import { TELEPROMPTER_TEXT_SIZES } from '@/constants/session-theme';
import { useMarkInteractive } from '@/hooks/use-mark-interactive';
import { usePracticeSession } from '@/hooks/use-practice-session';
import { useTheme } from '@/hooks/use-theme';
import { useSessionCheckpoint } from '@/hooks/use-session-checkpoint';
import { getAnyPassage, modeForId } from '@/lib/passage-catalog';
import { tokenizePassage } from '@/lib/passage-text';
import { recordSession } from '@/services/session-history';
import type { SessionEndedReason } from '@/types/history';

import { useSessionContext } from './_layout';

function dismissToHome() {
  try {
    router.dismissTo('/');
  } catch {
    router.dismissAll();
  }
}

/** Clears the absolutely-positioned SessionTopBar, plus breathing room. */
const CONTENT_TOP_GAP = 82;

export default function PracticeScreen() {
  const { passageId } = useLocalSearchParams<{ passageId: string }>();
  const found = getAnyPassage(passageId);
  // Hooks must run unconditionally; the guard effect below backs out of the
  // route when the id is unknown before anything is visible.
  const passage = found ?? PASSAGES[0];

  // An unknown id renders nothing and backs out, so only a resolved passage
  // counts as this route being interactive.
  useMarkInteractive(Boolean(found));

  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { setResult, retryToken } = useSessionContext();

  const session = usePracticeSession(passage);
  const tokenized = useMemo(() => tokenizePassage(passage.text), [passage.text]);

  const [sizeIndex, setSizeIndex] = useState(1);
  const fontSize = TELEPROMPTER_TEXT_SIZES[sizeIndex];

  // The session object is rebuilt every render (live fields); keep a ref so
  // stable effects/callbacks always act on the latest instance.
  const sessionRef = useRef(session);
  const navigatedRef = useRef(false);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    if (!found) router.back();
  }, [found]);

  // Explicit start on mount (per contract — never auto inside the hook), and
  // cancel anything still running if the whole session flow unmounts.
  useEffect(() => {
    sessionRef.current.start();
    return () => {
      const s = sessionRef.current;
      if (s.status === 'listening' || s.status === 'paused') s.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Results screen's Retry bumps the token; restart a fresh attempt.
  const prevRetryRef = useRef(retryToken);
  useEffect(() => {
    if (retryToken === prevRetryRef.current) return;
    prevRetryRef.current = retryToken;
    navigatedRef.current = false;
    sessionRef.current.restart();
  }, [retryToken]);

  const meta = useMemo(
    () => ({
      mode: modeForId(passage.id),
      passageId: passage.id,
      // Snapshotted so a deleted custom passage doesn't orphan the record.
      contentTitle: passage.title,
    }),
    [passage.id, passage.title],
  );

  // Crash recovery + pause-on-background. `currentWordIndex` is the live count of
  // words spoken so far, which is what decides whether a killed session is worth
  // recovering at all. Declared above the handlers because each terminal path
  // has to clear the checkpoint once it has written its record.
  const checkpoint = useSessionCheckpoint({
    status: session.status,
    elapsedMs: session.elapsedMs,
    spokenWords: session.currentWordIndex,
    fillerCount: session.fillerCount,
    meta: { ...meta, targetWpm: passage.targetWpm },
    onBackground: () => sessionRef.current.pause(),
  });

  const finishSession = useCallback(
    async (endedReason: SessionEndedReason = 'stopped') => {
      if (navigatedRef.current) return;
      navigatedRef.current = true;
      try {
        const result = await sessionRef.current.stop();
        // Once per attempt (navigatedRef); each retry becomes its own record.
        const written = recordSession(result, { ...meta, endedReason });
        // The attempt is on disk, so the crash checkpoint has nothing left to
        // protect. Pushing Results does NOT unmount this screen, so without this
        // the checkpoint would survive and be recovered as a duplicate record.
        checkpoint.end();
        setResult(result, written.ok ? written.record.id : null);
        router.push('/session/results');
      } catch {
        navigatedRef.current = false;
      }
    },
    [setResult, meta, checkpoint],
  );

  // The session can complete on its own (end of passage reached).
  useEffect(() => {
    if (session.status === 'done') finishSession('completed');
  }, [session.status, finishSession]);

  /**
   * Dismissing mid-read used to discard the attempt entirely, which is why
   * practice minutes systematically undercounted real usage. Now it records the
   * partial attempt as 'abandoned': the minutes and the streak count, but the
   * skills ignore it, because everything past the stop point is marked omitted
   * and would crater accuracy through no fault of the speaker.
   */
  const handleDismiss = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const s = sessionRef.current;
    const live = s.status === 'listening' || s.status === 'paused';
    // Stop the 'done' effect from also pushing the results screen.
    navigatedRef.current = true;
    if (live) {
      // stop() flips to 'processing' synchronously, so the unmount cleanup won't
      // abort it. Fire and forget so dismissing stays instant — and the
      // checkpoint is cleared only once the write has actually landed, so a kill
      // mid-`stop()` still recovers these minutes.
      void s
        .stop()
        .then((result) => recordSession(result, { ...meta, endedReason: 'abandoned' }))
        .catch(() => {})
        .finally(() => checkpoint.end());
    } else {
      checkpoint.end();
    }
    dismissToHome();
  }, [meta, checkpoint]);

  const handleTextSize = useCallback(() => {
    Haptics.selectionAsync();
    setSizeIndex((i) => (i + 1) % TELEPROMPTER_TEXT_SIZES.length);
  }, []);

  const handlePauseToggle = useCallback(() => {
    const s = sessionRef.current;
    if (s.status === 'listening') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      s.pause();
    } else if (s.status === 'paused') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      s.resume();
    }
  }, []);

  /**
   * Restarting mid-read banks the partial attempt the same way dismissing does,
   * so the two paths no longer disagree about whether the work happened.
   *
   * The restart is SEQUENCED behind the stop rather than fired alongside it.
   * `stop()` finalizes audio and may wait on Azure; resetting the machine under
   * it meant the stop's tail landed on the new attempt — forcing it to 'done',
   * releasing the mic, and deleting its segment files. `navigatedRef` stays true
   * across the wait so the 'done' effect can't push Results in the meantime.
   */
  const handleRestart = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const s = sessionRef.current;
    if (s.status !== 'listening' && s.status !== 'paused') {
      navigatedRef.current = false;
      s.restart();
      return;
    }
    navigatedRef.current = true;
    void s
      .stop()
      .then((result) => recordSession(result, { ...meta, endedReason: 'abandoned' }))
      .catch(() => {})
      .finally(() => {
        navigatedRef.current = false;
        sessionRef.current.restart();
        checkpoint.begin();
      });
  }, [meta, checkpoint]);

  const handleStop = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    finishSession('stopped');
  }, [finishSession]);

  const teleColors: TeleprompterColors = useMemo(
    () => ({
      foreground: colors.foreground,
      dimmed: colors.dimmed,
      accent: colors.accent,
      accentFaded: colors.accentFaded,
    }),
    [colors],
  );

  if (!found) return null;

  const contentTop = insets.top + CONTENT_TOP_GAP;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Teleprompter
        tokenized={tokenized}
        currentWordIndex={session.currentWordIndex}
        wordProgress={session.currentWordFraction}
        fontSize={fontSize}
        colors={teleColors}
        topInset={contentTop}
        bottomInset={windowHeight * 0.55}
      />

      <SessionTopBar onDismiss={handleDismiss} onTextSize={handleTextSize}>
        <LiveWpm liveWpm={session.liveWpm} targetWpm={passage.targetWpm} />
      </SessionTopBar>

      <PracticeControls
        status={session.status}
        error={session.error}
        elapsedMs={session.elapsedMs}
        meterLevel={session.meterLevel}
        onPauseToggle={handlePauseToggle}
        onRestart={handleRestart}
        onStop={handleStop}
        onErrorDismiss={handleDismiss}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
});

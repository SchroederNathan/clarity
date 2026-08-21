import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SkillCard } from '@/components/metrics';
import { AiCoachingCard } from '@/components/session/ai-coaching-card';
import { PlaybackPill } from '@/components/session/playback-pill';
import { ResultsFooter } from '@/components/session/results-footer';
import { ScoreGauge } from '@/components/session/score-gauge';
import { SessionTopBar } from '@/components/session/session-top-bar';
import { TranscriptCard } from '@/components/session/transcript-card';
import { UnscoredNotice } from '@/components/session/unscored-notice';
import { WordBreakdown } from '@/components/session/word-breakdown';
import { ThemedText } from '@/components/ui';
import { SKILL_ORDER } from '@/constants/metrics';
import { spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useMarkInteractive } from '@/hooks/use-mark-interactive';
import { useSessionRecords } from '@/hooks/use-session-history';
import {
  cleanWordPct,
  sessionSkills,
  skillCaptions,
  skillWindow,
  speakingScore,
} from '@/lib/score';
import { summarizeWords } from '@/services/ai-coaching';
import type { SkillEstimate, SkillKey } from '@/types/history';

import { useSessionContext } from './_layout';

/** Clears the absolutely-positioned SessionTopBar. */
const CONTENT_TOP_GAP = 62;

/** Clears the absolutely-positioned ResultsFooter. */
const FOOTER_SCROLL_INSET = 150;

function dismissToHome() {
  try {
    router.dismissTo('/');
  } catch {
    router.dismissAll();
  }
}

export default function ResultsScreen() {
  const { result, recordId, bumpRetry } = useSessionContext();

  // Without a result the screen renders nothing and pops, so the score is on
  // screen only once `result` exists.
  useMarkInteractive(result != null);

  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const records = useSessionRecords();
  // recordSession() runs before this screen is pushed, so the store already holds
  // the session being shown. Drop it or "vs your average" would measure this
  // session partly against the average it just moved, damping every real
  // improvement.
  //
  // Excluded BY ID, not by position: when the attempt wasn't persisted (nothing
  // spoken, or the write failed) there is nothing to drop, and the old
  // `records.slice(0, -1)` then removed the user's previous real session instead.
  const history = useMemo(
    () => (recordId ? records.filter((r) => r.id !== recordId) : records),
    [records, recordId],
  );

  // This session's five skills, plus how each compares to the user's running
  // average. Same shape the Analytics card consumes — one component renders
  // both, so the two screens can't name or order the skills differently.
  const { skills, deltas, captions, averageScore, sessionScore } = useMemo(() => {
    if (!result) {
      return {
        skills: {} as Record<SkillKey, SkillEstimate>,
        deltas: {} as Partial<Record<SkillKey, number>>,
        captions: {} as Partial<Record<SkillKey, string>>,
        averageScore: null as number | null,
        sessionScore: null as number | null,
      };
    }

    const measured = sessionSkills(result);
    const session = {} as Record<SkillKey, SkillEstimate>;
    for (const key of SKILL_ORDER) {
      const value = measured[key];
      session[key] = { value: value ?? 0, samples: value == null ? 0 : 1 };
    }

    const average = skillWindow(history);
    const skillDeltas: Partial<Record<SkillKey, number>> = {};
    for (const key of SKILL_ORDER) {
      if (session[key].samples > 0 && average[key].samples > 0) {
        skillDeltas[key] = session[key].value - average[key].value;
      }
    }

    const { wordCounts } = summarizeWords(result.words);
    return {
      skills: session,
      deltas: skillDeltas,
      captions: skillCaptions(
        {
          cleanPct: cleanWordPct(wordCounts),
          avgWpm: result.paceWpm > 0 ? result.paceWpm : null,
          targetWpm: result.paceWpm > 0 ? result.targetWpm : null,
          fillers: result.fillerCount,
          pauses: result.pauseCount ?? null,
          longestPauseMs: result.longestPauseMs ?? null,
        },
        'session',
      ),
      averageScore: speakingScore(history),
      sessionScore: speakingScore(result),
    };
  }, [result, history]);

  useEffect(() => {
    if (!result) router.back();
  }, [result]);

  // Celebrate the finished session.
  useEffect(() => {
    if (result) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Fire once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRetry = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    bumpRetry();
    router.back();
  }, [bumpRetry]);

  const handleDone = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    dismissToHome();
  }, []);

  if (!result) return null;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + CONTENT_TOP_GAP,
          paddingBottom: insets.bottom + FOOTER_SCROLL_INSET,
          paddingHorizontal: spacing.xl,
        }}>
        {/* The DERIVED score, never the persisted one. A session below the
            scoring floor has no score at all, and `overallScore` would render a
            confident 0 rather than saying so. */}
        {sessionScore != null ? (
          <ScoreGauge
            score={sessionScore}
            delta={averageScore != null ? sessionScore - averageScore : undefined}
          />
        ) : (
          <UnscoredNotice
            title={recordId == null ? "We didn't hear anything" : 'Too short to score'}
            detail={
              recordId == null
                ? 'Check that your mic is enabled and try speaking a little closer to it.'
                : 'It still counts toward your practice time and your streak.'
            }
          />
        )}
        <View style={styles.playback}>
          <PlaybackPill result={result} />
        </View>
        <View style={styles.skillsHeader}>
          <ThemedText variant="title">Skills</ThemedText>
          <ThemedText variant="subhead" weight="regular" tone="secondary">
            How this session compares to your average
          </ThemedText>
        </View>
        <SkillCard skills={skills} captions={captions} deltas={deltas} />
        <View style={styles.coaching}>
          <AiCoachingCard result={result} />
        </View>
        <View style={styles.breakdown}>
          {result.mode === 'freestyle' ? (
            <TranscriptCard transcript={result.transcript ?? ''} />
          ) : (
            <WordBreakdown
              words={result.words}
              source={result.source}
              audioUri={result.audioUri}
            />
          )}
        </View>
      </ScrollView>

      <SessionTopBar onDismiss={handleDone}>
        <ThemedText variant="title3" weight="semibold">
          Session Complete
        </ThemedText>
      </SessionTopBar>
      <ResultsFooter onRetry={handleRetry} onDone={handleDone} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  playback: {
    marginTop: spacing.md,
  },
  skillsHeader: {
    marginTop: spacing.xxl,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  coaching: {
    marginTop: spacing.xxxl,
  },
  breakdown: {
    marginTop: spacing.xxxl,
  },
});

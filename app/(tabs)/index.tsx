import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Alert, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnalyticsUpIcon } from '@hugeicons-pro/core-stroke-rounded';
import { useMemo, useState } from 'react';

import { DailyGoalCard } from '@/components/daily-goal-card';
import { EmptyStateCard } from '@/components/empty-state-card';
import { useMinimizeOnScroll } from '@/components/glass-tabs';
import { HeaderActions } from '@/components/header-actions';
import { PassageCarousel } from '@/components/passage-carousel';
import { ProgressCard } from '@/components/progress-card';
import { IntroReveal } from '@/components/splash';
import { WeeklyProgress } from '@/components/weekly-progress';
import { SectionHeader, ThemedText } from '@/components/ui';
import { WordsToMaster } from '@/components/words-to-master';
import { PASSAGES } from '@/constants/passages';
import { spacing, TAB_BAR_SCROLL_INSET } from '@/constants/theme';
import { useMarkInteractive } from '@/hooks/use-mark-interactive';
import { useSessionRecords, useDerivedStats, useWords } from '@/hooks/use-session-history';
import { useNow } from '@/hooks/use-now';
import { useSpeakingSummary } from '@/hooks/use-speaking-summary';
import { totals } from '@/lib/stats';
import { generateWordPracticePassage } from '@/services/practice-generation';
import { speakWord } from '@/services/word-pronunciation';

/** Takes `now` from the shared clock so it refreshes on foreground instead of
 * being frozen at whatever hour the screen first mounted. */
function greeting(now: number) {
  const hour = new Date(now).getHours();
  if (hour < 5) return 'Good Evening';
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

export default function HomeScreen() {
  // The launch route: its mark is what EAS Observe records as the app's TTI.
  // History comes from the synchronous store, so the first render is the
  // finished screen — nothing to wait on beyond the splash.
  useMarkInteractive();

  const onScroll = useMinimizeOnScroll();
  const insets = useSafeAreaInsets();

  const now = useNow();
  const stats = useDerivedStats();
  const records = useSessionRecords();
  // The same rolling-7-day figures Analytics leads with, so the two tabs can
  // never disagree about this week.
  const summary = useSpeakingSummary();
  const percent = Math.round(stats.todayProgress * 100);
  const startPractice = () => router.push('/practice');

  // Progress + trouble words are derived only from real history — never demo
  // data. With nothing recorded yet, `progress` is null and the section shows
  // an empty state that says so rather than inventing numbers.
  const progress = useMemo(() => {
    if (records.length === 0) return null;
    const t = totals(records);
    return {
      totalMinutes: Math.round(t.minutes),
      totalSessions: t.sessions,
      longestStreak: t.longestStreak,
    };
  }, [records]);

  // From the running per-word aggregates, which know whether a word is actually
  // improving. `challengingWords` on a record only ever held a lossy top-5, so it
  // could not tell a word the user has since mastered from one they still miss.
  const { toMaster } = useWords(5);

  const [generatingPractice, setGeneratingPractice] = useState(false);
  const [speakingWord, setSpeakingWord] = useState<string | null>(null);

  const handlePracticeAll = async () => {
    if (generatingPractice) return;
    setGeneratingPractice(true);
    try {
      const passage = await generateWordPracticePassage(toMaster.map((w) => w.word));
      router.push(`/session/${passage.id}`);
    } catch (error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        'Passage not created',
        error instanceof Error ? error.message : 'Passage generation is unavailable right now.',
      );
    } finally {
      setGeneratingPractice(false);
    }
  };

  const handleSpeak = async (word: string) => {
    if (speakingWord) return;
    setSpeakingWord(word);
    try {
      await speakWord(word);
    } catch (error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        'Pronunciation unavailable',
        error instanceof Error ? error.message : 'Pronunciation audio is unavailable right now.',
      );
    } finally {
      setSpeakingWord(null);
    }
  };

  return (
    <Animated.ScrollView
      onScroll={onScroll}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingTop: insets.top + spacing.xxl,
        paddingHorizontal: spacing.xl,
        paddingBottom: TAB_BAR_SCROLL_INSET,
      }}>
      {/* Intro stagger: chrome (header, slot 0 with the tab bar) first, then
          the content cascades top-to-bottom. Anything holding a GlassView
          animates transform-only (fade: false) — glass breaks under animated
          opacity — and gets its fade-in from the splash overlay instead. */}
      <View style={styles.header}>
        <IntroReveal order={0}>
          <ThemedText variant="largeTitle">{greeting(now)}</ThemedText>
        </IntroReveal>
        <IntroReveal order={0} fade={false}>
          <HeaderActions streak={stats.streak} />
        </IntroReveal>
      </View>
      <IntroReveal order={1}>
        <WeeklyProgress todayProgress={stats.todayProgress} history={stats.weeklyHistory} />
      </IntroReveal>
      <IntroReveal order={2} fade={false}>
        <DailyGoalCard percent={percent} onStartPractice={startPractice} />
      </IntroReveal>
      <IntroReveal order={3}>
        <SectionHeader title="For you" subtitle="Sharpen your speaking with these passages" />
      </IntroReveal>
      <IntroReveal order={4} fade={false}>
        <PassageCarousel
          items={PASSAGES}
          onStart={(item) => router.push(`/session/${item.id}`)}
        />
      </IntroReveal>
      <IntroReveal order={5}>
        <SectionHeader title="Your progress" subtitle="Where your speaking stands right now" />
      </IntroReveal>
      <IntroReveal order={6} fade={false} style={styles.sectionCard}>
        {progress ? (
          <ProgressCard
            {...progress}
            score={summary.score}
            scoreDelta={summary.scoreDelta ?? undefined}
          />
        ) : (
          <EmptyStateCard
            icon={AnalyticsUpIcon}
            title="No progress yet"
            subtitle="Finish your first practice session and your best score, streak, and minutes will show up here."
          />
        )}
      </IntroReveal>
      {toMaster.length > 0 && (
        <>
          <IntroReveal order={7}>
            <SectionHeader title="Words to master" subtitle="The ones that trip you up most often" />
          </IntroReveal>
          <IntroReveal order={8} fade={false} style={styles.sectionCard}>
            <WordsToMaster
              words={toMaster}
              onPracticeAll={handlePracticeAll}
              generating={generatingPractice}
              onSpeak={handleSpeak}
              speakingWord={speakingWord}
            />
          </IntroReveal>
        </>
      )}
    </Animated.ScrollView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  // Breathing room between a section's title/description block and its card.
  sectionCard: {
    marginTop: spacing.md,
  },
});

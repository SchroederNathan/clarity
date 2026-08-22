import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMinimizeOnScroll } from '@/components/glass-tabs';
import { HeaderActions } from '@/components/header-actions';
import { PassageCarousel } from '@/components/passage-carousel';
import { DrillCard } from '@/components/practice/drill-card';
import { FreestyleCard } from '@/components/practice/freestyle-card';
import { AddPassageRow, PassageRow } from '@/components/practice/passage-row';
import { IntroReveal } from '@/components/splash';
import { SectionHeader, ThemedText } from '@/components/ui';
import { DRILLS } from '@/constants/drills';
import { PASSAGES } from '@/constants/passages';
import { spacing, TAB_BAR_SCROLL_INSET } from '@/constants/theme';
import { randomTopic, TOPICS, type FreestyleTopic } from '@/constants/topics';
import { useCustomPassages } from '@/hooks/use-custom-passages';
import { useMarkInteractive } from '@/hooks/use-mark-interactive';
import { useDerivedStats, useRecommendations } from '@/hooks/use-session-history';
import {
  FREESTYLE_ID_PREFIX,
  freestyleTopicIdFrom,
} from '@/lib/recommendations';
import { removePassage } from '@/services/user-passages';
import type { Passage, PassageCategory } from '@/types/session';

const CATEGORY_TITLES: Partial<Record<PassageCategory, string>> = {
  stories: 'Stories',
  news: 'News',
  narration: 'Narration',
  poetry: 'Poetry',
  twisters: 'Tongue Twisters',
};

const DEFAULT_RECOMMEND_SUBTITLE = 'Picks that adapt as you practice';

/** Screen edge padding. Held in a constant because the drills row cancels it
 * with a negative margin so its cards can bleed to the screen edges. */
const SCREEN_PADDING = spacing.xl;

function openContent(item: { id: string }) {
  if (item.id.startsWith(FREESTYLE_ID_PREFIX)) {
    router.push(`/session/freestyle?topicId=${freestyleTopicIdFrom(item.id)}`);
  } else {
    router.push(`/session/${item.id}`);
  }
}

export default function PracticeScreen() {
  useMarkInteractive();

  const onScroll = useMinimizeOnScroll();
  const insets = useSafeAreaInsets();

  const recommendations = useRecommendations();
  const customPassages = useCustomPassages();
  const stats = useDerivedStats();
  const [topic, setTopic] = useState<FreestyleTopic>(TOPICS[0]);

  const shuffleTopic = useCallback(() => {
    setTopic((current) => randomTopic(current.id));
  }, []);

  const startFreestyle = useCallback((t: FreestyleTopic) => {
    router.push(`/session/freestyle?topicId=${t.id}`);
  }, []);

  const confirmDeleteCustom = useCallback((passage: Passage) => {
    Alert.alert('Delete passage?', `“${passage.title}” will be removed from your library.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removePassage(passage.id) },
    ]);
  }, []);

  // Library groups: built-ins by category, in a stable order.
  const groups = (Object.keys(CATEGORY_TITLES) as PassageCategory[])
    .map((category) => ({
      category,
      title: CATEGORY_TITLES[category]!,
      passages: PASSAGES.filter((p) => p.category === category),
    }))
    .filter((g) => g.passages.length > 0);

  return (
    <Animated.ScrollView
      onScroll={onScroll}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingTop: insets.top + spacing.xxl,
        paddingHorizontal: SCREEN_PADDING,
        paddingBottom: TAB_BAR_SCROLL_INSET,
      }}>
      {/* Same header composition as Home: title left, streak + avatar right
          (glass capsules → transform-only reveal). */}
      <View style={styles.header}>
        <IntroReveal order={0}>
          <ThemedText variant="largeTitle">Practice</ThemedText>
        </IntroReveal>
        <IntroReveal order={0} fade={false}>
          <HeaderActions streak={stats.streak} />
        </IntroReveal>
      </View>

      {/* Recommended: real-data picks; glass cards → transform-only reveal. */}
      <IntroReveal order={1}>
        <SectionHeader
          title="For you"
          subtitle={recommendations.reason ?? DEFAULT_RECOMMEND_SUBTITLE}
        />
      </IntroReveal>
      <IntroReveal order={2} fade={false}>
        <PassageCarousel items={recommendations.items} onStart={openContent} />
      </IntroReveal>

      {/* Drills */}
      <IntroReveal order={3}>
        <SectionHeader title="Drills" subtitle="One-minute workouts for a single skill" />
      </IntroReveal>
      <IntroReveal order={4} fade={false}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.drillsRow}
          contentContainerStyle={styles.drillsContent}>
          {DRILLS.map((drill) => (
            <DrillCard key={drill.id} drill={drill} onStart={openContent} />
          ))}
        </ScrollView>
      </IntroReveal>

      {/* Freestyle */}
      <IntroReveal order={5}>
        <SectionHeader
          title="Freestyle"
          subtitle="No script. Speak off the cuff and see your words live"
        />
      </IntroReveal>
      <IntroReveal order={6} fade={false}>
        <View style={styles.sectionBody}>
          <FreestyleCard topic={topic} onShuffle={shuffleTopic} onStart={startFreestyle} />
        </View>
      </IntroReveal>

      {/* Library */}
      <IntroReveal order={7}>
        <SectionHeader title="Your passages" subtitle="Practice your own words" />
      </IntroReveal>
      <IntroReveal order={8} fade={false}>
        <View>
          {customPassages.map((passage) => (
            <PassageRow
              key={passage.id}
              passage={passage}
              onPress={openContent}
              onLongPress={confirmDeleteCustom}
            />
          ))}
          <AddPassageRow onPress={() => router.push('/passage-editor')} />
        </View>
      </IntroReveal>

      {groups.map((group) => (
        <IntroReveal key={group.category} order={9} fade={false}>
          <SectionHeader title={group.title} />
          {group.passages.map((passage) => (
            <PassageRow key={passage.id} passage={passage} onPress={openContent} />
          ))}
        </IntroReveal>
      ))}
    </Animated.ScrollView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  drillsRow: {
    marginHorizontal: -SCREEN_PADDING,
    marginTop: spacing.sm,
    // The interactive glass press response grows past the card bounds; the
    // scroll view must not clip it (same finding as PassageCarousel).
    overflow: 'visible',
  },
  drillsContent: {
    paddingHorizontal: SCREEN_PADDING,
    gap: spacing.md,
  },
  sectionBody: {
    marginTop: spacing.sm,
  },
});

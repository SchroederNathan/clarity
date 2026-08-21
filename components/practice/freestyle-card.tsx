import { Mic02Icon } from '@hugeicons-pro/core-solid-rounded';
import { ShuffleIcon } from '@hugeicons-pro/core-stroke-rounded';
import { HugeiconsIcon } from '@hugeicons/react-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';

import { GlassSurface, PrimaryButton, ThemedText } from '@/components/ui';
import { radius, spacing } from '@/constants/theme';
import type { FreestyleTopic } from '@/constants/topics';
import { useTheme } from '@/hooks/use-theme';

/** Shuffle button. 40pt with `hitSlop` bringing the tap area past 44pt. */
const SHUFFLE_SIZE = 40;

export type FreestyleCardProps = {
  topic: FreestyleTopic;
  onShuffle: () => void;
  onStart: (topic: FreestyleTopic) => void;
};

/** Impromptu-mode card: suggested topic + shuffle, and a Start button.
 * DailyGoalCard's structure — card glass as an absolute sibling so the
 * button/shuffle GlassViews are never nested inside another glass. */
export function FreestyleCard({ topic, onShuffle, onStart }: FreestyleCardProps) {
  const { colors } = useTheme();
  const hasGlass = isLiquidGlassAvailable();

  const handleShuffle = () => {
    Haptics.selectionAsync();
    onShuffle();
  };

  const shuffleContent = (
    <HugeiconsIcon icon={ShuffleIcon} size={18} color={colors.foreground} strokeWidth={1.5} />
  );

  return (
    <View style={styles.card}>
      <GlassSurface radius="xl" style={StyleSheet.absoluteFill} />

      <View style={styles.topicRow}>
        <View style={styles.topicText}>
          <ThemedText variant="footnote" tone="secondary">
            Suggested topic
          </ThemedText>
          <ThemedText variant="title3" weight="bold">
            {topic.title}
          </ThemedText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Shuffle topic"
          onPress={handleShuffle}
          hitSlop={spacing.sm}>
          {hasGlass ? (
            <GlassView glassEffectStyle="regular" isInteractive style={styles.shuffle}>
              {shuffleContent}
            </GlassView>
          ) : (
            <View style={[styles.shuffle, { backgroundColor: colors.fillTranslucent }]}>
              {shuffleContent}
            </View>
          )}
        </Pressable>
      </View>

      <ThemedText variant="subheadProse" tone="secondary" style={styles.prompt} numberOfLines={3}>
        {topic.prompt}
      </ThemedText>

      <PrimaryButton
        title="Start Speaking"
        icon={Mic02Icon}
        size="md"
        onPress={() => onStart(topic)}
        style={styles.button}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.xl,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
  },
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  topicText: {
    flex: 1,
    gap: spacing.xxs,
  },
  shuffle: {
    width: SHUFFLE_SIZE,
    height: SHUFFLE_SIZE,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prompt: {
    marginTop: spacing.md,
  },
  button: {
    marginTop: spacing.lg,
  },
});

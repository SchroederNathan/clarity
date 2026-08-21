import { PlusSignIcon } from '@hugeicons-pro/core-stroke-rounded';
import { HugeiconsIcon } from '@hugeicons/react-native';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';

import { AnimatedDashedBorder } from '@/components/animated-dashed-border';
import { GlassSurface, ThemedText } from '@/components/ui';
import { SKILL_LABELS } from '@/constants/metrics';
import { radius, spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Passage } from '@/types/session';

const THUMB_SIZE = 56;

/** Small square of the passage's card artwork (same gradient technique as
 * PassageCard, minus the text-legibility bed). */
function ArtworkThumb({ artwork }: { artwork: Passage['artwork'] }) {
  return (
    <View style={styles.thumb}>
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            experimental_backgroundImage: `linear-gradient(to bottom, ${artwork.base[0]} 0%, ${artwork.base[1]} 100%)`,
          },
        ]}
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            experimental_backgroundImage: `radial-gradient(ellipse ${THUMB_SIZE}px ${THUMB_SIZE}px at 100% 0%, ${artwork.blob[0]} 0%, ${artwork.blob[1]} 40%, transparent 100%)`,
          },
        ]}
      />
    </View>
  );
}

export type PassageRowProps = {
  passage: Passage;
  onPress: (passage: Passage) => void;
  onLongPress?: (passage: Passage) => void;
};

/** Library list row: artwork thumb, title, duration + skill chips. The whole
 * row is the pressable glass (content inside, per the PassageCard finding). */
export function PassageRow({ passage, onPress, onLongPress }: PassageRowProps) {
  const skills = (passage.skills ?? []).map((s) => SKILL_LABELS[s]).join(' · ');

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress(passage);
  };

  return (
    <Pressable
      accessibilityRole="button"
      onPress={handlePress}
      onLongPress={onLongPress ? () => onLongPress(passage) : undefined}>
      <GlassSurface radius="lg" interactive style={styles.row}>
        <ArtworkThumb artwork={passage.artwork} />
        <View style={styles.textCol}>
          <ThemedText variant="headline" numberOfLines={1}>
            {passage.title}
          </ThemedText>
          <ThemedText variant="footnote" weight="regular" tone="secondary" numberOfLines={1}>
            {passage.duration}
            {skills.length > 0 ? `  ·  ${skills}` : ''}
          </ThemedText>
        </View>
      </GlassSurface>
    </Pressable>
  );
}

/** Dashed "add your own" row that opens the passage editor. */
export function AddPassageRow({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();

  const handlePress = () => {
    Haptics.selectionAsync();
    onPress();
  };

  return (
    <Pressable
      accessibilityRole="button"
      onPress={handlePress}
      style={({ pressed }) => pressed && styles.pressed}>
      <AnimatedDashedBorder
        style={styles.addBorder}
        borderRadius={radius.lg}
        strokeColor={colors.outline}
        strokeWidth={1.5}
        dashLength={5}
        gapLength={5}>
        <View style={styles.addRow}>
          <View style={[styles.thumb, styles.addThumb, { borderColor: colors.outline }]}>
            <HugeiconsIcon
              icon={PlusSignIcon}
              size={22}
              color={colors.secondary}
              strokeWidth={1.5}
            />
          </View>
          <View style={styles.textCol}>
            <ThemedText variant="headline">Add your own</ThemedText>
            <ThemedText variant="footnote" weight="regular" tone="secondary">
              Paste any text, speech, or transcript
            </ThemedText>
          </View>
        </View>
      </AnimatedDashedBorder>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  addBorder: {
    marginTop: spacing.md,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.md,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  addThumb: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: {
    flex: 1,
    gap: spacing.xs,
  },
  pressed: {
    opacity: 0.7,
  },
});

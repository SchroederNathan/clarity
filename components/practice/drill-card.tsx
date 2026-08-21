import { HugeiconsIcon } from '@hugeicons/react-native';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';

import { GlassSurface, ThemedText } from '@/components/ui';
import { DRILL_META } from '@/constants/drills';
import { SKILL_ICONS, SKILL_LABELS } from '@/constants/metrics';
import { radius, spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Passage } from '@/types/session';

/** Card width for the horizontal drills row: two cards plus a peek of the third
 * at the common phone width, so the row reads as scrollable. */
const CARD_WIDTH = 168;

const ICON_BED_SIZE = 40;

export type DrillCardProps = {
  drill: Passage;
  onStart: (drill: Passage) => void;
};

/** Compact card for the horizontal drills row. Content lives INSIDE the
 * GlassView so the interactive press response fires (same finding as
 * PassageCard); the icon bed is a plain view — never a nested glass. */
export function DrillCard({ drill, onStart }: DrillCardProps) {
  const { colors } = useTheme();
  const meta = DRILL_META[drill.id];

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onStart(drill);
  };

  return (
    <Pressable accessibilityRole="button" onPress={handlePress} style={styles.item}>
      <GlassSurface radius="lg" interactive style={styles.card}>
        <View style={[styles.iconBed, { backgroundColor: colors.fillTranslucent }]}>
          <HugeiconsIcon
            icon={meta ? SKILL_ICONS[meta.skill] : SKILL_ICONS.accuracy}
            size={22}
            color={colors.foreground}
            strokeWidth={1.5}
          />
        </View>
        <ThemedText variant="callout" numberOfLines={1}>
          {drill.title}
        </ThemedText>
        {meta != null && (
          <ThemedText
            variant="footnote"
            weight="regular"
            tone="secondary"
            style={styles.blurb}
            numberOfLines={1}>
            {meta.blurb}
          </ThemedText>
        )}
        <ThemedText variant="caption" tone="secondary" style={styles.meta}>
          {meta ? `${SKILL_LABELS[meta.skill]} · ` : ''}
          {drill.duration}
        </ThemedText>
      </GlassSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: {
    width: CARD_WIDTH,
  },
  card: {
    flex: 1,
    padding: spacing.lg,
  },
  iconBed: {
    width: ICON_BED_SIZE,
    height: ICON_BED_SIZE,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  blurb: {
    marginTop: spacing.xxs,
  },
  meta: {
    marginTop: spacing.sm,
  },
});

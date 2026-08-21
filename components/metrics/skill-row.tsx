import { HugeiconsIcon } from '@hugeicons/react-native';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ui';
import { SKILL_ICONS, SKILL_LABELS } from '@/constants/metrics';
import { radius, spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { SkillKey } from '@/types/history';

import { DeltaLabel } from './delta-label';
import { ScoreValue } from './score-value';
import { TickBar } from './tick-bar';

/** Caption line height, held even when a skill has no caption, so every row is
 * the same height and the tick bars below them stay on one grid. */
const CAPTION_HEIGHT = 16;

/** Skill name line height, so a row's height doesn't depend on its glyphs. */
const NAME_HEIGHT = 20;

/**
 * One skill: name, raw-measure caption, score out of 100, change, and a tick
 * meter. Identical on the session summary and on Analytics — only the `caption`
 * and `delta` bases differ ("this session" vs "this week"), which is why both
 * arrive as props rather than being derived here.
 *
 * `score: null` means the skill wasn't measured (a freestyle session has no
 * Articulation, a non-Azure one has no Expression). That renders a dash and an
 * empty track rather than a zero, so "no data" never reads as "you scored 0".
 */
export type SkillRowProps = {
  skill: SkillKey;
  score: number | null;
  /** Raw measure under the name, e.g. "183 wpm · target 179". Omit when the
   * underlying count isn't recorded — Flow and Expression have none today. */
  caption?: string;
  /** Change vs the comparison basis. Omit when there's nothing to compare. */
  delta?: number;
  /** Marks this as the weakest skill. Only ever set on one row per card. */
  focus?: boolean;
};

export function SkillRow({ skill, score, caption, delta, focus = false }: SkillRowProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.row}>
      <View style={styles.header}>
        {/* Fixed-width slot keeps names in one vertical lane across all rows. */}
        <View style={styles.iconSlot}>
          <HugeiconsIcon
            icon={SKILL_ICONS[skill]}
            size={18}
            color={colors.tertiary}
            strokeWidth={1.8}
          />
        </View>

        <View style={styles.text}>
          <View style={styles.nameRow}>
            <ThemedText variant="callout" style={styles.name}>
              {SKILL_LABELS[skill]}
            </ThemedText>
            {focus && (
              <View style={[styles.focusPill, { backgroundColor: colors.focusBg }]}>
                <ThemedText variant="micro" weight="bold" tone="focus">
                  FOCUS
                </ThemedText>
              </View>
            )}
          </View>
          <View style={styles.captionSlot}>
            {caption != null && (
              <ThemedText
                variant="footnote"
                weight="regular"
                tone="tertiary"
                style={styles.caption}
                numberOfLines={1}>
                {caption}
              </ThemedText>
            )}
          </View>
        </View>

        <View style={styles.trailing}>
          <ScoreValue value={score} size={22} maxSize={12} />
          {score != null && delta != null && <DeltaLabel delta={delta} hideZero />}
        </View>
      </View>

      <TickBar fill={score != null ? score / 100 : 0} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  iconSlot: {
    width: 18,
    height: NAME_HEIGHT,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  name: {
    lineHeight: NAME_HEIGHT,
  },
  focusPill: {
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.xs,
    borderCurve: 'continuous',
  },
  captionSlot: {
    height: CAPTION_HEIGHT,
    justifyContent: 'center',
  },
  caption: {
    lineHeight: CAPTION_HEIGHT,
  },
  trailing: {
    flexShrink: 0,
    alignItems: 'flex-end',
    gap: spacing.xxs,
  },
});

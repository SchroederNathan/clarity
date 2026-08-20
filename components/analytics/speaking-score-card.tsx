import { StyleSheet, View } from 'react-native';

import { ScoreChart, type ScoreChartPoint } from '@/components/analytics/score-chart';
import { DeltaLabel, ScoreValue } from '@/components/metrics';
import { GlassSurface, ThemedText } from '@/components/ui';
import { SKILL_ORDER } from '@/constants/metrics';
import { radius, spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { scoreBand } from '@/lib/score';

export type SpeakingScoreCardProps = {
  /** Rolling score over the window; null when nothing was measured. */
  score: number | null;
  /** Change vs the previous window. Omit when there's no prior data. */
  delta?: number;
  /** Window name the delta pill reads, e.g. "this week" / "this month". */
  deltaSuffix?: string;
  /** Oldest first, current bucket last. `score: null` on empty buckets. */
  points: readonly ScoreChartPoint[];
  /** Extra caption under the chart, e.g. "Each bar is one week." */
  note?: string;
};

/**
 * The hero: one speaking score, its band, its window change, and the bucketed
 * scores behind it.
 *
 * The chart plots the same window the score is computed from, so the number,
 * the dashed average line, and the bars can never disagree — and it's the same
 * window Home's card reads, so the two screens always show the same figure.
 * The bars themselves are TanStack Charts (see `ScoreChart`): tapping a bar
 * pins a tooltip with that bucket's date, exact score, sessions, and minutes.
 */
export function SpeakingScoreCard({
  score,
  delta,
  deltaSuffix = 'this week',
  points,
  note,
}: SpeakingScoreCardProps) {
  const { colors } = useTheme();

  const footnote = [
    points.some((p) => p.score != null && p.skillCount < SKILL_ORDER.length)
      ? 'Lighter bars were scored on fewer skills.'
      : null,
    note,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <GlassSurface radius="xl" style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headLeft}>
          <ThemedText variant="eyebrow" tone="secondary">
            SPEAKING SCORE
          </ThemedText>
          <ScoreValue value={score} size={52} maxSize={19} />
        </View>
        <View style={styles.headRight}>
          {delta != null && delta !== 0 && (
            <View
              style={[
                styles.deltaPill,
                { backgroundColor: delta > 0 ? colors.positiveBg : 'transparent' },
              ]}>
              <DeltaLabel delta={delta} suffix={deltaSuffix} />
            </View>
          )}
          {score != null && (
            <ThemedText variant="footnote" weight="semibold" tone="secondary">
              {scoreBand(score)}
            </ThemedText>
          )}
        </View>
      </View>

      <View style={styles.chart}>
        <ScoreChart points={points} avg={score} />
        {footnote.length > 0 && (
          <ThemedText variant="caption" weight="regular" tone="tertiary" style={styles.footnote}>
            {footnote}
          </ThemedText>
        )}
      </View>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  footnote: {
    marginTop: spacing.md,
  },
  card: {
    padding: spacing.xxl,
    gap: spacing.xl,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headLeft: {
    gap: spacing.sm,
  },
  headRight: {
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  deltaPill: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
  },
  chart: {
    gap: spacing.sm,
  },
});

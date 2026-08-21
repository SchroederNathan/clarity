import { StyleSheet, View } from 'react-native';

import { DeltaLabel, ScoreValue, TickBar } from '@/components/metrics';
import { GlassSurface, ThemedText } from '@/components/ui';
import { radius, spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { scoreBand } from '@/lib/score';

/** Ticks in the hero meter. Denser than the skill bars because this one spans
 * the full card width with no trailing score to leave room for. */
const TICK_COUNT = 35;

export type ProgressCardProps = {
  /** Rolling 7-day speaking score; null when the week has nothing measured. */
  score: number | null;
  /** Change vs the previous 7 days. Omit when there's no prior week. */
  scoreDelta?: number;
  totalMinutes: number;
  totalSessions: number;
  longestStreak: number;
};

/** One all-time stat: big value plus a muted label beneath. */
function Stat({ value, unit, label }: { value: string; unit: string; label: string }) {
  return (
    <View style={styles.stat}>
      <View style={styles.statTop}>
        <ThemedText variant="title">{value}</ThemedText>
        <ThemedText variant="footnote" tone="tertiary">
          {unit}
        </ThemedText>
      </View>
      <ThemedText variant="caption" tone="tertiary">
        {label}
      </ThemedText>
    </View>
  );
}

/**
 * "Your progress": where a user's speaking stands right now.
 *
 * The hero is the same rolling 7-day speaking score Analytics leads with — not
 * a personal best — so opening either screen shows the same number. All-time
 * totals sit underneath, and the week's change lives in the hero rather than
 * being repeated per stat.
 */
export function ProgressCard({
  score,
  scoreDelta,
  totalMinutes,
  totalSessions,
  longestStreak,
}: ProgressCardProps) {
  const { colors } = useTheme();
  const hours = totalMinutes >= 60 ? Math.round(totalMinutes / 60) : null;

  return (
    <View>
      <GlassSurface radius="xl" style={styles.hero}>
        <ThemedText variant="eyebrow" tone="secondary">
          SPEAKING SCORE
        </ThemedText>
        <View style={styles.scoreRow}>
          <ScoreValue value={score} size={40} maxSize={18} />
          {score != null && (
            <View style={[styles.badge, { backgroundColor: colors.inverseSurface }]}>
              <ThemedText variant="caption" weight="bold" tone="inverse" style={styles.badgeLabel}>
                {scoreBand(score).toUpperCase()}
              </ThemedText>
            </View>
          )}
        </View>
        <TickBar fill={score != null ? score / 100 : 0} tickCount={TICK_COUNT} height={20} />
        <View style={styles.metaRow}>
          <ThemedText variant="footnote" tone="secondary">
            Last 7 days
          </ThemedText>
          {scoreDelta != null && scoreDelta !== 0 && (
            <DeltaLabel delta={scoreDelta} suffix="this week" />
          )}
        </View>
      </GlassSurface>

      <View style={styles.momentum}>
        <Stat
          value={String(hours ?? Math.round(totalMinutes))}
          unit={hours != null ? 'h' : 'min'}
          label="practice"
        />
        <View style={[styles.momentumDivider, { backgroundColor: colors.divider }]} />
        <Stat
          value={String(totalSessions)}
          unit=""
          label={totalSessions === 1 ? 'session' : 'sessions'}
        />
        <View style={[styles.momentumDivider, { backgroundColor: colors.divider }]} />
        <Stat
          value={String(longestStreak)}
          unit={longestStreak === 1 ? 'day' : 'days'}
          label="best streak"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // Pulls the score up against the eyebrow's descender space.
    marginTop: -spacing.xxs,
  },
  badge: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
  },
  badgeLabel: {
    letterSpacing: 0.5,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  momentum: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingVertical: spacing.xxs,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
  },
  statTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  momentumDivider: {
    width: 1,
    height: 34,
  },
});

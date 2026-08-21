import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react-native';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { GlassSurface, ThemedText } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { DeltaLabel } from './delta-label';

/** Height of the delta line, reserved whether or not there's a delta, so cards
 * sitting in a row stay the same height. */
const DELTA_HEIGHT = 16;

/**
 * One effort counter: labelled icon, a big value with its unit, and the change
 * since last week. Frosted like every other card in the app; group siblings in
 * a `GlassContainer` so their glass composites as one set.
 *
 * The value is always ink. Effort is effort; there's no "good" or "bad" amount
 * of practice to color it by.
 */
export type CounterCardProps = {
  icon: IconSvgElement;
  label: string;
  value: number;
  /** Sits after the value, e.g. "min", "runs", "days". */
  unit: string;
  /** Week-over-week change. Omit for a counter with no comparison. */
  delta?: number;
  /** Appended after the delta number, e.g. "min" in "↑ 12 min". */
  deltaSuffix?: string;
  style?: StyleProp<ViewStyle>;
};

export function CounterCard({
  icon,
  label,
  value,
  unit,
  delta,
  deltaSuffix,
  style,
}: CounterCardProps) {
  const { colors } = useTheme();

  return (
    <GlassSurface radius="lg" style={[styles.card, style]}>
      <View style={styles.header}>
        <HugeiconsIcon icon={icon} size={15} color={colors.tertiary} strokeWidth={1.9} />
        <ThemedText variant="footnote" tone="secondary" style={styles.label} numberOfLines={1}>
          {label}
        </ThemedText>
      </View>
      <View style={styles.values}>
        <View style={styles.valueRow}>
          <ThemedText variant="displayValue">{value}</ThemedText>
          <ThemedText variant="footnote" weight="semibold" tone="tertiary">
            {unit}
          </ThemedText>
        </View>
        {/* Reserve the delta line even when absent so cards in a row align. */}
        <View style={styles.deltaSlot}>
          {delta != null && <DeltaLabel delta={delta} suffix={deltaSuffix} hideZero />}
        </View>
      </View>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    flexShrink: 1,
  },
  values: {
    gap: spacing.xs,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  deltaSlot: {
    height: DELTA_HEIGHT,
    justifyContent: 'center',
  },
});

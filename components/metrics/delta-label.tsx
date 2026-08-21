import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { fonts, spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A change since last time: an arrow plus the magnitude.
 *
 * This component is where the app's color rule lives. Green means *improving*,
 * never *good* — a high score is still rendered in ink. Anything flat or
 * declining is gray, and there is deliberately no red path: a dip is
 * information, not an error, and coloring it red made every honest week look
 * like a failure.
 */
export type DeltaLabelProps = {
  /** Signed change. 0 renders as flat (gray) unless `hideZero` is set. */
  delta: number;
  /** Appended after the number, e.g. "min", "days", "this week". */
  suffix?: string;
  fontSize?: number;
  /** Render nothing when the delta is exactly 0. */
  hideZero?: boolean;
  /** Force a color (e.g. inside the green results pill, which is already tinted). */
  color?: string;
};

/** Chunky arrow — traced from the design so it reads at 11px, where a stroke
 * icon would smear. `down` mirrors it vertically. */
function Arrow({ color, down, size }: { color: string; down: boolean; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12">
      <Path
        d={down ? 'M6 10 L2 5 L4.5 5 L4.5 2 L7.5 2 L7.5 5 L10 5 Z' : 'M6 2 L10 7 L7.5 7 L7.5 10 L4.5 10 L4.5 7 L2 7 Z'}
        fill={color}
      />
    </Svg>
  );
}

export function DeltaLabel({
  delta,
  suffix,
  fontSize = 12,
  hideZero = false,
  color,
}: DeltaLabelProps) {
  const { colors } = useTheme();

  if (delta === 0 && hideZero) return null;

  const improving = delta > 0;
  const tone = color ?? (improving ? colors.positive : colors.tertiary);

  return (
    <View style={styles.row}>
      <Arrow color={tone} down={!improving} size={Math.round(fontSize * 0.92)} />
      <Text style={[styles.label, { color: tone, fontSize }]}>
        {Math.abs(delta)}
        {suffix ? ` ${suffix}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  label: {
    fontFamily: fonts.bold,
  },
});

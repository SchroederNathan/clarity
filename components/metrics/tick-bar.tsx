import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/**
 * A linear tick meter: a row of rounded bars with the first `fill` fraction
 * inked and the rest dimmed to a track. The same visual language as the radial
 * daily-goal and results gauges, flattened out.
 *
 * Ticks are laid out with `space-between` rather than a fixed pitch so the bar
 * fills whatever width it's given — the design's 9px pitch at ~322px of card
 * width works out to 36 ticks.
 */
export type TickBarProps = {
  /** 0–1. Values outside the range are clamped. */
  fill: number;
  tickCount?: number;
  height?: number;
  tickWidth?: number;
  /** Overrides the themed ink (e.g. on an inverted surface). */
  tick?: string;
  track?: string;
  style?: StyleProp<ViewStyle>;
};

export function TickBar({
  fill,
  tickCount = 36,
  height = 24,
  tickWidth = 4,
  tick,
  track,
  style,
}: TickBarProps) {
  const { colors } = useTheme();
  const inked = Math.round(Math.max(0, Math.min(fill, 1)) * tickCount);

  return (
    <View style={[styles.bar, { height }, style]}>
      {Array.from({ length: tickCount }, (_, i) => (
        <View
          key={i}
          style={{
            width: tickWidth,
            height,
            borderRadius: tickWidth / 2,
            backgroundColor: i < inked ? (tick ?? colors.foreground) : (track ?? colors.track),
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});

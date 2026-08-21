import { memo, useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withTiming,
  type FrameInfo,
  type SharedValue,
} from 'react-native-reanimated';

import { fonts, radius, spacing, type } from '@/constants/theme';
import { formatClock } from '@/lib/metrics';

const BAR_COUNT = 26;
const HALF = BAR_COUNT / 2;
const SAMPLE_MS = 90;
const MIN_HEIGHT = 7;
const MAX_HEIGHT = 30;
const BAR_WIDTH = 3.5;

/** Holds the timer's width across every clock value so the bars either side of
 * it don't shift as the digits change. */
const TIMER_MIN_WIDTH = 56;

const Bar = memo(function Bar({
  samples,
  index,
  color,
}: {
  samples: SharedValue<number[]>;
  index: number;
  color: string;
}) {
  const style = useAnimatedStyle(() => ({
    height: withTiming(MIN_HEIGHT + samples.value[index] * (MAX_HEIGHT - MIN_HEIGHT), {
      duration: SAMPLE_MS,
    }),
  }));
  return <Animated.View style={[styles.bar, { backgroundColor: color }, style]} />;
});

export type LiveWaveformProps = {
  /** UI-thread mic level 0..1 from the practice session. */
  meterLevel: SharedValue<number>;
  elapsedMs: number;
  barColor: string;
  timerColor: string;
};

/** Control-card top row: `[13 bars] 0:16 [13 bars]`. A frame callback samples
 * meterLevel every ~90ms into a shared ring buffer; each bar animates its
 * height from its slot, all on the UI thread. */
export function LiveWaveform({ meterLevel, elapsedMs, barColor, timerColor }: LiveWaveformProps) {
  const samples = useSharedValue<number[]>(new Array(BAR_COUNT).fill(0));
  const accumulated = useSharedValue(0);

  // Memoized so the frame callback isn't re-registered on the ~10Hz timer
  // re-renders (all captured values are stable shared values).
  const sample = useCallback(
    (frame: FrameInfo) => {
      'worklet';
      accumulated.value += frame.timeSincePreviousFrame ?? 0;
      if (accumulated.value < SAMPLE_MS) return;
      accumulated.value = 0;
      // New array assignment (not mutation) so dependent styles re-run.
      const next = samples.value.slice(1);
      next.push(meterLevel.value);
      samples.value = next;
    },
    [accumulated, samples, meterLevel],
  );
  useFrameCallback(sample);

  return (
    <View style={styles.row}>
      <View style={styles.group}>
        {Array.from({ length: HALF }, (_, i) => (
          <Bar key={i} samples={samples} index={i} color={barColor} />
        ))}
      </View>
      <Text style={[styles.timer, { color: timerColor }]}>{formatClock(elapsedMs)}</Text>
      <View style={styles.group}>
        {Array.from({ length: HALF }, (_, i) => (
          <Bar key={HALF + i} samples={samples} index={HALF + i} color={barColor} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: MAX_HEIGHT + 4,
  },
  group: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },
  bar: {
    width: BAR_WIDTH,
    borderRadius: radius.xs,
  },
  timer: {
    ...type.title,
    fontFamily: fonts.semibold,
    fontVariant: ['tabular-nums'],
    marginHorizontal: spacing.lg,
    minWidth: TIMER_MIN_WIDTH,
    textAlign: 'center',
  },
});

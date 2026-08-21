import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { ThemedText } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const RING_SIZE = 36;
const STROKE_WIDTH = 2;
const RADIUS = (RING_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// A whole number of dash periods so the dashed ring closes without a seam.
const DASH_COUNT = 12;
const DASH_PERIOD = CIRCUMFERENCE / DASH_COUNT;
const DASH_LENGTH = DASH_PERIOD * 0.45;

// Indexed by Date.getDay() (Sunday-first).
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export type WeeklyProgressProps = {
  /** Today's goal completion, 0–1; renders as a partial arc (full ring at 1). */
  todayProgress: number;
  /** Completion for the 5 days before today, oldest first: true = goal met
   * (solid ring), false = missed (dashed ring). */
  history?: readonly boolean[];
};

// Demo history until real session data exists; the streak of 1 in the header
// matches a completed yesterday.
const DEFAULT_HISTORY = [false, false, false, false, true] as const;

/** Arc that sweeps clockwise from 12 o'clock as `progress` fills. */
function TodayRing({ progress, color }: { progress: number; color: string }) {
  const fill = useSharedValue(0);
  useEffect(() => {
    fill.value = withTiming(Math.max(0, Math.min(progress, 1)), {
      duration: 900,
      easing: Easing.out(Easing.cubic),
    });
  }, [progress, fill]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: CIRCUMFERENCE * (1 - fill.value),
  }));

  return (
    <AnimatedCircle
      cx={RING_SIZE / 2}
      cy={RING_SIZE / 2}
      r={RADIUS}
      stroke={color}
      strokeWidth={STROKE_WIDTH}
      strokeLinecap="round"
      strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
      fill="none"
      animatedProps={animatedProps}
    />
  );
}

/** Week strip under the home header: the past 5 days, today, and tomorrow.
 * Dashed ring = missed day, solid ring = completed, partial arc = today's
 * progress; tomorrow is ringless and grayed. */
export function WeeklyProgress({ todayProgress, history = DEFAULT_HISTORY }: WeeklyProgressProps) {
  const { colors } = useTheme();

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() + i - 5);
    return {
      letter: DAY_LETTERS[date.getDay()],
      dayOfMonth: date.getDate(),
      isTomorrow: i === 6,
      isToday: i === 5,
      completed: i < 5 ? (history[i] ?? false) : false,
    };
  });

  return (
    <View style={styles.row}>
      {days.map((day, i) => (
        <View key={i} style={styles.cell}>
          <View style={styles.ring}>
            {!day.isTomorrow && (
              // Rotated so today's arc grows from 12 o'clock; the full rings
              // are rotation-invariant apart from the dash seam.
              <Svg width={RING_SIZE} height={RING_SIZE} style={styles.ringSvg}>
                {day.isToday ? (
                  <TodayRing progress={todayProgress} color={colors.foreground} />
                ) : (
                  <Circle
                    cx={RING_SIZE / 2}
                    cy={RING_SIZE / 2}
                    r={RADIUS}
                    stroke={colors.foreground}
                    strokeWidth={STROKE_WIDTH}
                    strokeLinecap="round"
                    strokeDasharray={
                      day.completed ? undefined : `${DASH_LENGTH} ${DASH_PERIOD - DASH_LENGTH}`
                    }
                    fill="none"
                  />
                )}
              </Svg>
            )}
            <ThemedText
              variant="subhead"
              tone={day.isTomorrow ? 'secondary' : 'primary'}
              style={styles.letter}>
              {day.letter}
            </ThemedText>
          </View>
          <ThemedText variant="callout" weight="medium" tone={day.isTomorrow ? 'secondary' : 'primary'}>
            {day.dayOfMonth}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  cell: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  ring: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringSvg: {
    transform: [{ rotate: '-90deg' }],
  },
  letter: {
    position: 'absolute',
  },
});

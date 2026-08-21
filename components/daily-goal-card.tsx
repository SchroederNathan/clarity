import { Mic02Icon } from '@hugeicons-pro/core-solid-rounded';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  interpolateColor,
  useAnimatedProps,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Line } from 'react-native-svg';

import { AnimatedRoundedNumber } from '@/components/animated-rounded-number';
import { GlassSurface, PrimaryButton, ThemedText } from '@/components/ui';
import { fonts, radius, spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Radial tick gauge: exactly the BOTTOM half of a ring whose centre sits at
 * the top of the card, so the ticks fan downward around the text, which sits
 * in the hollow. Angles are screen-space degrees (0° = right, 90° = down);
 * the fill runs from the horizontal middle-left tick (180° = 0%) down across
 * the bottom to the horizontal middle-right tick (0° = 100%). */
const TICK_COUNT = 15;
const START_ANGLE = 180;
const SWEEP = -180;
const OUTER_RADIUS = 128;
const TICK_LENGTH = 34;
const TICK_WIDTH = 10;
const GAUGE_SIZE = OUTER_RADIUS * 2 + TICK_WIDTH;
const GAUGE_CENTER = GAUGE_SIZE / 2;
// Ring centre (≈ the "Daily Goal" caption) measured from the card's top edge —
// close enough that the gauge sits just below the container's top.
const CENTER_Y = 20;
const WINDOW_HEIGHT = 156;

/** The percentage is the screen's largest number and sits inside the ring's
 * hollow, so it is sized to the hollow rather than to a ramp step. */
const PERCENT_SIZE = 38;

/** How long the gauge takes to sweep to the day's value on mount. Longer than
 * `motion.slow` on purpose: this is the one celebratory moment in the app. */
const SWEEP_DURATION = 900;

export type DailyGoalCardProps = {
  /** Goal completion, 0–100. */
  percent: number;
  onStartPractice: () => void;
};

const AnimatedLine = Animated.createAnimatedComponent(Line);

/** One gauge tick; sweeps from track to fill color as `progress` (0–1)
 * crosses its slot, so fill changes wipe across the fan. */
function Tick({
  index,
  progress,
  fill,
  track,
}: {
  index: number;
  progress: SharedValue<number>;
  fill: string;
  track: string;
}) {
  const angle = ((START_ANGLE + (SWEEP / (TICK_COUNT - 1)) * index) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const inner = OUTER_RADIUS - TICK_LENGTH;
  const animatedProps = useAnimatedProps(() => {
    const filled = interpolate(
      progress.value * TICK_COUNT - index,
      [0, 1],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return { stroke: interpolateColor(filled, [0, 1], [track, fill]) };
  });
  return (
    <AnimatedLine
      x1={GAUGE_CENTER + cos * inner}
      y1={GAUGE_CENTER + sin * inner}
      x2={GAUGE_CENTER + cos * OUTER_RADIUS}
      y2={GAUGE_CENTER + sin * OUTER_RADIUS}
      strokeWidth={TICK_WIDTH}
      strokeLinecap="round"
      animatedProps={animatedProps}
    />
  );
}

export function DailyGoalCard({ percent, onStartPractice }: DailyGoalCardProps) {
  const { colors } = useTheme();

  const clamped = Math.max(0, Math.min(percent, 100));
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(clamped / 100, {
      duration: SWEEP_DURATION,
      easing: Easing.out(Easing.cubic),
    });
  }, [clamped, progress]);

  return (
    <View style={styles.card}>
      {/* The card's glass sits as an absolute sibling under the content, so the
          button's own GlassView below is never nested inside another glass
          effect (nested glass doesn't render on iOS 26). */}
      <GlassSurface radius="xl" style={StyleSheet.absoluteFill} />

      <View style={styles.gaugeWindow}>
        <Svg width={GAUGE_SIZE} height={GAUGE_SIZE} style={styles.gauge}>
          {Array.from({ length: TICK_COUNT }, (_, i) => (
            <Tick
              key={i}
              index={i}
              progress={progress}
              fill={colors.foreground}
              track={colors.track}
            />
          ))}
        </Svg>
        <View style={styles.gaugeCenter} pointerEvents="none">
          <ThemedText variant="subhead" weight="medium" tone="secondary">
            Daily Goal
          </ThemedText>
          <AnimatedRoundedNumber
            text={`${clamped}%`}
            value={clamped}
            color={colors.foreground}
            fontSize={PERCENT_SIZE}
            fontFamily={fonts.bold}
            weight="bold"
            duration={0.6}
          />
        </View>
      </View>

      <PrimaryButton
        title="Start Practicing"
        icon={Mic02Icon}
        onPress={onStartPractice}
        style={styles.button}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.xl,
    // The gauge window sits flush with the top edge; the card's rounded clip
    // is what cuts the ring's top arc — part of the design.
    paddingTop: 0,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  gaugeWindow: {
    height: WINDOW_HEIGHT,
  },
  gauge: {
    position: 'absolute',
    top: CENTER_Y - GAUGE_CENTER,
    alignSelf: 'center',
  },
  gaugeCenter: {
    position: 'absolute',
    // Anchors the caption on the ring's centre; the percent hangs below it,
    // inside the ring's hollow.
    top: CENTER_Y - spacing.xs,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: spacing.xxs,
  },
  button: {
    marginTop: spacing.lg,
  },
});

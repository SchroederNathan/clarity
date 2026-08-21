import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Easing, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { AnimatedRoundedNumber } from '@/components/animated-rounded-number';
import { DeltaLabel } from '@/components/metrics';
import { ThemedText } from '@/components/ui';
import { fonts, radius, spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { scoreBand } from '@/lib/score';

import { TickGauge } from './tick-gauge';

/** 270° segmented gauge: opening at the bottom, filling clockwise from the
 * bottom-left tick, black fill over a 22%-alpha track. */
const TICK_COUNT = 20;
const START_ANGLE = 135;
const SWEEP = 270;
const OUTER_RADIUS = 120;
const TICK_LENGTH = 30;
const TICK_WIDTH = 9;

const FILL_DELAY_MS = 350;
const FILL_DURATION_MS = 1100;

/** The gauge's own track, heavier than `colors.track`: these ticks are 9pt wide
 * and 30pt long, so the app-wide 12%/16% track disappears at this scale. */
const TRACK = {
  light: 'rgba(17,17,20,0.22)',
  dark: 'rgba(255,255,255,0.22)',
} as const;

/** The results hero number. Sized to the gauge's hollow, not to a ramp step. */
const SCORE_SIZE = 56;
const SCORE_BOX_HEIGHT = 64;

export type ScoreGaugeProps = {
  /** 0–100 speaking score for this session. */
  score: number;
  /** Change vs the user's rolling average; omitted on a first session, where
   * there's no average to compare against yet. */
  delta?: number;
};

/**
 * The session's speaking score. Reads `NN /100` with its band word — the same
 * unit and the same vocabulary as Home and Analytics, so the number a user sees
 * here is the number they'll recognize everywhere else.
 */
export function ScoreGauge({ score, delta }: ScoreGaugeProps) {
  const { colors, scheme } = useTheme();

  const clamped = Math.max(0, Math.min(score, 100));
  const progress = useSharedValue(0);
  // The number counts up in sync with the tick fill (numericText rolls the
  // digits natively).
  const [displayScore, setDisplayScore] = useState(0);

  useEffect(() => {
    progress.value = withDelay(
      FILL_DELAY_MS,
      withTiming(clamped / 100, {
        duration: FILL_DURATION_MS,
        easing: Easing.out(Easing.cubic),
      }),
    );
    const timeout = setTimeout(() => setDisplayScore(clamped), FILL_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [clamped, progress]);

  return (
    <TickGauge
      tickCount={TICK_COUNT}
      startAngle={START_ANGLE}
      sweep={SWEEP}
      outerRadius={OUTER_RADIUS}
      tickLength={TICK_LENGTH}
      tickWidth={TICK_WIDTH}
      progress={progress}
      fill={colors.foreground}
      track={TRACK[scheme]}
      style={styles.gauge}>
      {/* Fixed-height boxes: SwiftUI Hosts don't self-size reliably in flex, and
          `alignItems: 'baseline'` can't reach the text inside one — so both
          columns are the same height and bottom-aligned instead, with the unit
          padded up onto the digits' baseline. The rolling number carries the
          value; "/100" is a static sibling so it doesn't animate with the
          digits. */}
      <View style={styles.scoreRow}>
        <View style={styles.scoreBox}>
          <AnimatedRoundedNumber
            text={`${displayScore}`}
            value={displayScore}
            color={colors.foreground}
            fontSize={SCORE_SIZE}
            fontFamily={fonts.heavy}
            weight="heavy"
            duration={0.9}
          />
        </View>
        <View style={styles.maxBox}>
          <ThemedText variant="title3" weight="semibold" tone="tertiary">
            /100
          </ThemedText>
        </View>
      </View>
      <ThemedText variant="subhead" tone="secondary" style={styles.band}>
        {scoreBand(clamped)}
      </ThemedText>
      {delta != null && delta !== 0 && (
        <View
          style={[
            styles.deltaPill,
            { backgroundColor: delta > 0 ? colors.positiveBg : 'transparent' },
          ]}>
          {/* "vs avg", not "vs your average": the gauge's hollow is only ~150px
              wide at this height, and the longer phrase overflows onto the
              ticks once the delta reaches two digits. */}
          <DeltaLabel delta={delta} suffix="vs avg" />
        </View>
      )}
    </TickGauge>
  );
}

const styles = StyleSheet.create({
  gauge: {
    alignSelf: 'center',
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  scoreBox: {
    height: SCORE_BOX_HEIGHT,
    justifyContent: 'center',
  },
  maxBox: {
    height: SCORE_BOX_HEIGHT,
    justifyContent: 'flex-end',
    // Lifts "/100" off the box floor onto the 56px digits' baseline.
    paddingBottom: 11,
  },
  band: {
    marginTop: spacing.xxs,
  },
  deltaPill: {
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
  },
});

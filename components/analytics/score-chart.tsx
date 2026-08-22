import { barY } from '@tanstack/charts/bar';
import { Chart } from '@tanstack/charts/react-native';
import {
  type NativeChartTooltipExtension,
  type NativeChartTooltipProps,
} from '@tanstack/charts/react-native/tooltip';
import { ruleY } from '@tanstack/charts/rule';
import { scaleBand } from '@tanstack/charts/scales/band';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { defineChart } from '@tanstack/charts/scene';
import { text } from '@tanstack/charts/text';
import {
  createChartTooltipContent,
  resolveChartTooltipAnchor,
  resolveChartTooltipPlacement,
} from '@tanstack/charts/tooltip/model';
import type { ChartValue } from '@tanstack/charts/types';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ui';
import { SKILL_ORDER } from '@/constants/metrics';
import { fonts, radius, spacing, type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { scoreBand } from '@/lib/score';

/** Bar area plus the tick-label row the axis draws inside the chart box. */
const CHART_HEIGHT = 134;

/**
 * Floor, in score points on the 0–100 scale, so a very low score still renders
 * as a visible bar — and the height a day with no practice gets. Same optical
 * size as the old hand-rolled chart's 14pt-of-110pt minimum bar.
 */
const MIN_BAR_SCORE = 13;

/** One plotted bucket: a day on the week/month ranges, a week on all time. */
export type ScoreChartPoint = {
  /** Stable identity and band-scale category — a dayKey or a week's startKey. */
  key: string;
  /** Axis tick label: a weekday initial or a short date. */
  label: string;
  /** Tooltip title: the full day ("Wed, Aug 19") or week span. */
  detail: string;
  /** null when nothing scorable happened in the bucket. */
  score: number | null;
  sessions: number;
  minutes: number;
  /** Skills the bucket was scored on; fewer than all five marks the bar as
   * partial, since a 3-skill score and a 5-skill score are not comparable. */
  skillCount: number;
  /** Today / the current week — drawn in the foreground ink like before. */
  isCurrent: boolean;
};

export type ScoreChartProps = {
  points: readonly ScoreChartPoint[];
  /** The window's rolling score; drawn as the dashed average line so the bars
   * and the number above them can never disagree. null hides the line. */
  avg: number | null;
};

/** Bars never render below the visibility floor; the tooltip carries the
 * exact value. */
function barTop(point: ScoreChartPoint): number {
  return Math.max(point.score ?? 0, MIN_BAR_SCORE);
}

/**
 * TanStack's RN tooltip host paints a hardcoded white shell (padding, border,
 * shadow) around `renderTooltip`. We keep its placement math and swap the
 * chrome for a transparent overlay so the themed card is the only surface.
 */
function ThemedChartTooltip<TDatum, TXValue extends ChartValue, TYValue extends ChartValue>({
  scene,
  width,
  height,
  points,
  pointer,
  focusSource,
  options,
  pinned,
  dismiss,
  render,
}: NativeChartTooltipProps<TDatum, TXValue, TYValue>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const point = points[0];
  if (!point || !render) return null;

  const content = createChartTooltipContent(points, scene, pinned, options, point);
  const sceneAnchor = resolveChartTooltipAnchor(point, points, scene, pointer, options, {
    primary: point,
    group: points,
    source: focusSource,
    pinned,
  });
  const position = resolveChartTooltipPlacement(
    {
      x: (sceneAnchor.x / scene.width) * width,
      y: (sceneAnchor.y / scene.height) * height,
    },
    size,
    { left: 0, top: 0, right: width, bottom: height },
    options?.placement,
    options?.offset,
  );
  const accessibilityLabel =
    typeof content === 'string'
      ? content
      : [content.title, ...content.rows.map((row) => `${row.label}: ${row.value}`)]
          .filter(Boolean)
          .join('\n');

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion={pinned ? 'none' : 'polite'}
      accessibilityRole={pinned ? 'summary' : undefined}
      onLayout={(event) => {
        const next = event.nativeEvent.layout;
        if (next.width !== size.width || next.height !== size.height) {
          setSize({ width: next.width, height: next.height });
        }
      }}
      onStartShouldSetResponder={() => pinned}
      pointerEvents={pinned ? 'auto' : 'none'}
      style={[styles.host, { left: position.left, top: position.top }]}>
      {render({ points, content, pinned, dismiss, defaultBody: null })}
    </View>
  );
}

const themedTooltip: NativeChartTooltipExtension = {
  id: 'themed-react-native-tooltip',
  __chartExtensionType: 'tooltip',
  __chartTooltipHost: 'react-native',
  create: () => ThemedChartTooltip,
};

/**
 * The speaking-score bar chart, drawn with TanStack Charts' native SVG host.
 *
 * Three bar marks share one explicit band domain: full-coverage days, partial
 * days (faded, same rule as before: scored on fewer skills), and no-practice
 * stubs. `focus: 'nearest-x'` plus a themed tooltip give every bucket a tap
 * detail — date, exact score and band, sessions, and minutes — which the old
 * hand-rolled chart could not do beyond seven weekday initials.
 */
export function ScoreChart({ points, avg }: ScoreChartProps) {
  const { colors } = useTheme();

  const definition = useMemo(() => {
    const keys = points.map((p) => p.key);
    const labels = new Map(points.map((p) => [p.key, p.label]));

    // ONE bar mark for every bucket: the band domain is inferred from mark
    // data in first-seen order, so splitting empty/full/partial into separate
    // marks reordered the bars (all the empty ones jumped to the front).
    // Partial-coverage fading therefore rides on the fill color itself —
    // `bar`/`foreground` are 6-digit hex in both schemes, so a 45% alpha byte
    // is safe to append.
    const fill = (p: ScoreChartPoint): string => {
      if (p.score == null) return colors.barEmpty;
      const ink = p.isCurrent ? colors.foreground : colors.bar;
      return p.skillCount < SKILL_ORDER.length ? `${ink}73` : ink;
    };

    return defineChart({
      marks: [
        barY(points as ScoreChartPoint[], {
          x: 'key',
          y1: 0,
          y2: barTop,
          key: 'key',
          radius: radius.xs,
          fill,
        }),
        ...(avg != null
          ? [
              ruleY([avg], {
                stroke: colors.foreground,
                strokeOpacity: 0.15,
                strokeWidth: 1.5,
                strokeDasharray: '4 4',
              }),
              text([avg], {
                x: () => keys[0],
                y: (v: number) => v,
                text: (v: number) => `avg ${Math.round(v)}`,
                fill: colors.tertiary,
                fontSize: type.micro.fontSize,
                anchor: 'start',
                dy: -spacing.sm,
              }),
            ]
          : []),
      ],
      x: {
        scale: () => scaleBand<string>().domain(keys).paddingInner(0.25).paddingOuter(0),
        axis: {
          line: false,
          ticks: {
            values: keys,
            size: 0,
            format: (key: string) => labels.get(key) ?? '',
          },
          tickLabels: { fontSize: type.caption.fontSize },
        },
      },
      y: {
        scale: () => scaleLinear().domain([0, 100]),
        grid: false,
        axis: false,
      },
      focus: 'nearest-x',
      tooltip: { use: themedTooltip, sticky: true },
      theme: {
        foreground: colors.foreground,
        muted: colors.tertiary,
        grid: colors.barEmpty,
        background: 'transparent',
      },
    });
  }, [points, avg, colors]);

  if (points.length === 0) return null;

  return (
    <Chart
      definition={definition}
      height={CHART_HEIGHT}
      color={colors.foreground}
      fontFamily={fonts.medium}
      accessibilityLabel="Speaking score by day"
      accessibilityHint="Swipe up or down to inspect a bar. Activate to pin its details."
      testID="speaking-score-chart"
      renderTooltip={({ points: focused }) => {
        const p = focused[0]?.datum as ScoreChartPoint | undefined;
        if (!p) return null;
        return (
          <View
            style={[
              styles.tooltip,
              { backgroundColor: colors.card, borderColor: colors.barEmpty },
            ]}>
            <ThemedText variant="caption" weight="semibold" tone="secondary">
              {p.detail}
            </ThemedText>
            {p.score != null ? (
              <ThemedText variant="footnote" weight="bold">
                {Math.round(p.score)} · {scoreBand(p.score)}
              </ThemedText>
            ) : (
              <ThemedText variant="footnote" weight="medium" tone="secondary">
                {p.sessions > 0 ? 'Practiced, not scored' : 'No practice'}
              </ThemedText>
            )}
            {p.sessions > 0 && (
              <ThemedText variant="caption" tone="tertiary">
                {p.sessions} {p.sessions === 1 ? 'session' : 'sessions'} · {p.minutes} min
              </ThemedText>
            )}
            {p.score != null && p.skillCount < SKILL_ORDER.length && (
              <ThemedText variant="caption" tone="tertiary">
                Scored on {p.skillCount} of {SKILL_ORDER.length} skills
              </ThemedText>
            )}
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    zIndex: 1,
    maxWidth: '80%',
  },
  tooltip: {
    padding: spacing.md,
    gap: spacing.xs,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
});

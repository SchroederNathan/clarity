import { Refresh01Icon } from '@hugeicons-pro/core-stroke-rounded';
import { HugeiconsIcon } from '@hugeicons/react-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { LoadingSpinner } from '@/components/loading-spinner';
import { ThemedText } from '@/components/ui';
import { radius, spacing } from '@/constants/theme';
import { useAiCoaching } from '@/hooks/use-ai-coaching';
import { useTheme } from '@/hooks/use-theme';
import type { SessionResult } from '@/types/session';

/** Card floor, so a one-line summary and the loading row occupy the same space
 * and the surrounding layout doesn't jump when coaching arrives. */
const CARD_MIN_HEIGHT = 104;
const LOADING_ROW_MIN_HEIGHT = 68;

/** The numbered tip badge. Square with a soft corner, not a circle: a two-digit
 * tip number would crowd a circle of this size. */
const TIP_BADGE_SIZE = 28;

const RETRY_HEIGHT = 38;

export type AiCoachingCardProps = {
  result: SessionResult;
};

export function AiCoachingCard({ result }: AiCoachingCardProps) {
  const { colors } = useTheme();
  const hasGlass = isLiquidGlassAvailable();
  const coaching = useAiCoaching(result);

  const isLoading = coaching.status === 'loading';
  // Keep the loading row mounted after the request settles so the spinner's
  // stop animation can play out before the result swaps in.
  const [spinnerDone, setSpinnerDone] = useState(false);
  useEffect(() => {
    if (isLoading) setSpinnerDone(false);
  }, [isLoading]);
  const showLoading = isLoading || !spinnerDone;

  // Streaming partials and the final result render through the same view.
  const breakdown =
    coaching.status === 'streaming' || coaching.status === 'success' ? coaching.breakdown : null;
  const tips = (breakdown?.tips ?? []).filter(
    (tip): tip is NonNullable<typeof tip> => !!tip?.title,
  );

  return (
    <View>
      <ThemedText variant="title3" weight="bold" style={styles.heading}>
        AI Coach
      </ThemedText>

      <View style={styles.card}>
        {/* The card's glass is an absolute sibling so the retry button's tinted
            bed is never nested inside a glass effect. */}
        {hasGlass ? (
          <GlassView
            glassEffectStyle="regular"
            style={[
              StyleSheet.absoluteFill,
              styles.cardShape,
              { backgroundColor: colors.glassTintStrong },
            ]}
          />
        ) : (
          <View
            style={[StyleSheet.absoluteFill, styles.cardShape, { backgroundColor: colors.card }]}
          />
        )}

        {showLoading ? (
          <View style={styles.state}>
            <LoadingSpinner active={isLoading} onFinish={() => setSpinnerDone(true)} />
            <View style={styles.stateCopy}>
              <ThemedText variant="callout">Reviewing your session</ThemedText>
              <ThemedText variant="footnoteProse" tone="secondary">
                Putting together a few pointers for you.
              </ThemedText>
            </View>
          </View>
        ) : null}

        {!showLoading && coaching.status === 'error' ? (
          <View style={styles.errorState}>
            <ThemedText variant="callout">Coaching couldn’t load</ThemedText>
            <ThemedText variant="footnoteProse" tone="secondary">
              {coaching.error}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry AI coaching"
              onPress={coaching.retry}
              style={({ pressed }) => [
                styles.retryButton,
                { backgroundColor: colors.accentBg },
                pressed && styles.pressed,
              ]}>
              <HugeiconsIcon
                icon={Refresh01Icon}
                size={17}
                color={colors.accent}
                strokeWidth={1.8}
              />
              <ThemedText variant="footnote" weight="semibold" tone="accent">
                Try again
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        {!showLoading && breakdown ? (
          <View>
            <ThemedText variant="bodyProse" weight="semibold" style={styles.summary}>
              {breakdown.summary ?? ''}
            </ThemedText>
            {tips.length > 0 ? (
              <View style={styles.tips}>
                {tips.map((tip, index) => (
                  <View
                    key={index}
                    style={[
                      styles.tip,
                      index > 0 && { borderTopColor: colors.divider, borderTopWidth: 1 },
                    ]}>
                    <View style={[styles.tipNumber, { backgroundColor: colors.accentBg }]}>
                      <ThemedText variant="footnote" weight="bold" tone="accent">
                        {index + 1}
                      </ThemedText>
                    </View>
                    <View style={styles.tipCopy}>
                      <ThemedText variant="callout" style={styles.tipTitle}>
                        {tip.title}
                      </ThemedText>
                      {tip.guidance ? (
                        <ThemedText variant="subheadProse" style={styles.tipGuidance}>
                          {tip.guidance}
                        </ThemedText>
                      ) : null}
                      {tip.evidence ? (
                        <ThemedText variant="caption" tone="secondary" style={styles.evidence}>
                          {tip.evidence}
                        </ThemedText>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    marginBottom: spacing.md,
  },
  card: {
    minHeight: CARD_MIN_HEIGHT,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
    padding: spacing.xl,
  },
  cardShape: {
    borderRadius: radius.lg,
    borderCurve: 'continuous',
  },
  state: {
    minHeight: LOADING_ROW_MIN_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  stateCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  errorState: {
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  retryButton: {
    height: RETRY_HEIGHT,
    borderRadius: radius.full,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.72,
  },
  summary: {
    letterSpacing: -0.15,
  },
  tips: {
    marginTop: spacing.md,
  },
  tip: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  tipNumber: {
    width: TIP_BADGE_SIZE,
    height: TIP_BADGE_SIZE,
    borderRadius: radius.sm,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    // Sits the badge on the tip title's cap height rather than its line box.
    marginTop: 1,
  },
  tipCopy: {
    flex: 1,
  },
  tipTitle: {
    lineHeight: 20,
  },
  tipGuidance: {
    marginTop: spacing.xs,
  },
  evidence: {
    marginTop: spacing.sm,
    lineHeight: 16,
  },
});

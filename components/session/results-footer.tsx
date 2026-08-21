import { Rotate01Icon, Tick02Icon } from '@hugeicons-pro/core-stroke-rounded';
import { HugeiconsIcon } from '@hugeicons/react-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CHROME_BLUR_BLEED, ProgressiveBlur } from '@/components/glass-tabs';
import { ThemedText } from '@/components/ui';
import { radius, spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const PILL_HEIGHT = 60;

/** Gap between the pills and the safe-area bottom. */
const ROW_BOTTOM_GAP = spacing.sm;

export type ResultsFooterProps = {
  onRetry: () => void;
  onDone: () => void;
};

/** Floating Retry (light glass) / Done (dark) pills over a bottom
 * progressive blur so results scroll away beneath them. */
export function ResultsFooter({ onRetry, onDone }: ResultsFooterProps) {
  const insets = useSafeAreaInsets();
  const { colors, scheme } = useTheme();
  const hasGlass = isLiquidGlassAvailable();

  const retryContent = (
    <>
      <HugeiconsIcon icon={Rotate01Icon} size={20} color={colors.foreground} strokeWidth={1.8} />
      <ThemedText variant="headline">Retry</ThemedText>
    </>
  );

  const doneContent = (
    <>
      <HugeiconsIcon icon={Tick02Icon} size={20} color={colors.inverseLabel} strokeWidth={2} />
      <ThemedText variant="headline" tone="inverse">
        Done
      </ThemedText>
    </>
  );

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <ProgressiveBlur
        direction="bottom"
        tint={scheme}
        style={[styles.blur, { top: -CHROME_BLUR_BLEED }]}
      />
      <View
        style={[styles.row, { paddingBottom: insets.bottom + ROW_BOTTOM_GAP }]}
        pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [styles.pillWrap, pressed && !hasGlass && styles.pressed]}>
          {hasGlass ? (
            <GlassView glassEffectStyle="regular" isInteractive style={styles.pill}>
              {retryContent}
            </GlassView>
          ) : (
            <View style={[styles.pill, { backgroundColor: colors.fillStrong }]}>
              {retryContent}
            </View>
          )}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={onDone}
          style={({ pressed }) => [styles.pillWrap, pressed && !hasGlass && styles.pressed]}>
          {hasGlass ? (
            <GlassView
              glassEffectStyle="regular"
              isInteractive
              tintColor={colors.inverseSurface}
              style={styles.pill}>
              {doneContent}
            </GlassView>
          ) : (
            <View style={[styles.pill, { backgroundColor: colors.inverseSurface }]}>{doneContent}</View>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'flex-end',
  },
  blur: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  pillWrap: {
    flex: 1,
  },
  pill: {
    height: PILL_HEIGHT,
    borderRadius: radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.8,
  },
});

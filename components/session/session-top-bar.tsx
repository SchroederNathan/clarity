import { ArrowDown01Icon } from '@hugeicons-pro/core-stroke-rounded';
import { HugeiconsIcon } from '@hugeicons/react-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CHROME_BLUR_BLEED, ProgressiveBlur } from '@/components/glass-tabs';
import { ThemedText } from '@/components/ui';
import { radius, spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Minimum comfortable touch target, and the circle buttons' diameter. */
const BUTTON_SIZE = 44;

/** Gap between the safe-area top and the bar. */
const BAR_TOP_GAP = spacing.sm;

type CircleButtonProps = {
  onPress: () => void;
  children: ReactNode;
};

function CircleButton({ onPress, children }: CircleButtonProps) {
  const { colors } = useTheme();
  const hasGlass = isLiquidGlassAvailable();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={spacing.sm}
      style={({ pressed }) => !hasGlass && pressed && styles.pressed}>
      {hasGlass ? (
        <GlassView glassEffectStyle="regular" isInteractive style={styles.circle}>
          {children}
        </GlassView>
      ) : (
        <View style={[styles.circle, { backgroundColor: colors.fillStrong }]}>{children}</View>
      )}
    </Pressable>
  );
}

export type SessionTopBarProps = {
  onDismiss: () => void;
  /** Renders an "Aa" text-size button on the right when provided. */
  onTextSize?: () => void;
  /** Center slot (e.g. the live WPM header on the practice screen). */
  children?: ReactNode;
};

/** Shared session header: circular glass dismiss chevron (left), optional
 * "Aa" text-size button (right), and a centered content slot. Absolutely
 * positioned over the screen so content scrolls beneath it. */
export function SessionTopBar({ onDismiss, onTextSize, children }: SessionTopBarProps) {
  const insets = useSafeAreaInsets();
  const { colors, scheme } = useTheme();

  return (
    <>
      <ProgressiveBlur
        direction="top"
        tint={scheme}
        style={[
          styles.blur,
          { height: insets.top + BAR_TOP_GAP + BUTTON_SIZE + CHROME_BLUR_BLEED },
        ]}
      />
      <View style={[styles.bar, { top: insets.top + BAR_TOP_GAP }]} pointerEvents="box-none">
        <CircleButton onPress={onDismiss}>
          <HugeiconsIcon icon={ArrowDown01Icon} size={24} color={colors.foreground} strokeWidth={2} />
        </CircleButton>

        <View style={styles.center} pointerEvents="none">
          {children}
        </View>

        {onTextSize ? (
          <CircleButton onPress={onTextSize}>
            <ThemedText variant="headline">Aa</ThemedText>
          </CircleButton>
        ) : (
          <View style={styles.spacer} />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  blur: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
  },
  circle: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spacer: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
  },
  pressed: {
    opacity: 0.7,
  },
});

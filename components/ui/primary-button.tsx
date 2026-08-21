import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from './themed-text';

/** Button heights. Both clear the 44pt minimum touch target comfortably; `lg` is
 * for a screen's single committing action, `md` for one inside a card. */
const HEIGHTS = { md: 54, lg: 60 } as const;

export type PrimaryButtonProps = {
  title: string;
  onPress: () => void;
  icon?: IconSvgElement;
  size?: keyof typeof HEIGHTS;
  disabled?: boolean;
  /** Fires a medium impact on press. On by default: every existing caller wants
   * it, because this button always starts or commits something. */
  haptic?: boolean;
  /** Merged last, so callers can set margins without forking. */
  style?: StyleProp<ViewStyle>;
};

/**
 * The app's one committing action: "Start Practicing", "Start Speaking", "Save".
 * A capsule of inverted glass — near-black on light, near-white on dark.
 *
 * There is no `variant` prop because the app has exactly one button intent
 * today. A second intent (destructive, secondary) adds a variant here rather
 * than a second button component.
 *
 * The glass layer needs `tintColor` rather than a `backgroundColor`, and it
 * can't be nested inside another `GlassView` (nested glass doesn't render on
 * iOS 26) — so a card holding this button must render its own glass as an
 * absolute sibling, not as this button's ancestor.
 */
export function PrimaryButton({
  title,
  onPress,
  icon,
  size = 'lg',
  disabled = false,
  haptic = true,
  style,
}: PrimaryButtonProps) {
  const { colors } = useTheme();
  const hasGlass = isLiquidGlassAvailable();

  const handlePress = () => {
    if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress();
  };

  const shape = [styles.button, { height: HEIGHTS[size] }];
  const body = (
    <>
      {icon != null && (
        <HugeiconsIcon icon={icon} size={size === 'lg' ? 22 : 20} color={colors.inverseLabel} />
      )}
      <ThemedText variant="headline" tone="inverse">
        {title}
      </ThemedText>
    </>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={handlePress}
      style={({ pressed }) => [pressed && styles.pressed, style]}>
      {hasGlass && !disabled ? (
        <GlassView
          glassEffectStyle="regular"
          isInteractive
          tintColor={colors.inverseSurface}
          style={shape}>
          {body}
        </GlassView>
      ) : (
        <View
          style={[
            shape,
            { backgroundColor: disabled ? colors.inverseSurfaceMuted : colors.inverseSurface },
          ]}>
          {body}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  pressed: {
    opacity: 0.85,
  },
});

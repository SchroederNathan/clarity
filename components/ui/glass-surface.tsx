import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius as radiusTokens } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type GlassSurfaceProps = {
  children?: React.ReactNode;
  /** Corner radius step. Compact cards use `lg`; hero cards use `xl`. */
  radius?: keyof typeof radiusTokens;
  /** `strong` for a control sitting over live content, where the standard tint
   * lets too much through to stay readable. */
  tint?: 'standard' | 'strong';
  /** Adds the native press response. Only for a surface that is itself tappable. */
  interactive?: boolean;
  /** Merged last, so callers can set layout (padding, gap, flex) without
   * forking. Callers set layout, not the surface's identity. */
  style?: StyleProp<ViewStyle>;
};

/**
 * A frosted card. Nineteen components each carried their own copy of this:
 * check `isLiquidGlassAvailable()`, render `GlassView` with a tint, or fall back
 * to an opaque `View` — which is how the app ended up with two different
 * fallback colors and six different card radii.
 *
 * Never wrap this in an animated opacity: `GlassView` stops rendering its blur
 * under one. Animate a transform on a parent instead.
 */
export function GlassSurface({
  children,
  radius = 'lg',
  tint = 'standard',
  interactive,
  style,
}: GlassSurfaceProps) {
  const { colors } = useTheme();
  const shape: ViewStyle = {
    borderRadius: radiusTokens[radius],
    borderCurve: 'continuous',
    // An interactive surface must NOT clip: the native press response grows
    // past the card's bounds, and hidden overflow shears it off.
    overflow: interactive ? 'visible' : 'hidden',
  };

  if (!isLiquidGlassAvailable()) {
    return <View style={[shape, { backgroundColor: colors.glassFallback }, style]}>{children}</View>;
  }

  return (
    <GlassView
      glassEffectStyle="regular"
      isInteractive={interactive}
      style={[
        shape,
        { backgroundColor: tint === 'strong' ? colors.glassTintStrong : colors.glassTint },
        style,
      ]}>
      {children}
    </GlassView>
  );
}

/** Shape-only styles for a surface that can't use `GlassSurface` — one that has
 * to be a `Pressable`, or an `Animated.View`. Keeps the radius and clipping
 * consistent with the real thing. */
export const glassSurfaceShape = StyleSheet.create({
  clip: { borderCurve: 'continuous', overflow: 'hidden' },
});

/**
 * Moving dashed border. Ported from the Opal example in rn-makeitanimated
 * (originally arunabhverma/expo-animated-dashed-border, which uses Skia's
 * DashPathEffect). This project doesn't ship Skia, so the same effect is
 * recreated with react-native-svg's `strokeDashoffset`, animated on the UI
 * thread with Reanimated. Wrap content; the dashes travel around the rounded
 * rect perimeter.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Rect } from 'react-native-svg';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

type Props = {
  strokeWidth?: number;
  dashLength?: number;
  gapLength?: number;
  /** Loop duration in ms. Lower = faster dash travel. */
  animationSpeed?: number;
  borderRadius?: number;
  /** Required: this primitive has no view on what the app's border color is. */
  strokeColor: string;
  direction?: 'clockwise' | 'counterclockwise';
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

export function AnimatedDashedBorder({
  strokeWidth = 1.5,
  dashLength = 6,
  gapLength = 6,
  animationSpeed = 1500,
  borderRadius = 26,
  strokeColor,
  direction = 'clockwise',
  style,
  children,
}: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Draw the stroke fully inside the view's bounds.
  const inset = strokeWidth / 2;
  const w = Math.max(0, size.w - strokeWidth);
  const h = Math.max(0, size.h - strokeWidth);
  const r = Math.min(borderRadius, Math.min(w, h) / 2);

  // Distribute dashes evenly around the rounded-rect perimeter so there's no
  // broken segment at the seam (same math as the Skia original).
  const { dash, gap, cycle } = useMemo(() => {
    if (!w || !h) return { dash: Math.max(3, dashLength), gap: Math.max(3, gapLength), cycle: 0 };
    const perimeter = 2 * (w + h - 2 * r) + 2 * Math.PI * r;
    const numDashes = Math.max(8, Math.floor(perimeter / (dashLength + gapLength)));
    const total = perimeter / numDashes;
    const g = Math.max(3, gapLength);
    const d = Math.max(3, total - g);
    return { dash: d, gap: g, cycle: d + g };
  }, [w, h, r, dashLength, gapLength]);

  const phase = useSharedValue(0);

  useMemo(() => {
    if (!cycle) return;
    // Clockwise travel reads as a negative offset shift on this path.
    const target = direction === 'clockwise' ? -cycle : cycle;
    phase.set(0);
    phase.set(
      withRepeat(withTiming(target, { duration: animationSpeed, easing: Easing.linear }), -1, false)
    );
  }, [cycle, animationSpeed, direction, phase]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: phase.get(),
  }));

  return (
    <View
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize({ w: width, h: height });
      }}
      style={[{ position: 'relative' }, style]}>
      {children}
      {!!w && !!h && (
        <Svg
          width={size.w}
          height={size.h}
          style={{ position: 'absolute', top: 0, left: 0 }}
          pointerEvents="none">
          <AnimatedRect
            x={inset}
            y={inset}
            width={w}
            height={h}
            rx={r}
            ry={r}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={[dash, gap]}
            animatedProps={animatedProps}
          />
        </Svg>
      )}
    </View>
  );
}

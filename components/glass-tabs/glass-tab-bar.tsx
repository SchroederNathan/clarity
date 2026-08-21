import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { Children, createContext, use, useCallback, useEffect, useMemo } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  useColorScheme,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type AnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TabListProps, TabTriggerSlotProps } from 'expo-router/ui';

import { colors, fonts, radius, springs } from '@/constants/theme';

import { MINIMIZE_SPRING, setMinimized, useMinimizeState } from './minimize-context';
import { CHROME_BLUR_BLEED, ProgressiveBlur } from './progressive-blur';

const AnimatedGlassView = Animated.createAnimatedComponent(GlassView);

const EXPANDED_HEIGHT = 58;
const MINIMIZED_HEIGHT = 44;
/** Fixed per-tab widths — the pill hugs its content instead of spanning the
 * screen; minimizing shrinks each item so the pill contracts in both axes. */
const ITEM_WIDTH_EXPANDED = 80;
const ITEM_WIDTH_MINIMIZED = 58;
/** Inner inset between the capsule wall and the tab items. */
const ROW_PAD_H = 4;
const LABEL_HEIGHT = 13;
/** Below the type ramp's smallest step on purpose: a tab label has to fit an
 * 80pt item beside four siblings, and the icon above it carries the meaning. */
const LABEL_FONT_SIZE = 9.5;
const ICON_SIZE = 21;
/** Space between icon and label — folded into the label's animated height so
 * it fully disappears when minimized (keeps the icon perfectly centered). */
const ITEM_GAP = 2;
const LABEL_BLOCK = LABEL_HEIGHT + ITEM_GAP;
const ITEM_PAD_V = 7;
/** Highlight content heights — radius must track h/2 for a true capsule. */
const HIGHLIGHT_EXPANDED = ICON_SIZE + LABEL_BLOCK + ITEM_PAD_V * 2;
const HIGHLIGHT_MINIMIZED = ICON_SIZE + ITEM_PAD_V * 2;
/**
 * Slide spring: interruptible by design — rapid tab-hopping retargets with
 * preserved velocity. Slight under-damping gives the pill a tiny settle,
 * safe here because it's transform-only (no layout involved).
 */
const SLIDE_SPRING = springs.settle;

export type GlassTabBarTheme = {
  activeTint: string;
  inactiveTint: string;
  /** Sliding highlight pill color. */
  highlight: string;
  /** Tint layered over the liquid glass. */
  glassTint: string;
  /** Opaque-ish background used when liquid glass is unavailable. */
  solidFallback: string;
};

/** The bar's own highlight pill. Lighter than `colors.fillTranslucent`: it sits
 * on top of glass and behind a label, so a heavier fill muddies the text. */
const HIGHLIGHT = {
  light: 'rgba(0,0,0,0.07)',
  dark: 'rgba(255,255,255,0.14)',
} as const;

const DARK_THEME: GlassTabBarTheme = {
  activeTint: colors.dark.foreground,
  inactiveTint: colors.dark.secondary,
  highlight: HIGHLIGHT.dark,
  glassTint: colors.dark.glassTint,
  solidFallback: colors.dark.glassFallback,
};

const LIGHT_THEME: GlassTabBarTheme = {
  activeTint: colors.light.foreground,
  inactiveTint: colors.light.secondary,
  highlight: HIGHLIGHT.light,
  glassTint: colors.light.glassTint,
  solidFallback: colors.light.glassFallback,
};

export type GlassTabItem = {
  name: string;
  label: string;
  /** Hugeicons solid glyph — used for both tint layers. */
  icon: IconSvgElement;
};

type BarContextValue = {
  slideIndex: SharedValue<number>;
  isDragging: SharedValue<boolean>;
  theme: GlassTabBarTheme;
};

const BarContext = createContext<BarContextValue | null>(null);

export type GlassTabBarProps = TabListProps & {
  /** Called when a tab is chosen by tap or scrub release. */
  onIndexSelected?: (index: number) => void;
  theme?: Partial<GlassTabBarTheme>;
  /** Haptic tick while the scrub crosses tab boundaries (iOS). */
  haptics?: boolean;
  /** Extra (animated) style on the bar's root — e.g. the app-intro entrance.
   * A prop instead of a wrapper view because expo-router's TabList must keep
   * the bar as its direct `asChild` element for trigger parsing. */
  entranceStyle?: StyleProp<AnimatedStyle<ViewStyle>>;
};

/**
 * Floating liquid-glass tab bar with Revolut-style minimize-on-scroll,
 * a sliding highlight, and finger scrubbing. Use via `TabList asChild`
 * with expo-router's headless tabs.
 */
export function GlassTabBar({
  children,
  onIndexSelected,
  theme: themeOverrides,
  haptics = true,
  entranceStyle,
  ...props
}: GlassTabBarProps) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const minimized = useMinimizeState();
  const progress = minimized.progress;
  const slideIndex = useSharedValue(0);
  const isDragging = useSharedValue(false);
  const lastTicked = useSharedValue(-1);
  const tabCount = Math.max(Children.count(children), 1);
  const theme = useMemo(
    () => ({ ...(scheme === 'dark' ? DARK_THEME : LIGHT_THEME), ...themeOverrides }),
    [scheme, themeOverrides],
  );

  // Picker-style tick while the highlight crosses tab boundaries mid-drag.
  const tick = useCallback(() => {
    if (haptics && Platform.OS === 'ios') {
      Haptics.selectionAsync();
    }
  }, [haptics]);

  // Navigation happens only on release — switching screens live while
  // scrubbing makes the content jump under the finger.
  const selectIndex = useCallback((index: number) => onIndexSelected?.(index), [onIndexSelected]);

  // Scrubbing: the highlight tracks the finger 1:1 while dragging (no spring
  // — it must feel attached), haptic ticks fire on boundary crossings, and
  // navigation happens only on release. Taps are handled by a Tap gesture
  // racing the pan — the detector consumes the bar's touches, so the inner
  // Pressables never receive them.
  const gesture = useMemo(() => {
    const indexAtX = (x: number, minimizedValue: number) => {
      'worklet';
      const itemWidth = interpolate(
        minimizedValue,
        [0, 1],
        [ITEM_WIDTH_EXPANDED, ITEM_WIDTH_MINIMIZED],
        Extrapolation.CLAMP,
      );
      const raw = (x - ROW_PAD_H) / itemWidth - 0.5;
      return Math.min(Math.max(raw, 0), tabCount - 1);
    };

    const pan = Gesture.Pan()
      .activeOffsetX([-6, 6])
      .failOffsetY([-14, 14])
      .onStart(() => {
        isDragging.value = true;
        lastTicked.value = Math.round(slideIndex.value);
        // Scrubbing is a deliberate bar interaction — surface the labels.
        setMinimized(minimized, 0);
      })
      .onUpdate((event) => {
        const index = indexAtX(event.x, progress.value);
        slideIndex.value = index;

        const rounded = Math.round(index);
        if (rounded !== lastTicked.value) {
          lastTicked.value = rounded;
          runOnJS(tick)();
        }
      })
      .onFinalize(() => {
        // Fires on failure too (e.g. the touch was a tap) — only act when
        // the pan actually activated, or we'd stomp the tap's navigation.
        if (!isDragging.value) {
          return;
        }
        const rounded = Math.round(slideIndex.value);
        slideIndex.value = withSpring(rounded, SLIDE_SPRING);
        runOnJS(selectIndex)(rounded);
        isDragging.value = false;
      });

    const tap = Gesture.Tap()
      // Real fingers drift a few points — the default tolerance (~2pt)
      // makes ordinary taps fail. Past 6pt horizontal the pan takes over.
      .maxDistance(16)
      .maxDuration(400)
      .onEnd((event, success) => {
        if (!success) {
          return;
        }
        const index = Math.round(indexAtX(event.x, progress.value));
        slideIndex.value = withSpring(index, SLIDE_SPRING);
        setMinimized(minimized, 0);
        runOnJS(selectIndex)(index);
      });

    return Gesture.Race(pan, tap);
  }, [tabCount, selectIndex, tick, isDragging, lastTicked, slideIndex, minimized, progress]);

  const barStyle = useAnimatedStyle(() => {
    const height = interpolate(
      progress.value,
      [0, 1],
      [EXPANDED_HEIGHT, MINIMIZED_HEIGHT],
      Extrapolation.CLAMP,
    );
    const itemWidth = interpolate(
      progress.value,
      [0, 1],
      [ITEM_WIDTH_EXPANDED, ITEM_WIDTH_MINIMIZED],
      Extrapolation.CLAMP,
    );
    return {
      height,
      // Revolut-style: the pill shrinks in both dimensions.
      width: itemWidth * tabCount + ROW_PAD_H * 2,
    };
  });

  // The capsule shape lives on the glass view itself: iOS 26 glass renders
  // its own native corner configuration (true squircle + rim lighting).
  // Clipping a rectangular glass with an RN mask breaks that.
  const shapeStyle = useAnimatedStyle(() => {
    const height = interpolate(
      progress.value,
      [0, 1],
      [EXPANDED_HEIGHT, MINIMIZED_HEIGHT],
      Extrapolation.CLAMP,
    );
    return { borderRadius: radius.full };
  });

  // One shared highlight that slides between tabs (transform-only → GPU).
  // All geometry derives from shared values, never from layout callbacks.
  const highlightStyle = useAnimatedStyle(() => {
    const barHeight = interpolate(
      progress.value,
      [0, 1],
      [EXPANDED_HEIGHT, MINIMIZED_HEIGHT],
      Extrapolation.CLAMP,
    );
    const height = interpolate(
      progress.value,
      [0, 1],
      [HIGHLIGHT_EXPANDED, HIGHLIGHT_MINIMIZED],
      Extrapolation.CLAMP,
    );
    const itemWidth = interpolate(
      progress.value,
      [0, 1],
      [ITEM_WIDTH_EXPANDED, ITEM_WIDTH_MINIMIZED],
      Extrapolation.CLAMP,
    );
    return {
      height,
      width: itemWidth,
      borderRadius: radius.full,
      top: (barHeight - height) / 2,
      transform: [{ translateX: ROW_PAD_H + itemWidth * slideIndex.value }],
    };
  });

  const bottomOffset = Math.max(insets.bottom - 16, 12);
  const barContext = useMemo(
    () => ({ slideIndex, isDragging, theme }),
    [slideIndex, isDragging, theme],
  );

  const barContent = (
    <>
      <Animated.View
        style={[
          {
            position: 'absolute',
            left: 0,
            backgroundColor: theme.highlight,
            borderCurve: 'continuous',
          },
          highlightStyle,
        ]}
      />
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: ROW_PAD_H,
        }}>
        <BarContext.Provider value={barContext}>{children}</BarContext.Provider>
      </View>
    </>
  );

  return (
    <Animated.View
      {...props}
      pointerEvents="box-none"
      style={[{ position: 'absolute', left: 0, right: 0, bottom: 0 }, entranceStyle]}>
      {/* Progressive blur rising from the screen's bottom edge behind the pill. */}
      <ProgressiveBlur
        direction="bottom"
        tint={scheme === 'dark' ? 'dark' : 'light'}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: bottomOffset + EXPANDED_HEIGHT + CHROME_BLUR_BLEED,
        }}
      />
      <View
        pointerEvents="box-none"
        style={{ alignItems: 'center', marginBottom: bottomOffset }}>
        <GestureDetector gesture={gesture}>
          {/* The glass view IS the bar container: touches on the tabs land
              inside its native bounds, so `isInteractive` responds to presses.
              As a detached sibling it never receives them. */}
          {isLiquidGlassAvailable() ? (
            <AnimatedGlassView
              glassEffectStyle="regular"
              isInteractive
              style={[
                { backgroundColor: theme.glassTint, borderCurve: 'continuous' },
                barStyle,
                shapeStyle,
              ]}>
              {barContent}
            </AnimatedGlassView>
          ) : (
            <Animated.View
              style={[
                { backgroundColor: theme.solidFallback, borderCurve: 'continuous' },
                barStyle,
                shapeStyle,
              ]}>
              {barContent}
            </Animated.View>
          )}
        </GestureDetector>
      </View>
    </Animated.View>
  );
}

/** Icon rendered at a fixed tint (used twice for the crossfade layers). */
function TabGlyph({ item, tint }: { item: GlassTabItem; tint: string }) {
  return (
    <View style={{ height: ICON_SIZE, justifyContent: 'center' }}>
      <HugeiconsIcon icon={item.icon} size={ICON_SIZE} color={tint} />
    </View>
  );
}

/** One tab trigger: icon + label that fades when minimized. */
export function GlassTabButton({
  item,
  index,
  isFocused,
  onPress,
  ...props
}: TabTriggerSlotProps & { item: GlassTabItem; index: number }) {
  const minimized = useMinimizeState();
  const progress = minimized.progress;
  const scheme = useColorScheme();
  const bar = use(BarContext);
  const theme = bar?.theme ?? (scheme === 'dark' ? DARK_THEME : LIGHT_THEME);
  const slideIndex = bar?.slideIndex;

  // Covers programmatic navigation too (deep links, back gestures). While
  // scrubbing, the finger owns the highlight — never fight it with a spring.
  useEffect(() => {
    if (isFocused && bar && !bar.isDragging.value) {
      bar.slideIndex.value = withSpring(index, SLIDE_SPRING);
    }
  }, [isFocused, index, bar]);

  // Tint follows the sliding highlight, not navigation focus: whatever the
  // pill is over lights up — live while scrubbing, traveling on taps.
  const activeGlyphStyle = useAnimatedStyle(() => ({
    opacity: slideIndex ? 1 - Math.min(Math.abs(slideIndex.value - index), 1) : isFocused ? 1 : 0,
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.4], [1, 0], Extrapolation.CLAMP),
    color: slideIndex
      ? interpolateColor(
          Math.min(Math.abs(slideIndex.value - index), 1),
          [0, 1],
          [theme.activeTint, theme.inactiveTint],
        )
      : isFocused
        ? theme.activeTint
        : theme.inactiveTint,
  }));

  // Height is animated EXPLICITLY (not derived from children) so the icon
  // stays perfectly centered every frame — layout-driven sizing lags behind
  // UI-thread animation.
  const boxStyle = useAnimatedStyle(() => ({
    height: interpolate(
      progress.value,
      [0, 1],
      [HIGHLIGHT_EXPANDED, HIGHLIGHT_MINIMIZED],
      Extrapolation.CLAMP,
    ),
  }));

  return (
    <Pressable
      {...props}
      onPress={(event) => {
        // The GestureDetector normally consumes touches; this still fires
        // for accessibility activation (VoiceOver) and keyboard focus.
        if (bar) bar.slideIndex.value = withSpring(index, SLIDE_SPRING);
        setMinimized(minimized, 0);
        onPress?.(event);
      }}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          { alignSelf: 'stretch', alignItems: 'center', paddingTop: ITEM_PAD_V, overflow: 'hidden' },
          boxStyle,
        ]}>
        {/* Inactive glyph underneath, active glyph crossfading on top. */}
        <View>
          <TabGlyph item={item} tint={theme.inactiveTint} />
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { alignItems: 'center', justifyContent: 'center' },
              activeGlyphStyle,
            ]}>
            <TabGlyph item={item} tint={theme.activeTint} />
          </Animated.View>
        </View>
        {/* Fades out and is clipped by the shrinking box — no layout anim. */}
        <Animated.Text
          numberOfLines={1}
          style={[styles.label, labelStyle]}>
          {item.label}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: LABEL_FONT_SIZE,
    fontFamily: fonts.semibold,
    marginTop: ITEM_GAP,
  },
});

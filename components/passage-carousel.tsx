import { PlayIcon } from '@hugeicons-pro/core-solid-rounded';
import { HugeiconsIcon } from '@hugeicons/react-native';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { memo } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedProps,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/ui';
import { colors as themeColors, radius, spacing } from '@/constants/theme';

/** Opal-style layout: 2 full cards centered with a 15% peek of the next card
 * on each side, so the row reads as horizontally scrollable at a glance. */
const ITEMS_CENTERED = 2;
const PEEK_RATIO = 0.15;
const VISIBLE_RATIO = ITEMS_CENTERED + PEEK_RATIO * 2;
/** Outer padding (not margin/gap) on each item keeps the visual gap stable
 * while the card scales down inside its layout box. */
const ITEM_GAP = spacing.sm;
const CARD_RADIUS = radius.xl;
/** The "Start" pill on a card. Visual only — the whole card is pressable. */
const BUTTON_HEIGHT = 40;
/** Width / height of the card's layout box, matched to the design mock. */
const CARD_ASPECT = 0.88;

/**
 * A passage card is the app's one INVERTED surface: dark in both schemes, so its
 * artwork reads and its white text keeps contrast. That's why the tint doesn't
 * come from `colors.glassTint` — this is the opposite direction — and why the
 * two entries aren't a light/dark pair of the same thing but two strengths of
 * the same dark tint. Text and controls on it use the `onArtwork*` tokens.
 */
const CARD_TINT = {
  // Light backgrounds shine through glass more, so the tint is stronger.
  light: { glass: 'rgba(14,14,22,0.60)', solid: 'rgba(20,20,28,0.98)' },
  dark: { glass: 'rgba(10,10,16,0.45)', solid: 'rgba(18,18,24,0.98)' },
} as const;

export type PassageItem = {
  id: string;
  title: string;
  /** Display string, e.g. "~2 mins". */
  duration: string;
  /** Card art: vertical base gradient pair + a radial accent blob pair,
   * as CSS color strings. Alphas < 1 let the card's glass read through. */
  artwork: { base: [string, string]; blob: [string, string] };
};

export type PassageCarouselProps = {
  items: PassageItem[];
  onStart: (item: PassageItem) => void;
  /** The consuming screen's content padding; the carousel bleeds past it
   * edge-to-edge and re-pads its content so cards align with the column. */
  horizontalPadding?: number;
};

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

export function PassageCarousel({
  items,
  onStart,
  horizontalPadding = 20,
}: PassageCarouselProps) {
  const { width: screenWidth } = useWindowDimensions();
  const itemWidth = (screenWidth - horizontalPadding * 2) / VISIBLE_RATIO;
  // Inset by the item gap so the first card's VISUAL edge (inside its 6pt
  // gap padding) lines up with the consuming screen's content column.
  const edgePadding = horizontalPadding - ITEM_GAP;

  // Single source of truth for every card's scale/blur interpolation.
  const scrollX = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.set(event.contentOffset.x);
    },
  });

  return (
    <Animated.ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      onScroll={onScroll}
      scrollEventThrottle={16}
      // overflow:visible — a ScrollView clips to its bounds by default, and
      // the cards' glass shadows (plus the interactive press response) extend
      // past the 6pt item gap. Same fix as the drills row on Practice.
      style={{ marginHorizontal: -horizontalPadding, overflow: 'visible' }}
      contentContainerStyle={{ paddingHorizontal: edgePadding }}>
      {items.map((item, index) => (
        <PassageCard
          key={item.id}
          item={item}
          index={index}
          scrollX={scrollX}
          itemWidth={itemWidth}
          screenWidth={screenWidth}
          edgePadding={edgePadding}
          onStart={onStart}
        />
      ))}
    </Animated.ScrollView>
  );
}

type PassageCardProps = {
  item: PassageItem;
  index: number;
  scrollX: SharedValue<number>;
  itemWidth: number;
  screenWidth: number;
  edgePadding: number;
  onStart: (item: PassageItem) => void;
};

const PassageCard = memo(function PassageCard({
  item,
  index,
  scrollX,
  itemWidth,
  screenWidth,
  edgePadding,
  onStart,
}: PassageCardProps) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const tint = CARD_TINT[scheme];
  const hasGlass = isLiquidGlassAvailable();

  // Cards at the visual center stay full size and sharp; they shrink to 0.88
  // and (on iOS) blur up to 15 as they move a card-and-a-half away from it.
  const rCardStyle = useAnimatedStyle(() => {
    const screenCenter = (screenWidth - edgePadding * 2) / 2;
    const itemCenter = index * itemWidth - scrollX.get() + itemWidth / 2;
    const distance = Math.abs(itemCenter - screenCenter);
    const scale = interpolate(
      distance,
      [0, itemWidth, itemWidth * 1.5],
      [1, 1, 0.88],
      Extrapolation.CLAMP,
    );
    return { transform: [{ scale }] };
  });

  const rBlurProps = useAnimatedProps(() => {
    const screenCenter = (screenWidth - edgePadding * 2) / 2;
    const itemCenter = index * itemWidth - scrollX.get() + itemWidth / 2;
    const distance = Math.abs(itemCenter - screenCenter);
    return {
      intensity: interpolate(
        distance,
        [0, itemWidth, itemWidth * 1.5],
        [0, 0, 15],
        Extrapolation.CLAMP,
      ),
    };
  });

  const handleStart = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onStart(item);
  };

  const buttonContent = (
    <>
      <HugeiconsIcon icon={PlayIcon} size={15} color={themeColors.light.onArtwork} />
      <ThemedText variant="subhead" style={styles.buttonLabel}>
        Start
      </ThemedText>
    </>
  );

  // Card artwork + text live INSIDE the card's GlassView: the native glass
  // effect only reacts to touches that land in the glass view's own subtree,
  // so an absolute-sibling underlay never shimmers (same finding as the tab
  // bar — the glass view must be the container that gets pressed).
  const cardBody = (
    <>
      {/* The art clips to the card shape HERE (not on an outer wrapper) so
          the glass view itself can overflow its bounds — the interactive
          press response scales the glass up slightly and an outer
          overflow:hidden would swallow it.
          Children must stay HIT-TESTABLE (no pointerEvents="none"): the
          native glass mounts them inside the effect view's contentView, and
          the interactive response only fires when a touch lands there. */}
      <View style={styles.artClip}>
        {/* Art fades out by ~78% height so the bottom third stays true glass;
            one gradient per view — multi-background strings aren't supported. */}
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              experimental_backgroundImage: `linear-gradient(to bottom, ${item.artwork.base[0]} 0%, ${item.artwork.base[1]} 45%, transparent 78%)`,
            },
          ]}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              // Explicit radii keep the blob an accent on the top-right
              // corner (default farthest-corner size floods the card). Both
              // radii are spelled out: RN's parser mis-eats `at` after a
              // single-size `circle Npx`, dropping the position.
              experimental_backgroundImage: `radial-gradient(ellipse ${Math.round(itemWidth * 0.6)}px ${Math.round(itemWidth * 0.6)}px at 100% 0%, ${item.artwork.blob[0]} 0%, ${item.artwork.blob[1]} 40%, transparent 100%)`,
            },
          ]}
        />
        {/* Scheme-invariant dark bed keeps the white text legible over both
            the artwork and whatever shows through the glass. */}
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              experimental_backgroundImage:
                'linear-gradient(to bottom, transparent 38%, rgba(0,0,0,0.38) 66%, rgba(0,0,0,0.68) 100%)',
            },
          ]}
        />
      </View>
      <View style={styles.content}>
        <ThemedText variant="headline" weight="bold" style={styles.title} numberOfLines={2}>
          {item.title}
        </ThemedText>
        <ThemedText variant="footnote" style={styles.duration}>
          {item.duration}
        </ThemedText>
        {/* Purely visual affordance — the WHOLE card is the pressable. The
            pill lives INSIDE the card's glass so it expands with the
            interactive response; it can't be its own GlassView because
            nested glass doesn't render on iOS 26. */}
        <View style={[styles.button, { backgroundColor: themeColors.light.artworkFill }]}>
          {buttonContent}
        </View>
      </View>
    </>
  );

  return (
    <Animated.View style={[{ width: itemWidth }, styles.item, rCardStyle]}>
      {/* The whole card is the button; the native interactive glass supplies
          the press feedback, so no pressed-opacity (dropping opacity can
          also disable the glass effect entirely). */}
      <Pressable onPress={handleStart} style={styles.clip}>
        {hasGlass ? (
          <GlassView
            glassEffectStyle="regular"
            isInteractive
            style={[styles.cardFill, styles.cardShape, { backgroundColor: tint.glass }]}>
            {cardBody}
          </GlassView>
        ) : (
          <View
            style={[styles.cardFill, styles.cardShape, { backgroundColor: tint.solid }]}>
            {cardBody}
          </View>
        )}
      </Pressable>

      {/* Off-center depth blur, iOS only (parity with the reference app). */}
      {Platform.OS === 'ios' && (
        <View style={styles.blurClip} pointerEvents="none">
          <AnimatedBlurView
            animatedProps={rBlurProps}
            tint="systemThinMaterialDark"
            style={StyleSheet.absoluteFill}
          />
        </View>
      )}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  item: {
    aspectRatio: CARD_ASPECT,
    padding: ITEM_GAP,
  },
  // Deliberately NO overflow:'hidden' here — the interactive glass response
  // grows past the card bounds and must stay visible.
  clip: {
    flex: 1,
  },
  cardShape: {
    borderRadius: CARD_RADIUS,
    borderCurve: 'continuous',
  },
  artClip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: CARD_RADIUS,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  cardFill: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: 'flex-end',
  },
  title: {
    color: themeColors.light.onArtwork,
  },
  duration: {
    color: themeColors.light.onArtworkMuted,
    marginTop: spacing.xxs,
    marginBottom: spacing.md,
  },
  button: {
    height: BUTTON_HEIGHT,
    borderRadius: radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  buttonLabel: {
    color: themeColors.light.onArtwork,
  },
  blurClip: {
    position: 'absolute',
    top: ITEM_GAP,
    left: ITEM_GAP,
    right: ITEM_GAP,
    bottom: ITEM_GAP,
    borderRadius: CARD_RADIUS,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
});

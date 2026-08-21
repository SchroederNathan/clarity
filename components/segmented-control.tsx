import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { ThemedText } from '@/components/ui';
import { radius, springs } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Inset of the thumb inside the track. Sub-grid on purpose: it is the visual
 * hairline that separates thumb from track, not a spacing decision. */
const TRACK_PADDING = 3;

/** Minimum comfortable touch target. */
const HEIGHT = 44;

export type SegmentedControlProps = {
  segments: readonly string[];
  selectedIndex: number;
  onChange: (index: number) => void;
  style?: StyleProp<ViewStyle>;
};

/** Custom segmented control in the app's pill language: inverted sliding
 * thumb (same colors as the Start buttons), SF Pro Rounded labels, spring
 * slide between segments. */
export function SegmentedControl({
  segments,
  selectedIndex,
  onChange,
  style,
}: SegmentedControlProps) {
  const { colors } = useTheme();

  const [trackWidth, setTrackWidth] = useState(0);
  const segmentWidth = trackWidth > 0 ? (trackWidth - TRACK_PADDING * 2) / segments.length : 0;

  const offset = useSharedValue(selectedIndex);
  useEffect(() => {
    offset.value = withSpring(selectedIndex, springs.snap);
  }, [selectedIndex, offset]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value * segmentWidth }],
  }));

  return (
    <View
      style={[styles.track, { backgroundColor: colors.fillTranslucent }, style]}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}>
      {segmentWidth > 0 && (
        <Animated.View
          style={[
            styles.thumb,
            { width: segmentWidth, backgroundColor: colors.inverseSurface },
            thumbStyle,
          ]}
        />
      )}
      {segments.map((segment, index) => (
        <Pressable
          key={segment}
          onPress={() => {
            if (index !== selectedIndex) onChange(index);
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: index === selectedIndex }}
          style={styles.segment}>
          <ThemedText variant="subhead" tone={index === selectedIndex ? 'inverse' : 'primary'}>
            {segment}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    height: HEIGHT,
    borderRadius: radius.full,
    padding: TRACK_PADDING,
  },
  thumb: {
    position: 'absolute',
    top: TRACK_PADDING,
    bottom: TRACK_PADDING,
    left: TRACK_PADDING,
    borderRadius: radius.full,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

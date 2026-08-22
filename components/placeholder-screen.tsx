import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMinimizeOnScroll } from '@/components/glass-tabs';
import { ThemedText } from '@/components/ui';
import { spacing, TAB_BAR_SCROLL_INSET } from '@/constants/theme';

/** Temporary screen body while the real screen is built. No backgroundColor
 * here — the navigation theme paints the screen container, which keeps
 * tab-switch fades flash-free. */
export function PlaceholderScreen({ title }: { title: string }) {
  const onScroll = useMinimizeOnScroll();
  const insets = useSafeAreaInsets();

  return (
    <Animated.ScrollView
      onScroll={onScroll}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingTop: insets.top + spacing.xxl,
        paddingHorizontal: spacing.xl,
        paddingBottom: TAB_BAR_SCROLL_INSET,
      }}>
      <ThemedText variant="largeTitle" style={styles.title}>
        {title}
      </ThemedText>
    </Animated.ScrollView>
  );
}

const styles = StyleSheet.create({
  title: {
    marginBottom: spacing.xl,
  },
});

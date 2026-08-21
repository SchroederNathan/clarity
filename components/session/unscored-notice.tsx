import { MicOff01Icon } from '@hugeicons-pro/core-stroke-rounded';
import { HugeiconsIcon } from '@hugeicons/react-native';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ui';
import { radius, spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const ICON_TILE_SIZE = 56;

export type UnscoredNoticeProps = {
  title: string;
  detail: string;
};

/**
 * Stands in for the score gauge when a session has no score: nothing was heard,
 * or it fell below the scoring floor.
 *
 * Deliberately not a zero. A confident `0 /100` reads as "you were terrible"
 * when the truth is "we couldn't measure this", and the second sentence is what
 * keeps the user from thinking their practice time was thrown away.
 */
export function UnscoredNotice({ title, detail }: UnscoredNoticeProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <View style={[styles.iconTile, { backgroundColor: colors.fill }]}>
        <HugeiconsIcon icon={MicOff01Icon} size={26} color={colors.secondary} strokeWidth={1.5} />
      </View>
      <ThemedText variant="title" style={styles.centered}>
        {title}
      </ThemedText>
      <ThemedText variant="subheadProse" tone="tertiary" style={styles.detail}>
        {detail}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xxl,
  },
  iconTile: {
    width: ICON_TILE_SIZE,
    height: ICON_TILE_SIZE,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  centered: {
    textAlign: 'center',
  },
  detail: {
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});

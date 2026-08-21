import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react-native';
import { StyleSheet, View } from 'react-native';

import { GlassSurface, ThemedText } from '@/components/ui';
import { radius, spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Widest the subtitle may run before wrapping. Narrower than the card so the
 * copy breaks into short, centered lines instead of edge-to-edge ones. */
const SUBTITLE_MAX_WIDTH = 260;

export type EmptyStateCardProps = {
  icon: IconSvgElement;
  title: string;
  subtitle: string;
};

/** Frosted placeholder shown where a data section has nothing to display yet —
 * states plainly that there's no data rather than faking any. */
export function EmptyStateCard({ icon, title, subtitle }: EmptyStateCardProps) {
  const { colors } = useTheme();

  return (
    <GlassSurface radius="lg" style={styles.card}>
      <View style={[styles.iconWrap, { backgroundColor: colors.fill }]}>
        <HugeiconsIcon icon={icon} size={24} color={colors.secondary} strokeWidth={1.5} />
      </View>
      <ThemedText variant="headline" style={styles.centered}>
        {title}
      </ThemedText>
      <ThemedText variant="footnoteProse" tone="secondary" style={styles.subtitle}>
        {subtitle}
      </ThemedText>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  centered: {
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
    maxWidth: SUBTITLE_MAX_WIDTH,
  },
});

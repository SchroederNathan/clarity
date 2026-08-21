import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/ui';
import { spacing } from '@/constants/theme';

/**
 * A section's title and optional one-line description. Every scrolling screen
 * (Home, Practice, Analytics) uses this, so section headings can't drift apart
 * in size, weight, or the gap to the card beneath them.
 */
export function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <>
      <ThemedText variant="title" style={styles.title}>
        {title}
      </ThemedText>
      {subtitle != null && (
        <ThemedText variant="subhead" weight="regular" tone="secondary" style={styles.subtitle}>
          {subtitle}
        </ThemedText>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  title: {
    marginTop: spacing.xxxl,
  },
  subtitle: {
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
});

import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react-native';
import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ScoreValue } from '@/components/metrics';
import { GlassSurface, ThemedText } from '@/components/ui';
import { fonts, radius, spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const ICON_TILE_SIZE = 40;

/**
 * All-time bests. Every row here has a weekly counterpart in the counters
 * above, so a user can see "this week" and "ever" side by side without the two
 * using different names or units for the same thing.
 */
export type RecordRow = {
  icon: IconSvgElement;
  title: string;
  caption: string;
  /** Rendered as `NN /100` when true, otherwise as the raw value plus `unit`. */
  isScore?: boolean;
  value: number;
  unit?: string;
};

export function RecordsCard({ rows }: { rows: readonly RecordRow[] }) {
  const { colors } = useTheme();

  return (
    <GlassSurface radius="xl" style={styles.card}>
      {rows.map((row, i) => (
        <Fragment key={row.title}>
          {i > 0 && <View style={[styles.divider, { backgroundColor: colors.divider }]} />}
          <View style={styles.row}>
            <View style={[styles.iconTile, { backgroundColor: colors.fill }]}>
              <HugeiconsIcon icon={row.icon} size={20} color={colors.foreground} strokeWidth={1.7} />
            </View>
            <View style={styles.text}>
              <ThemedText variant="callout" weight="semibold" numberOfLines={1}>
                {row.title}
              </ThemedText>
              <ThemedText
                variant="footnote"
                weight="regular"
                tone="tertiary"
                numberOfLines={1}>
                {row.caption}
              </ThemedText>
            </View>
            <View style={styles.trailing}>
              {row.isScore ? (
                <ScoreValue value={row.value} size={19} maxSize={13} />
              ) : (
                <>
                  <Text style={[styles.value, { color: colors.foreground }]}>{row.value}</Text>
                  <ThemedText variant="footnote" weight="semibold" tone="tertiary">
                    {row.unit}
                  </ThemedText>
                </>
              )}
            </View>
          </View>
        </Fragment>
      ))}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  iconTile: {
    width: ICON_TILE_SIZE,
    height: ICON_TILE_SIZE,
    borderRadius: radius.full,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  trailing: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  /** Sized to match `ScoreValue` at 19 so a score row and a count row put their
   * numbers on the same baseline. */
  value: {
    fontSize: 19,
    fontFamily: fonts.heavy,
  },
  divider: {
    height: 1,
  },
});

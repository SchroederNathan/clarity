import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ResultWord } from '@/types/session';

export type WordBreakdownProps = {
  words: ResultWord[];
};

/** Per-word verdicts over the whole passage: good = foreground,
 * mispronounced = orange, omitted = red strikethrough, inserted = blue. */
export function WordBreakdown({ words }: WordBreakdownProps) {
  const { colors } = useTheme();

  const colorFor = (status: ResultWord['status']) => {
    switch (status) {
      case 'good':
        return colors.foreground;
      case 'mispronounced':
        return colors.warn;
      case 'omitted':
        return colors.danger;
      case 'inserted':
        return colors.accent;
    }
  };

  return (
    <View>
      <ThemedText variant="title3" weight="bold" style={styles.header}>
        Word Breakdown
      </ThemedText>
      <ThemedText variant="body" weight="medium" style={styles.passage}>
        {words.map((w, i) => (
          <Fragment key={i}>
            <Text
              style={{
                color: colorFor(w.status),
                textDecorationLine: w.status === 'omitted' ? 'line-through' : 'none',
              }}>
              {w.word}
            </Text>
            {i < words.length - 1 ? ' ' : null}
          </Fragment>
        ))}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: spacing.md,
  },
  passage: {
    // Looser than `bodyProse`: per-word colors and strikethroughs need the
    // extra leading to stay legible as a block.
    lineHeight: 26,
  },
});

import { Fragment, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { WordDetail } from '@/components/session/word-detail';
import { ThemedText } from '@/components/ui';
import { radius, spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ResultWord, WordVerdict } from '@/types/session';

const LEGEND_DOT = 8;

export type WordBreakdownProps = {
  words: ResultWord[];
  /**
   * Which judge produced these verdicts. It changes what the card can honestly
   * claim, so it is required rather than defaulted.
   */
  source: 'azure' | 'live';
  /** The session recording, for playing back a single word. */
  audioUri: string | null;
};

/**
 * A word is worth tapping when there is something behind it: a problem to
 * explain, or the phoneme tier to show. A clean word with no detail opens an
 * empty panel, so it stays inert.
 */
function hasDetail(word: ResultWord): boolean {
  if (word.status === 'omitted' || word.status === 'mispronounced') return true;
  return (word.phonemes?.length ?? 0) > 0 || (word.syllables?.length ?? 0) > 1;
}

/**
 * How much of the passage was read, and how much of that was clear.
 *
 * `completeness` has been measured, persisted and sent to the AI coach since the
 * beginning and shown to the user nowhere. It is not a sixth skill (the five are
 * fixed, see constants/metrics.ts), it is the plainest fact about a read, so it
 * belongs here as the word card's own summary rather than as another score.
 */
function coverage(words: readonly ResultWord[]): { read: number; total: number; clear: number } {
  let read = 0;
  let total = 0;
  let clear = 0;
  for (const word of words) {
    if (word.status === 'inserted') continue; // not part of the passage
    // Punctuation-only display tokens inherit a neighbour's verdict for
    // rendering; counting them would inflate the passage's word count.
    if (!/[\p{L}\p{N}]/u.test(word.word)) continue;
    total += 1;
    if (word.status === 'omitted') continue;
    read += 1;
    if (word.status === 'good') clear += 1;
  }
  return { read, total, clear };
}

const LEGEND: { status: WordVerdict; label: string }[] = [
  { status: 'good', label: 'Clear' },
  { status: 'mispronounced', label: 'Unclear' },
  { status: 'omitted', label: 'Skipped' },
  { status: 'inserted', label: 'Added' },
];

/**
 * Per-word verdicts over the whole passage.
 *
 * Three things were wrong with the colors-only version. It never said what the
 * colors meant, so orange and red were left to be guessed at. It never said
 * WHICH judge produced them, so a live-fallback session looked like a
 * pronunciation assessment when it was really "did the recognizer hear this
 * word". And the per-word score, which the pipeline has always carried, was
 * never shown anywhere, along with the entire phoneme tier behind it.
 */
export function WordBreakdown({ words, source, audioUri }: WordBreakdownProps) {
  const { colors } = useTheme();
  const [selected, setSelected] = useState<number | null>(null);

  const colorFor = (status: WordVerdict) => {
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

  const tappable = useMemo(() => words.map(hasDetail), [words]);
  const anyTappable = useMemo(() => tappable.some(Boolean), [tappable]);
  const selectedWord = selected != null ? words[selected] : null;
  const { read, total, clear } = useMemo(() => coverage(words), [words]);

  // The live fallback has no pronunciation signal at all: its only verdicts are
  // "the recognizer matched this" and "it did not". Presenting that as an
  // articulation judgement is the single most misleading thing this card can do.
  const caption =
    source === 'live'
      ? 'Pronunciation scoring was unavailable, so this shows which words were recognized, not how clearly they were said.'
      : anyTappable
        ? 'Tap a highlighted word to hear it and see which sound to work on.'
        : 'Every word came through clearly.';

  return (
    <View>
      <ThemedText variant="title3" weight="bold">
        Word Breakdown
      </ThemedText>
      {total > 0 ? (
        <ThemedText variant="footnote" tone="secondary" style={styles.coverage}>
          {read === total ? `All ${total} words read` : `${read} of ${total} words read`}
          {source === 'azure' ? ` · ${clear} clear` : null}
        </ThemedText>
      ) : null}
      <ThemedText variant="footnoteProse" tone="tertiary" style={styles.caption}>
        {caption}
      </ThemedText>

      <View style={styles.legend}>
        {LEGEND.map(({ status, label }) => (
          <View key={status} style={styles.legendItem}>
            <View
              style={[
                styles.legendDot,
                {
                  backgroundColor: colorFor(status),
                  // A struck-through word is a color the eye reads as "gone";
                  // hollowing the dot matches that without inventing a token.
                  opacity: status === 'omitted' ? 0.5 : 1,
                },
              ]}
            />
            <ThemedText variant="caption" tone="tertiary">
              {label}
            </ThemedText>
          </View>
        ))}
      </View>

      <ThemedText variant="body" weight="medium" style={styles.passage}>
        {words.map((w, i) => {
          const isTappable = tappable[i];
          const isSelected = selected === i;
          return (
            <Fragment key={i}>
              <Text
                onPress={
                  isTappable
                    ? () => {
                        Haptics.selectionAsync();
                        setSelected((current) => (current === i ? null : i));
                      }
                    : undefined
                }
                suppressHighlighting={!isTappable}
                accessibilityRole={isTappable ? 'button' : undefined}
                accessibilityLabel={
                  isTappable ? `${w.word}, ${w.status}. Show detail.` : undefined
                }
                style={{
                  color: colorFor(w.status),
                  textDecorationLine:
                    w.status === 'omitted'
                      ? 'line-through'
                      : isTappable
                        ? 'underline'
                        : 'none',
                  // A dotted underline marks "there is more here" without
                  // competing with the verdict colors for attention.
                  textDecorationStyle: w.status === 'omitted' ? 'solid' : 'dotted',
                  backgroundColor: isSelected ? colors.fillStrong : 'transparent',
                }}>
                {w.word}
              </Text>
              {i < words.length - 1 ? ' ' : null}
            </Fragment>
          );
        })}
      </ThemedText>

      {selectedWord ? <WordDetail word={selectedWord} audioUri={audioUri} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  coverage: {
    marginTop: spacing.xs,
  },
  caption: {
    marginTop: spacing.xxs,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendDot: {
    width: LEGEND_DOT,
    height: LEGEND_DOT,
    borderRadius: radius.full,
  },
  passage: {
    // Looser than `bodyProse`: per-word colors, strikethroughs and underlines
    // need the extra leading to stay legible as a block.
    lineHeight: 26,
  },
});

import { Mic01Icon, VolumeHighIcon } from '@hugeicons-pro/core-stroke-rounded';
import { HugeiconsIcon } from '@hugeicons/react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/ui';
import { radius, spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { playOwnAttempt, speakWord } from '@/services/word-pronunciation';
import { PHONEME_WEAK_MAX, weakestPhoneme, type ResultWord } from '@/types/session';

const ACTION_HEIGHT = 40;
const ACTION_ICON = 17;

export type WordDetailProps = {
  word: ResultWord;
  /** The session's concatenated recording, for playing the user's own attempt. */
  audioUri: string | null;
};

/** IPA reads as a symbol, not a letter, when it sits between slashes. */
function ipa(symbol: string): string {
  return `/${symbol}/`;
}

/**
 * What to do about one word, in one sentence.
 *
 * The score alone was never actionable: "measure, 42" tells a user they were
 * wrong and nothing else. Azure's phoneme tier says which sound was wrong and
 * what it sounded like instead, so that is what leads here. The score follows as
 * supporting detail, and only when there is no specific sound to name does the
 * copy fall back to talking about the word as a whole.
 */
function guidance(word: ResultWord, canCompare: boolean): string {
  if (word.status === 'omitted') {
    return 'You skipped this word. Hear it, then read the line again.';
  }
  if (word.status === 'inserted') {
    return 'An extra word, not in the passage.';
  }

  // Only invite a comparison when there are actually two clips to compare. The
  // user's own attempt needs both a session recording and per-word offsets, and
  // neither is guaranteed.
  const next = canCompare
    ? 'Compare the two clips, then say the word slowly.'
    : 'Say the word slowly and hold that sound.';

  const weak = weakestPhoneme(word);
  if (weak) {
    const heard = weak.heard?.[0]?.phoneme;
    return heard != null
      ? `The ${ipa(weak.phoneme)} sound came out closer to ${ipa(heard)}. ${next}`
      : `The ${ipa(weak.phoneme)} sound is the weak part. ${next}`;
  }
  if (word.status === 'mispronounced') {
    return canCompare
      ? 'Close, but not clear. Compare the two clips and slow the word down.'
      : 'Close, but not clear. Slow the word down and finish every sound.';
  }
  return 'Clearly said.';
}

/** One tappable action with its own async state, so a slow fetch cannot leave
 * the other button spinning. */
function Action({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: typeof VolumeHighIcon;
  onPress: () => Promise<void>;
}) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const handlePress = useCallback(() => {
    if (busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBusy(true);
    setFailed(false);
    onPress()
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  }, [busy, onPress]);

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy }}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: colors.fill, opacity: pressed ? 0.6 : 1 },
      ]}>
      {busy ? (
        <ActivityIndicator size="small" color={colors.secondary} />
      ) : (
        <HugeiconsIcon
          icon={icon}
          size={ACTION_ICON}
          color={failed ? colors.tertiary : colors.foreground}
          strokeWidth={1.5}
        />
      )}
      <ThemedText variant="footnote" tone={failed ? 'tertiary' : 'primary'}>
        {failed ? 'Unavailable' : label}
      </ThemedText>
    </Pressable>
  );
}

/**
 * The syllable ramp. Each syllable is printed with its own score so the user can
 * see WHERE in the word the trouble is, which a single word score cannot show.
 * Weak syllables are the only ones tinted; tinting all of them would make a good
 * word look alarming.
 */
function Syllables({ word }: { word: ResultWord }) {
  const { colors } = useTheme();
  const syllables = word.syllables ?? [];
  if (syllables.length < 2) return null;

  return (
    <View style={styles.syllables}>
      {syllables.map((syllable, i) => {
        const weak = syllable.score != null && syllable.score < PHONEME_WEAK_MAX;
        return (
          <View
            key={`${syllable.syllable}-${i}`}
            style={[
              styles.syllable,
              { backgroundColor: weak ? colors.focusBg : colors.fillStrong },
            ]}>
            <ThemedText variant="footnote" weight="semibold" tone={weak ? 'primary' : 'secondary'}>
              {syllable.grapheme ?? syllable.syllable}
            </ThemedText>
            {syllable.score != null ? (
              <ThemedText variant="caption" tone="tertiary">
                {Math.round(syllable.score)}
              </ThemedText>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** Expanded detail for one tapped word in the breakdown. */
export function WordDetail({ word, audioUri }: WordDetailProps) {
  const { colors } = useTheme();
  const spoken = word.word.replace(/[^\p{L}\p{N}'-]/gu, '');
  const canHearOwn =
    audioUri != null && word.audioStartMs != null && word.audioEndMs != null;

  const hearTarget = useCallback(() => speakWord(spoken), [spoken]);
  const hearOwn = useCallback(
    () => playOwnAttempt(audioUri!, word.audioStartMs!, word.audioEndMs!),
    [audioUri, word.audioStartMs, word.audioEndMs],
  );

  return (
    <View style={[styles.card, { backgroundColor: colors.fill }]}>
      <View style={styles.header}>
        <ThemedText variant="title3" weight="bold">
          {spoken}
        </ThemedText>
        {word.score != null ? (
          <ThemedText variant="footnote" tone="secondary">
            {Math.round(word.score)}
            <ThemedText variant="caption" tone="tertiary">
              {' /100'}
            </ThemedText>
          </ThemedText>
        ) : null}
      </View>

      <Syllables word={word} />

      <ThemedText variant="footnoteProse" tone="secondary">
        {guidance(word, canHearOwn)}
      </ThemedText>

      {word.prosody?.monotone ? (
        <ThemedText variant="footnoteProse" tone="tertiary">
          Delivered flat. Let the pitch move on this word.
        </ThemedText>
      ) : null}
      {word.prosody?.unexpectedBreak ? (
        <ThemedText variant="footnoteProse" tone="tertiary">
          You broke here, but the sentence runs on.
        </ThemedText>
      ) : null}
      {word.prosody?.missingBreak ? (
        <ThemedText variant="footnoteProse" tone="tertiary">
          The punctuation here wants a short rest.
        </ThemedText>
      ) : null}

      {word.status !== 'inserted' ? (
        <View style={styles.actions}>
          <Action label="Hear it" icon={VolumeHighIcon} onPress={hearTarget} />
          {canHearOwn ? (
            <Action label="Hear yours" icon={Mic01Icon} onPress={hearOwn} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  syllables: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  syllable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.xs,
    borderCurve: 'continuous',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: ACTION_HEIGHT,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
  },
});

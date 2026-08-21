import { Book02Icon } from '@hugeicons-pro/core-solid-rounded';
import { HugeiconsIcon } from '@hugeicons/react-native';
import * as Haptics from 'expo-haptics';
import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { SegmentedControl } from '@/components/segmented-control';
import { PrimaryButton, ThemedText } from '@/components/ui';
import { radius, spacing, type } from '@/constants/theme';
import { useMarkInteractive } from '@/hooks/use-mark-interactive';
import { useTheme } from '@/hooks/use-theme';
import { tokenizePassage } from '@/lib/passage-text';
import { addPassage } from '@/services/user-passages';

const MIN_WORDS = 20;

const PACE_OPTIONS = [
  { label: 'Slow', wpm: 120 },
  { label: 'Natural', wpm: 150 },
  { label: 'Brisk', wpm: 175 },
] as const;

/** Fixed-size box the native toolbar needs around its one child. */
const TOOLBAR_TITLE_WIDTH = 200;
const TOOLBAR_TITLE_HEIGHT = 36;

/** Flat card surface — glass is reserved for the save CTA, matching how the
 * rest of the app keeps solid cards for content and glass for chrome. */
function EditorCard({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();

  return <View style={[styles.card, { backgroundColor: colors.card }]}>{children}</View>;
}

/** Modal for adding a user passage: title, pasted text, target pace. The
 * screen title and close button live in the native stack toolbar. */
export default function PassageEditorScreen() {
  useMarkInteractive();

  const { colors } = useTheme();

  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [paceIndex, setPaceIndex] = useState(1);
  const [saveError, setSaveError] = useState<string | null>(null);

  const wordCount = useMemo(() => tokenizePassage(text).words.length, [text]);
  const targetWpm = PACE_OPTIONS[paceIndex].wpm;
  const minutes = wordCount > 0 ? Math.max(1, Math.round(wordCount / targetWpm)) : 0;
  const canSave = title.trim().length > 0 && wordCount >= MIN_WORDS;

  const handleClose = () => {
    Haptics.selectionAsync();
    router.back();
  };

  /**
   * `addPassage` returns null when the write could not be verified, and in that
   * case the passage is in neither the store nor the in-memory list. Dismissing
   * anyway would drop the user back into a library without the passage they just
   * typed, with no indication anything went wrong — so stay put and say so.
   */
  const handleSave = () => {
    if (!canSave) return;
    const saved = addPassage({ title, text, targetWpm });
    if (!saved) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setSaveError("Couldn't save this passage. Your device may be out of storage.");
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  const preview =
    wordCount === 0
      ? `At least ${MIN_WORDS} words to save`
      : wordCount < MIN_WORDS
        ? `${wordCount} of ${MIN_WORDS} words needed`
        : `${wordCount} words · ~${minutes} min${minutes > 1 ? 's' : ''} at ${targetWpm} wpm`;

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <EditorCard>
          <ThemedText variant="footnote" tone="secondary" style={styles.caption}>
            Title
          </ThemedText>
          <TextInput
            value={title}
            onChangeText={(v) => {
              setTitle(v);
              setSaveError(null);
            }}
            placeholder="My speech"
            placeholderTextColor={colors.secondary}
            maxLength={48}
            style={[styles.titleInput, { color: colors.foreground }]}
          />
        </EditorCard>

        <EditorCard>
          <ThemedText variant="footnote" tone="secondary" style={styles.caption}>
            Your words
          </ThemedText>
          <TextInput
            value={text}
            onChangeText={(v) => {
              setText(v);
              setSaveError(null);
            }}
            placeholder="Paste any text, speech, or transcript…"
            placeholderTextColor={colors.secondary}
            multiline
            textAlignVertical="top"
            style={[styles.textInput, { color: colors.foreground }]}
          />
          <View style={[styles.divider, { backgroundColor: colors.divider }]} />
          <ThemedText
            variant="footnote"
            style={[styles.meta, { color: saveError ? colors.danger : colors.secondary }]}>
            {saveError ?? preview}
          </ThemedText>
        </EditorCard>

        <EditorCard>
          <ThemedText variant="footnote" tone="secondary" style={styles.caption}>
            Reading pace
          </ThemedText>
          {/* Matches the caption→input visual gap: the text inputs add ~4pt
              of their own leading below the caption's 6pt margin. */}
          <SegmentedControl
            segments={PACE_OPTIONS.map((o) => o.label)}
            selectedIndex={paceIndex}
            onChange={(index) => {
              Haptics.selectionAsync();
              setPaceIndex(index);
            }}
            style={styles.paceControl}
          />
        </EditorCard>

        <PrimaryButton
          title="Save to Library"
          icon={Book02Icon}
          onPress={handleSave}
          disabled={!canSave}
          style={styles.save}
        />
      </ScrollView>

      {/* Custom title on the LEFT of the header bar (iOS centers regular
          titles), vertically centered via the fixed-size toolbar view.
          hidesSharedBackground drops the iOS 26 glass capsule behind it. */}
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.View hidesSharedBackground>
          <View style={styles.headerTitleBox}>
            <ThemedText variant="title3" weight="semibold">
              New Passage
            </ThemedText>
          </View>
        </Stack.Toolbar.View>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="xmark" onPress={handleClose} />
      </Stack.Toolbar>
    </>
  );
}

const styles = StyleSheet.create({
  // Toolbar views need one child with explicit width/height; centering
  // vertically inside it keeps the text on the bar's middle line.
  headerTitleBox: {
    width: TOOLBAR_TITLE_WIDTH,
    height: TOOLBAR_TITLE_HEIGHT,
    justifyContent: 'center',
  },
  content: {
    padding: spacing.xl,
    paddingBottom: spacing.xxxxl,
    gap: spacing.lg,
  },
  card: {
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
  },
  caption: {
    marginBottom: spacing.sm,
  },
  paceControl: {
    marginTop: spacing.xs,
  },
  // The inputs mirror the ramp steps their content reads as — a passage title is
  // a `title3`, its body is `bodyProse` — with the vertical padding trimmed so
  // the caret sits tight under the caption.
  titleInput: {
    ...type.title3,
    paddingVertical: spacing.xxs,
  },
  textInput: {
    ...type.bodyProse,
    minHeight: 150,
    maxHeight: 260,
    paddingTop: spacing.xxs,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  meta: {
    fontVariant: ['tabular-nums'],
  },
  save: {
    marginTop: spacing.sm,
  },
});

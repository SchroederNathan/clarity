import { CheckmarkCircle02Icon } from '@hugeicons-pro/core-solid-rounded';
import { HugeiconsIcon } from '@hugeicons/react-native';
import * as Haptics from 'expo-haptics';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/ui';
import { ACCENTS, hasPhonemeDetail, type Accent } from '@/constants/accents';
import { radius, spacing } from '@/constants/theme';
import { useMarkInteractive } from '@/hooks/use-mark-interactive';
import { useSetting } from '@/hooks/use-settings';
import { useTheme } from '@/hooks/use-theme';
import type { AccentLocale } from '@/types/settings';

/** Fixed-size box the native toolbar needs around its one child. */
const TOOLBAR_TITLE_WIDTH = 200;
const TOOLBAR_TITLE_HEIGHT = 36;

const CHECK_SIZE = 22;

/** Minimum row height, so a one-line row still reads as a tappable list row and
 * a two-line one grows past it. Not a spacing step: it is a control size, like
 * the icon tiles elsewhere. */
const ROW_MIN_HEIGHT = 56;

/** Grouped rows on one card, matching the flat-card convention the passage
 * editor uses: glass is chrome, solid cards are content. */
function SettingsCard({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return <View style={[styles.card, { backgroundColor: colors.card }]}>{children}</View>;
}

/** A hairline between rows inside a card, inset past the row's padding. */
function RowDivider() {
  const { colors } = useTheme();
  return <View style={[styles.divider, { backgroundColor: colors.divider }]} />;
}

function AccentRow({
  accent,
  selected,
  onSelect,
}: {
  accent: Accent;
  selected: boolean;
  onSelect: (locale: AccentLocale) => void;
}) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={() => onSelect(accent.locale)}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${accent.label}, ${accent.region}`}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}>
      <View style={styles.rowText}>
        <ThemedText variant="headline" weight={selected ? 'semibold' : 'regular'}>
          {accent.label}
        </ThemedText>
        <ThemedText variant="footnote" tone="tertiary">
          {accent.region}
        </ThemedText>
      </View>
      {selected ? (
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={CHECK_SIZE} color={colors.accent} />
      ) : null}
    </Pressable>
  );
}

/**
 * Settings: the accent pronunciation is graded against, and the data preference.
 *
 * The accent is the consequential one. Azure scores a reading against a
 * reference accent, and the wrong reference is counted as mispronunciation: the
 * same British reading measured 80 accuracy against `en-US` and 100 against
 * `en-GB`. Until this screen existed every user was graded as American.
 */
export default function SettingsScreen() {
  useMarkInteractive();

  const { colors } = useTheme();
  const [accentLocale, setAccentLocale] = useSetting('accentLocale');
  const [improveClarity, setImproveClarity] = useSetting('improveClarity');
  const [writeFailed, setWriteFailed] = useState(false);

  const handleClose = () => {
    Haptics.selectionAsync();
    router.back();
  };

  const chooseAccent = (locale: AccentLocale) => {
    if (locale === accentLocale) return;
    Haptics.selectionAsync();
    setWriteFailed(!setAccentLocale(locale));
  };

  const toggleImprove = (value: boolean) => {
    Haptics.selectionAsync();
    setWriteFailed(!setImproveClarity(value));
  };

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <ThemedText variant="eyebrow" tone="tertiary" style={styles.eyebrow}>
          YOUR ACCENT
        </ThemedText>
        <ThemedText variant="footnoteProse" tone="secondary" style={styles.sectionBlurb}>
          Your reading is scored against this accent. Picking the one you actually
          speak stops your own vowels being counted as mistakes.
        </ThemedText>

        <SettingsCard>
          {ACCENTS.map((accent, index) => (
            <View key={accent.locale}>
              {index > 0 ? <RowDivider /> : null}
              <AccentRow
                accent={accent}
                selected={accent.locale === accentLocale}
                onSelect={chooseAccent}
              />
            </View>
          ))}
        </SettingsCard>

        {/* Measured, not assumed: only en-US returns phoneme symbols. Saying so
            is the difference between a user making an informed trade and one
            wondering why the per-sound tips stopped appearing. */}
        {!hasPhonemeDetail(accentLocale) ? (
          <ThemedText variant="footnoteProse" tone="tertiary" style={styles.note}>
            Per-sound feedback, the tips that name a sound like /θ/, is available
            for American English only. You still get word and syllable scores.
          </ThemedText>
        ) : null}

        <ThemedText variant="eyebrow" tone="tertiary" style={styles.eyebrow}>
          PRIVACY
        </ThemedText>

        <SettingsCard>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <ThemedText variant="headline" weight="regular">
                Use my data to improve Clarity
              </ThemedText>
            </View>
            {/* The platform switch, unwrapped. It already carries the design
                language, and routing it through a themed shell would only make
                it look less native. */}
            <Switch value={improveClarity} onValueChange={toggleImprove} />
          </View>
        </SettingsCard>

        {writeFailed ? (
          <ThemedText variant="footnoteProse" tone="tertiary" style={styles.note}>
            That preference could not be saved. Your device may be out of storage.
          </ThemedText>
        ) : null}
      </ScrollView>

      <Stack.Toolbar placement="left">
        <Stack.Toolbar.View hidesSharedBackground>
          <View style={styles.headerTitleBox}>
            <ThemedText variant="title3" weight="semibold">
              Settings
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
  },
  eyebrow: {
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  sectionBlurb: {
    marginBottom: spacing.md,
  },
  card: {
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: ROW_MIN_HEIGHT,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing.lg,
  },
  note: {
    marginTop: spacing.md,
  },
});

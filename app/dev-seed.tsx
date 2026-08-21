import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { EXPORT_KIND, EXPORT_VERSION, type HistoryExport } from '@/lib/history-schema';
import { generateHistory, generateWordStats } from '@/services/history-dev';
import { importHistory, type ImportSummary } from '@/services/session-history';

/**
 * Deterministic demo-data seed, reachable at `<scheme>://dev-seed`.
 *
 * Exists for automated QA: simulators have no speech recognizer, so a real
 * practice session can never run on one, and every history-driven surface
 * (analytics, streaks, words to master) stays empty. An agent driving a
 * simulator build deep-links here once and gets 45 days of believable
 * history. Idempotent — the generated ids are a pure function of the seed,
 * so re-visiting merges zero duplicates.
 *
 * Compiled to a refusal unless the build sets EXPO_PUBLIC_SEED_HOOKS=1,
 * which only the `simulator` build profile does.
 */
const SEED_ENABLED = process.env.EXPO_PUBLIC_SEED_HOOKS === '1';

export default function DevSeedScreen() {
  const { colors } = useTheme();
  const ran = useRef(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  useEffect(() => {
    if (!SEED_ENABLED || ran.current) return;
    ran.current = true;
    const envelope: HistoryExport = {
      kind: EXPORT_KIND,
      version: EXPORT_VERSION,
      exportedAt: Date.now(),
      records: generateHistory({ days: 45, seed: 1 }),
      words: generateWordStats({ seed: 1 }),
    };
    setSummary(importHistory(JSON.stringify(envelope), 'merge'));
  }, []);

  const message = !SEED_ENABLED
    ? 'Not available in this build.'
    : summary == null
      ? 'Seeding…'
      : summary.ok
        ? `Seeded ✓ — ${summary.imported} sessions imported, ${summary.duplicates} already present`
        : `Seed failed: ${summary.reason ?? 'unknown'}`;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ThemedText variant="title3" weight="semibold" testID="dev-seed-result">
        {message}
      </ThemedText>
      {SEED_ENABLED && summary?.ok ? (
        <ThemedText variant="footnote" tone="secondary">
          History and word stats are live. Go back to the Home tab.
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
});

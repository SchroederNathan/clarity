import { Cancel01Icon, Tick02Icon } from '@hugeicons-pro/core-stroke-rounded';
import { CheckmarkCircle02Icon, Crown02Icon } from '@hugeicons-pro/core-solid-rounded';
import { HugeiconsIcon } from '@hugeicons/react-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PACKAGE_TYPE, type PurchasesPackage } from 'react-native-purchases';

import { GlassSurface, PrimaryButton, ThemedText } from '@/components/ui';
import { radius, spacing } from '@/constants/theme';
import { useMarkInteractive } from '@/hooks/use-mark-interactive';
import { useSubscription } from '@/hooks/use-subscription';
import { useTheme } from '@/hooks/use-theme';
import { fetchCurrentOffering, purchasePackage } from '@/services/purchases';

/** The Pro crown. Not a palette token: it is an illustrative glyph color, fixed
 * in both schemes, matching the header crown in `header-actions.tsx`. */
const PRO_GOLD = '#FFB000';

/** Apple's standard EULA, which covers auto-renewing subscriptions. */
const TERMS_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
const PRIVACY_URL = 'https://exponathan-clarity.expo.app/privacy';

const FEATURES = [
  'Unlimited practice sessions',
  'Personal AI speech coaching',
  'Full speaking analytics and history',
  'Early access to new features',
];

/** Display order and the per-card caption wording, keyed by package type. */
const PLAN_LABELS: Partial<Record<PACKAGE_TYPE, { title: string; caption: string }>> = {
  [PACKAGE_TYPE.ANNUAL]: { title: 'Annual', caption: 'per year' },
  [PACKAGE_TYPE.MONTHLY]: { title: 'Monthly', caption: 'per month' },
  [PACKAGE_TYPE.WEEKLY]: { title: 'Weekly', caption: 'per week' },
};

/** Annual first because it is the default selection and carries the badge. */
function sortPlans(packages: PurchasesPackage[]): PurchasesPackage[] {
  const order = [PACKAGE_TYPE.ANNUAL, PACKAGE_TYPE.MONTHLY, PACKAGE_TYPE.WEEKLY];
  return packages
    .filter((pkg) => order.includes(pkg.packageType))
    .sort((a, b) => order.indexOf(a.packageType) - order.indexOf(b.packageType));
}

/**
 * "Save 44%": the annual price against a year of the monthly plan. Derived from
 * the store's own numbers so it can never disagree with the prices shown; null
 * when either plan is missing or the math yields nothing worth bragging about.
 */
function annualSavings(plans: PurchasesPackage[]): number | null {
  const annual = plans.find((pkg) => pkg.packageType === PACKAGE_TYPE.ANNUAL);
  const monthly = plans.find((pkg) => pkg.packageType === PACKAGE_TYPE.MONTHLY);
  const yearAtMonthlyRate = monthly?.product.pricePerYear ?? null;
  if (!annual || !yearAtMonthlyRate) return null;

  const saved = Math.round((1 - annual.product.price / yearAtMonthlyRate) * 100);
  return saved >= 5 ? saved : null;
}

/**
 * Shown when this build has no store: web, or a release build with no API key.
 * An honest dead end beats a paywall that renders empty, and it names the cause
 * so the next person is not guessing.
 */
function PurchasesUnavailable() {
  const { colors } = useTheme();

  return (
    <View style={styles.centered}>
      <View style={[styles.iconTile, { backgroundColor: colors.card }]}>
        <HugeiconsIcon icon={Crown02Icon} size={32} color={PRO_GOLD} />
      </View>
      <ThemedText variant="title" style={styles.centeredText}>
        Clarity Pro is unavailable
      </ThemedText>
      <ThemedText variant="subheadProse" tone="secondary" style={styles.centeredText}>
        This build has no store connected, so plans cannot load. Try the app on a device or
        simulator build.
      </ThemedText>
    </View>
  );
}

function PlanCard({
  plan,
  selected,
  savings,
  onSelect,
}: {
  plan: PurchasesPackage;
  selected: boolean;
  /** "Save 44%" badge value; only the annual card gets one. */
  savings: number | null;
  onSelect: () => void;
}) {
  const { colors } = useTheme();
  const labels = PLAN_LABELS[plan.packageType];
  if (!labels) return null;

  const isAnnual = plan.packageType === PACKAGE_TYPE.ANNUAL;
  const perMonth = isAnnual ? plan.product.pricePerMonthString : null;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={() => {
        Haptics.selectionAsync();
        onSelect();
      }}
      style={({ pressed }) => [styles.planCard, pressed && styles.planPressed]}>
      {/* Absolute sibling, not ancestor: the card's own content stays free to
          hold other native views without nesting glass. The selection border
          lives on the glass so it hugs the same continuous corners. */}
      <GlassSurface
        radius="lg"
        interactive
        style={[
          StyleSheet.absoluteFill,
          selected && { borderWidth: 2, borderColor: colors.accent },
        ]}
      />
      <View style={styles.planRow}>
        {selected ? (
          <HugeiconsIcon icon={CheckmarkCircle02Icon} size={26} color={colors.accent} />
        ) : (
          <View style={[styles.radio, { borderColor: colors.track }]} />
        )}
        <View style={styles.planTitle}>
          <ThemedText variant="title3">{labels.title}</ThemedText>
          {savings !== null && (
            <View style={[styles.saveBadge, { backgroundColor: colors.accentBg }]}>
              <ThemedText variant="caption" weight="semibold" tone="accent">
                Save {savings}%
              </ThemedText>
            </View>
          )}
        </View>
        <View style={styles.planPrice}>
          <ThemedText variant="title3" weight="bold">
            {plan.product.priceString}
          </ThemedText>
          <ThemedText variant="footnote" tone="secondary">
            {perMonth ? `${perMonth} / mo` : labels.caption}
          </ThemedText>
        </View>
      </View>
    </Pressable>
  );
}

/**
 * The Clarity Pro paywall, fully in-app.
 *
 * Layout and copy live here; prices come from the store via the Current
 * offering's packages, so a price change in App Store Connect (or a plan-mix
 * change in the RevenueCat dashboard) still needs no release. Only wording and
 * layout changes do — that is the trade against the previous dashboard-hosted
 * paywall, accepted so the screen can speak the app's own design language.
 *
 * Presented as a modal from the root layout. For gating a locked feature in
 * place, prefer `usePaywall().requirePro` over navigating here.
 */
export default function PaywallScreen() {
  useMarkInteractive();

  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { available, refresh, restore } = useSubscription();

  const [plans, setPlans] = useState<PurchasesPackage[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A purchase can land while the customer is also tapping the close button;
  // one latch keeps that from popping two screens.
  const dismissed = useRef(false);
  const close = () => {
    if (dismissed.current) return;
    dismissed.current = true;
    router.back();
  };

  useEffect(() => {
    if (!available) return;
    let alive = true;
    setLoadFailed(false);
    fetchCurrentOffering()
      .then((offering) => {
        if (!alive) return;
        const sorted = sortPlans(offering?.availablePackages ?? []);
        setPlans(sorted);
        setSelectedId(sorted[0]?.identifier ?? null);
        setLoadFailed(sorted.length === 0);
      })
      .catch(() => {
        if (alive) setLoadFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [available]);

  const selected = plans?.find((plan) => plan.identifier === selectedId) ?? null;
  const savings = plans ? annualSavings(plans) : null;

  const buy = async () => {
    if (!selected || busy) return;
    setBusy(true);
    const result = await purchasePackage(selected);
    setBusy(false);

    switch (result.outcome) {
      case 'purchased':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        refresh();
        close();
        return;
      case 'pending':
        Alert.alert(
          'Payment pending',
          'Your payment is still processing. Clarity Pro unlocks as soon as it clears.',
        );
        return;
      case 'failed':
        Alert.alert('Purchase failed', result.message);
        return;
      case 'cancelled':
        // A normal outcome, not an error. The paywall stays open.
        return;
    }
  };

  const restorePurchase = async () => {
    if (busy) return;
    setBusy(true);
    const result = await restore();
    setBusy(false);

    if (result.outcome === 'restored') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      close();
      return;
    }
    if (result.outcome === 'nothingToRestore') {
      // A successful restore that found nothing. Saying so is the difference
      // between the customer retrying and the customer contacting support.
      Alert.alert(
        'Nothing to restore',
        'We could not find a Clarity Pro purchase on this store account. Make sure you are signed in with the account you bought it on.',
      );
      return;
    }
    Alert.alert('Restore failed', result.message);
  };

  if (!available) return <PurchasesUnavailable />;

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.xxl },
      ]}
      showsVerticalScrollIndicator={false}>
      {/* Pressable wraps the glass rather than the reverse: GlassView renders a
          native material, so the touch target has to sit above it. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={close}
        style={styles.close}>
        <GlassView isInteractive style={styles.closeCircle}>
          <HugeiconsIcon icon={Cancel01Icon} size={18} color={colors.secondary} strokeWidth={2} />
        </GlassView>
      </Pressable>
      <View style={styles.brandRow}>
        <HugeiconsIcon icon={Crown02Icon} size={28} color={PRO_GOLD} />
        <ThemedText variant="title">Clarity</ThemedText>
        {isLiquidGlassAvailable() ? (
          <GlassView glassEffectStyle="regular" tintColor={colors.inverseSurface} style={styles.proBadge}>
            <ThemedText variant="callout" tone="inverse">
              Pro
            </ThemedText>
          </GlassView>
        ) : (
          <View style={[styles.proBadge, { backgroundColor: colors.inverseSurface }]}>
            <ThemedText variant="callout" tone="inverse">
              Pro
            </ThemedText>
          </View>
        )}
      </View>

      <ThemedText variant="largeTitle" style={styles.headline}>
        Get the full power of Clarity
      </ThemedText>

      <View style={styles.features}>
        {FEATURES.map((feature) => (
          <View key={feature} style={styles.featureRow}>
            <HugeiconsIcon icon={Tick02Icon} size={20} color={colors.accent} strokeWidth={2} />
            <ThemedText variant="bodyProse" tone="secondary" style={styles.featureText}>
              {feature}
            </ThemedText>
          </View>
        ))}
      </View>

      <View style={styles.flexSpacer} />

      {plans === null && !loadFailed ? (
        <View style={styles.plansLoading}>
          <ActivityIndicator color={colors.secondary} />
        </View>
      ) : loadFailed ? (
        <View style={styles.plansLoading}>
          <ThemedText variant="subheadProse" tone="secondary" style={styles.centeredText}>
            Plans could not load. Check your connection and reopen this screen.
          </ThemedText>
        </View>
      ) : (
        <View style={styles.plans}>
          {plans?.map((plan) => (
            <PlanCard
              key={plan.identifier}
              plan={plan}
              selected={plan.identifier === selectedId}
              savings={plan.packageType === PACKAGE_TYPE.ANNUAL ? savings : null}
              onSelect={() => setSelectedId(plan.identifier)}
            />
          ))}
        </View>
      )}

      <PrimaryButton
        title="Continue with Clarity Pro"
        onPress={buy}
        disabled={busy || !selected}
        style={styles.cta}
      />

      <Pressable
        accessibilityRole="button"
        onPress={restorePurchase}
        disabled={busy}
        style={({ pressed }) => [styles.textButton, pressed && styles.planPressed]}>
        <ThemedText variant="subhead" tone="secondary">
          Restore purchase
        </ThemedText>
      </Pressable>

      <View style={styles.legalRow}>
        <Pressable onPress={() => Linking.openURL(TERMS_URL)} hitSlop={spacing.sm}>
          <ThemedText variant="caption" tone="tertiary">
            Terms of Use
          </ThemedText>
        </Pressable>
        <ThemedText variant="caption" tone="dimmed">
          |
        </ThemedText>
        <Pressable onPress={() => Linking.openURL(PRIVACY_URL)} hitSlop={spacing.sm}>
          <ThemedText variant="caption" tone="tertiary">
            Privacy Policy
          </ThemedText>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  close: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  closeCircle: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxxl,
    gap: spacing.md,
  },
  centeredText: {
    textAlign: 'center',
  },
  iconTile: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  proBadge: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headline: {
    textAlign: 'center',
    marginTop: spacing.xxxl,
    marginBottom: spacing.xxxl,
  },
  features: {
    gap: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  featureText: {
    flex: 1,
  },
  flexSpacer: {
    flexGrow: 1,
    minHeight: spacing.xxxl,
  },
  plans: {
    gap: spacing.lg,
  },
  plansLoading: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planCard: {
    minHeight: 72,
    justifyContent: 'center',
  },
  planPressed: {
    opacity: 0.85,
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    borderWidth: 2,
  },
  planTitle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  planPrice: {
    alignItems: 'flex-end',
    gap: spacing.xxs,
  },
  saveBadge: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  cta: {
    marginTop: spacing.xxl,
  },
  textButton: {
    alignSelf: 'center',
    padding: spacing.md,
    marginTop: spacing.xs,
  },
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
});

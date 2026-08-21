import { Crown02Icon } from '@hugeicons-pro/core-solid-rounded';
import { HugeiconsIcon } from '@hugeicons/react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useRef } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import RevenueCatUI from 'react-native-purchases-ui';

import { fonts } from '@/constants/theme';
import { useMarkInteractive } from '@/hooks/use-mark-interactive';
import { useSubscription } from '@/hooks/use-subscription';
import { useTheme } from '@/hooks/use-theme';
import { isPro } from '@/lib/entitlements';
import { describePurchasesError } from '@/services/purchases';

const PRO_GOLD = '#FFB000';

/**
 * Shown when this build has no store: web, or a release build with no API key.
 * An honest dead end beats a native paywall that renders empty, and it names the
 * cause so the next person is not guessing.
 */
function PurchasesUnavailable({ onClose }: { onClose: () => void }) {
  const { colors } = useTheme();

  return (
    <View style={[styles.unavailable, { backgroundColor: colors.background }]}>
      <View style={[styles.iconTile, { backgroundColor: colors.card }]}>
        <HugeiconsIcon icon={Crown02Icon} size={32} color={PRO_GOLD} />
      </View>
      <Text style={[styles.unavailableTitle, { color: colors.foreground }]}>
        Clarity Pro is unavailable
      </Text>
      <Text style={[styles.unavailableBody, { color: colors.secondary }]}>
        This build has no store connected, so plans cannot load. Try the app on a device or
        simulator build.
      </Text>
      <Pressable onPress={onClose} style={styles.unavailableButton}>
        <Text style={[styles.unavailableButtonLabel, { color: colors.foreground }]}>Close</Text>
      </Pressable>
    </View>
  );
}

/**
 * The Clarity Pro paywall, as a route.
 *
 * The layout, copy, and plan mix are all dashboard-owned: this renders whatever
 * the Current offering's paywall is configured to be, so pricing and packaging
 * change without an app release. The screen's only job is dismissal and reacting
 * to the outcome.
 *
 * Presented as a modal from the root layout. For gating a locked feature in
 * place, prefer `usePaywall().requirePro` over navigating here.
 */
export default function PaywallScreen() {
  useMarkInteractive();

  const { refresh, available } = useSubscription();
  // The paywall closes itself after a purchase and then calls onDismiss, but a
  // manual close also calls it. One latch keeps that from popping two screens.
  const dismissed = useRef(false);

  const close = () => {
    if (dismissed.current) return;
    dismissed.current = true;
    router.back();
  };

  if (!available) return <PurchasesUnavailable onClose={close} />;

  return (
    <RevenueCatUI.Paywall
      style={styles.paywall}
      options={{ displayCloseButton: true }}
      onPurchaseCompleted={() => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // The customer info listener also fires; this awaits nothing and only
        // makes the entitlement land as early as possible.
        refresh();
      }}
      onPurchaseError={({ error }) => {
        Alert.alert('Purchase failed', describePurchasesError(error));
      }}
      // Cancelling is a normal outcome, not an error. The paywall stays open.
      onPurchaseCancelled={() => {}}
      onRestoreCompleted={({ customerInfo }) => {
        refresh();
        if (isPro(customerInfo)) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          return;
        }
        // A successful restore that found nothing. Saying so is the difference
        // between the customer retrying and the customer contacting support.
        Alert.alert(
          'Nothing to restore',
          'We could not find a Clarity Pro purchase on this store account. Make sure you are signed in with the account you bought it on.',
        );
      }}
      onRestoreError={({ error }) => {
        Alert.alert('Restore failed', describePurchasesError(error));
      }}
      onDismiss={close}
    />
  );
}

const styles = StyleSheet.create({
  paywall: {
    flex: 1,
  },
  unavailable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  iconTile: {
    width: 64,
    height: 64,
    borderRadius: 20,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  unavailableTitle: {
    fontSize: 22,
    fontFamily: fonts.semibold,
    textAlign: 'center',
  },
  unavailableBody: {
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fonts.regular,
    textAlign: 'center',
  },
  unavailableButton: {
    marginTop: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  unavailableButtonLabel: {
    fontSize: 17,
    fontFamily: fonts.medium,
  },
});

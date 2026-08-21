import { router } from 'expo-router';
import { useRef } from 'react';
import { StyleSheet } from 'react-native';
import RevenueCatUI from 'react-native-purchases-ui';

import { useMarkInteractive } from '@/hooks/use-mark-interactive';
import { useSubscription } from '@/hooks/use-subscription';

/**
 * The RevenueCat Customer Center, embedded as a route.
 *
 * This is the self-serve subscription screen: see the active plan, change it,
 * cancel, request a refund (iOS only), or report a purchase that did not unlock.
 * Which of those appear, and the retention offers shown on the way out, are
 * configured under Project Settings > Customer Center in the dashboard, so the
 * flow can change without an app release.
 *
 * Shipping this is also the cheapest support win available: cancellations and
 * "I paid and nothing happened" are the two most common subscription tickets,
 * and both are self-serve here.
 *
 * Embedded rather than `presentCustomerCenter()` so it is a real navigation
 * destination with a back stack. The imperative version is on
 * `usePaywall().presentCustomerCenter`, for presenting it over what the customer
 * is already doing.
 */
export default function ManageSubscriptionScreen() {
  useMarkInteractive();

  const { refresh } = useSubscription();
  const dismissed = useRef(false);

  const close = () => {
    if (dismissed.current) return;
    dismissed.current = true;
    router.back();
  };

  return (
    <RevenueCatUI.CustomerCenterView
      style={styles.customerCenter}
      onRestoreCompleted={() => {
        refresh();
      }}
      onRefundRequestCompleted={() => {
        // A granted refund revokes the entitlement server-side, so the local
        // read has to come from RevenueCat again rather than the SDK cache.
        refresh();
      }}
      onPromotionalOfferSucceeded={() => {
        refresh();
      }}
      onShowingManageSubscriptions={() => {
        // The customer is heading to the store's own management page, where they
        // may cancel. Refresh so returning to the app shows the real state.
        refresh();
      }}
      onDismiss={close}
    />
  );
}

const styles = StyleSheet.create({
  customerCenter: {
    flex: 1,
  },
});

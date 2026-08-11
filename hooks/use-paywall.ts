/**
 * Imperative access to the RevenueCat-hosted paywall and Customer Center.
 *
 * These present native views the dashboard owns, so plan mix, copy, pricing, and
 * layout change without an app release. Two ways in, and they are not
 * interchangeable:
 *
 * - `requirePro(action)` for gating. Presents only when the entitlement is
 *   missing, and runs the action once it is unlocked. This is the one to reach
 *   for at a locked feature.
 * - `presentPaywall()` for an explicit upgrade tap, where the customer asked to
 *   see the plans even if they already have them.
 *
 * The declarative alternative, `<RevenueCatUI.Paywall>` inside a route, lives in
 * `app/paywall.tsx`. Use that when the paywall should be a real navigation
 * destination; use these when it should sit on top of what the customer is doing.
 */

import * as Haptics from 'expo-haptics';
import { useCallback } from 'react';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';
import type { PurchasesOffering } from 'react-native-purchases';

import { useSubscription } from '@/hooks/use-subscription';
import { PRO_ENTITLEMENT_ID } from '@/lib/entitlements';
import { describePurchasesError } from '@/services/purchases';

export type PaywallOutcome =
  | 'purchased'
  | 'restored'
  /** Dismissed without buying. */
  | 'cancelled'
  /** `presentPaywallIfNeeded` skipped it: the entitlement is already active. */
  | 'notPresented'
  | 'error';

/** Both of these mean the customer walked away entitled. */
function unlocked(outcome: PaywallOutcome): boolean {
  return outcome === 'purchased' || outcome === 'restored' || outcome === 'notPresented';
}

function toOutcome(result: PAYWALL_RESULT): PaywallOutcome {
  switch (result) {
    case PAYWALL_RESULT.PURCHASED:
      return 'purchased';
    case PAYWALL_RESULT.RESTORED:
      return 'restored';
    case PAYWALL_RESULT.NOT_PRESENTED:
      return 'notPresented';
    case PAYWALL_RESULT.CANCELLED:
      return 'cancelled';
    default:
      return 'error';
  }
}

export function usePaywall() {
  const { available, access, refresh } = useSubscription();

  /** Pulls the entitlement forward after a paywall closes. The customer info
   * listener also fires, but awaiting this means a caller can branch on fresh
   * state on the very next line. */
  const settle = useCallback(
    async (outcome: PaywallOutcome) => {
      if (outcome === 'purchased' || outcome === 'restored') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await refresh();
      }
      return outcome;
    },
    [refresh],
  );

  /** Shows the plans unconditionally. Pass an offering to sell something other
   * than the dashboard's Current offering. */
  const presentPaywall = useCallback(
    async (offering?: PurchasesOffering): Promise<PaywallOutcome> => {
      if (!available) return 'error';
      try {
        const result = await RevenueCatUI.presentPaywall({ offering, displayCloseButton: true });
        return settle(toOutcome(result));
      } catch (cause) {
        console.warn('[purchases] paywall failed', describePurchasesError(cause), cause);
        return 'error';
      }
    },
    [available, settle],
  );

  /** Shows the plans only when Clarity Pro is missing. */
  const presentPaywallIfNeeded = useCallback(
    async (offering?: PurchasesOffering): Promise<PaywallOutcome> => {
      if (!available) return 'error';
      try {
        const result = await RevenueCatUI.presentPaywallIfNeeded({
          requiredEntitlementIdentifier: PRO_ENTITLEMENT_ID,
          offering,
          displayCloseButton: true,
        });
        return settle(toOutcome(result));
      } catch (cause) {
        console.warn('[purchases] paywall failed', describePurchasesError(cause), cause);
        return 'error';
      }
    },
    [available, settle],
  );

  /**
   * The gate. Runs `action` immediately for a subscriber, otherwise presents the
   * paywall and runs it only if the customer comes back entitled. Returns
   * whether the action ran.
   *
   * When purchases are unavailable the action runs anyway: a build with no store
   * configured should not lock the customer out of the app.
   */
  const requirePro = useCallback(
    async (action: () => void): Promise<boolean> => {
      if (access.isPro || !available) {
        action();
        return true;
      }
      const outcome = await presentPaywallIfNeeded();
      if (unlocked(outcome)) {
        action();
        return true;
      }
      return false;
    },
    [access.isPro, available, presentPaywallIfNeeded],
  );

  /**
   * The self-serve subscription screen: cancel, change plan, request a refund
   * (iOS), report a missing purchase. Configured under Project Settings >
   * Customer Center in the dashboard.
   *
   * `refresh` runs on the callbacks that can change entitlement state, since a
   * cancellation or refund happens on the store's side.
   */
  const presentCustomerCenter = useCallback(async () => {
    if (!available) return;
    try {
      await RevenueCatUI.presentCustomerCenter({
        callbacks: {
          onRestoreCompleted: () => {
            refresh();
          },
          onRefundRequestCompleted: () => {
            refresh();
          },
          onShowingManageSubscriptions: () => {
            // The customer is leaving for the store's own management page, where
            // they may cancel. Nothing to await, so refresh on the way out.
            refresh();
          },
        },
      });
    } catch (cause) {
      console.warn('[purchases] customer center failed', describePurchasesError(cause), cause);
    }
  }, [available, refresh]);

  return { presentPaywall, presentPaywallIfNeeded, requirePro, presentCustomerCenter };
}

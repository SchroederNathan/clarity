/**
 * Clarity Pro entitlement state for the whole app.
 *
 * One provider owns one subscription to RevenueCat's customer info updates, and
 * every screen reads the derived `access` off context. The alternative — each
 * screen calling `getCustomerInfo` — gives every screen its own loading state and
 * its own chance to be a render behind a renewal.
 *
 * The listener, not polling, is what keeps this fresh: it fires on purchases
 * made outside the app, renewals, expirations, and deferred payments clearing.
 */

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { NO_PRO_ACCESS, readProAccess, type ProAccess } from '@/lib/entitlements';
import {
  configurePurchases,
  describePurchasesError,
  fetchCustomerInfo,
  onCustomerInfoChange,
  refreshCustomerInfo,
  restorePurchases,
  type RestoreOutcome,
  type StoreKind,
} from '@/services/purchases';
import type { CustomerInfo } from 'react-native-purchases';

type SubscriptionValue = {
  /** What the UI branches on. Withholds Pro while loading and when unavailable. */
  access: ProAccess;
  /** True until the first customer info lands, or the SDK is ruled out. */
  isLoading: boolean;
  /** False when this build has no store: web, or no API key configured. */
  available: boolean;
  /** Which store is serving products. `test` means the RevenueCat Test Store. */
  storeKind: StoreKind | null;
  /** Last customer-facing failure from a background read, or null. */
  error: string | null;
  customerInfo: CustomerInfo | null;
  /** Forces a server read. For after the customer leaves to manage billing. */
  refresh: () => Promise<void>;
  restore: () => Promise<RestoreOutcome>;
};

const SubscriptionContext = createContext<SubscriptionValue | null>(null);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);
  const [storeKind, setStoreKind] = useState<StoreKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const verdict = configurePurchases();
    setAvailable(verdict.available);
    setStoreKind(verdict.available ? verdict.store : null);

    // No store in this build. Stop here with `isLoading` false so the UI can
    // say purchases are unavailable instead of spinning forever.
    if (!verdict.available) {
      setLoading(false);
      return;
    }

    let alive = true;
    // Registered before the first read so a change landing mid-fetch is not
    // dropped between the two.
    const unsubscribe = onCustomerInfoChange((info) => {
      if (alive) setCustomerInfo(info);
    });

    fetchCustomerInfo()
      .then((info) => {
        if (alive && info) setCustomerInfo(info);
      })
      .catch((cause) => {
        // A failed first read is not a reason to block the app. Pro stays off,
        // the message surfaces on the account screen, and the listener still
        // corrects the state once the network recovers.
        console.warn('[purchases] initial customer info failed', cause);
        if (alive) setError(describePurchasesError(cause));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const info = await refreshCustomerInfo();
      if (info) {
        setCustomerInfo(info);
        setError(null);
      }
    } catch (cause) {
      console.warn('[purchases] refresh failed', cause);
      setError(describePurchasesError(cause));
    }
  }, []);

  const restore = useCallback(async () => {
    const result = await restorePurchases();
    if (result.outcome === 'failed') {
      setError(result.message);
    } else {
      setCustomerInfo(result.customerInfo);
      setError(null);
    }
    return result;
  }, []);

  const value = useMemo<SubscriptionValue>(
    () => ({
      // `readProAccess(null)` already withholds Pro, so an unresolved or
      // unavailable SDK cannot read as entitled.
      access: available ? readProAccess(customerInfo) : NO_PRO_ACCESS,
      isLoading,
      available,
      storeKind,
      error,
      customerInfo,
      refresh,
      restore,
    }),
    [available, customerInfo, error, isLoading, refresh, restore, storeKind],
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

/**
 * Reads Clarity Pro state. Throws outside the provider rather than defaulting,
 * because a silent "not subscribed" would look exactly like a real answer and
 * hide the missing provider until a customer reported a lost unlock.
 */
export function useSubscription(): SubscriptionValue {
  const value = use(SubscriptionContext);
  if (!value) {
    throw new Error('useSubscription must be used inside <SubscriptionProvider>.');
  }
  return value;
}

/** Shorthand for the common case: gate a feature on Clarity Pro. */
export function useIsPro(): boolean {
  return useSubscription().access.isPro;
}

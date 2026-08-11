/**
 * The one place the RevenueCat SDK is configured and called.
 *
 * Everything here is side-effectful and platform-bound; the pure read model
 * lives in `lib/entitlements.ts` and the React surface in
 * `hooks/use-subscription.tsx`. Keeping the SDK behind this module means the
 * screens never see a raw `Purchases` call, and a store error always arrives as
 * a mapped result rather than an opaque native rejection.
 *
 * Failure policy: `configure()` never throws, because a monetization SDK must
 * not be able to take the app down at launch. Everything after configuration
 * returns a tagged result instead of rejecting, so a caller cannot forget to
 * handle "the user tapped cancel".
 */

import { Platform } from 'react-native';
import Purchases, {
  LOG_LEVEL,
  PURCHASES_ERROR_CODE,
  type CustomerInfo,
  type PurchasesError,
  type PurchasesOffering,
  type PurchasesPackage,
} from 'react-native-purchases';

import { isPro } from '@/lib/entitlements';

/**
 * RevenueCat Test Store key.
 *
 * A `test_` key makes the SDK serve products from the dashboard's Test Store
 * instead of StoreKit or Play Billing, so purchases complete in a plain
 * simulator with no App Store Connect products and no StoreKit configuration
 * file. Test subscriptions renew a handful of times on an accelerated clock and
 * then cancel, which is enough to exercise renewal, lapse, and restore.
 *
 * It is dev-only on purpose. RevenueCat deliberately alerts and hard-crashes a
 * release build that configures with a test key, to keep test purchases from
 * granting production entitlements, so `resolveApiKey` never hands it back
 * outside `__DEV__`.
 */
const TEST_STORE_KEY = 'test_esHeedIzfkCXIjbYMCOqZuKOifu';

export type StoreKind = 'test' | 'appStore' | 'playStore';

/**
 * Why purchases are or are not usable in this build. The UI needs this to stay
 * honest: with no key resolved there is nothing to sell, so the account screen
 * says so instead of rendering a paywall that cannot load.
 */
export type PurchasesAvailability =
  | { available: true; store: StoreKind }
  | { available: false; reason: 'unsupportedPlatform' | 'missingApiKey' };

function resolveApiKey(): { apiKey: string; store: StoreKind } | null {
  const platformKey =
    Platform.OS === 'ios'
      ? process.env.EXPO_PUBLIC_RC_IOS_API_KEY
      : process.env.EXPO_PUBLIC_RC_ANDROID_API_KEY;
  const platformStore: StoreKind = Platform.OS === 'ios' ? 'appStore' : 'playStore';

  // Release builds get the real store key or nothing. Falling back to the test
  // key here would crash the app by design, and falling back to the other
  // platform's key would silently attribute revenue to the wrong store.
  if (!__DEV__) {
    return platformKey ? { apiKey: platformKey, store: platformStore } : null;
  }

  // Dev builds default to the Test Store so purchases work on a simulator.
  // Set EXPO_PUBLIC_RC_USE_STORE=1 to point a dev build at real sandbox
  // purchases instead, for testing App Store or Play receipts end to end.
  if (process.env.EXPO_PUBLIC_RC_USE_STORE === '1' && platformKey) {
    return { apiKey: platformKey, store: platformStore };
  }
  return { apiKey: process.env.EXPO_PUBLIC_RC_TEST_API_KEY || TEST_STORE_KEY, store: 'test' };
}

let availability: PurchasesAvailability | null = null;

/**
 * Configures the SDK once per app process and reports whether purchases are
 * usable. Safe to call from more than one place: repeat calls return the cached
 * verdict without reconfiguring.
 *
 * Called from `SubscriptionProvider`'s mount effect rather than at module scope,
 * so the web bundle and the API-route bundle can import this file without
 * touching a native module.
 */
export function configurePurchases(): PurchasesAvailability {
  if (availability) return availability;

  // Web has no store wired up (RevenueCat Billing is not configured for this
  // project), and `getProducts` / `purchaseProduct` / `restorePurchases` are all
  // no-ops there, so skip configuration rather than half-enable it.
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    availability = { available: false, reason: 'unsupportedPlatform' };
    return availability;
  }

  const resolved = resolveApiKey();
  if (!resolved) {
    console.warn(
      '[purchases] No RevenueCat API key for this build. Set EXPO_PUBLIC_RC_IOS_API_KEY and EXPO_PUBLIC_RC_ANDROID_API_KEY. Purchases stay disabled.',
    );
    availability = { available: false, reason: 'missingApiKey' };
    return availability;
  }

  // Set before configure() so configuration itself is logged. Fire and forget:
  // losing a log level is never worth failing setup over.
  Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.ERROR).catch(() => {});

  Purchases.configure({
    apiKey: resolved.apiKey,
    // No account system yet, so the SDK generates and persists an anonymous
    // app user id. When sign-in lands, call `identifyPurchaser` after login
    // instead of passing an id here, so existing anonymous purchases transfer.
    appUserID: null,
    // Signs entitlement responses and reports tampering through
    // `entitlement.verification` without ever withholding access. Informational
    // is the safe default: a verification outage degrades to granting the
    // entitlement rather than locking out paying customers.
    entitlementVerificationMode: Purchases.ENTITLEMENT_VERIFICATION_MODE.INFORMATIONAL,
  });

  availability = { available: true, store: resolved.store };
  return availability;
}

/** The verdict from the last `configurePurchases()`, or null before first call. */
export function purchasesAvailability(): PurchasesAvailability | null {
  return availability;
}

function isConfigured(): boolean {
  return availability?.available === true;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function isPurchasesError(error: unknown): error is PurchasesError {
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error;
}

/**
 * Customer-facing copy for a store failure. The SDK's own `message` is written
 * for developers ("There was a problem with the App Store."), so the cases worth
 * acting on get their own line and everything else falls back to it.
 */
export function describePurchasesError(error: unknown): string {
  if (!isPurchasesError(error)) {
    return 'Something went wrong. Please try again.';
  }

  switch (error.code) {
    case PURCHASES_ERROR_CODE.NETWORK_ERROR:
    case PURCHASES_ERROR_CODE.OFFLINE_CONNECTION_ERROR:
      return 'You appear to be offline. Check your connection and try again.';
    case PURCHASES_ERROR_CODE.PURCHASE_NOT_ALLOWED_ERROR:
      return 'Purchases are not allowed on this device. Check your device restrictions.';
    case PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR:
      return 'You already own this. Try Restore Purchases to unlock it here.';
    case PURCHASES_ERROR_CODE.RECEIPT_ALREADY_IN_USE_ERROR:
      return 'This purchase is already tied to another account.';
    case PURCHASES_ERROR_CODE.PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR:
      return 'That plan is not available right now. Please try again later.';
    case PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR:
      return 'Your payment is still processing. Pro unlocks as soon as it clears.';
    case PURCHASES_ERROR_CODE.INELIGIBLE_ERROR:
      return 'You are not eligible for that offer.';
    case PURCHASES_ERROR_CODE.STORE_PROBLEM_ERROR:
      return 'The store is having trouble. Please try again in a moment.';
    case PURCHASES_ERROR_CODE.CONFIGURATION_ERROR:
    case PURCHASES_ERROR_CODE.INVALID_CREDENTIALS_ERROR:
      // A setup mistake, not something the customer can fix. Say so plainly
      // and let the dashboard logs carry the detail.
      return 'Purchases are not set up correctly. Please try again later.';
    default:
      return error.message || 'Something went wrong. Please try again.';
  }
}

function isCancellation(error: unknown): boolean {
  return isPurchasesError(error) && error.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR;
}

// ---------------------------------------------------------------------------
// Offerings
// ---------------------------------------------------------------------------

/**
 * The offering the dashboard marks Current, or null when the project has none.
 *
 * Read packages off the returned offering (`offering.weekly`, `offering.monthly`,
 * `offering.annual`, or `offering.availablePackages`) rather than hardcoding
 * product ids: that is what lets pricing, plan mix, and experiments change from
 * the dashboard without an app release.
 *
 * Throws on a store or network failure so the caller can retry.
 */
export async function fetchCurrentOffering(): Promise<PurchasesOffering | null> {
  if (!isConfigured()) return null;
  const offerings = await Purchases.getOfferings();
  return offerings.current;
}

/** A named offering, for a screen that sells a different set of plans than the
 * default (a win-back offer, an onboarding-only discount). */
export async function fetchOffering(identifier: string): Promise<PurchasesOffering | null> {
  if (!isConfigured()) return null;
  const offerings = await Purchases.getOfferings();
  return offerings.all[identifier] ?? null;
}

// ---------------------------------------------------------------------------
// Purchasing
// ---------------------------------------------------------------------------

export type PurchaseOutcome =
  | { outcome: 'purchased'; customerInfo: CustomerInfo }
  /** The customer dismissed the sheet. Not an error, show nothing. */
  | { outcome: 'cancelled' }
  /** Deferred payment (Play's slow payment methods, Ask to Buy). The
   * entitlement is not granted yet; it arrives through the customer info
   * listener when the charge clears. */
  | { outcome: 'pending' }
  | { outcome: 'failed'; message: string };

/**
 * Buys a package from an offering.
 *
 * Prefer this over `purchaseProduct`: a package carries the offering and
 * placement it came from, which is what makes dashboard-side experiments and
 * per-offering reporting work.
 */
export async function purchasePackage(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  if (!isConfigured()) {
    return { outcome: 'failed', message: 'Purchases are unavailable in this build.' };
  }

  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { outcome: 'purchased', customerInfo };
  } catch (error) {
    if (isCancellation(error)) return { outcome: 'cancelled' };
    if (isPurchasesError(error) && error.code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) {
      return { outcome: 'pending' };
    }
    console.warn('[purchases] purchase failed', error);
    return { outcome: 'failed', message: describePurchasesError(error) };
  }
}

export type RestoreOutcome =
  | { outcome: 'restored'; customerInfo: CustomerInfo }
  /** The restore succeeded but found no Clarity Pro purchase on this store
   * account. Worth a distinct message: "nothing found" and "restore failed"
   * need different next steps. */
  | { outcome: 'nothingToRestore'; customerInfo: CustomerInfo }
  | { outcome: 'failed'; message: string };

/**
 * Re-reads the store account's purchase history. Required by App Review for any
 * app selling a subscription, and the fix for a customer on a new device.
 */
export async function restorePurchases(): Promise<RestoreOutcome> {
  if (!isConfigured()) {
    return { outcome: 'failed', message: 'Purchases are unavailable in this build.' };
  }

  try {
    const customerInfo = await Purchases.restorePurchases();
    return isPro(customerInfo)
      ? { outcome: 'restored', customerInfo }
      : { outcome: 'nothingToRestore', customerInfo };
  } catch (error) {
    console.warn('[purchases] restore failed', error);
    return { outcome: 'failed', message: describePurchasesError(error) };
  }
}

// ---------------------------------------------------------------------------
// Customer info
// ---------------------------------------------------------------------------

/**
 * The current customer info. Served from the SDK's cache when it is warm, so
 * this is cheap enough to call on mount; it only hits the network when the cache
 * is stale or missing.
 */
export async function fetchCustomerInfo(): Promise<CustomerInfo | null> {
  if (!isConfigured()) return null;
  return Purchases.getCustomerInfo();
}

/**
 * Subscribes to customer info changes and returns the unsubscribe function.
 *
 * This is the primary way entitlement state should reach the app. The listener
 * fires immediately with the cached info and again on every change the SDK
 * learns about, including renewals, expirations, purchases made on the store's
 * own sheet, and deferred payments that clear later. Polling `getCustomerInfo`
 * would miss all of those.
 */
export function onCustomerInfoChange(listener: (info: CustomerInfo) => void): () => void {
  if (!isConfigured()) return () => {};
  Purchases.addCustomerInfoUpdateListener(listener);
  return () => {
    Purchases.removeCustomerInfoUpdateListener(listener);
  };
}

/**
 * Forces a fresh read from RevenueCat's servers.
 *
 * Use sparingly. The SDK's cache plus the update listener already cover normal
 * operation; this exists for the cases where the app knows something changed
 * out of band, such as returning from the store's own subscription management
 * page. Calling it on every render or screen focus just adds latency.
 */
export async function refreshCustomerInfo(): Promise<CustomerInfo | null> {
  if (!isConfigured()) return null;
  await Purchases.invalidateCustomerInfoCache();
  return Purchases.getCustomerInfo();
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Links purchases to a stable app-side user id.
 *
 * Unused today: Clarity has no accounts, so the SDK keeps an anonymous id per
 * install. These wrappers mark the two places that must change when sign-in
 * lands, because getting the order wrong is how subscriptions go missing.
 * Call `identifyPurchaser` right after login (RevenueCat transfers the
 * anonymous purchases onto the identified user) and `forgetPurchaser` on
 * logout, never on app launch.
 */
export async function identifyPurchaser(appUserID: string): Promise<CustomerInfo | null> {
  if (!isConfigured()) return null;
  const { customerInfo } = await Purchases.logIn(appUserID);
  return customerInfo;
}

export async function forgetPurchaser(): Promise<CustomerInfo | null> {
  if (!isConfigured()) return null;
  return Purchases.logOut();
}

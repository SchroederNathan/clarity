/**
 * Everything the app knows about Clarity Pro access, read off a RevenueCat
 * `CustomerInfo`. PURE — no React, no SDK calls, no persistence — so it runs
 * under bun in scripts/tests and can be driven from a fixture.
 *
 * RevenueCat is the only source of truth for entitlements. Nothing here caches
 * or mirrors that state: `services/purchases.ts` hands over the `CustomerInfo`
 * the SDK already keeps warm, and this module only reads it. Persisting "is pro"
 * locally would be both a stale-data bug and a trivially editable unlock.
 *
 * Imports go one way — `services/` and `hooks/` may import this, this imports
 * neither — so the pure layer stays loadable outside the app.
 */

import type { CustomerInfo, PurchasesEntitlementInfo } from 'react-native-purchases';

import { formatMonthDay } from '@/lib/format';

/**
 * Entitlement identifier as configured in the RevenueCat dashboard, under
 * Project Settings > Entitlements.
 *
 * This string must match the dashboard exactly, including case and spacing. A
 * mismatch does not raise: the entitlement simply never appears in
 * `customerInfo.entitlements.active`, so every customer reads as not
 * subscribed. If subscribers report a missing unlock, check this first.
 */
export const PRO_ENTITLEMENT_ID = 'Clarity Pro';

/**
 * Access states worth telling the customer apart. The first four all mean the
 * entitlement is unlocked right now; only `none` withholds the feature.
 *
 * `cancelled` and `billingIssue` matter because access outlives the intent to
 * keep paying: someone who cancelled still has Pro until the period ends, and a
 * failed renewal keeps access through the store's grace period. Both are the
 * moments to point at the Customer Center rather than the paywall.
 */
export type ProStatus = 'active' | 'trial' | 'cancelled' | 'billingIssue' | 'none';

export type ProAccess = {
  /** The single gate the UI should branch on. */
  isPro: boolean;
  status: ProStatus;
  /** The raw entitlement, for anything this summary does not cover. */
  entitlement: PurchasesEntitlementInfo | null;
  /** ms since epoch, or null for lifetime access and for no entitlement. */
  expiresAtMs: number | null;
  willRenew: boolean;
  /** True when the unlock came from a family member's purchase. */
  isFamilyShared: boolean;
  /** True when the purchase came from a sandbox or the Test Store. */
  isSandbox: boolean;
  /** Store-hosted subscription management page, when the customer has one. */
  managementUrl: string | null;
};

/** The state before the first `CustomerInfo` arrives, and the state when the
 * SDK is unavailable. Withholds Pro: unknown must never read as entitled. */
export const NO_PRO_ACCESS: ProAccess = {
  isPro: false,
  status: 'none',
  entitlement: null,
  expiresAtMs: null,
  willRenew: false,
  isFamilyShared: false,
  isSandbox: false,
  managementUrl: null,
};

/**
 * The active Clarity Pro entitlement, or null.
 *
 * Reads `entitlements.active`, not `entitlements.all`: `all` also holds expired
 * entitlements, so keying into it would grant Pro to every past subscriber.
 */
export function proEntitlement(info: CustomerInfo | null | undefined): PurchasesEntitlementInfo | null {
  return info?.entitlements.active[PRO_ENTITLEMENT_ID] ?? null;
}

/** The one-line check. Prefer `useSubscription().access.isPro` in components. */
export function isPro(info: CustomerInfo | null | undefined): boolean {
  return proEntitlement(info) !== null;
}

function statusOf(entitlement: PurchasesEntitlementInfo): ProStatus {
  // Order matters. A failing renewal is the most actionable state, and it can
  // coexist with willRenew, so it is checked before anything else.
  if (entitlement.billingIssueDetectedAt) return 'billingIssue';
  if (entitlement.periodType === 'TRIAL' || entitlement.periodType === 'INTRO') return 'trial';
  // Lifetime purchases never renew but are not cancelled, so they read active.
  if (!entitlement.willRenew && entitlement.expirationDate !== null) return 'cancelled';
  return 'active';
}

/** Collapses a `CustomerInfo` into the summary the UI branches on. */
export function readProAccess(info: CustomerInfo | null | undefined): ProAccess {
  const entitlement = proEntitlement(info);
  const managementUrl = info?.managementURL ?? null;

  if (!entitlement) return { ...NO_PRO_ACCESS, managementUrl };

  return {
    isPro: true,
    status: statusOf(entitlement),
    entitlement,
    expiresAtMs: entitlement.expirationDateMillis,
    willRenew: entitlement.willRenew,
    isFamilyShared: entitlement.ownershipType === 'FAMILY_SHARED',
    isSandbox: entitlement.isSandbox,
    managementUrl,
  };
}

/** One-line caption for an account row. Absolute dates, because "in 3 weeks" is
 * vaguer than the day the card gets charged. */
export function describeProAccess(access: ProAccess): string {
  const on = access.expiresAtMs === null ? null : formatMonthDay(access.expiresAtMs);

  switch (access.status) {
    case 'none':
      return 'Not subscribed';
    case 'billingIssue':
      return 'Payment problem, update your billing';
    case 'trial':
      return on ? `Free trial until ${on}` : 'Free trial';
    case 'cancelled':
      return on ? `Access until ${on}` : 'Access ending';
    case 'active':
      if (on === null) return 'Lifetime access';
      return access.isFamilyShared ? `Family shared, renews ${on}` : `Renews ${on}`;
  }
}

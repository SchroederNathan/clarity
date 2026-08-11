/**
 * Self-tests for the Clarity Pro entitlement read model. Pure JS — run with:
 *   bun scripts/test-entitlements.ts
 *
 * These matter more than their size suggests: every one of these branches is a
 * paying customer either locked out of what they bought or handed access they
 * did not. None of it is reachable from a simulator without the store, so it
 * gets covered here instead.
 */

import {
  describeProAccess,
  isPro,
  NO_PRO_ACCESS,
  PRO_ENTITLEMENT_ID,
  proEntitlement,
  readProAccess,
} from '@/lib/entitlements';
import type { CustomerInfo, PurchasesEntitlementInfo } from 'react-native-purchases';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: unknown) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${label}`, detail !== undefined ? JSON.stringify(detail) : '');
  }
}

function assertEq<T>(actual: T, expected: T, label: string) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
  );
}

function section(name: string) {
  console.log(`\n== ${name}`);
}

// Fixed local-noon anchors so the formatted day is identical in any TZ.
const RENEWS_AT = new Date(2026, 7, 20, 12, 0, 0).getTime();
const BOUGHT_AT = new Date(2026, 6, 20, 12, 0, 0).getTime();

/**
 * Fixture for one entitlement. Cast rather than fully populated: the cast covers
 * only the transport fields `lib/entitlements` never reads (verification result,
 * the ISO twins of the millis fields), and every field the module does read is
 * set explicitly below.
 */
function entitlement(overrides: Partial<PurchasesEntitlementInfo> = {}): PurchasesEntitlementInfo {
  return {
    identifier: PRO_ENTITLEMENT_ID,
    isActive: true,
    willRenew: true,
    periodType: 'NORMAL',
    latestPurchaseDateMillis: BOUGHT_AT,
    originalPurchaseDateMillis: BOUGHT_AT,
    expirationDate: new Date(RENEWS_AT).toISOString(),
    expirationDateMillis: RENEWS_AT,
    store: 'APP_STORE',
    productIdentifier: 'clarity_pro_monthly',
    productPlanIdentifier: null,
    isSandbox: false,
    unsubscribeDetectedAt: null,
    billingIssueDetectedAt: null,
    ownershipType: 'PURCHASED',
    ...overrides,
  } as PurchasesEntitlementInfo;
}

/** Fixture for a customer. `active` and `all` are set separately on purpose:
 * telling them apart is the whole point of the expired-entitlement case. */
function customer(options: {
  active?: PurchasesEntitlementInfo[];
  all?: PurchasesEntitlementInfo[];
  managementURL?: string | null;
}): CustomerInfo {
  const byId = (list: PurchasesEntitlementInfo[]) =>
    Object.fromEntries(list.map((e) => [e.identifier, e]));
  const active = options.active ?? [];
  return {
    entitlements: {
      active: byId(active),
      all: byId(options.all ?? active),
    },
    managementURL: options.managementURL ?? null,
  } as CustomerInfo;
}

{
  section('entitlements: no subscription');

  assertEq(readProAccess(null), NO_PRO_ACCESS, 'null customer info withholds Pro');
  assertEq(readProAccess(undefined), NO_PRO_ACCESS, 'undefined customer info withholds Pro');
  assertEq(isPro(null), false, 'isPro(null) is false');
  assertEq(proEntitlement(null), null, 'no entitlement without customer info');

  const fresh = customer({});
  assertEq(isPro(fresh), false, 'a customer with no entitlements is not Pro');
  assertEq(readProAccess(fresh).status, 'none', 'status none');
  assertEq(describeProAccess(readProAccess(fresh)), 'Not subscribed', 'caption for no subscription');
}

{
  section('entitlements: only the active map grants access');

  // The regression this file exists for. `entitlements.all` keeps expired
  // entitlements forever, so keying into it would hand Pro to every past
  // subscriber for good.
  const lapsed = customer({ active: [], all: [entitlement({ isActive: false })] });
  assertEq(isPro(lapsed), false, 'an expired entitlement in `all` does not grant Pro');
  assertEq(readProAccess(lapsed).status, 'none', 'lapsed reads as not subscribed');

  // A different entitlement being active must not unlock Pro either.
  const other = customer({ active: [entitlement({ identifier: 'Some Other Tier' })] });
  assertEq(isPro(other), false, 'another entitlement does not unlock Clarity Pro');
}

{
  section('entitlements: active subscription');

  const access = readProAccess(customer({ active: [entitlement()] }));
  assertEq(access.isPro, true, 'active entitlement grants Pro');
  assertEq(access.status, 'active', 'status active');
  assertEq(access.willRenew, true, 'willRenew passes through');
  assertEq(access.expiresAtMs, RENEWS_AT, 'expiry passes through');
  assertEq(access.isFamilyShared, false, 'purchased directly');
  assertEq(describeProAccess(access), 'Renews Aug 20', 'caption names the renewal day');
}

{
  section('entitlements: trial, cancelled, lifetime, billing issue');

  const trial = readProAccess(customer({ active: [entitlement({ periodType: 'TRIAL' })] }));
  assertEq(trial.status, 'trial', 'TRIAL period reads as trial');
  assertEq(describeProAccess(trial), 'Free trial until Aug 20', 'trial caption');

  const intro = readProAccess(customer({ active: [entitlement({ periodType: 'INTRO' })] }));
  assertEq(intro.status, 'trial', 'INTRO period also reads as trial');

  // Cancelled but not yet expired: still entitled, and the distinction is what
  // decides whether the account button opens the Customer Center or the paywall.
  const cancelled = readProAccess(customer({ active: [entitlement({ willRenew: false })] }));
  assertEq(cancelled.isPro, true, 'a cancelled subscriber keeps access until expiry');
  assertEq(cancelled.status, 'cancelled', 'status cancelled');
  assertEq(describeProAccess(cancelled), 'Access until Aug 20', 'cancelled caption');

  // Lifetime never renews and never expires, so it must not read as cancelled.
  const lifetime = readProAccess(
    customer({
      active: [entitlement({ willRenew: false, expirationDate: null, expirationDateMillis: null })],
    }),
  );
  assertEq(lifetime.status, 'active', 'lifetime is active, not cancelled');
  assertEq(lifetime.expiresAtMs, null, 'lifetime has no expiry');
  assertEq(describeProAccess(lifetime), 'Lifetime access', 'lifetime caption');

  // A failing renewal outranks everything else: it is the one state the
  // customer can act on, and access continues through the grace period.
  const billing = readProAccess(
    customer({
      active: [entitlement({ billingIssueDetectedAt: new Date(BOUGHT_AT).toISOString() })],
    }),
  );
  assertEq(billing.isPro, true, 'grace period keeps access');
  assertEq(billing.status, 'billingIssue', 'billing issue wins over active');
  assertEq(
    describeProAccess(billing),
    'Payment problem, update your billing',
    'billing issue caption',
  );
}

{
  section('entitlements: family sharing and management URL');

  const shared = readProAccess(
    customer({ active: [entitlement({ ownershipType: 'FAMILY_SHARED' })] }),
  );
  assertEq(shared.isPro, true, 'family shared grants Pro');
  assertEq(shared.isFamilyShared, true, 'family sharing is flagged');
  assertEq(describeProAccess(shared), 'Family shared, renews Aug 20', 'family shared caption');

  // Carried even with no active entitlement: a lapsed customer may still have a
  // store page to visit, so the account UI needs it either way.
  const url = 'https://apps.apple.com/account/subscriptions';
  assertEq(readProAccess(customer({ managementURL: url })).managementUrl, url, 'URL passes through');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

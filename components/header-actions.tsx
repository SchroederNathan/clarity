import { Crown02Icon, FireIcon, User03Icon } from '@hugeicons-pro/core-solid-rounded';
import { HugeiconsIcon } from '@hugeicons/react-native';
import { GlassContainer, GlassView } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/ui';
import { radius, spacing } from '@/constants/theme';
import { useSubscription } from '@/hooks/use-subscription';
import { useTheme } from '@/hooks/use-theme';

/** The streak flame. Not a palette token: it is an illustrative glyph color,
 * fixed in both schemes, and nothing else in the app uses it. */
const STREAK_FLAME = '#FF9500';
const PRO_GOLD = '#FFB000';

function proButtonLabel(isLoading: boolean, isPro: boolean): string {
  if (isLoading) return 'Checking your subscription';
  return isPro ? 'Manage Clarity Pro' : 'Get Clarity Pro';
}

/** The screen-header trailing capsules shared by Home and Practice: streak
 * flame + count, and the profile avatar. GlassContainer lets the capsules
 * merge fluidly when they get close. */
export function HeaderActions({ streak }: { streak: number }) {
  const { colors } = useTheme();
  const { access, isLoading } = useSubscription();

  /**
   * The subscription entry point. Subscribers get the Customer Center, where
   * they can change plan, cancel, or fix a billing problem; everyone else gets
   * the paywall. Routing on entitlement rather than showing both keeps one tap
   * between the customer and the thing they came for.
   *
   * The button waits for the first entitlement read rather than routing on the
   * withheld-by-default `isPro`. That read is served from the SDK's cache and
   * lands a frame or two into a cold start; sending a paying customer to the
   * paywall during those frames is the one outcome worth waiting to avoid.
   */
  const openAccount = () => {
    if (isLoading) return;
    Haptics.selectionAsync();
    router.push(access.isPro ? '/manage-subscription' : '/paywall');
  };

  return (
    <GlassContainer spacing={spacing.sm} style={styles.row}>
      <GlassView isInteractive style={styles.streak}>
        <HugeiconsIcon icon={FireIcon} size={24} color={STREAK_FLAME} />
        <ThemedText variant="callout" weight="medium">
          {streak}
        </ThemedText>
      </GlassView>
      {/* Pressable wraps the glass rather than the reverse: GlassView renders a
          native material, so the touch target has to sit above it. */}
      <Pressable
        onPress={openAccount}
        disabled={isLoading}
        accessibilityRole="button"
        accessibilityState={{ disabled: isLoading }}
        accessibilityLabel={proButtonLabel(isLoading, access.isPro)}>
        <GlassView isInteractive style={styles.avatar}>
          <HugeiconsIcon
            icon={access.isPro ? Crown02Icon : User03Icon}
            size={24}
            color={access.isPro ? PRO_GOLD : colors.tertiary}
          />
        </GlassView>
      </Pressable>
    </GlassContainer>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.sm,
    paddingRight: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  avatar: {
    padding: spacing.sm,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

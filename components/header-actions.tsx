import { Crown02Icon, FireIcon, User03Icon } from '@hugeicons-pro/core-solid-rounded';
import { HugeiconsIcon } from '@hugeicons/react-native';
import { GlassContainer, GlassView } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, useColorScheme } from 'react-native';

import { palette } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { useSubscription } from '@/hooks/use-subscription';

const STREAK_FLAME = '#FF9500';
const PRO_GOLD = '#FFB000';

/** The screen-header trailing capsules shared by Home and Practice: streak
 * flame + count, and the profile avatar. GlassContainer lets the capsules
 * merge fluidly when they get close. */
export function HeaderActions({ streak }: { streak: number }) {
  const dark = useColorScheme() === 'dark';
  const colors = dark ? palette.dark : palette.light;
  const { access } = useSubscription();

  /**
   * The subscription entry point. Subscribers get the Customer Center, where
   * they can change plan, cancel, or fix a billing problem; everyone else gets
   * the paywall. Routing on entitlement rather than showing both keeps one tap
   * between the customer and the thing they came for.
   */
  const openAccount = () => {
    Haptics.selectionAsync();
    router.push(access.isPro ? '/manage-subscription' : '/paywall');
  };

  return (
    <GlassContainer spacing={8} style={styles.row}>
      <GlassView isInteractive style={styles.streak}>
        <HugeiconsIcon icon={FireIcon} size={24} color={STREAK_FLAME} />
        <Text style={[styles.streakCount, { color: colors.foreground }]}>{streak}</Text>
      </GlassView>
      {/* Pressable wraps the glass rather than the reverse: GlassView renders a
          native material, so the touch target has to sit above it. */}
      <Pressable
        onPress={openAccount}
        accessibilityRole="button"
        accessibilityLabel={access.isPro ? 'Manage Clarity Pro' : 'Get Clarity Pro'}>
        <GlassView isInteractive style={styles.avatar}>
          <HugeiconsIcon
            icon={access.isPro ? Crown02Icon : User03Icon}
            size={24}
            color={access.isPro ? PRO_GOLD : dark ? '#8E8E93' : '#98989E'}
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
    gap: 8,
  },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 8,
    paddingRight: 14,
    paddingVertical: 8,
    borderRadius: 50,
    borderCurve: 'continuous',
  },
  streakCount: {
    fontSize: 16,
    fontFamily: fonts.medium,
  },
  avatar: {
    padding: 8,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

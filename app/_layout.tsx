import { useFonts } from 'expo-font';
import { Observe, ObserveRoot } from 'expo-observe';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, type ReactNode } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ProgressiveBlur } from '@/components/glass-tabs';
import { IntroRevealProvider, SplashOverlay } from '@/components/splash';
import { fontAssets, fonts } from '@/constants/theme';
import { useIntroReveal } from '@/hooks/use-intro-reveal';
import { AppReadyProvider } from '@/hooks/use-mark-interactive';
import { SubscriptionProvider } from '@/hooks/use-subscription';
import { useTheme } from '@/hooks/use-theme';

/**
 * EAS Observe. The expo-router integration adds per-route navigation metrics
 * (cold_ttr, warm_ttr, and a per-navigation tti tagged with the route pattern)
 * on top of the app-wide startup metrics. It must be configured at module
 * scope: the library throws if the integration is toggled after the tree
 * mounts, and this module is evaluated before any screen renders.
 *
 * Metrics from debug builds are dropped by default, so a local dev build sends
 * nothing. EXPO_PUBLIC_OBSERVE_IN_DEV=1 dispatches them anyway while verifying
 * the wiring; it has no effect on release builds.
 */
Observe.configure({
  integrations: { 'expo-router': true },
  dispatchInDebug: process.env.EXPO_PUBLIC_OBSERVE_IN_DEV === '1',
});

// Single source of truth for the native route background. The navigator paints
// every screen's container with the navigation theme's `background`, so setting
// it here themes all nested navigators at once and paints the screen container
// before JS content mounts — the surface behind the tab-switch fade always
// matches the screen color, so no flash.
function NavThemeProvider({ children }: { children: ReactNode }) {
  const { colors, scheme } = useTheme();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;

  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      background: colors.background,
      card: colors.background,
      text: colors.foreground,
    },
    // Navigator-rendered text (headers, back labels) uses SF Pro Rounded too.
    fonts: {
      regular: { fontFamily: fonts.regular, fontWeight: '400' },
      medium: { fontFamily: fonts.medium, fontWeight: '500' },
      bold: { fontFamily: fonts.semibold, fontWeight: '600' },
      heavy: { fontFamily: fonts.bold, fontWeight: '700' },
    },
  } as const;

  // Keep the native root view / window (behind the routes: launch, overscroll
  // bounce, transparent sheets) in sync with the theme too.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.background);
  }, [colors.background]);

  return <ThemeProvider value={navTheme}>{children}</ThemeProvider>;
}

function RootLayout() {
  // Expo Go can't embed fonts at build time, so load them here. The splash
  // overlay needs no fonts, so it plays over the wait — only the routes
  // beneath it hold for the font load.
  const [fontsReady, fontError] = useFonts(fontAssets);
  const { scheme } = useTheme();
  // revealed flips when the splash logo ends (content starts staggering in
  // beneath the fade); splashDone flips when the fade completes (overlay unmounts).
  const { revealed, setRevealed, splashDone, setSplashDone } = useIntroReveal();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Configures RevenueCat and holds the Clarity Pro entitlement for every
          screen. Above the routes so the first render of any screen can already
          branch on it, and outside the font gate so the SDK starts its first
          customer-info read while the fonts load. */}
      <SubscriptionProvider>
        {/* Observe's TTI is reported by each screen, but only once the splash
            overlay is gone: until then it covers the routes and eats every
            touch, so the app is not interactive no matter what has rendered. */}
        <AppReadyProvider value={splashDone}>
          <IntroRevealProvider value={revealed}>
            <NavThemeProvider>
              {fontsReady || fontError ? (
                <Stack>
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                  <Stack.Screen
                    name="session"
                    options={{ presentation: 'fullScreenModal', headerShown: false }}
                  />
                  {/* Keeps its native header: a custom left-placed title and the
                      close button live in the stack toolbar (Stack.Toolbar inside
                      the route). The shared progressive blur lets the form scroll
                      beneath the toolbar without introducing a hard material edge. */}
                  <Stack.Screen
                    name="passage-editor"
                    options={{
                      presentation: 'modal',
                      title: '',
                      headerTransparent: true,
                      headerShadowVisible: false,
                      headerBlurEffect: 'none',
                      headerBackground: () => (
                        <ProgressiveBlur
                          direction="top"
                          tint={scheme}
                          style={{ flex: 1 }}
                        />
                      ),
                    }}
                  />
                  {/* Both are RevenueCat-hosted native views that draw their own
                      close button and their own scrolling, so they take the whole
                      modal with no header of ours on top. */}
                  <Stack.Screen
                    name="paywall"
                    options={{ presentation: 'modal', headerShown: false }}
                  />
                  <Stack.Screen
                    name="manage-subscription"
                    options={{ presentation: 'modal', headerShown: false }}
                  />
                </Stack>
              ) : null}
              {/* The splash backdrop inverts the scheme (light mode plays on
                  black), so pin the status bar to stay legible until it's gone. */}
              <StatusBar style={splashDone ? 'auto' : scheme} />
              {!splashDone ? (
                <SplashOverlay
                  onReveal={() => setRevealed(true)}
                  onDone={() => setSplashDone(true)}
                />
              ) : null}
            </NavThemeProvider>
          </IntroRevealProvider>
        </AppReadyProvider>
      </SubscriptionProvider>
    </GestureHandlerRootView>
  );
}

// Measures Time to First Render (cold_ttr / warm_ttr) and hosts the router
// integration that tags every later metric with its route.
export default ObserveRoot.wrap(RootLayout);

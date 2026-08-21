import { useColorScheme } from 'react-native';

import { colors, type ColorSchemeName, type ThemeColors } from '@/constants/theme';

/**
 * The current scheme's colors, plus the scheme itself for the rare component
 * that needs to branch on it (a glass tint direction, an SVG gradient).
 *
 * Use this instead of `useColorScheme()` plus a lookup. It resolves the `null`
 * that `useColorScheme()` returns before the system reports a scheme, so no
 * call site has to repeat `=== 'dark' ? 'dark' : 'light'`.
 */
export function useTheme(): { colors: ThemeColors; scheme: ColorSchemeName } {
  const scheme: ColorSchemeName = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { colors: colors[scheme], scheme };
}

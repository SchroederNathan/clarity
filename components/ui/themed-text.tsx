import { Text, type TextProps, type TextStyle } from 'react-native';

import { fonts, type, type TypeVariant } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Which ink a piece of text uses. Maps to the four-step text ramp in `colors`,
 * plus the two status inks that text is allowed to take. */
export type TextTone =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'dimmed'
  | 'inverse'
  | 'accent'
  | 'positive'
  | 'focus';

export type ThemedTextProps = TextProps & {
  /** A step in the type ramp. Defaults to `body`. */
  variant?: TypeVariant;
  /** Override the step's default face without changing its size. */
  weight?: keyof typeof fonts;
  /** Defaults to `primary`. */
  tone?: TextTone;
};

/**
 * All text in the app. Screens and components pick a ramp step and an ink tone;
 * neither ever names a `fontSize` or a hex value.
 *
 * `style` merges last, so a caller can set alignment or `maxWidth` without
 * forking. A caller setting `fontSize` or `color` through `style` is drift — the
 * ramp or the tone list is missing a step.
 */
export function ThemedText({
  variant = 'body',
  weight,
  tone = 'primary',
  style,
  ...props
}: ThemedTextProps) {
  const { colors } = useTheme();

  const ink: Record<TextTone, string> = {
    primary: colors.foreground,
    secondary: colors.secondary,
    tertiary: colors.tertiary,
    dimmed: colors.dimmed,
    inverse: colors.inverseLabel,
    accent: colors.accent,
    positive: colors.positive,
    focus: colors.focus,
  };

  const face: TextStyle | undefined = weight ? { fontFamily: fonts[weight] } : undefined;

  return <Text style={[type[variant], face, { color: ink[tone] }, style]} {...props} />;
}

import { StyleSheet, View } from 'react-native';

import { AnimatedRoundedNumber } from '@/components/animated-rounded-number';
import { ThemedText } from '@/components/ui';
import { fonts, spacing, type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { paceLabel } from '@/lib/metrics';

/** Fixed height for the SwiftUI Host: Hosts don't reliably self-size in a flex
 * row, so the WPM readout gets a box tall enough for `title3`. */
const WPM_BOX_HEIGHT = 25;

export type LiveWpmProps = {
  liveWpm: number;
  targetWpm: number;
};

/** Practice header center slot: blue live WPM (SwiftUI numericText transition
 * so digits roll) over a gray "target 179 · good pace" caption. */
export function LiveWpm({ liveWpm, targetWpm }: LiveWpmProps) {
  const { colors } = useTheme();

  const wpmText = `${liveWpm > 0 ? liveWpm : '–'} WPM`;

  return (
    <View style={styles.wrap}>
      <View style={styles.wpmBox}>
        <AnimatedRoundedNumber
          text={wpmText}
          value={liveWpm}
          color={colors.accent}
          fontSize={type.title3.fontSize}
          fontFamily={fonts.semibold}
          weight="semibold"
          duration={0.5}
        />
      </View>
      <ThemedText variant="footnote" tone="secondary">
        {`target ${targetWpm} · ${paceLabel(liveWpm, targetWpm)}`}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: spacing.xxs,
  },
  wpmBox: {
    height: WPM_BOX_HEIGHT,
    justifyContent: 'center',
  },
});

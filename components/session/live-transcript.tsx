import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { fonts } from '@/constants/theme';

/** Matches the teleprompter's reading-text padding, so switching between a
 * scripted session and a freestyle one doesn't shift the text column. */
const CONTENT_PADDING = 24;

export type LiveTranscriptColors = {
  foreground: string;
  dimmed: string;
  accent: string;
};

export type LiveTranscriptProps = {
  /** Committed (final-result) text. */
  finalText: string;
  /** In-flight interim tail, restyled until the recognizer commits it. */
  interimText: string;
  /** Prompt shown dimmed until the first words arrive. */
  placeholder: string;
  fontSize: number;
  colors: LiveTranscriptColors;
  topInset: number;
  bottomInset: number;
};

/**
 * The freestyle realtime surface: the user's words render as they speak —
 * committed text in the foreground color, the interim tail in accent. Unlike
 * the Teleprompter (frontier-driven over a fixed token list) this simply
 * grows downward and follows its own tail.
 */
export function LiveTranscript({
  finalText,
  interimText,
  placeholder,
  fontSize,
  colors,
  topInset,
  bottomInset,
}: LiveTranscriptProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [followTail, setFollowTail] = useState(true);
  const empty = finalText.length === 0 && interimText.length === 0;

  // Follow the newest words unless the user scrolled back up to reread.
  useEffect(() => {
    if (followTail) scrollRef.current?.scrollToEnd({ animated: true });
  }, [finalText, interimText, followTail]);

  const lineHeight = Math.round(fontSize * 1.35);

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.fill}
      contentContainerStyle={{
        paddingTop: topInset,
        paddingBottom: bottomInset,
        paddingHorizontal: CONTENT_PADDING,
      }}
      showsVerticalScrollIndicator={false}
      onScrollBeginDrag={() => setFollowTail(false)}
      onMomentumScrollEnd={(e) => {
        const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
        const distanceFromEnd =
          contentSize.height - contentOffset.y - layoutMeasurement.height;
        if (distanceFromEnd < 80) setFollowTail(true);
      }}>
      {empty ? (
        <Text style={[styles.text, { fontSize, lineHeight, color: colors.dimmed }]}>
          {placeholder}
        </Text>
      ) : (
        <View>
          <Text style={[styles.text, { fontSize, lineHeight }]}>
            <Text style={{ color: colors.foreground }}>{finalText}</Text>
            {interimText.length > 0 && (
              <Text style={{ color: colors.accent }}>
                {finalText.length > 0 ? ' ' : ''}
                {interimText}
              </Text>
            )}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  text: {
    fontFamily: fonts.semibold,
    letterSpacing: -0.3,
  },
});

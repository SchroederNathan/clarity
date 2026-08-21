import { View } from 'react-native';

import { ThemedText } from '@/components/ui';
import { spacing } from '@/constants/theme';

export type TranscriptCardProps = {
  transcript: string;
};

/** Freestyle results: what you said, in place of the Word Breakdown. */
export function TranscriptCard({ transcript }: TranscriptCardProps) {
  const empty = transcript.trim().length === 0;

  return (
    <View>
      <ThemedText variant="title3" weight="bold" style={{ marginBottom: spacing.md }}>
        What You Said
      </ThemedText>
      <ThemedText variant="bodyProse" tone={empty ? 'dimmed' : 'primary'}>
        {empty ? 'No speech was recognized this session.' : transcript}
      </ThemedText>
    </View>
  );
}

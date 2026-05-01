import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C, T, R, S } from '../theme';

interface Props {
  score: number | null;
  scoreType?: 'vector' | 'text' | 'none';
}

export function getScoreColour(score: number): { text: string; bg: string } {
  if (score >= 80) return { text: C.accent,  bg: C.accentDim };
  if (score >= 55) return { text: C.yellow,  bg: C.yellowDim };
  return               { text: C.red,    bg: C.redDim };
}

export default function MatchScoreBadge({ score, scoreType }: Props) {
  // Show real score only for vector matches
  if (scoreType === 'vector' && score !== null && score !== undefined) {
    const { text, bg } = getScoreColour(score);
    return (
      <View style={[styles.badge, { backgroundColor: bg }]}>
        <Text style={[styles.text, { color: text }]}>⚡ {score}%</Text>
      </View>
    );
  }

  // No resume uploaded or fallback strategy — show CTA
  return (
    <View style={styles.ctaBadge}>
      <Text style={styles.ctaText}>+ Add resume</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: S.sm,
    paddingVertical: 3,
    borderRadius: R.pill,
    alignSelf: 'flex-start',
  },
  text: {
    fontWeight: T.bold,
    fontSize: T.xs,
    letterSpacing: 0.3,
  },
  ctaBadge: {
    paddingHorizontal: S.sm,
    paddingVertical: 3,
    borderRadius: R.pill,
    backgroundColor: 'rgba(90,100,117,0.18)',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(90,100,117,0.3)',
    borderStyle: 'dashed',
  },
  ctaText: {
    color: C.textSub,
    fontSize: T.xs,
    fontWeight: T.medium,
  },
});

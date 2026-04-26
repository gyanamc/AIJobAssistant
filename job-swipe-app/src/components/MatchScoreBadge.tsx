import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C, T, R, S } from '../theme';

interface Props {
  score: number | null;
}

export function getScoreColour(score: number): { text: string; bg: string } {
  if (score >= 80) return { text: C.accent,  bg: C.accentDim };
  if (score >= 55) return { text: C.yellow,  bg: C.yellowDim };
  return               { text: C.red,    bg: C.redDim };
}

export default function MatchScoreBadge({ score }: Props) {
  if (score === null || score === undefined) {
    return (
      <View style={styles.noScore}>
        <Text style={styles.noScoreText}>—</Text>
      </View>
    );
  }

  const { text, bg } = getScoreColour(score);
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color: text }]}>⚡ {score}%</Text>
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
  noScore: {
    paddingHorizontal: S.sm,
    paddingVertical: 3,
    borderRadius: R.pill,
    backgroundColor: 'rgba(90,100,117,0.18)',
    alignSelf: 'flex-start',
  },
  noScoreText: {
    color: C.textSub,
    fontSize: T.xs,
    fontWeight: T.bold,
  },
});

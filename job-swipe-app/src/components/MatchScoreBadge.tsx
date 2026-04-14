import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  score: number | null;
}

export function getScoreColour(score: number): string {
  if (score >= 80) return '#22c55e'; // green
  if (score >= 50) return '#eab308'; // yellow
  return '#ef4444';                  // red
}

export default function MatchScoreBadge({ score }: Props) {
  if (score === null) {
    return (
      <View style={styles.noScore}>
        <Text style={styles.noScoreText}>No score — upload resume</Text>
      </View>
    );
  }

  const color = getScoreColour(score);
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Text style={styles.text}>{score}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  text: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  noScore: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#6b7280',
    alignSelf: 'flex-start',
  },
  noScoreText: {
    color: '#fff',
    fontSize: 12,
  },
});

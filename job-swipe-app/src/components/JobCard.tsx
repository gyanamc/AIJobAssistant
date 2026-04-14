import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import MatchScoreBadge from './MatchScoreBadge';
import type { JobCard as JobCardType } from '../types';

interface Props {
  job: JobCardType;
  onSwipeRight?: (job: JobCardType) => void;
  onSwipeLeft?: (job: JobCardType) => void;
  onTap?: (job: JobCardType) => void;
}

export default function JobCard({ job, onTap }: Props) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onTap?.(job)}
      activeOpacity={0.95}
    >
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={2}>{job.title}</Text>
        <MatchScoreBadge score={job.match_score} />
      </View>

      <Text style={styles.company}>{job.company}</Text>

      <View style={styles.meta}>
        <Text style={styles.metaText}>📍 {job.location || 'Remote'}</Text>
        <Text style={styles.metaText}>🔗 {job.source}</Text>
      </View>

      <Text style={styles.excerpt} numberOfLines={4}>{job.excerpt}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    marginHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#f1f5f9',
  },
  company: {
    fontSize: 14,
    color: '#94a3b8',
    marginBottom: 10,
  },
  meta: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  metaText: {
    fontSize: 12,
    color: '#64748b',
  },
  excerpt: {
    fontSize: 14,
    color: '#cbd5e1',
    lineHeight: 20,
  },
});

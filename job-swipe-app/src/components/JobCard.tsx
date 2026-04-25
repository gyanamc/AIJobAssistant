import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import MatchScoreBadge from './MatchScoreBadge';
import type { JobCard as JobCardType } from '../types';
import { C, T, R, S, SHADOW } from '../theme';

interface Props {
  job: JobCardType;
  onSwipeRight?: (job: JobCardType) => void;
  onSwipeLeft?: (job: JobCardType) => void;
  onTap?: (job: JobCardType) => void;
}

export default function JobCard({ job, onTap }: Props) {
  const sourceLabel = job.source === 'linkedin' ? 'LinkedIn' : 'Naukri';

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onTap?.(job)}
      activeOpacity={0.97}
    >
      {/* Top row: company + score badge */}
      <View style={styles.topRow}>
        <Text style={styles.company} numberOfLines={1}>{job.company}</Text>
        <MatchScoreBadge score={job.match_score} />
      </View>

      {/* Job title */}
      <Text style={styles.title} numberOfLines={2}>{job.title}</Text>

      {/* Meta chips */}
      <View style={styles.metaRow}>
        <View style={styles.chip}>
          <Text style={styles.chipText}>{job.location || 'Remote'}</Text>
        </View>
        <View style={styles.chipDivider} />
        <View style={styles.chip}>
          <Text style={styles.chipText}>{sourceLabel}</Text>
        </View>
      </View>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Excerpt */}
      <Text style={styles.excerpt} numberOfLines={4}>{job.excerpt}</Text>

      {/* Footer branding */}
      <View style={styles.footer}>
        <Image source={require('../assets/logo.png')} style={styles.logo} />
        <Text style={styles.brandText}>AntiGravity</Text>
        <View style={{ flex: 1 }} />
        <Text style={styles.tapHint}>Tap for details</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.surface2,
    borderRadius: R.lg,
    padding: S.lg,
    marginHorizontal: S.lg,
    borderWidth: 1,
    borderColor: C.border,
    ...SHADOW.card,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: S.xs,
  },
  company: {
    fontSize: T.xs + 1,
    fontWeight: T.medium,
    color: C.textSub,
    letterSpacing: 0.3,
    flex: 1,
    marginRight: S.sm,
  },
  title: {
    fontSize: T.lg,
    fontWeight: T.semibold,
    color: C.text,
    lineHeight: T.lg * 1.3,
    marginBottom: S.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.xs,
    marginBottom: S.md,
  },
  chip: {
    paddingHorizontal: S.sm,
    paddingVertical: 3,
    borderRadius: R.pill,
    backgroundColor: C.surface3,
  },
  chipText: {
    fontSize: T.xs,
    color: C.textSub,
    fontWeight: T.medium,
  },
  chipDivider: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: C.textDim,
  },
  divider: {
    height: 1,
    backgroundColor: C.borderSub,
    marginBottom: S.md,
  },
  excerpt: {
    fontSize: T.base,
    color: C.textSub,
    lineHeight: T.normal,
    marginBottom: S.md,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.xs,
  },
  logo: {
    width: 14,
    height: 14,
    resizeMode: 'contain',
    opacity: 0.5,
  },
  brandText: {
    fontSize: T.xs,
    color: C.textDim,
    fontWeight: T.semibold,
    letterSpacing: 0.5,
  },
  tapHint: {
    fontSize: T.xs,
    color: C.textDim,
    fontStyle: 'italic',
  },
});

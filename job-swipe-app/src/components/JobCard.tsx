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
  const companyInitial = job.company ? job.company.charAt(0).toUpperCase() : '🏢';

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onTap?.(job)}
      activeOpacity={0.97}
    >
      {/* Top row: Match score on the right */}
      <View style={styles.topRow}>
        <View style={styles.topLeftIcons}>
           <Text style={styles.iconText}>⚑</Text>
           <Text style={styles.iconText}>🔗</Text>
        </View>
        <MatchScoreBadge score={job.match_score} />
      </View>

      {/* Center Top: Company Logo Placeholder */}
      <View style={styles.logoWrapper}>
        <View style={styles.logoContainer}>
          <Text style={styles.logoText}>{companyInitial}</Text>
        </View>
      </View>

      {/* Company Name & Excerpt */}
      <Text style={styles.company} numberOfLines={2}>{job.company || 'Unknown Company'}</Text>
      <Text style={styles.excerpt} numberOfLines={3}>{job.excerpt}</Text>

      {/* Job Title */}
      <Text style={styles.title} numberOfLines={2}>{job.title}</Text>

      {/* Meta Chips */}
      <View style={styles.metaContainer}>
        <View style={styles.metaRow}>
          <View style={styles.chipTransparent}>
            <Text style={styles.chipTextTransparent}>📍 {job.location || 'Remote'}</Text>
          </View>
          <View style={styles.chipTransparent}>
            <Text style={styles.chipTextTransparent}>🗓️ Posted on {sourceLabel}</Text>
          </View>
        </View>
        
        <View style={styles.metaRow}>
          <View style={styles.chip}>
            <Text style={styles.chipText}>📊 Executive Level</Text>
          </View>
          <View style={styles.chip}>
            <Text style={styles.chipText}>💻 Remote</Text>
          </View>
        </View>
        
        <View style={styles.metaRow}>
          <View style={styles.chip}>
            <Text style={styles.chipText}>💼 Technology</Text>
          </View>
        </View>
        
        <View style={styles.metaRow}>
          <View style={styles.chip}>
            <Text style={styles.chipText}>🏢 1001-5000 employees</Text>
          </View>
        </View>
      </View>

      <View style={{ flex: 1 }} />

      {/* Footer branding */}
      <View style={styles.footer}>
        <View style={styles.brandContainer}>
          <Image source={require('../assets/logo.png')} style={styles.brandLogo} />
          <Text style={styles.brandText}>AntiGravity</Text>
        </View>
        <Text style={styles.tapHint}>Tap for details ⓘ</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111418', // Slightly darker than surface2 for depth
    borderRadius: 24,
    padding: S.lg,
    marginHorizontal: S.sm,
    borderWidth: 1,
    borderColor: C.borderSub,
    ...SHADOW.card,
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: S.lg,
  },
  topLeftIcons: {
    flexDirection: 'row',
    gap: S.md,
  },
  iconText: {
    color: C.accent,
    fontSize: T.lg,
  },
  logoWrapper: {
    alignItems: 'center',
    marginBottom: S.lg,
  },
  logoContainer: {
    width: 72,
    height: 72,
    borderRadius: 18,
    backgroundColor: '#2563EB', // A nice blue similar to Sprout's map logo
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 32,
    fontWeight: '800',
    color: C.white,
  },
  company: {
    fontSize: T.lg,
    fontWeight: T.medium,
    color: C.text,
    textAlign: 'center',
    marginBottom: S.sm,
  },
  excerpt: {
    fontSize: T.sm,
    color: C.textSub,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: S.md,
    marginBottom: S.xl,
  },
  title: {
    fontSize: 22,
    fontWeight: T.bold,
    color: C.text,
    textAlign: 'center',
    marginBottom: S.xl,
    lineHeight: 28,
  },
  metaContainer: {
    alignItems: 'center',
    gap: S.sm,
    marginBottom: S.xl,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: S.sm,
  },
  chipTransparent: {
    paddingHorizontal: S.sm,
    paddingVertical: S.xs,
  },
  chipTextTransparent: {
    fontSize: T.xs,
    color: C.textSub,
    fontWeight: T.medium,
  },
  chip: {
    paddingHorizontal: S.md,
    paddingVertical: 6,
    borderRadius: R.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  chipText: {
    fontSize: T.xs,
    color: '#D1D5DB', // Light gray
    fontWeight: T.medium,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: S.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.xs,
  },
  brandLogo: {
    width: 18,
    height: 18,
    resizeMode: 'contain',
  },
  brandText: {
    fontSize: T.md,
    color: C.white,
    fontWeight: T.bold,
    letterSpacing: 0.5,
  },
  tapHint: {
    fontSize: T.xs,
    color: C.textSub,
  },
});

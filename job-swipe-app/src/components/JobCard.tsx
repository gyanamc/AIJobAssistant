import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Flag, ExternalLink, MapPin, Calendar, BarChart, Monitor, Briefcase, Building2, Info } from 'lucide-react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
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
      activeOpacity={1}
    >
      {/* Top row: Match score on the right */}
      <View style={styles.topRow}>
        <View style={styles.topLeftIcons}>
           <Flag size={20} color={C.textDim} />
           <ExternalLink size={20} color={C.textDim} />
        </View>
        <MatchScoreBadge score={job.match_score} />
      </View>

      {/* Header section: Logo + Title + Company (left aligned) */}
      <View style={styles.headerSection}>
        <View style={styles.logoContainer}>
          <Svg height="100%" width="100%" style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={C.accent} stopOpacity="0.8" />
                <Stop offset="1" stopColor="#2563EB" stopOpacity="0.8" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#grad)" />
          </Svg>
          <Text style={styles.logoText}>{companyInitial}</Text>
        </View>
        
        <View style={styles.titleWrapper}>
          <Text style={styles.company} numberOfLines={1}>{job.company || 'Unknown Company'}</Text>
          <Text style={styles.title} numberOfLines={3}>{job.title}</Text>
        </View>
      </View>

      {/* Excerpt */}
      <Text style={styles.excerpt} numberOfLines={3}>{job.excerpt}</Text>

      {/* Meta Chips */}
      <View style={styles.metaContainer}>
        <View style={styles.metaRow}>
          <View style={styles.chipTransparent}>
            <MapPin size={14} color={C.textSub} />
            <Text style={styles.chipTextTransparent}>{job.location || 'Remote'}</Text>
          </View>
          <View style={styles.chipTransparent}>
            <Calendar size={14} color={C.textSub} />
            <Text style={styles.chipTextTransparent}>Posted on {sourceLabel}</Text>
          </View>
        </View>
        
        <View style={styles.metaWrapRow}>
          {job.job_level && (
            <View style={styles.glassChip}>
              <BarChart size={14} color="#D1D5DB" />
              <Text style={styles.chipText}>{job.job_level}</Text>
            </View>
          )}
          {job.job_type && (
            <View style={styles.glassChip}>
              <Monitor size={14} color="#D1D5DB" />
              <Text style={styles.chipText}>{job.job_type}</Text>
            </View>
          )}
          {job.industry && (
            <View style={styles.glassChip}>
              <Briefcase size={14} color="#D1D5DB" />
              <Text style={styles.chipText}>{job.industry}</Text>
            </View>
          )}
          {job.company_size && (
            <View style={styles.glassChip}>
              <Building2 size={14} color="#D1D5DB" />
              <Text style={styles.chipText}>{job.company_size}</Text>
            </View>
          )}
        </View>
      </View>

      <View style={{ flex: 1 }} />

      {/* Footer branding */}
      <View style={styles.footer}>
        <View style={styles.brandContainer}>
          <Image source={require('../assets/logo.png')} style={styles.brandLogo} />
          <Text style={styles.brandText}>AntiGravity</Text>
        </View>
        <View style={styles.hintContainer}>
          <Text style={styles.tapHint}>Tap for details</Text>
          <Info size={14} color={C.textSub} />
        </View>
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
  headerSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    marginBottom: S.lg,
  },
  logoContainer: {
    width: 64,
    height: 64,
    borderRadius: R.xl,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 28,
    fontWeight: '800',
    color: C.white,
    position: 'absolute',
  },
  titleWrapper: {
    flex: 1,
    justifyContent: 'center',
  },
  company: {
    fontSize: 14,
    fontWeight: '700',
    color: C.accent,
    marginBottom: 4,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 26,
    fontWeight: '900',
    color: C.white,
    lineHeight: 32,
  },
  excerpt: {
    fontSize: 16,
    color: '#D1D5DB',
    lineHeight: 24,
    marginBottom: S.xl,
  },
  metaContainer: {
    gap: S.sm,
    marginBottom: S.xl,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: S.sm,
    marginBottom: S.xs,
  },
  metaWrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: S.sm,
  },
  chipTransparent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: S.xs,
    marginRight: S.sm,
  },
  chipTextTransparent: {
    fontSize: T.xs,
    color: C.textSub,
    fontWeight: T.medium,
  },
  glassChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: S.md,
    paddingVertical: 8,
    borderRadius: R.pill,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
  },
  chipText: {
    fontSize: T.xs,
    color: '#D1D5DB',
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
  hintContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tapHint: {
    fontSize: T.xs,
    color: C.textSub,
  },
});

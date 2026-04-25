import React from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Linking,
} from 'react-native';
import MatchScoreBadge from '../components/MatchScoreBadge';
import { C, T, R, S, SHADOW } from '../theme';

export default function JobDetailSheet({ route, navigation }: any) {
  const { job } = route.params;
  const sourceLabel = job.source === 'linkedin' ? 'LinkedIn' : 'Naukri';

  return (
    <View style={styles.container}>
      {/* Handle */}
      <View style={styles.handle} />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.headerCard}>
          <View style={styles.headerTop}>
            <Text style={styles.company} numberOfLines={1}>{job.company}</Text>
            <MatchScoreBadge score={job.match_score} />
          </View>
          <Text style={styles.title} numberOfLines={3}>{job.title}</Text>

          {/* Meta */}
          <View style={styles.metaRow}>
            <View style={styles.chip}>
              <Text style={styles.chipText}>{job.location || 'Remote'}</Text>
            </View>
            <View style={styles.chipDot} />
            <View style={styles.chip}>
              <Text style={styles.chipText}>{sourceLabel}</Text>
            </View>
          </View>
        </View>

        {/* Description */}
        <Text style={styles.sectionLabel}>Description</Text>
        <Text style={styles.description}>{job.description}</Text>

        {/* External link */}
        {!!job.apply_url && (
          <TouchableOpacity
            style={styles.externalBtn}
            onPress={() => Linking.openURL(job.apply_url)}
          >
            <Text style={styles.externalText}>View Original Posting ↗</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Fixed action bar */}
      <View style={styles.actionBar}>
        <TouchableOpacity
          style={styles.skipBtn}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.applyBtn}
          onPress={() => {
            navigation.goBack();
            navigation.navigate('HILReview', { job, autoApply: false });
          }}
        >
          <Text style={styles.applyText}>Apply Now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  handle: {
    width: 36,
    height: 3,
    backgroundColor: C.surface3,
    borderRadius: R.pill,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: S.lg,
  },
  content: {
    paddingHorizontal: S.xl,
    paddingBottom: S.xxxl,
  },

  // Header card
  headerCard: {
    backgroundColor: C.surface2,
    borderRadius: R.lg,
    padding: S.lg,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: S.xl,
    ...SHADOW.subtle,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: S.xs,
  },
  company: {
    fontSize: T.xs + 1,
    fontWeight: T.medium,
    color: C.textSub,
    flex: 1,
    marginRight: S.sm,
    letterSpacing: 0.3,
  },
  title: {
    fontSize: T.xl,
    fontWeight: T.bold,
    color: C.text,
    lineHeight: T.xl * 1.3,
    marginBottom: S.md,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.xs,
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
  chipDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: C.textDim,
  },

  // Description
  sectionLabel: {
    fontSize: T.xs,
    fontWeight: T.bold,
    color: C.textSub,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: S.sm,
  },
  description: {
    fontSize: T.base,
    color: C.textSub,
    lineHeight: T.loose,
    marginBottom: S.xl,
  },
  externalBtn: {
    paddingVertical: S.sm,
  },
  externalText: {
    color: C.accent,
    fontSize: T.sm,
    fontWeight: T.medium,
  },

  // Action bar
  actionBar: {
    flexDirection: 'row',
    gap: S.md,
    padding: S.xl,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: C.borderSub,
    backgroundColor: C.bg,
  },
  skipBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
  },
  applyBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: R.pill,
    backgroundColor: C.accent,
    alignItems: 'center',
    ...SHADOW.subtle,
  },
  skipText: {
    color: C.textSub,
    fontSize: T.base,
    fontWeight: T.semibold,
  },
  applyText: {
    color: C.black,
    fontSize: T.base,
    fontWeight: T.bold,
  },
});

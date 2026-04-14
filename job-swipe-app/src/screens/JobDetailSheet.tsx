import React from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Linking,
} from 'react-native';
import MatchScoreBadge from '../components/MatchScoreBadge';

export default function JobDetailSheet({ route, navigation }: any) {
  const { job } = route.params;

  return (
    <View style={styles.container}>
      <View style={styles.handle} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{job.title}</Text>
            <Text style={styles.company}>{job.company}</Text>
          </View>
          <MatchScoreBadge score={job.match_score} />
        </View>

        <View style={styles.meta}>
          <Text style={styles.metaText}>📍 {job.location || 'Remote'}</Text>
          <Text style={styles.metaText}>🔗 {job.source}</Text>
        </View>

        <Text style={styles.sectionLabel}>Job Description</Text>
        <Text style={styles.description}>{job.description}</Text>

        <TouchableOpacity
          style={styles.externalBtn}
          onPress={() => Linking.openURL(job.apply_url)}
        >
          <Text style={styles.externalText}>View Original Posting ↗</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.skipBtn]}
          onPress={() => { navigation.goBack(); }}
        >
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.applyBtn]}
          onPress={() => {
            navigation.goBack();
            navigation.navigate('HILReview', { job, autoApply: false });
          }}
        >
          <Text style={styles.applyText}>Apply</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  handle: { width: 40, height: 4, backgroundColor: '#334155', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 8 },
  content: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '700', color: '#f1f5f9', marginBottom: 4 },
  company: { fontSize: 14, color: '#94a3b8' },
  meta: { flexDirection: 'row', gap: 16, marginBottom: 20 },
  metaText: { fontSize: 13, color: '#64748b' },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  description: { fontSize: 15, color: '#cbd5e1', lineHeight: 22, marginBottom: 24 },
  externalBtn: { paddingVertical: 10 },
  externalText: { color: '#22c55e', fontSize: 14 },
  actions: { flexDirection: 'row', gap: 12, padding: 20, borderTopWidth: 1, borderTopColor: '#1e293b' },
  actionBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  skipBtn: { backgroundColor: '#1e293b' },
  applyBtn: { backgroundColor: '#22c55e' },
  skipText: { color: '#94a3b8', fontWeight: '600' },
  applyText: { color: '#fff', fontWeight: '700' },
});

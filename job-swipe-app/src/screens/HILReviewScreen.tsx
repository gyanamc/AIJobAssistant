import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput,
  TouchableOpacity, Alert, ScrollView,
} from 'react-native';
import { v4 as uuidv4 } from 'uuid';
import { generateCoverLetter } from '../api/jobsApi';
import { useApplicationStore } from '../store/useApplicationStore';
import { useJobStore } from '../store/useJobStore';
import { getItem, KEYS } from '../utils/storage';
import MatchScoreBadge from '../components/MatchScoreBadge';
import LoadingOverlay from '../components/LoadingOverlay';
import type { ResumeSummary, DraftApplication } from '../types';

const TIMEOUT_MS = 30_000;

export default function HILReviewScreen({ route, navigation }: any) {
  const { job, autoApply } = route.params;
  const { saveDraft } = useApplicationStore();
  const { markAutoApplied } = useJobStore();

  const [coverLetter, setCoverLetter] = useState('');
  const [loading, setLoading] = useState(true);
  const [timedOut, setTimedOut] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    generateLetter();
    timeoutRef.current = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, []);

  async function generateLetter() {
    try {
      const resume = await getItem<ResumeSummary>(KEYS.RESUME_SUMMARY);
      const letter = await generateCoverLetter({
        job_id: job.id,
        job_title: job.title,
        company: job.company,
        job_description: job.description,
        resume_summary: resume?.experience_summary ?? '',
      });
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setCoverLetter(letter);
    } catch (err: any) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setTimedOut(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm(status: 'draft' | 'auto-applied' = 'draft') {
    const draft: DraftApplication = {
      id: uuidv4(),
      job_id: job.id,
      job_title: job.title,
      company: job.company,
      apply_url: job.apply_url,
      cover_letter: coverLetter,
      status,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await saveDraft(draft);
    if (status === 'auto-applied') markAutoApplied(job.id);
    Alert.alert('Saved', status === 'auto-applied' ? 'Auto-applied!' : 'Draft saved.');
    navigation.navigate('Main');
  }

  if (timedOut && !coverLetter) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Cover Letter Timed Out</Text>
        <Text style={styles.subtitle}>The AI took too long. You can write one manually or skip.</Text>
        <TextInput
          style={[styles.editor, { height: 200 }]}
          multiline
          value={coverLetter}
          onChangeText={setCoverLetter}
          placeholder="Write your cover letter here…"
          placeholderTextColor="#64748b"
        />
        <TouchableOpacity style={styles.confirmBtn} onPress={() => handleConfirm('draft')}>
          <Text style={styles.confirmText}>Save Draft</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.skipBtn} onPress={() => navigation.navigate('Main')}>
          <Text style={styles.skipText}>Skip Application</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LoadingOverlay visible={loading} message="Generating your cover letter…" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.jobHeader}>
          <Text style={styles.jobTitle}>{job.title}</Text>
          <Text style={styles.jobCompany}>{job.company}</Text>
          <MatchScoreBadge score={job.match_score} />
        </View>

        <Text style={styles.sectionLabel}>Cover Letter</Text>
        <TextInput
          style={styles.editor}
          multiline
          value={coverLetter}
          onChangeText={setCoverLetter}
          placeholder="Cover letter will appear here…"
          placeholderTextColor="#64748b"
        />
      </ScrollView>

      <View style={styles.actions}>
        {autoApply && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.autoBtn]}
            onPress={() => handleConfirm('auto-applied')}
          >
            <Text style={styles.autoBtnText}>⚡ AUTO-APPLY</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.actionBtn, styles.confirmBtn]} onPress={() => handleConfirm('draft')}>
          <Text style={styles.confirmText}>Confirm & Save</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.skipBtn} onPress={() => navigation.navigate('Main')}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 20, paddingBottom: 40 },
  jobHeader: { marginBottom: 20, gap: 4 },
  jobTitle: { fontSize: 18, fontWeight: '700', color: '#f1f5f9' },
  jobCompany: { fontSize: 14, color: '#94a3b8', marginBottom: 8 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  editor: { backgroundColor: '#1e293b', color: '#f1f5f9', borderRadius: 12, padding: 14, fontSize: 15, lineHeight: 22, minHeight: 280, textAlignVertical: 'top' },
  actions: { padding: 20, gap: 10, borderTopWidth: 1, borderTopColor: '#1e293b' },
  actionBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  autoBtn: { backgroundColor: '#7c3aed' },
  autoBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  confirmBtn: { backgroundColor: '#22c55e', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  confirmText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  skipBtn: { alignItems: 'center', paddingVertical: 10 },
  skipText: { color: '#64748b', fontSize: 14 },
  title: { fontSize: 22, fontWeight: '700', color: '#f1f5f9', marginBottom: 12, padding: 20, paddingTop: 60 },
  subtitle: { fontSize: 15, color: '#94a3b8', paddingHorizontal: 20, marginBottom: 20 },
});

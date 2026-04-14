import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, TextInput, Alert,
} from 'react-native';
import DocumentPicker from 'react-native-document-picker';
import { useAuthStore } from '../store/useAuthStore';
import { useJobStore } from '../store/useJobStore';
import { getItem, setItem, KEYS } from '../utils/storage';
import { parseResume } from '../api/resumeApi';
import { syncProfile } from '../api/profileApi';
import type { ResumeSummary, UserPreferences } from '../types';

const THRESHOLD_OPTIONS = [70, 75, 80, 85, 90, 95];

export default function ProfileScreen() {
  const { session, isAuthenticated, signOut } = useAuthStore();
  const { resetHistory } = useJobStore();

  const [resume, setResume] = useState<ResumeSummary | null>(null);
  const [prefs, setPrefs] = useState<UserPreferences>({
    target_roles: [],
    preferred_locations: [],
    auto_apply_threshold: 80,
    onboarding_complete: true,
  });
  const [targetRoles, setTargetRoles] = useState('');
  const [locations, setLocations] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const [storedResume, storedPrefs] = await Promise.all([
      getItem<ResumeSummary>(KEYS.RESUME_SUMMARY),
      getItem<UserPreferences>(KEYS.PREFERENCES),
    ]);
    if (storedResume) setResume(storedResume);
    if (storedPrefs) {
      setPrefs(storedPrefs);
      setTargetRoles(storedPrefs.target_roles.join(', '));
      setLocations(storedPrefs.preferred_locations.join(', '));
    }
  }

  async function handleResumeUpload() {
    try {
      const result = await DocumentPicker.pickSingle({
        type: [DocumentPicker.types.pdf, DocumentPicker.types.plainText],
      });
      setLoading(true);
      const summary = await parseResume({
        uri: result.uri,
        name: result.name ?? 'resume',
        type: result.type ?? 'application/pdf',
        size: result.size ?? 0,
      });
      const withTimestamp: ResumeSummary = { ...summary, synced_at: new Date().toISOString() };
      await setItem(KEYS.RESUME_SUMMARY, withTimestamp);
      setResume(withTimestamp);
      try { await syncProfile(withTimestamp, prefs); } catch (_) {}
      Alert.alert('Resume updated', `Parsed as ${summary.name}`);
    } catch (err: any) {
      if (!DocumentPicker.isCancel(err)) Alert.alert('Upload failed', err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSavePrefs() {
    const updated: UserPreferences = {
      ...prefs,
      target_roles: targetRoles.split(',').map(s => s.trim()).filter(Boolean),
      preferred_locations: locations.split(',').map(s => s.trim()).filter(Boolean),
    };
    await setItem(KEYS.PREFERENCES, updated);
    setPrefs(updated);
    if (resume) {
      try { await syncProfile(resume, updated); } catch (_) {}
    }
    Alert.alert('Saved', 'Preferences updated.');
  }

  async function handleSignOut() {
    Alert.alert('Sign Out', 'Your drafts and swipe history will be kept.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => signOut() },
    ]);
  }

  async function handleResetHistory() {
    Alert.alert('Reset Swipe History', 'This will clear all swiped jobs and refresh your feed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: () => resetHistory() },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.header}>Profile</Text>

      {/* Auth section */}
      {isAuthenticated && session ? (
        <View style={styles.authCard}>
          <Text style={styles.authName}>{session.email}</Text>
          <TouchableOpacity onPress={handleSignOut}>
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={styles.notSignedIn}>Not signed in — sign in when applying to save applications.</Text>
      )}

      {/* Resume */}
      <Text style={styles.sectionLabel}>Resume</Text>
      {resume && (
        <View style={styles.resumeCard}>
          <Text style={styles.resumeName}>{resume.name || 'Resume uploaded'}</Text>
          <Text style={styles.resumeMeta}>
            {resume.skills.slice(0, 4).join(', ')}{resume.skills.length > 4 ? '…' : ''}
          </Text>
        </View>
      )}
      <TouchableOpacity style={styles.uploadBtn} onPress={handleResumeUpload} disabled={loading}>
        <Text style={styles.uploadText}>{loading ? 'Parsing…' : resume ? 'Re-upload Resume' : 'Upload Resume'}</Text>
      </TouchableOpacity>

      {/* Preferences */}
      <Text style={styles.sectionLabel}>Target Roles</Text>
      <TextInput
        style={styles.input}
        value={targetRoles}
        onChangeText={setTargetRoles}
        placeholder="e.g. Software Engineer, ML Engineer"
        placeholderTextColor="#64748b"
      />

      <Text style={styles.sectionLabel}>Preferred Locations</Text>
      <TextInput
        style={styles.input}
        value={locations}
        onChangeText={setLocations}
        placeholder="e.g. Bangalore, Remote"
        placeholderTextColor="#64748b"
      />

      {/* AUTO-APPLY threshold */}
      <Text style={styles.sectionLabel}>
        AUTO-APPLY Threshold — {prefs.auto_apply_threshold}%
      </Text>
      <Text style={styles.thresholdHint}>
        Jobs scoring at or above this will show the AUTO-APPLY option.
      </Text>
      <View style={styles.thresholdRow}>
        {THRESHOLD_OPTIONS.map(val => (
          <TouchableOpacity
            key={val}
            style={[styles.thresholdBtn, prefs.auto_apply_threshold === val && styles.thresholdActive]}
            onPress={() => setPrefs(p => ({ ...p, auto_apply_threshold: val }))}
          >
            <Text style={[styles.thresholdText, prefs.auto_apply_threshold === val && styles.thresholdTextActive]}>
              {val}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.saveBtn} onPress={handleSavePrefs}>
        <Text style={styles.saveBtnText}>Save Preferences</Text>
      </TouchableOpacity>

      {/* Reset history */}
      <TouchableOpacity style={styles.resetBtn} onPress={handleResetHistory}>
        <Text style={styles.resetText}>Reset Swipe History</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 20, paddingTop: 56, paddingBottom: 60 },
  header: { fontSize: 22, fontWeight: '800', color: '#f1f5f9', marginBottom: 24 },
  authCard: { backgroundColor: '#1e293b', borderRadius: 12, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  authName: { color: '#f1f5f9', fontSize: 15 },
  signOutText: { color: '#ef4444', fontSize: 14, fontWeight: '600' },
  notSignedIn: { color: '#64748b', fontSize: 14, marginBottom: 24 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 20 },
  resumeCard: { backgroundColor: '#1e293b', borderRadius: 10, padding: 12, marginBottom: 10 },
  resumeName: { color: '#f1f5f9', fontWeight: '600', marginBottom: 4 },
  resumeMeta: { color: '#94a3b8', fontSize: 13 },
  uploadBtn: { backgroundColor: '#334155', paddingVertical: 12, borderRadius: 10, alignItems: 'center', marginBottom: 4 },
  uploadText: { color: '#f1f5f9', fontWeight: '600' },
  input: { backgroundColor: '#1e293b', color: '#f1f5f9', borderRadius: 10, padding: 12, fontSize: 15 },
  thresholdHint: { color: '#64748b', fontSize: 13, marginBottom: 10 },
  thresholdRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 4 },
  thresholdBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#1e293b' },
  thresholdActive: { backgroundColor: '#22c55e' },
  thresholdText: { color: '#94a3b8', fontWeight: '600' },
  thresholdTextActive: { color: '#fff' },
  saveBtn: { backgroundColor: '#22c55e', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 24 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  resetBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  resetText: { color: '#ef4444', fontSize: 14 },
});

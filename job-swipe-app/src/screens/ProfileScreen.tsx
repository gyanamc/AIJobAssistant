import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, TextInput, Alert,
} from 'react-native';
import DocumentPicker from 'react-native-document-picker';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useAuthStore } from '../store/useAuthStore';
import { useJobStore } from '../store/useJobStore';
import { getItem, setItem, KEYS } from '../utils/storage';
import { parseResume } from '../api/resumeApi';
import { syncProfile } from '../api/profileApi';
import { useToast } from '../hooks/useToast';
import Toast from '../components/Toast';
import type { ResumeSummary, UserPreferences } from '../types';
import { C, T, R, S, SHADOW } from '../theme';

const THRESHOLD_OPTIONS = [70, 75, 80, 85, 90, 95];

type ProfileScreenNavigationProp = StackNavigationProp<RootStackParamList>;

export default function ProfileScreen() {
  const navigation = useNavigation<ProfileScreenNavigationProp>();
  const { session, isAuthenticated, signOut } = useAuthStore();
  const { resetHistory } = useJobStore();
  const { toast, showToast, hideToast } = useToast();

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

  useEffect(() => { loadData(); }, []);

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
      const ts: ResumeSummary = { ...summary, synced_at: new Date().toISOString() };
      await setItem(KEYS.RESUME_SUMMARY, ts);
      setResume(ts);
      try { await syncProfile(ts, prefs); } catch (_) {}
      showToast('Resume updated');
    } catch (err: any) {
      if (!DocumentPicker.isCancel(err)) showToast('Upload failed', 'error');
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
    if (resume) { try { await syncProfile(resume, updated); } catch (_) {} }
    showToast('Preferences saved');
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Toast message={toast?.message ?? ''} type={toast?.type} visible={!!toast} onDismiss={hideToast} />
      <Text style={styles.pageTitle}>Profile</Text>

      {/* Account */}
      <Text style={styles.sectionLabel}>Account</Text>
      <View style={styles.group}>
        {isAuthenticated && session ? (
          <>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Signed in as</Text>
              <Text style={styles.rowValue} numberOfLines={1}>{session.email}</Text>
            </View>
            <View style={styles.sep} />
            <TouchableOpacity style={styles.row} onPress={() => Alert.alert('Sign Out', 'Your data stays on device.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign Out', style: 'destructive', onPress: () => signOut() },
            ])}>
              <Text style={[styles.rowLabel, { color: C.red }]}>Sign Out</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity 
            style={styles.row} 
            onPress={() => navigation.navigate('AuthGate', { returnTo: 'Profile' })}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Sign in to unlock profile features</Text>
              <Text style={[styles.rowValue, { textAlign: 'left', maxWidth: '100%', marginTop: 4 }]}>
                Track applications, sync preferences, and more
              </Text>
            </View>
            <Text style={{ fontSize: T.lg, color: C.accent }}>→</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Resume */}
      <Text style={styles.sectionLabel}>Resume</Text>
      <View style={styles.group}>
        {resume && (
          <>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>{resume.name || 'Resume'}</Text>
              <View style={styles.greenDot} />
            </View>
            {resume.skills.length > 0 && (
              <>
                <View style={styles.sep} />
                <View style={[styles.row, { flexWrap: 'wrap', gap: 6 }]}>
                  {resume.skills.slice(0, 4).map((s, i) => (
                    <View key={i} style={styles.chip}><Text style={styles.chipText}>{s}</Text></View>
                  ))}
                  {resume.skills.length > 4 && <Text style={styles.chipMore}>+{resume.skills.length - 4}</Text>}
                </View>
              </>
            )}
            <View style={styles.sep} />
          </>
        )}
        <TouchableOpacity style={styles.row} onPress={handleResumeUpload} disabled={loading}>
          <Text style={[styles.rowLabel, { color: C.accent }]}>
            {loading ? 'Parsing…' : resume ? 'Re-upload Resume' : 'Upload Resume'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Preferences */}
      <Text style={styles.sectionLabel}>Job Preferences</Text>
      <View style={styles.group}>
        <View style={styles.inputRow}>
          <Text style={styles.inputLabel}>Target Roles</Text>
          <TextInput style={styles.input} value={targetRoles} onChangeText={setTargetRoles}
            placeholder="e.g. Software Engineer, ML Engineer" placeholderTextColor={C.textDim} />
        </View>
        <View style={styles.sep} />
        <View style={styles.inputRow}>
          <Text style={styles.inputLabel}>Locations</Text>
          <TextInput style={styles.input} value={locations} onChangeText={setLocations}
            placeholder="e.g. Bangalore, Remote" placeholderTextColor={C.textDim} />
        </View>
      </View>

      {/* Threshold */}
      <Text style={styles.sectionLabel}>Auto-Apply Threshold</Text>
      <View style={styles.group}>
        <View style={[styles.row, { flexDirection: 'column', alignItems: 'flex-start', gap: S.md }]}>
          <Text style={styles.rowLabel}>
            Current: <Text style={{ color: C.accent }}>{prefs.auto_apply_threshold}%</Text>
          </Text>
          <View style={styles.thresholdRow}>
            {THRESHOLD_OPTIONS.map(val => (
              <TouchableOpacity
                key={val}
                style={[styles.thresholdChip, prefs.auto_apply_threshold === val && styles.thresholdChipOn]}
                onPress={() => setPrefs(p => ({ ...p, auto_apply_threshold: val }))}
              >
                <Text style={[styles.thresholdText, prefs.auto_apply_threshold === val && styles.thresholdTextOn]}>
                  {val}%
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <TouchableOpacity style={styles.saveBtn} onPress={handleSavePrefs}>
        <Text style={styles.saveBtnText}>Save Changes</Text>
      </TouchableOpacity>

      {/* Danger */}
      <Text style={styles.sectionLabel}>Danger Zone</Text>
      <View style={styles.group}>
        <TouchableOpacity style={styles.row} onPress={() => Alert.alert('Reset History', 'Clears all swiped jobs.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Reset', style: 'destructive', onPress: () => resetHistory() },
        ])}>
          <Text style={[styles.rowLabel, { color: C.red }]}>Reset Swipe History</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.footerText}>AntiGravity · v3.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content:   { paddingTop: 56, paddingHorizontal: S.xl, paddingBottom: 56 },
  pageTitle: { fontSize: T.xl, fontWeight: T.black_w, color: C.text, marginBottom: S.xl, letterSpacing: -0.3 },
  sectionLabel: { fontSize: T.xs, fontWeight: T.bold, color: C.textSub, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: S.sm, marginTop: S.xl },
  group:  { backgroundColor: C.surface2, borderRadius: R.lg, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  sep:    { height: 1, backgroundColor: C.borderSub, marginHorizontal: S.lg },
  row:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: S.lg, paddingVertical: S.md, gap: S.sm },
  rowLabel: { fontSize: T.base, color: C.text, fontWeight: T.medium, flex: 1 },
  rowValue: { fontSize: T.sm, color: C.textSub, maxWidth: '55%', textAlign: 'right' },
  greenDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.accent },
  chip:    { paddingHorizontal: S.sm, paddingVertical: 3, borderRadius: R.pill, backgroundColor: C.surface3 },
  chipText:{ fontSize: T.xs, color: C.textSub, fontWeight: T.medium },
  chipMore:{ fontSize: T.xs, color: C.textDim, alignSelf: 'center' },
  inputRow: { paddingHorizontal: S.lg, paddingVertical: S.md, gap: S.xs },
  inputLabel: { fontSize: T.xs, fontWeight: T.bold, color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.8 },
  input: { color: C.text, fontSize: T.base, paddingVertical: S.xs },
  thresholdRow: { flexDirection: 'row', gap: S.xs, flexWrap: 'wrap' },
  thresholdChip: { paddingHorizontal: S.md, paddingVertical: S.xs + 2, borderRadius: R.pill, backgroundColor: C.surface3, borderWidth: 1, borderColor: C.border },
  thresholdChipOn: { backgroundColor: C.accentDim, borderColor: C.accent },
  thresholdText: { fontSize: T.sm, color: C.textSub, fontWeight: T.semibold },
  thresholdTextOn: { color: C.accent },
  saveBtn: { marginTop: S.xl, paddingVertical: 15, borderRadius: R.pill, backgroundColor: C.accent, alignItems: 'center', ...SHADOW.subtle },
  saveBtnText: { color: C.black, fontSize: T.base, fontWeight: T.bold },
  footerText: { textAlign: 'center', fontSize: T.xs, color: C.textDim, marginTop: S.xxl, letterSpacing: 0.5 },
});

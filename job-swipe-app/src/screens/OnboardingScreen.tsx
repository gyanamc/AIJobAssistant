import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, Alert, ScrollView,
} from 'react-native';
import DocumentPicker from 'react-native-document-picker';
import { setItem, KEYS } from '../utils/storage';
import { parseResume } from '../api/resumeApi';
import { syncProfile } from '../api/profileApi';
import type { ResumeSummary, UserPreferences } from '../types';

type Step = 'welcome' | 'resume' | 'preferences';

export default function OnboardingScreen({ navigation }: any) {
  const [step, setStep] = useState<Step>('welcome');
  const [resumeSummary, setResumeSummary] = useState<ResumeSummary | null>(null);
  const [targetRoles, setTargetRoles] = useState('');
  const [locations, setLocations] = useState('');
  const [loading, setLoading] = useState(false);

  async function handlePickResume() {
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
      setResumeSummary(withTimestamp);
      Alert.alert('Resume uploaded', `Parsed as ${summary.name}`);
    } catch (err: any) {
      if (!DocumentPicker.isCancel(err)) {
        Alert.alert('Upload failed', err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleFinish() {
    const prefs: UserPreferences = {
      target_roles: targetRoles.split(',').map(s => s.trim()).filter(Boolean),
      preferred_locations: locations.split(',').map(s => s.trim()).filter(Boolean),
      auto_apply_threshold: 80,
      onboarding_complete: true,
    };
    await setItem(KEYS.PREFERENCES, prefs);

    if (resumeSummary) {
      try { await syncProfile(resumeSummary, prefs); } catch (_) {}
    }

    navigation.replace('Main');
  }

  if (step === 'welcome') {
    return (
      <View style={styles.container}>
        <View style={styles.centerContent}>
          <View style={styles.iconContainer}>
            <Text style={styles.emoji}>💼</Text>
          </View>
          <Text style={styles.title}>Job Swipe</Text>
          <Text style={styles.subtitle}>
            Swipe right to apply, left to skip.{`\n`}AI handles the cover letter.
          </Text>
        </View>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.btn} onPress={() => setStep('resume')}>
            <Text style={styles.btnText}>Get Started</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (step === 'resume') {
    return (
      <View style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.title}>Upload Resume</Text>
          <Text style={styles.subtitle}>We'll use it to match jobs and{`\n`}generate cover letters.</Text>
          
          <TouchableOpacity style={styles.btn} onPress={handlePickResume} disabled={loading}>
            <Text style={styles.btnText}>{loading ? 'Parsing...' : 'Pick PDF or .txt'}</Text>
          </TouchableOpacity>
          
          {resumeSummary && (
            <Text style={styles.success}>✓ {resumeSummary.name.toUpperCase()} — resume ready</Text>
          )}
          
          <TouchableOpacity
            style={styles.skipBtn}
            onPress={() => setStep(resumeSummary ? 'preferences' : 'preferences')}
          >
            <Text style={styles.skipText}>{resumeSummary ? 'Continue →' : 'Skip for now'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.containerScrollView}>
      <View style={styles.centerContentPref}>
        <Text style={styles.title}>Preferences</Text>
        <Text style={styles.subtitle}>Tell us what you're looking for so we can{`\n`}find your perfect match.</Text>
        
        <Text style={styles.label}>Target Roles (comma-separated)</Text>
        <TextInput
          style={styles.input}
          value={targetRoles}
          onChangeText={setTargetRoles}
          placeholder="e.g. Software Engineer, ML Engineer"
          placeholderTextColor="#64748b"
        />
        
        <Text style={styles.label}>Preferred Locations</Text>
        <TextInput
          style={styles.input}
          value={locations}
          onChangeText={setLocations}
          placeholder="e.g. Bangalore, Remote"
          placeholderTextColor="#64748b"
        />
      </View>
      
      <View style={styles.footer}>
        <TouchableOpacity style={styles.btn} onPress={handleFinish}>
          <Text style={styles.btnText}>Start Swiping</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', padding: 24, justifyContent: 'space-between' },
  containerScrollView: { flexGrow: 1, backgroundColor: '#0f172a', padding: 24, justifyContent: 'space-between' },
  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  centerContentPref: { flex: 1, justifyContent: 'center', alignItems: 'center', width: '100%' },
  iconContainer: { justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  emoji: { fontSize: 80 }, 
  title: { fontSize: 34, fontWeight: '900', color: '#f1f5f9', marginBottom: 12, textAlign: 'center', letterSpacing: -0.5 },
  subtitle: { fontSize: 17, color: '#94a3b8', textAlign: 'center', marginBottom: 32, lineHeight: 26 },
  footer: { marginBottom: 20, width: '100%' },
  btn: { backgroundColor: '#22c55e', paddingHorizontal: 32, paddingVertical: 18, borderRadius: 12, width: '100%', alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 18 },
  skipBtn: { marginTop: 24, paddingVertical: 10 },
  skipText: { color: '#64748b', fontSize: 16, fontWeight: '600' },
  success: { color: '#22c55e', marginTop: 16, fontSize: 14, fontWeight: '600', maxWidth: '100%', textAlign: 'center' },
  label: { color: '#94a3b8', fontSize: 14, alignSelf: 'flex-start', marginBottom: 8, marginTop: 16, fontWeight: '600' },
  input: { backgroundColor: '#1e293b', color: '#f1f5f9', borderRadius: 12, padding: 16, width: '100%', fontSize: 16, marginBottom: 8 },
});

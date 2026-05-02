import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, TextInput, Alert, Dimensions,
} from 'react-native';
import DocumentPicker from 'react-native-document-picker';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { 
  useSharedValue, useAnimatedStyle, runOnJS, withTiming, useAnimatedProps 
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

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

const { width } = Dimensions.get('window');
const SLIDER_WIDTH = width - S.xl * 2 - S.lg * 2 - 24; // screen width - padding

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function ProfileStrengthRing({ score }: { score: number }) {
  const progress = useSharedValue(0);
  const radius = 24;
  const circumference = 2 * Math.PI * radius;

  useEffect(() => {
    progress.value = withTiming(score / 100, { duration: 1500 });
  }, [score]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - progress.value)
  }));

  return (
    <View style={styles.ringContainer}>
      <Svg width={56} height={56}>
        <Circle cx={28} cy={28} r={radius} stroke={C.border} strokeWidth={4} fill="none" />
        <AnimatedCircle 
          cx={28} cy={28} r={radius} 
          stroke={C.accent} strokeWidth={4} fill="none" 
          strokeDasharray={circumference} 
          animatedProps={animatedProps} 
          strokeLinecap="round" 
          transform="rotate(-90 28 28)"
        />
      </Svg>
      <View style={styles.ringTextContainer}>
        <Text style={styles.ringText}>{score}%</Text>
      </View>
    </View>
  );
}

function CustomSlider({ value, onValueChange }: { value: number, onValueChange: (v: number) => void }) {
  // Value ranges from 50 to 100
  const min = 50;
  const max = 100;
  const range = max - min;
  
  const initialX = ((value - min) / range) * SLIDER_WIDTH;
  const translateX = useSharedValue(initialX);

  const pan = Gesture.Pan()
    .onChange((e) => {
      let newX = translateX.value + e.changeX;
      if (newX < 0) newX = 0;
      if (newX > SLIDER_WIDTH) newX = SLIDER_WIDTH;
      translateX.value = newX;
      
      const newValue = Math.round(min + (newX / SLIDER_WIDTH) * range);
      runOnJS(onValueChange)(newValue);
    });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }]
  }));
  
  const trackStyle = useAnimatedStyle(() => ({
    width: translateX.value + 12
  }));

  return (
    <View style={styles.sliderWrapper}>
      <View style={styles.sliderBgTrack} />
      <Animated.View style={[styles.sliderFillTrack, trackStyle]} />
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.sliderThumb, thumbStyle]} />
      </GestureDetector>
      
      <View style={styles.sliderLabels}>
        <Text style={styles.sliderLabelText}>50%</Text>
        <Text style={styles.sliderLabelText}>100%</Text>
      </View>
    </View>
  );
}

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

  // Determine a dummy score based on resume completeness
  const resumeScore = resume ? Math.min(100, 40 + (resume.skills?.length || 0) * 5 + (resume.experience_summary ? 20 : 0)) : 0;

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
            <View style={[styles.row, { paddingVertical: S.lg }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{resume.name || 'Resume'}</Text>
                <Text style={[styles.rowValue, { textAlign: 'left', marginTop: 4 }]}>Parsed successfully</Text>
              </View>
              <ProfileStrengthRing score={resumeScore} />
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

      {/* Threshold Slider */}
      <Text style={styles.sectionLabel}>Auto-Apply Threshold</Text>
      <View style={styles.group}>
        <View style={{ padding: S.lg }}>
          <Text style={styles.rowLabel}>
            Current: <Text style={{ color: C.accent, fontWeight: '800' }}>{prefs.auto_apply_threshold}%</Text>
          </Text>
          <Text style={{ fontSize: T.xs, color: C.textSub, marginTop: 4, marginBottom: S.xl }}>
            Only auto-apply to jobs that match your profile this well.
          </Text>
          <CustomSlider 
            value={prefs.auto_apply_threshold} 
            onValueChange={(v) => setPrefs(p => ({ ...p, auto_apply_threshold: v }))} 
          />
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

      <Text style={styles.footerText}>AntiGravity · Premium</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content:   { paddingTop: 56, paddingHorizontal: S.xl, paddingBottom: 56 },
  pageTitle: { fontSize: T.xl, fontWeight: '800', color: C.text, marginBottom: S.xl, letterSpacing: -0.3 },
  sectionLabel: { fontSize: T.xs, fontWeight: '700', color: C.textSub, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: S.sm, marginTop: S.xl },
  group:  { backgroundColor: C.surface2, borderRadius: R.lg, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  sep:    { height: 1, backgroundColor: C.borderSub, marginHorizontal: S.lg },
  row:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: S.lg, paddingVertical: S.md, gap: S.sm },
  rowLabel: { fontSize: T.base, color: C.text, fontWeight: '500', flex: 1 },
  rowValue: { fontSize: T.sm, color: C.textSub, maxWidth: '55%', textAlign: 'right' },
  
  // Ring
  ringContainer: { width: 56, height: 56, justifyContent: 'center', alignItems: 'center' },
  ringTextContainer: { position: 'absolute', justifyContent: 'center', alignItems: 'center' },
  ringText: { fontSize: T.xs, color: C.text, fontWeight: '800' },
  
  chip:    { paddingHorizontal: S.sm, paddingVertical: 3, borderRadius: R.pill, backgroundColor: C.surface3 },
  chipText:{ fontSize: T.xs, color: C.textSub, fontWeight: '500' },
  chipMore:{ fontSize: T.xs, color: C.textDim, alignSelf: 'center' },
  
  inputRow: { paddingHorizontal: S.lg, paddingVertical: S.md, gap: S.xs },
  inputLabel: { fontSize: T.xs, fontWeight: '700', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.8 },
  input: { color: C.text, fontSize: T.base, paddingVertical: S.xs },
  
  // Slider
  sliderWrapper: { position: 'relative', height: 40, justifyContent: 'center', marginHorizontal: 12 },
  sliderBgTrack: { position: 'absolute', height: 6, width: '100%', backgroundColor: C.surface3, borderRadius: 3 },
  sliderFillTrack: { position: 'absolute', height: 6, backgroundColor: C.accent, borderRadius: 3 },
  sliderThumb: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: C.white, ...SHADOW.card },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between', position: 'absolute', width: '100%', bottom: -20 },
  sliderLabelText: { fontSize: 10, color: C.textDim, fontWeight: '600' },
  
  saveBtn: { marginTop: S.xl, paddingVertical: 15, borderRadius: R.pill, backgroundColor: C.accent, alignItems: 'center', ...SHADOW.elevated },
  saveBtnText: { color: C.black, fontSize: T.base, fontWeight: '700' },
  footerText: { textAlign: 'center', fontSize: T.xs, color: C.textDim, marginTop: S.xxl, letterSpacing: 0.5 },
});

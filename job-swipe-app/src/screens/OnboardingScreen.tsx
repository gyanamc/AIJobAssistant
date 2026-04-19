import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, Alert, ScrollView, Dimensions, FlatList,
} from 'react-native';
import DocumentPicker from 'react-native-document-picker';
import { setItem, KEYS } from '../utils/storage';
import { parseResume } from '../api/resumeApi';
import { syncProfile } from '../api/profileApi';
import type { ResumeSummary, UserPreferences } from '../types';

type Step = 'welcome' | 'resume' | 'preferences';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const SPROUT_SLIDES = [
  { id: '1', title: 'Welcome to AntiGravity!', sub: 'Your AI Agent Job Search companion.\nBuilt to automate the heavy lifting of\nfinding your career.', emoji: '🚀' },
  { id: '2', title: 'Best Job Matches', sub: 'Receive AI-driven match scores explaining\nwhy a job suits you. AntiGravity can\nautomatically apply to the best fits.', emoji: '🎯' },
  { id: '3', title: 'You Are in Control', sub: 'Swipe right to apply, left to pass.\nIf the AI match score is low, we utilize a\nHuman-in-the-Loop review beforehand.', emoji: '⚖️' },
  { id: '4', title: 'Effortless Applying', sub: "When you swipe to apply, our AI agent\ninstantly prepares a highly tailored cover\nletter on your behalf.", emoji: '✍️' },
];

export default function OnboardingScreen({ navigation }: any) {
  const [step, setStep] = useState<Step>('welcome');
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  const [resumeSummary, setResumeSummary] = useState<ResumeSummary | null>(null);
  const [targetRoles, setTargetRoles] = useState('');
  const [locations, setLocations] = useState('');
  const [loading, setLoading] = useState(false);

  const handleScroll = (event: any) => {
    const xOffset = event.nativeEvent.contentOffset.x;
    const index = Math.round(xOffset / SCREEN_WIDTH);
    if (index !== currentIndex) {
      setCurrentIndex(index);
    }
  };

  const nextSlide = () => {
    if (currentIndex < SPROUT_SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1, animated: true });
    } else {
      setStep('resume');
    }
  };

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
      <View style={styles.sproutContainer}>
        {/* Top Header Pill */}
        <View style={styles.topHeader}>
          <TouchableOpacity style={styles.loginPill}>
            <Text style={styles.loginPillText}>Already have an account? Sign in</Text>
          </TouchableOpacity>
        </View>

        {/* Carousel */}
        <FlatList
          ref={flatListRef}
          data={SPROUT_SLIDES}
          keyExtractor={item => item.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          renderItem={({ item }) => (
            <View style={styles.slide}>
              <View style={styles.graphicPlaceholder}>
                <Text style={styles.graphicEmoji}>{item.emoji}</Text>
              </View>
              <Text style={styles.slideTitle}>{item.title}</Text>
              <Text style={styles.slideSubtitle}>{item.sub}</Text>
            </View>
          )}
        />

        {/* Bottom Section */}
        <View style={styles.bottomSection}>
          {/* Pagination Dots */}
          <View style={styles.pagination}>
            {SPROUT_SLIDES.map((_, i) => (
              <View
                key={i}
                style={[styles.dot, i === currentIndex ? styles.dotActive : styles.dotInactive]}
              />
            ))}
          </View>

          {/* Continue Button */}
          <TouchableOpacity style={styles.sproutBtn} onPress={nextSlide}>
            <Text style={styles.sproutBtnText}>Continue</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (step === 'resume') {
    return (
      <View style={styles.sproutContainer}>
        <View style={styles.centerContent}>
          <Text style={styles.slideTitle}>Upload Resume</Text>
          <Text style={styles.slideSubtitle}>We'll use it to match jobs and{`\n`}generate cover letters.</Text>
          
          <TouchableOpacity style={styles.sproutBtn} onPress={handlePickResume} disabled={loading}>
            <Text style={styles.sproutBtnText}>{loading ? 'Parsing...' : 'Pick PDF or .txt'}</Text>
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
        <Text style={styles.slideTitle}>Preferences</Text>
        <Text style={styles.slideSubtitle}>Tell us what you're looking for so we can{`\n`}find your perfect match.</Text>
        
        <Text style={styles.label}>Target Roles (comma-separated)</Text>
        <TextInput
          style={styles.input}
          value={targetRoles}
          onChangeText={setTargetRoles}
          placeholder="e.g. Software Engineer, ML Engineer"
          placeholderTextColor="#4b5563"
        />
        
        <Text style={styles.label}>Preferred Locations</Text>
        <TextInput
          style={styles.input}
          value={locations}
          onChangeText={setLocations}
          placeholder="e.g. Bangalore, Remote"
          placeholderTextColor="#4b5563"
        />
      </View>
      
      <View style={styles.bottomSection}>
        <TouchableOpacity style={styles.sproutBtn} onPress={handleFinish}>
          <Text style={styles.sproutBtnText}>Start Swiping</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  /* Brand Constants for Sprout */
  sproutContainer: { flex: 1, backgroundColor: '#0e1212', justifyContent: 'space-between' },
  containerScrollView: { flexGrow: 1, backgroundColor: '#0e1212', paddingHorizontal: 24, paddingVertical: 40, justifyContent: 'space-between' },
  
  /* Top Pill */
  topHeader: { paddingTop: 60, alignItems: 'center' },
  loginPill: { backgroundColor: '#1f2937', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 30 },
  loginPillText: { color: '#d1d5db', fontSize: 15, fontWeight: '600' },

  /* Carousels & Slides */
  slide: { width: SCREEN_WIDTH, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  graphicPlaceholder: { width: 200, height: 200, justifyContent: 'center', alignItems: 'center', marginBottom: 40 },
  graphicEmoji: { fontSize: 100, opacity: 0.9 }, // Using emojis to simulate the line art illustrations
  slideTitle: { fontSize: 26, fontWeight: '800', color: '#f9fafb', marginBottom: 16, textAlign: 'center' },
  slideSubtitle: { fontSize: 16, color: '#9ca3af', textAlign: 'center', lineHeight: 24, paddingHorizontal: 12 },

  /* Bottom Controls */
  bottomSection: { paddingHorizontal: 24, paddingBottom: 40, alignItems: 'center', width: '100%' },
  pagination: { flexDirection: 'row', gap: 10, marginBottom: 30 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotActive: { backgroundColor: '#7dd3a8', width: 10, height: 10, borderRadius: 5, marginTop: -1 },
  dotInactive: { backgroundColor: '#374151' },
  sproutBtn: { backgroundColor: '#7dd3a8', width: '100%', paddingVertical: 18, borderRadius: 30, alignItems: 'center' },
  sproutBtnText: { color: '#0e1212', fontWeight: '800', fontSize: 18 },

  /* Utilities (from previous views) */
  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  centerContentPref: { flex: 1, justifyContent: 'center', alignItems: 'center', width: '100%' },
  skipBtn: { marginTop: 24, paddingVertical: 10 },
  skipText: { color: '#9ca3af', fontSize: 16, fontWeight: '600' },
  success: { color: '#7dd3a8', marginTop: 16, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  label: { color: '#d1d5db', fontSize: 14, alignSelf: 'flex-start', marginBottom: 8, marginTop: 16, fontWeight: '600' },
  input: { backgroundColor: '#1f2937', color: '#f9fafb', borderRadius: 12, padding: 16, width: '100%', fontSize: 16, marginBottom: 8 },
});

import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, ScrollView, Dimensions, FlatList, Animated,
} from 'react-native';
import DocumentPicker from 'react-native-document-picker';
import { setItem, KEYS } from '../utils/storage';
import { parseResume } from '../api/resumeApi';
import { syncProfile } from '../api/profileApi';
import { useToast } from '../hooks/useToast';
import Toast from '../components/Toast';
import type { ResumeSummary, UserPreferences } from '../types';
import { C, T, R, S, SHADOW } from '../theme';

type Step = 'welcome' | 'resume' | 'preferences';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const SLIDES = [
  {
    id: '1',
    glyph: '✦',
    title: 'Welcome to AntiGravity',
    sub: 'Your AI-powered career companion.\nAutomating the heavy lifting of job search.',
  },
  {
    id: '2',
    glyph: '◎',
    title: 'AI Match Scores',
    sub: 'Every job gets an AI score explaining\nwhy it fits your profile.',
  },
  {
    id: '3',
    glyph: '⇄',
    title: 'You're in Control',
    sub: 'Swipe right to apply, left to pass.\nLow-confidence matches get your review first.',
  },
  {
    id: '4',
    glyph: '✍',
    title: 'Instant Cover Letters',
    sub: 'Swipe to apply and we generate a\ntailored cover letter in seconds.',
  },
];

export default function OnboardingScreen({ navigation }: any) {
  const [step, setStep] = useState<Step>('welcome');
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const { toast, showToast, hideToast } = useToast();
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const [resumeSummary, setResumeSummary] = useState<ResumeSummary | null>(null);
  const [targetRoles, setTargetRoles] = useState('');
  const [locations, setLocations] = useState('');
  const [loading, setLoading] = useState(false);

  const handleScroll = (event: any) => {
    const xOffset = event.nativeEvent.contentOffset.x;
    const index = Math.round(xOffset / SCREEN_WIDTH);
    if (index !== currentIndex) {
      setCurrentIndex(index);
      fadeAnim.setValue(0.4);
      Animated.timing(fadeAnim, { toValue: 1, duration: 320, useNativeDriver: true }).start();
    }
  };

  const nextSlide = () => {
    if (currentIndex < SLIDES.length - 1) {
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
      showToast(`Resume parsed — ${summary.name}`);
    } catch (err: any) {
      if (!DocumentPicker.isCancel(err)) showToast('Upload failed', 'error');
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

  // ── WELCOME SLIDES ────────────────────────────────────────────────────────────
  if (step === 'welcome') {
    return (
      <View style={styles.screen}>
        <Toast message={toast?.message ?? ''} type={toast?.type} visible={!!toast} onDismiss={hideToast} />

        {/* Top pill */}
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.signinPill}>
            <Text style={styles.signinPillText}>Already have an account?  Sign in →</Text>
          </TouchableOpacity>
        </View>

        {/* Carousel */}
        <FlatList
          ref={flatListRef}
          data={SLIDES}
          keyExtractor={item => item.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          renderItem={({ item }) => (
            <View style={styles.slide}>
              <Animated.View style={{ opacity: fadeAnim, alignItems: 'center' }}>
                <View style={styles.glyphContainer}>
                  <Text style={styles.glyph}>{item.glyph}</Text>
                </View>
                <Text style={styles.slideTitle}>{item.title}</Text>
                <Text style={styles.slideSub}>{item.sub}</Text>
              </Animated.View>
            </View>
          )}
        />

        {/* Bottom controls */}
        <View style={styles.bottomBar}>
          {/* Dots */}
          <View style={styles.dots}>
            {SLIDES.map((_, i) => (
              <View
                key={i}
                style={[styles.dot, i === currentIndex ? styles.dotActive : styles.dotInactive]}
              />
            ))}
          </View>
          <TouchableOpacity style={styles.ctaBtn} onPress={nextSlide}>
            <Text style={styles.ctaBtnText}>
              {currentIndex === SLIDES.length - 1 ? 'Get Started' : 'Continue'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── RESUME STEP ───────────────────────────────────────────────────────────────
  if (step === 'resume') {
    return (
      <View style={styles.screen}>
        <Toast message={toast?.message ?? ''} type={toast?.type} visible={!!toast} onDismiss={hideToast} />
        <View style={styles.stepContent}>
          {/* Step label */}
          <Text style={styles.stepLabel}>Step 1 of 2</Text>
          <Text style={styles.stepTitle}>Upload Resume</Text>
          <Text style={styles.stepSub}>
            We'll match jobs and generate cover letters based on your experience.
          </Text>

          {/* Upload card */}
          <TouchableOpacity
            style={[styles.uploadCard, resumeSummary && styles.uploadCardDone]}
            onPress={handlePickResume}
            disabled={loading}
          >
            <Text style={styles.uploadIcon}>{resumeSummary ? '✓' : '↑'}</Text>
            <Text style={styles.uploadCardTitle}>
              {loading ? 'Parsing…' : resumeSummary ? resumeSummary.name || 'Resume ready' : 'Pick PDF or .txt file'}
            </Text>
            {!resumeSummary && (
              <Text style={styles.uploadCardSub}>PDF · TXT up to 5 MB</Text>
            )}
          </TouchableOpacity>

          {/* Skills preview */}
          {resumeSummary?.skills && resumeSummary.skills.length > 0 && (
            <View style={styles.skillsRow}>
              {resumeSummary.skills.slice(0, 5).map((s, i) => (
                <View key={i} style={styles.skillChip}>
                  <Text style={styles.skillChipText}>{s}</Text>
                </View>
              ))}
              {resumeSummary.skills.length > 5 && (
                <Text style={styles.skillsMore}>+{resumeSummary.skills.length - 5} more</Text>
              )}
            </View>
          )}
        </View>

        {/* Bottom */}
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={styles.ctaBtn}
            onPress={() => setStep('preferences')}
          >
            <Text style={styles.ctaBtnText}>{resumeSummary ? 'Continue' : 'Skip for now'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── PREFERENCES STEP ──────────────────────────────────────────────────────────
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={styles.prefScroll}
      keyboardShouldPersistTaps="handled"
    >
      <Toast message={toast?.message ?? ''} type={toast?.type} visible={!!toast} onDismiss={hideToast} />
      <Text style={styles.stepLabel}>Step 2 of 2</Text>
      <Text style={styles.stepTitle}>Your Preferences</Text>
      <Text style={styles.stepSub}>Tell us what you're looking for so we can find the best matches.</Text>

      <Text style={styles.inputLabel}>Target Roles</Text>
      <TextInput
        style={styles.input}
        value={targetRoles}
        onChangeText={setTargetRoles}
        placeholder="e.g. Software Engineer, ML Engineer"
        placeholderTextColor={C.textDim}
      />
      <Text style={styles.inputHint}>Separate multiple roles with commas</Text>

      <Text style={[styles.inputLabel, { marginTop: S.xl }]}>Preferred Locations</Text>
      <TextInput
        style={styles.input}
        value={locations}
        onChangeText={setLocations}
        placeholder="e.g. Bangalore, Remote"
        placeholderTextColor={C.textDim}
      />
      <Text style={styles.inputHint}>Separate with commas · Leave blank for all locations</Text>

      <TouchableOpacity style={[styles.ctaBtn, { marginTop: S.xxl }]} onPress={handleFinish}>
        <Text style={styles.ctaBtnText}>Start Swiping</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.bg,
    justifyContent: 'space-between',
  },

  // Top pill
  topBar: {
    paddingTop: 56,
    alignItems: 'center',
  },
  signinPill: {
    backgroundColor: C.surface2,
    paddingHorizontal: S.xl,
    paddingVertical: S.sm + 2,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.border,
  },
  signinPillText: {
    color: C.textSub,
    fontSize: T.sm,
    fontWeight: T.medium,
  },

  // Slide
  slide: {
    width: SCREEN_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: S.xxl + 4,
  },
  glyphContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: C.accentDim,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: S.xl,
    borderWidth: 1,
    borderColor: 'rgba(0,200,150,0.2)',
  },
  glyph: {
    fontSize: 32,
    color: C.accent,
  },
  slideTitle: {
    fontSize: T.xl,
    fontWeight: T.bold,
    color: C.text,
    textAlign: 'center',
    marginBottom: S.md,
    letterSpacing: -0.3,
  },
  slideSub: {
    fontSize: T.base,
    color: C.textSub,
    textAlign: 'center',
    lineHeight: T.loose,
  },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: S.xl,
    paddingBottom: 44,
    alignItems: 'center',
    gap: S.xl,
  },
  dots: {
    flexDirection: 'row',
    gap: S.xs + 2,
  },
  dot: {
    height: 5,
    borderRadius: R.pill,
  },
  dotActive: {
    width: 20,
    backgroundColor: C.accent,
  },
  dotInactive: {
    width: 5,
    backgroundColor: C.surface3,
  },
  ctaBtn: {
    backgroundColor: C.accent,
    width: '100%',
    paddingVertical: 16,
    borderRadius: R.pill,
    alignItems: 'center',
    ...SHADOW.subtle,
  },
  ctaBtnText: {
    color: C.black,
    fontWeight: T.bold,
    fontSize: T.base,
    letterSpacing: 0.2,
  },

  // Steps
  stepContent: {
    flex: 1,
    paddingHorizontal: S.xl,
    paddingTop: 72,
  },
  prefScroll: {
    paddingHorizontal: S.xl,
    paddingTop: 72,
    paddingBottom: 56,
  },
  stepLabel: {
    fontSize: T.xs,
    fontWeight: T.bold,
    color: C.accent,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: S.sm,
  },
  stepTitle: {
    fontSize: T.xxl,
    fontWeight: T.black_w,
    color: C.text,
    marginBottom: S.sm,
    letterSpacing: -0.5,
  },
  stepSub: {
    fontSize: T.base,
    color: C.textSub,
    lineHeight: T.loose,
    marginBottom: S.xxl,
  },

  // Upload card
  uploadCard: {
    borderWidth: 1.5,
    borderColor: C.border,
    borderStyle: 'dashed',
    borderRadius: R.lg,
    padding: S.xl,
    alignItems: 'center',
    gap: S.sm,
    backgroundColor: C.surface,
    marginBottom: S.lg,
  },
  uploadCardDone: {
    borderColor: C.accent,
    borderStyle: 'solid',
    backgroundColor: C.accentDim,
  },
  uploadIcon: {
    fontSize: 28,
    color: C.textSub,
  },
  uploadCardTitle: {
    fontSize: T.base,
    fontWeight: T.semibold,
    color: C.text,
    textAlign: 'center',
  },
  uploadCardSub: {
    fontSize: T.xs,
    color: C.textDim,
  },

  // Skills preview
  skillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: S.xs,
  },
  skillChip: {
    paddingHorizontal: S.sm,
    paddingVertical: 4,
    borderRadius: R.pill,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
  },
  skillChipText: {
    fontSize: T.xs,
    color: C.textSub,
    fontWeight: T.medium,
  },
  skillsMore: {
    fontSize: T.xs,
    color: C.textDim,
    alignSelf: 'center',
  },

  // Inputs
  inputLabel: {
    fontSize: T.xs,
    fontWeight: T.bold,
    color: C.textSub,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: S.sm,
  },
  input: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    color: C.text,
    borderRadius: R.md,
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    fontSize: T.base,
  },
  inputHint: {
    fontSize: T.xs,
    color: C.textDim,
    marginTop: S.xs,
  },
});

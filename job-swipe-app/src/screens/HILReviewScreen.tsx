import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput,
  TouchableOpacity, ScrollView, Linking, Clipboard,
} from 'react-native';
import { generateCoverLetter, classifyApplyUrl } from '../api/jobsApi';
import { useApplicationStore } from '../store/useApplicationStore';
import { useJobStore } from '../store/useJobStore';
import { getItem, KEYS } from '../utils/storage';
import { useToast } from '../hooks/useToast';
import Toast from '../components/Toast';
import MatchScoreBadge from '../components/MatchScoreBadge';
import LoadingOverlay from '../components/LoadingOverlay';
import type { ResumeSummary, DraftApplication } from '../types';
import { C, T, R, S, SHADOW } from '../theme';

// Pure JS UUID — no native crypto dependency needed
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

const TIMEOUT_MS = 30_000;

export default function HILReviewScreen({ route, navigation }: any) {
  const { job, autoApply } = route.params;
  
  // Debug logging
  console.log('HILReviewScreen - job:', JSON.stringify(job, null, 2));
  console.log('HILReviewScreen - autoApply:', autoApply);
  console.log('HILReviewScreen - match_score:', job.match_score);
  
  const { saveDraft } = useApplicationStore();
  const { markAutoApplied } = useJobStore();
  const { toast, showToast, hideToast } = useToast();

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
    } catch {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setTimedOut(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm(status: 'draft' | 'auto-applied' = 'draft') {
    try {
      const draft: DraftApplication = {
        id: generateId(),
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
      showToast(status === 'auto-applied' ? 'Auto-applied!' : 'Draft saved');
      navigation.navigate('Main');
    } catch {
      showToast('Failed to save. Try again.', 'error');
    }
  }

  async function handleApplyNow() {
    if (!job.apply_url) {
      showToast('No apply link available for this job', 'error');
      return;
    }

    // Save draft first (non-blocking)
    try {
      const draft: DraftApplication = {
        id: generateId(),
        job_id: job.id,
        job_title: job.title,
        company: job.company,
        apply_url: job.apply_url,
        cover_letter: coverLetter,
        status: 'draft',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await saveDraft(draft);
    } catch { /* non-blocking */ }

    // Classify the apply URL to choose the right strategy
    try {
      const classification = await classifyApplyUrl(job.apply_url);

      if (classification.strategy === 'webview_autofill' && classification.platform) {
        // Option 1: Open in-app WebView with auto-fill
        navigation.navigate('ApplyWebView', {
          applyUrl: job.apply_url,
          platform: classification.platform,
          coverLetter,
          jobTitle: job.title,
          company: job.company,
        });
      } else {
        // Option 2 fallback: Copy cover letter + open in browser
        if (coverLetter) Clipboard.setString(coverLetter);
        const atsName = classification.ats_name ? ` (${classification.ats_name})` : '';
        showToast(`Cover letter copied! Opening${atsName} 📋`);
        setTimeout(() => Linking.openURL(job.apply_url), 800);
      }
    } catch {
      // Network error — fall back to Option 2
      if (coverLetter) Clipboard.setString(coverLetter);
      showToast('Cover letter copied! Paste it in the form 📋');
      setTimeout(() => Linking.openURL(job.apply_url), 800);
    }
  }

  if (timedOut && !coverLetter) {
    return (
      <View style={styles.container}>
        <Toast message={toast?.message ?? ''} type={toast?.type} visible={!!toast} onDismiss={hideToast} />
        <View style={styles.handle} />
        <View style={styles.timedOutContent}>
          <Text style={styles.timedOutLabel}>Generation timed out</Text>
          <Text style={styles.timedOutSub}>Write your cover letter manually or skip.</Text>
          <TextInput
            style={styles.editor}
            multiline
            value={coverLetter}
            onChangeText={setCoverLetter}
            placeholder="Write your cover letter here…"
            placeholderTextColor={C.textDim}
          />
        </View>
        <View style={styles.actionBar}>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => navigation.navigate('Main')}>
            <Text style={styles.secondaryBtnText}>Skip</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => handleConfirm('draft')}>
            <Text style={styles.primaryBtnText}>Save Draft</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Toast message={toast?.message ?? ''} type={toast?.type} visible={!!toast} onDismiss={hideToast} />
      <LoadingOverlay visible={loading} message="Generating cover letter…" />

      {/* Handle */}
      <View style={styles.handle} />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Job info card */}
        <View style={styles.jobCard}>
          <View style={styles.jobCardTop}>
            <Text style={styles.jobCompany} numberOfLines={1}>{job.company}</Text>
            <MatchScoreBadge score={job.match_score} scoreType={job.score_type} />
          </View>
          <Text style={styles.jobTitle} numberOfLines={2}>{job.title}</Text>
          {autoApply && (
            <View style={styles.autoPill}>
              <Text style={styles.autoPillText}>⚡ AUTO-APPLY eligible</Text>
            </View>
          )}
        </View>

        {/* Cover letter editor */}
        <Text style={styles.sectionLabel}>Cover Letter</Text>
        <TextInput
          style={styles.editor}
          multiline
          value={coverLetter}
          onChangeText={setCoverLetter}
          placeholder="Cover letter will appear here…"
          placeholderTextColor={C.textDim}
        />
        <Text style={styles.editorHint}>You can edit before saving</Text>
      </ScrollView>

      {/* Action bar */}
      <View style={styles.actionBar}>
        {/* Primary CTA: Apply Now — copies cover letter + opens job URL */}
        <TouchableOpacity
          style={styles.applyNowBtn}
          onPress={handleApplyNow}
          disabled={loading}
        >
          <Text style={styles.applyNowBtnText}>🚀 Apply Now</Text>
        </TouchableOpacity>

        {autoApply && (
          <TouchableOpacity
            style={styles.autoApplyBtn}
            onPress={() => handleConfirm('auto-applied')}
          >
            <Text style={styles.autoApplyBtnText}>⚡ Mark as Applied</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => handleConfirm('draft')}
        >
          <Text style={styles.primaryBtnText}>Save Draft</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => navigation.navigate('Main')}
        >
          <Text style={styles.secondaryBtnText}>Skip</Text>
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

  // Job card
  jobCard: {
    backgroundColor: C.surface2,
    borderRadius: R.lg,
    padding: S.lg,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: S.xl,
    gap: S.xs,
    ...SHADOW.subtle,
  },
  jobCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  jobCompany: {
    fontSize: T.xs + 1,
    fontWeight: T.medium,
    color: C.textSub,
    flex: 1,
    marginRight: S.sm,
    letterSpacing: 0.3,
  },
  jobTitle: {
    fontSize: T.lg,
    fontWeight: T.semibold,
    color: C.text,
    lineHeight: T.lg * 1.35,
    marginTop: S.xs,
  },
  autoPill: {
    alignSelf: 'flex-start',
    marginTop: S.sm,
    paddingHorizontal: S.sm,
    paddingVertical: 3,
    borderRadius: R.pill,
    backgroundColor: 'rgba(124,58,237,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.3)',
  },
  autoPillText: {
    fontSize: T.xs,
    fontWeight: T.bold,
    color: '#A78BFA',
    letterSpacing: 0.3,
  },

  // Editor
  sectionLabel: {
    fontSize: T.xs,
    fontWeight: T.bold,
    color: C.textSub,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: S.sm,
  },
  editor: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    color: C.text,
    borderRadius: R.md,
    padding: S.lg,
    fontSize: T.base,
    lineHeight: T.loose,
    minHeight: 260,
    textAlignVertical: 'top',
  },
  editorHint: {
    fontSize: T.xs,
    color: C.textDim,
    marginTop: S.xs,
  },

  // Action bar
  actionBar: {
    gap: S.sm,
    padding: S.xl,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: C.borderSub,
  },
  applyNowBtn: {
    paddingVertical: 14,
    borderRadius: R.pill,
    backgroundColor: C.accent,
    alignItems: 'center',
    ...SHADOW.subtle,
  },
  applyNowBtnText: {
    color: C.black,
    fontSize: T.base,
    fontWeight: T.bold,
    letterSpacing: 0.3,
  },
  autoApplyBtn: {
    paddingVertical: 14,
    borderRadius: R.pill,
    backgroundColor: 'rgba(124,58,237,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.4)',
    alignItems: 'center',
  },
  autoApplyBtnText: {
    color: '#A78BFA',
    fontSize: T.base,
    fontWeight: T.bold,
  },
  primaryBtn: {
    paddingVertical: 14,
    borderRadius: R.pill,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: C.black,
    fontSize: T.base,
    fontWeight: T.bold,
  },
  secondaryBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: C.textSub,
    fontSize: T.base,
    fontWeight: T.medium,
  },

  // Timed out
  timedOutContent: {
    flex: 1,
    paddingHorizontal: S.xl,
    gap: S.md,
  },
  timedOutLabel: {
    fontSize: T.lg,
    fontWeight: T.semibold,
    color: C.text,
  },
  timedOutSub: {
    fontSize: T.base,
    color: C.textSub,
    lineHeight: T.loose,
  },
});

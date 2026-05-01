/**
 * useApplicationFlow — encapsulates the score-based routing logic.
 *
 * After auth check:
 *   score >= threshold  → navigate to HILReview with autoApply=true  (AUTO-APPLY option shown)
 *   score <  threshold  → navigate to HILReview with autoApply=false (HIL only)
 *
 * On AUTO-APPLY failure the HILReviewScreen falls back to HIL automatically.
 * The swipe record status is updated to 'auto-applied' by the store when confirmed.
 */

import { getItem, KEYS } from '../utils/storage';
import type { JobCard, UserPreferences } from '../types';
import { useJobStore } from './useJobStore';

export function useApplicationFlow(navigation: any) {
  const { swipeRight, markAutoApplied } = useJobStore();

  async function handleApply(job: JobCard) {
    const prefs = await getItem<UserPreferences>(KEYS.PREFERENCES);
    const threshold = prefs?.auto_apply_threshold ?? 80;
    const score = job.match_score ?? 0;

    // Debug logging
    console.log('useApplicationFlow - job:', JSON.stringify(job, null, 2));
    console.log('useApplicationFlow - threshold:', threshold);
    console.log('useApplicationFlow - score:', score);
    console.log('useApplicationFlow - score_type:', job.score_type);
    console.log('useApplicationFlow - autoApply will be:', score >= threshold);

    // Record swipe
    swipeRight(job);

    // Auto-apply only valid for real vector similarity scores — not text/random fallbacks
    const autoApply = job.score_type === 'vector' && score >= threshold;
    navigation.navigate('HILReview', { job, autoApply });
  }

  return { handleApply };
}

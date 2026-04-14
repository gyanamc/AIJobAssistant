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

    // Record swipe
    swipeRight(job);

    // Route based on score vs threshold
    const autoApply = score >= threshold;
    navigation.navigate('HILReview', { job, autoApply });
  }

  return { handleApply };
}

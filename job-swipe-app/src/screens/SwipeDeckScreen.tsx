import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useJobStore } from '../store/useJobStore';
import { useAuthStore } from '../store/useAuthStore';
import { useApplicationFlow } from '../store/useApplicationFlow';
import SwipeDeck from '../components/SwipeDeck';
import JobCard from '../components/JobCard';
import OfflineBanner from '../components/OfflineBanner';
import LoadingOverlay from '../components/LoadingOverlay';
import type { JobCard as JobCardType } from '../types';
import { C, T, R, S, SHADOW } from '../theme';

export default function SwipeDeckScreen({ navigation }: any) {
  const { deck, isLoading, isOffline, error, fetchFeed, swipeLeft } = useJobStore();
  const { isAuthenticated } = useAuthStore();
  const { handleApply } = useApplicationFlow(navigation);

  useEffect(() => {
    if (deck.length === 0) fetchFeed();
  }, []);

  async function handleSwipeRight(index: number) {
    const job = deck[index];
    if (!job) return;
    if (!isAuthenticated) {
      navigation.navigate('Auth', { pendingJob: job });
      return;
    }
    await handleApply(job);
  }

  function handleSwipeLeft(index: number) {
    const job = deck[index];
    if (job) swipeLeft(job);
  }

  const topJob: JobCardType | undefined = deck[0];

  if (deck.length === 0 && !isLoading) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>✦</Text>
        <Text style={styles.emptyTitle}>
          {error ? 'Something went wrong' : 'All caught up'}
        </Text>
        <Text style={styles.emptyBody}>
          {error ? error : 'No more jobs right now. Check back soon.'}
        </Text>
        <TouchableOpacity style={styles.refreshBtn} onPress={fetchFeed}>
          <Text style={styles.refreshText}>Refresh Feed</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <OfflineBanner visible={isOffline} />
      <LoadingOverlay visible={isLoading && deck.length === 0} message="Finding jobs for you…" />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Text style={styles.brandName}>AntiGravity</Text>
          <Text style={styles.brandTag}>Jobs</Text>
        </View>
        {deck.length > 0 && (
          <View style={styles.deckPill}>
            <Text style={styles.deckPillText}>{deck.length}</Text>
          </View>
        )}
      </View>

      {/* Swipe deck */}
      <SwipeDeck
        cards={deck}
        renderCard={(job: JobCardType) => (
          <JobCard
            job={job}
            onTap={j => navigation.navigate('JobDetail', { job: j })}
          />
        )}
        onSwipedRight={handleSwipeRight}
        onSwipedLeft={handleSwipeLeft}
        disabled={isOffline}
      />

      {/* Action buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.skipBtn]}
          onPress={() => topJob && handleSwipeLeft(0)}
          disabled={!topJob}
        >
          <Text style={styles.skipIcon}>✕</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, styles.applyBtn, (!topJob || isOffline) && styles.disabledBtn]}
          onPress={() => topJob && !isOffline && handleSwipeRight(0)}
          disabled={!topJob || isOffline}
        >
          <Text style={styles.applyIcon}>✓</Text>
        </TouchableOpacity>
      </View>

      {/* Hint */}
      <Text style={styles.hint}>← skip · apply →</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    paddingTop: 56,
    paddingHorizontal: S.xl,
    paddingBottom: S.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: S.sm,
  },
  brandName: {
    fontSize: T.lg,
    fontWeight: T.black_w,
    color: C.accent,
    letterSpacing: -0.3,
  },
  brandTag: {
    fontSize: T.xs,
    fontWeight: T.bold,
    color: C.textSub,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  deckPill: {
    backgroundColor: C.surface2,
    paddingHorizontal: S.sm,
    paddingVertical: 3,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.border,
  },
  deckPillText: {
    fontSize: T.xs,
    color: C.textSub,
    fontWeight: T.bold,
  },

  // Action buttons
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 36,
    paddingTop: S.lg,
    paddingBottom: S.xl,
  },
  actionBtn: {
    width: 58,
    height: 58,
    borderRadius: 29,
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOW.card,
  },
  skipBtn: {
    backgroundColor: C.surface2,
    borderWidth: 1.5,
    borderColor: C.red,
  },
  applyBtn: {
    backgroundColor: C.accent,
  },
  disabledBtn: {
    opacity: 0.35,
  },
  skipIcon: {
    fontSize: 18,
    color: C.red,
    fontWeight: T.bold,
  },
  applyIcon: {
    fontSize: 20,
    color: C.black,
    fontWeight: T.bold,
  },

  // Hint
  hint: {
    textAlign: 'center',
    fontSize: T.xs,
    color: C.textDim,
    letterSpacing: 0.5,
    paddingBottom: S.lg,
  },

  // Empty state
  empty: {
    flex: 1,
    backgroundColor: C.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: S.xxxl,
    gap: S.md,
  },
  emptyIcon: {
    fontSize: 32,
    color: C.accent,
    marginBottom: S.sm,
  },
  emptyTitle: {
    fontSize: T.lg,
    fontWeight: T.semibold,
    color: C.text,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: T.base,
    color: C.textSub,
    textAlign: 'center',
    lineHeight: T.loose,
  },
  refreshBtn: {
    marginTop: S.lg,
    paddingHorizontal: S.xl,
    paddingVertical: S.md,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.accent,
  },
  refreshText: {
    color: C.accent,
    fontSize: T.base,
    fontWeight: T.semibold,
  },
});

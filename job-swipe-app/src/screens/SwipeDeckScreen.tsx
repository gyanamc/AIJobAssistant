import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { X, Check, Sparkles } from 'lucide-react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, withSequence, Easing } from 'react-native-reanimated';

import { useJobStore } from '../store/useJobStore';
import { useAuthStore } from '../store/useAuthStore';
import { useApplicationFlow } from '../store/useApplicationFlow';
import SwipeDeck from '../components/SwipeDeck';
import JobCard from '../components/JobCard';
import OfflineBanner from '../components/OfflineBanner';
import LoadingOverlay from '../components/LoadingOverlay';
import type { JobCard as JobCardType } from '../types';
import { C, T, R, S, SHADOW } from '../theme';

const hapticOptions = { enableVibrateFallback: true, ignoreAndroidSystemSettings: false };

function EmptyStateAnimatedIcon() {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.15, { duration: 1500, easing: Easing.inOut(Easing.ease) }), 
        withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1500 }), 
        withTiming(0.5, { duration: 1500 })
      ),
      -1,
      true
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: scale.value }],
      opacity: opacity.value,
    };
  });

  return (
    <Animated.View style={[styles.emptyIconContainer, animatedStyle]}>
      <Sparkles size={48} color={C.accent} />
    </Animated.View>
  );
}

export default function SwipeDeckScreen({ navigation }: any) {
  const { deck, isLoading, isOffline, error, fetchFeed, swipeLeft } = useJobStore();
  const { isAuthenticated } = useAuthStore();
  const { handleApply } = useApplicationFlow(navigation);

  useEffect(() => {
    if (deck.length === 0) fetchFeed();
  }, []);

  async function handleSwipeRight(index: number) {
    ReactNativeHapticFeedback.trigger('impactHeavy', hapticOptions);
    const job = deck[index];
    if (!job) return;
    if (!isAuthenticated) {
      navigation.navigate('AuthGate', { pendingJob: job });
      return;
    }
    await handleApply(job);
  }

  function handleSwipeLeft(index: number) {
    ReactNativeHapticFeedback.trigger('impactLight', hapticOptions);
    const job = deck[index];
    if (job) swipeLeft(job);
  }

  const topJob: JobCardType | undefined = deck[0];

  if (deck.length === 0 && !isLoading) {
    return (
      <View style={styles.empty}>
        <EmptyStateAnimatedIcon />
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
          activeOpacity={0.7}
        >
          <X size={28} color={C.red} strokeWidth={3} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, styles.applyBtn, (!topJob || isOffline) && styles.disabledBtn]}
          onPress={() => topJob && !isOffline && handleSwipeRight(0)}
          disabled={!topJob || isOffline}
          activeOpacity={0.7}
        >
          <Check size={32} color={C.black} strokeWidth={3} />
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
    fontWeight: '800',
    color: C.accent,
    letterSpacing: -0.3,
  },
  brandTag: {
    fontSize: T.xs,
    fontWeight: '700',
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
    fontWeight: '700',
  },

  // Action buttons
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 40,
    paddingTop: S.lg,
    paddingBottom: S.xl,
  },
  actionBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOW.elevated,
  },
  skipBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.surface2,
    borderWidth: 1.5,
    borderColor: C.red,
  },
  applyBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.accent,
    shadowColor: C.accent,
    shadowOpacity: 0.4,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  disabledBtn: {
    opacity: 0.35,
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
  emptyIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(0, 200, 150, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: S.lg,
    borderWidth: 1,
    borderColor: 'rgba(0, 200, 150, 0.2)',
  },
  emptyTitle: {
    fontSize: T.lg,
    fontWeight: '600',
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
    backgroundColor: 'rgba(0, 200, 150, 0.1)',
  },
  refreshText: {
    color: C.accent,
    fontSize: T.base,
    fontWeight: '600',
  },
});

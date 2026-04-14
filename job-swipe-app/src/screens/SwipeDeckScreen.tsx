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

  if (deck.length === 0 && !isLoading) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {error ? `⚠️ ${error}` : '🎉 No more jobs right now'}
        </Text>
        <TouchableOpacity style={styles.refreshBtn} onPress={fetchFeed}>
          <Text style={styles.refreshText}>Refresh</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const topJob: JobCardType | undefined = deck[0];

  return (
    <View style={styles.container}>
      <OfflineBanner visible={isOffline} />
      <LoadingOverlay visible={isLoading && deck.length === 0} message="Loading jobs…" />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Job Swipe</Text>
        <Text style={styles.deckCount}>{deck.length} jobs</Text>
      </View>

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

      {/* Tap buttons */}
      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.skipBtn]}
          onPress={() => topJob && handleSwipeLeft(0)}
        >
          <Text style={styles.skipIcon}>✗</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.applyBtn]}
          onPress={() => topJob && !isOffline && handleSwipeRight(0)}
          disabled={isOffline}
        >
          <Text style={styles.applyIcon}>✓</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { paddingTop: 56, paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#f1f5f9' },
  deckCount: { fontSize: 13, color: '#64748b' },
  empty: { flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyText: { color: '#94a3b8', fontSize: 16, textAlign: 'center', marginBottom: 24 },
  refreshBtn: { backgroundColor: '#22c55e', paddingHorizontal: 28, paddingVertical: 12, borderRadius: 10 },
  refreshText: { color: '#fff', fontWeight: '700' },
  buttons: { flexDirection: 'row', justifyContent: 'center', gap: 40, paddingBottom: 40, paddingTop: 16 },
  actionBtn: { width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 4 },
  skipBtn: { backgroundColor: '#1e293b', borderWidth: 2, borderColor: '#ef4444' },
  applyBtn: { backgroundColor: '#22c55e' },
  skipIcon: { fontSize: 24, color: '#ef4444' },
  applyIcon: { fontSize: 24, color: '#fff' },
});

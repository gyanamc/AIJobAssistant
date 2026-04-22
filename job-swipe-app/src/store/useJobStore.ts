import { create } from 'zustand';
import NetInfo from '@react-native-community/netinfo';
import { getItem, setItem, KEYS } from '../utils/storage';
import { fetchJobFeed } from '../api/jobsApi';
import type { JobCard, SwipeRecord, CachedJobBatch } from '../types';

interface JobStore {
  deck: JobCard[];
  swipeHistory: SwipeRecord[];
  isLoading: boolean;
  isOffline: boolean;
  error: string | null;
  fetchFeed: () => Promise<void>;
  swipeRight: (job: JobCard) => void;
  swipeLeft: (job: JobCard) => void;
  markAutoApplied: (jobId: string) => void;
  resetHistory: () => Promise<void>;
  loadCache: () => Promise<void>;
  setOffline: (offline: boolean) => void;
}

export const useJobStore = create<JobStore>((set, get) => ({
  deck: [],
  swipeHistory: [],
  isLoading: false,
  isOffline: false,
  error: null,

  loadCache: async () => {
    const [cached, history] = await Promise.all([
      getItem<CachedJobBatch>(KEYS.CACHED_JOBS),
      getItem<SwipeRecord[]>(KEYS.SWIPE_HISTORY),
    ]);
    const historyIds = new Set((history ?? []).map(r => r.job_id));
    const cachedJobs = (cached?.jobs ?? []).filter(j => !historyIds.has(j.id));
    set({ deck: cachedJobs, swipeHistory: history ?? [] });
  },

  fetchFeed: async () => {
    const { swipeHistory, isLoading } = get();
    if (isLoading) return;
    set({ isLoading: true, error: null });
    try {
      const resumeSummary = await getItem<{
        experience_summary: string;
        skills: string[];
        target_roles: string[];
      }>(KEYS.RESUME_SUMMARY);

      // Build a rich query string from all resume fields for better matching
      const parts = [
        resumeSummary?.experience_summary ?? '',
        (resumeSummary?.target_roles ?? []).join(', '),
        (resumeSummary?.skills ?? []).slice(0, 20).join(', '),
      ].filter(Boolean);
      const summary = parts.join('. ') || 'software engineer developer';

      const excludeIds = swipeHistory.map(r => r.job_id).join(',');
      const data = await fetchJobFeed(summary, excludeIds || undefined, 50);

      // Client-side dedup
      const historyIds = new Set(swipeHistory.map(r => r.job_id));
      const newJobs = data.jobs.filter((j: JobCard) => !historyIds.has(j.id));

      await setItem<CachedJobBatch>(KEYS.CACHED_JOBS, {
        fetched_at: new Date().toISOString(),
        jobs: newJobs,
      });
      set(state => ({ deck: [...state.deck, ...newJobs], isLoading: false }));
    } catch (err: any) {
      set({ isLoading: false, error: err.message ?? 'Failed to load jobs.' });
    }
  },

  swipeRight: (job: JobCard) => {
    const record: SwipeRecord = {
      job_id: job.id,
      direction: 'right',
      timestamp: new Date().toISOString(),
      status: 'interested',
    };
    set(state => {
      const history = [...state.swipeHistory, record];
      const deck = state.deck.filter(j => j.id !== job.id);
      setItem(KEYS.SWIPE_HISTORY, history);
      // Auto-fetch when fewer than 3 cards remain
      if (deck.length < 5) setTimeout(() => get().fetchFeed(), 0);
      return { deck, swipeHistory: history };
    });
  },

  swipeLeft: (job: JobCard) => {
    const record: SwipeRecord = {
      job_id: job.id,
      direction: 'left',
      timestamp: new Date().toISOString(),
      status: 'skipped',
    };
    set(state => {
      const history = [...state.swipeHistory, record];
      const deck = state.deck.filter(j => j.id !== job.id);
      setItem(KEYS.SWIPE_HISTORY, history);
      if (deck.length < 5) setTimeout(() => get().fetchFeed(), 0);
      return { deck, swipeHistory: history };
    });
  },

  markAutoApplied: (jobId: string) => {
    set(state => {
      const history = state.swipeHistory.map(r =>
        r.job_id === jobId ? { ...r, status: 'auto-applied' as const } : r
      );
      setItem(KEYS.SWIPE_HISTORY, history);
      return { swipeHistory: history };
    });
  },

  resetHistory: async () => {    await setItem(KEYS.SWIPE_HISTORY, []);
    set({ swipeHistory: [], deck: [] });
    get().fetchFeed();
  },

  setOffline: (offline: boolean) => set({ isOffline: offline }),
}));

// Subscribe to connectivity changes
NetInfo.addEventListener(state => {
  const offline = state.isConnected === false;
  const wasOffline = useJobStore.getState().isOffline;
  useJobStore.getState().setOffline(offline);

  // On reconnect: refresh feed and clear error
  if (wasOffline && !offline) {
    useJobStore.getState().fetchFeed();
  }
});

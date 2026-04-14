import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = '@jsa:';

export async function getItem<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function setItem<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(PREFIX + key, JSON.stringify(value));
}

export async function removeItem(key: string): Promise<void> {
  await AsyncStorage.removeItem(PREFIX + key);
}

// Storage keys
export const KEYS = {
  RESUME_SUMMARY:    'resume_summary',
  SWIPE_HISTORY:     'swipe_history',
  CACHED_JOBS:       'cached_jobs',
  DRAFT_APPLICATIONS:'draft_applications',
  AUTH_SESSION:      'auth_session',
  PREFERENCES:       'preferences',
} as const;

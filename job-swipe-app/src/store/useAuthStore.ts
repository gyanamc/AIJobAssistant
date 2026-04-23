import { create } from 'zustand';
import { createClient } from '@supabase/supabase-js';
import { Linking } from 'react-native';
import { getItem, setItem, removeItem, KEYS } from '../utils/storage';
import type { AuthSession } from '../types';

const SUPABASE_URL = 'https://fqwocsqfzzkqbdmzadhz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZxd29jc3FmenprcWJkbXphZGh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MjE0NjUsImV4cCI6MjA5MDA5NzQ2NX0.EAZUXOhI_Ia-vSuVE1saOnumI_Vt-p4d7ulnOZ9HeC4';

// Deep link scheme — must match android/app/src/main/AndroidManifest.xml
const REDIRECT_URL = 'jobswipeapp://auth/callback';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

interface AuthStore {
  session: AuthSession | null;
  isAuthenticated: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
  loadSession: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  session: null,
  isAuthenticated: false,

  loadSession: async () => {
    const stored = await getItem<AuthSession>(KEYS.AUTH_SESSION);
    if (stored && stored.expires_at > Date.now() / 1000) {
      set({ session: stored, isAuthenticated: true });
    }
  },

  signInWithGoogle: async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: REDIRECT_URL,
        skipBrowserRedirect: true,
      },
    });
    if (error) throw new Error(error.message);
    if (data?.url) {
      // Open the OAuth URL in the device browser
      await Linking.openURL(data.url);
    }
  },

  signOut: async () => {
    await supabase.auth.signOut();
    await removeItem(KEYS.AUTH_SESSION);
    set({ session: null, isAuthenticated: false });
  },

  refreshSession: async () => {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session) return;
    const session: AuthSession = {
      access_token:  data.session.access_token,
      refresh_token: data.session.refresh_token,
      user_id:       data.session.user.id,
      email:         data.session.user.email ?? '',
      avatar_url:    data.session.user.user_metadata?.avatar_url,
      expires_at:    data.session.expires_at ?? 0,
    };
    await setItem(KEYS.AUTH_SESSION, session);
    set({ session, isAuthenticated: true });
  },
}));

// Handle deep link callback from OAuth
async function handleDeepLink(url: string) {
  if (!url.includes('jobswipeapp://auth/callback')) return;
  // Extract tokens from URL fragment
  const params = new URLSearchParams(url.split('#')[1] || url.split('?')[1] || '');
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken || '',
    });
    if (!error && data.session) {
      const authSession: AuthSession = {
        access_token:  data.session.access_token,
        refresh_token: data.session.refresh_token,
        user_id:       data.session.user.id,
        email:         data.session.user.email ?? '',
        avatar_url:    data.session.user.user_metadata?.avatar_url,
        expires_at:    data.session.expires_at ?? 0,
      };
      await setItem(KEYS.AUTH_SESSION, authSession);
      useAuthStore.setState({ session: authSession, isAuthenticated: true });
    }
  }
}

// Listen for deep links when app is open
Linking.addEventListener('url', ({ url }) => handleDeepLink(url));

// Handle deep link when app is launched from background
Linking.getInitialURL().then(url => {
  if (url) handleDeepLink(url);
});

// Sync Supabase auth state changes into the store
supabase.auth.onAuthStateChange(async (_event, session) => {
  if (session) {
    const authSession: AuthSession = {
      access_token:  session.access_token,
      refresh_token: session.refresh_token,
      user_id:       session.user.id,
      email:         session.user.email ?? '',
      avatar_url:    session.user.user_metadata?.avatar_url,
      expires_at:    session.expires_at ?? 0,
    };
    await setItem(KEYS.AUTH_SESSION, authSession);
    useAuthStore.setState({ session: authSession, isAuthenticated: true });
  } else {
    useAuthStore.setState({ session: null, isAuthenticated: false });
  }
});


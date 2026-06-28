import { create } from 'zustand';
import { createClient } from '@supabase/supabase-js';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { getItem, setItem, removeItem, KEYS } from '../utils/storage';
import type { AuthSession } from '../types';

const SUPABASE_URL = 'https://fqwocsqfzzkqbdmzadhz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZxd29jc3FmenprcWJkbXphZGh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MjE0NjUsImV4cCI6MjA5MDA5NzQ2NX0.EAZUXOhI_Ia-vSuVE1saOnumI_Vt-p4d7ulnOZ9HeC4';

// Web client ID from Google Cloud Console — required by the native SDK
const WEB_CLIENT_ID = '369645233419-8ila29dtmod6bm5hd0fo95ns9e7ehg52.apps.googleusercontent.com';

// Configure the native Google SDK once at module load
GoogleSignin.configure({
  webClientId: WEB_CLIENT_ID,
  offlineAccess: true,
});

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
  /** Trigger the OS-level Google account picker and exchange the ID token with Supabase */
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
  loadSession: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>((set, _get) => ({
  session: null,
  isAuthenticated: false,

  loadSession: async () => {
    const stored = await getItem<AuthSession>(KEYS.AUTH_SESSION);
    if (stored && stored.expires_at > Date.now() / 1000) {
      set({ session: stored, isAuthenticated: true });
    }
  },

  signInWithGoogle: async () => {
    // Ensure Google Play Services are available (no-op on iOS)
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

    // Open the native OS account picker
    const response = await GoogleSignin.signIn();

    if (!response.data?.idToken) {
      throw new Error('Google Sign-In did not return an ID token');
    }

    // Exchange the Google ID token for a Supabase session
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: response.data.idToken,
    });

    if (error) throw error;
    if (!data.session) throw new Error('No Supabase session returned');

    const authSession: AuthSession = {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user_id: data.session.user.id,
      email: data.session.user.email ?? '',
      avatar_url: data.session.user.user_metadata?.avatar_url,
      expires_at: data.session.expires_at ?? 0,
    };

    await setItem(KEYS.AUTH_SESSION, authSession);
    set({ session: authSession, isAuthenticated: true });
  },

  signOut: async () => {
    try {
      await GoogleSignin.signOut();
    } catch {
      // Ignore — the user may not have signed in via Google
    }
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

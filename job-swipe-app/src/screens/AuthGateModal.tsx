import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useAuthStore } from '../store/useAuthStore';
import { C, T, R, S } from '../theme';
import type { JobCard } from '../types';

type AuthGateParams = {
  pendingJob?: JobCard;
  returnTo?: 'Applications' | 'Profile';
};

type AuthGateState = 'idle' | 'loading' | 'error';

export default function AuthGateModal({ route, navigation }: any) {
  const { pendingJob, returnTo } = (route.params ?? {}) as AuthGateParams;
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const signInWithGoogle = useAuthStore(s => s.signInWithGoogle);
  const [state, setState] = useState<AuthGateState>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // If already authenticated, close modal immediately
  React.useEffect(() => {
    if (isAuthenticated) {
      handleAuthSuccess();
    }
  }, [isAuthenticated]);

  const handleAuthSuccess = () => {
    if (pendingJob) {
      // Navigate to HILReview with the pending job
      navigation.replace('HILReview', { job: pendingJob, autoApply: false });
    } else if (returnTo) {
      // Return to the originating tab
      navigation.goBack();
    } else {
      // Default: just go back
      navigation.goBack();
    }
  };

  const handleSignInPress = async () => {
    setState('loading');
    try {
      await signInWithGoogle();
      // Auth store will update isAuthenticated, triggering the useEffect
    } catch (error: any) {
      // Handle user cancellation gracefully
      if (error?.code === 'SIGN_IN_CANCELLED') {
        setState('idle');
        return;
      }
      setErrorMessage(
        error instanceof Error ? error.message : 'Sign-in failed. Please try again.',
      );
      setState('error');
    }
  };

  const handleRetry = () => {
    setErrorMessage('');
    handleSignInPress();
  };

  const handleCancel = () => {
    navigation.goBack();
  };

  // Render based on state
  if (state === 'loading') {
    return (
      <View style={styles.container}>
        <View style={styles.content}>
          <ActivityIndicator size="large" color={C.accent} />
          <Text style={styles.loadingText}>Signing in…</Text>
        </View>
      </View>
    );
  }

  if (state === 'error') {
    return (
      <View style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.title}>Sign-in Failed</Text>
          <Text style={styles.errorMessage}>{errorMessage}</Text>

          <TouchableOpacity style={styles.primaryBtn} onPress={handleRetry}>
            <Text style={styles.primaryBtnText}>Try Again</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Default: idle state
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.icon}>🔐</Text>
        <Text style={styles.title}>Sign in to Apply</Text>
        <Text style={styles.subtitle}>
          {pendingJob
            ? 'Create an account to apply for this job and track your applications.'
            : 'Sign in to access your profile and application history.'}
        </Text>

        <TouchableOpacity style={styles.googleBtn} onPress={handleSignInPress}>
          <Text style={styles.googleIcon}>G</Text>
          <Text style={styles.googleText}>Continue with Google</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    width: '100%',
    maxWidth: 400,
    padding: S.xxxl,
    alignItems: 'center',
  },
  icon: {
    fontSize: 48,
    marginBottom: S.lg,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: S.lg,
  },
  title: {
    fontSize: T.disp,
    fontWeight: T.black_w,
    color: C.text,
    marginBottom: S.md,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: T.md,
    color: C.textSub,
    textAlign: 'center',
    marginBottom: S.xxxl,
    lineHeight: T.loose,
  },
  loadingText: {
    marginTop: S.lg,
    fontSize: T.md,
    color: C.textSub,
  },
  errorMessage: {
    fontSize: T.md,
    color: C.red,
    textAlign: 'center',
    marginBottom: S.xxxl,
    lineHeight: T.loose,
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.white,
    paddingHorizontal: S.xl,
    paddingVertical: S.lg,
    borderRadius: R.md,
    width: '100%',
    justifyContent: 'center',
    gap: S.md,
    marginBottom: S.lg,
  },
  googleIcon: {
    fontSize: T.xl,
    fontWeight: T.black_w,
    color: '#4285F4',
  },
  googleText: {
    fontSize: T.lg,
    fontWeight: T.semibold,
    color: C.black,
  },
  primaryBtn: {
    backgroundColor: C.accent,
    paddingHorizontal: S.xl,
    paddingVertical: S.lg,
    borderRadius: R.md,
    width: '100%',
    alignItems: 'center',
    marginBottom: S.lg,
  },
  primaryBtnText: {
    fontSize: T.lg,
    fontWeight: T.semibold,
    color: C.black,
  },
  cancelBtn: {
    paddingVertical: S.md,
  },
  cancelText: {
    color: C.textSub,
    fontSize: T.base,
  },
});

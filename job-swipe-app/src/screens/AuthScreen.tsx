import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useAuthStore } from '../store/useAuthStore';

export default function AuthScreen({ route, navigation }: any) {
  const { pendingJob } = route.params ?? {};
  const { signInWithGoogle, isAuthenticated } = useAuthStore();
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    if (isAuthenticated) {
      navigation.goBack();
      if (pendingJob) {
        navigation.navigate('HILReview', { job: pendingJob, autoApply: false });
      }
    }
  }, [isAuthenticated]);

  async function handleSignIn() {
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      Alert.alert('Sign in failed', err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sign in to Apply</Text>
      <Text style={styles.subtitle}>
        Your applications are linked to your Google account.
      </Text>

      <TouchableOpacity style={styles.googleBtn} onPress={handleSignIn} disabled={loading}>
        <Text style={styles.googleIcon}>G</Text>
        <Text style={styles.googleText}>{loading ? 'Signing in…' : 'Continue with Google'}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.cancelBtn} onPress={() => navigation.goBack()}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center', padding: 32 },
  title: { fontSize: 24, fontWeight: '800', color: '#f1f5f9', marginBottom: 12 },
  subtitle: { fontSize: 15, color: '#94a3b8', textAlign: 'center', marginBottom: 40, lineHeight: 22 },
  googleBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12, width: '100%', justifyContent: 'center', gap: 12, marginBottom: 16 },
  googleIcon: { fontSize: 18, fontWeight: '800', color: '#4285F4' },
  googleText: { fontSize: 16, fontWeight: '600', color: '#1e293b' },
  cancelBtn: { paddingVertical: 12 },
  cancelText: { color: '#64748b', fontSize: 14 },
});

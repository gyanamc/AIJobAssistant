import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { useAuthStore } from './src/store/useAuthStore';
import { useJobStore } from './src/store/useJobStore';
import { useApplicationStore } from './src/store/useApplicationStore';

export default function App() {
  const loadSession = useAuthStore(s => s.loadSession);
  const loadCache   = useJobStore(s => s.loadCache);
  const loadDrafts  = useApplicationStore(s => s.loadDrafts);

  useEffect(() => {
    loadSession();
    loadCache();
    loadDrafts();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppNavigator />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

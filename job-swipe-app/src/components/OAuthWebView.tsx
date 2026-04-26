import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewNavigation } from 'react-native-webview';
import { useAuthStore } from '../store/useAuthStore';

interface OAuthWebViewProps {
  onSuccess: () => void;
  onCancel: () => void;
  onError: (message: string) => void;
}

const ALLOWED_DOMAINS = [
  'accounts.google.com',
  'oauth2.googleapis.com',
  'fqwocsqfzzkqbdmzadhz.supabase.co', // Supabase auth domain
];

const TIMEOUT_MS = 15000; // 15 seconds

export const OAuthWebView: React.FC<OAuthWebViewProps> = ({
  onSuccess,
  onCancel,
  onError,
}) => {
  const [oauthUrl, setOauthUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const getOAuthUrl = useAuthStore(s => s.getOAuthUrl);
  const handleOAuthCallback = useAuthStore(s => s.handleOAuthCallback);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    // Fetch OAuth URL on mount
    const fetchUrl = async () => {
      try {
        const url = await getOAuthUrl();
        setOauthUrl(url);
      } catch (error) {
        onError(error instanceof Error ? error.message : 'Failed to get OAuth URL');
      }
    };

    fetchUrl();

    // Set up timeout
    timeoutRef.current = setTimeout(() => {
      if (!hasLoadedRef.current) {
        onError('Connection timed out');
      }
    }, TIMEOUT_MS);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [getOAuthUrl, onError]);

  const handleLoadStart = () => {
    setIsLoading(true);
  };

  const handleLoadEnd = () => {
    setIsLoading(false);
    hasLoadedRef.current = true;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  };

  const handleShouldStartLoadWithRequest = (request: WebViewNavigation): boolean => {
    const { url } = request;

    // Intercept the deep link callback
    if (url.startsWith('jobswipeapp://auth/callback')) {
      handleOAuthCallback(url)
        .then(() => {
          onSuccess();
        })
        .catch((error) => {
          onError(error instanceof Error ? error.message : 'Authentication failed');
        });
      return false; // Block navigation
    }

    return true; // Allow navigation
  };

  const handleNavigationStateChange = (navState: WebViewNavigation) => {
    const { url } = navState;

    // Check if user navigated away from allowed OAuth domains
    const isAllowedDomain = ALLOWED_DOMAINS.some(domain => url.includes(domain));
    
    if (!isAllowedDomain && !url.startsWith('jobswipeapp://')) {
      onCancel();
    }
  };

  if (!oauthUrl) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Preparing sign-in...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        source={{ uri: oauthUrl }}
        onLoadStart={handleLoadStart}
        onLoadEnd={handleLoadEnd}
        onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
        onNavigationStateChange={handleNavigationStateChange}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
      />
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  webview: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
});

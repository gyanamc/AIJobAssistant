import React, { useRef, useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, SafeAreaView, Clipboard,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewNavigation } from 'react-native-webview';
import { getItem, KEYS } from '../utils/storage';
import type { ResumeSummary, UserPreferences } from '../types';
import { C, T, R, S, SHADOW } from '../theme';

// Chrome Android user-agent — prevents LinkedIn from showing "use the app" prompt
const CHROME_ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

// ── JS Injection Script ───────────────────────────────────────────────────────
// Injected after page load. Fills form fields using the user's profile data.
// Uses React native setter approach for LinkedIn (React-controlled inputs).
function buildInjectionScript(
  platform: 'linkedin' | 'naukri',
  profile: {
    name: string;
    email: string;
    phone: string;
    location: string;
    coverLetter: string;
  }
): string {
  const profileJson = JSON.stringify(profile);
  return `
(function() {
  const profile = ${profileJson};
  const platform = '${platform}';
  let filled = 0;

  function fillReactInput(el, val) {
    if (!el || !val || el.value) return;
    try {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      filled++;
    } catch(e) {}
  }

  function fillReactTextarea(el, val) {
    if (!el || !val || el.value) return;
    try {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      filled++;
    } catch(e) {}
  }

  function fillInput(el, val) {
    if (!el || !val || el.value) return;
    try {
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      filled++;
    } catch(e) {}
  }

  function tryFill(selectors, value, isTextarea, useReact) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        if (isTextarea) fillReactTextarea(el, value);
        else if (useReact) fillReactInput(el, value);
        else fillInput(el, value);
        return true;
      }
    }
    return false;
  }

  function runFill() {
    if (platform === 'linkedin') {
      tryFill(
        ['input[name="phoneNumber"]', 'input[id*="phoneNumber"]', 'input[aria-label*="Phone"]', 'input[aria-label*="phone"]'],
        profile.phone, false, true
      );
      tryFill(
        ['input[name="city"]', 'input[aria-label*="City"]', 'input[aria-label*="city"]'],
        profile.location, false, true
      );
      tryFill(
        ['textarea[aria-label*="cover letter"]', 'textarea[aria-label*="Cover letter"]', 'textarea[name="coverLetter"]', '.jobs-easy-apply-form-section__cover-letter textarea'],
        profile.coverLetter, true, true
      );
    } else if (platform === 'naukri') {
      tryFill(
        ['input[name="name"]', '#applicantName', 'input[placeholder*="Name"]', 'input[placeholder*="name"]'],
        profile.name, false, false
      );
      tryFill(
        ['input[name="email"]', 'input[type="email"]', '#applicantEmail', 'input[placeholder*="Email"]'],
        profile.email, false, false
      );
      tryFill(
        ['input[name="mobile"]', 'input[name="phone"]', 'input[type="tel"]', '#applicantMobile', 'input[placeholder*="Mobile"]', 'input[placeholder*="Phone"]'],
        profile.phone, false, false
      );
      tryFill(
        ['textarea[name="coverLetter"]', '#coverLetter', 'textarea[placeholder*="cover"]', 'textarea[placeholder*="message"]'],
        profile.coverLetter, true, false
      );
    }

    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'FILL_RESULT',
      success: filled > 0,
      fieldsFilled: filled,
    }));
  }

  // Wait 2s for SPA to render the form
  setTimeout(runFill, 2000);
})();
true; // required by React Native WebView
`;
}

// ── Screen ────────────────────────────────────────────────────────────────────
interface Props {
  route: {
    params: {
      applyUrl: string;
      platform: 'linkedin' | 'naukri';
      coverLetter: string;
      jobTitle: string;
      company: string;
    };
  };
  navigation: any;
}

export default function ApplyWebViewScreen({ route, navigation }: Props) {
  const { applyUrl, platform, coverLetter, jobTitle, company } = route.params;

  const webViewRef = useRef<any>(null);
  const [pageLoaded, setPageLoaded] = useState(false);
  const [fillResult, setFillResult] = useState<{ success: boolean; fieldsFilled: number } | null>(null);
  const [injectionScript, setInjectionScript] = useState<string>('');
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    buildScript();
  }, []);

  async function buildScript() {
    const [resume, prefs] = await Promise.all([
      getItem<ResumeSummary>(KEYS.RESUME_SUMMARY),
      getItem<UserPreferences>(KEYS.PREFERENCES),
    ]);

    const profile = {
      name: resume?.name ?? '',
      email: resume?.email ?? '',
      phone: resume?.phone ?? '',
      location: (prefs?.preferred_locations ?? [])[0] ?? '',
      coverLetter,
    };

    setInjectionScript(buildInjectionScript(platform, profile));
  }

  function handleMessage(event: any) {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'FILL_RESULT') {
        setFillResult({ success: data.success, fieldsFilled: data.fieldsFilled });
        setShowBanner(true);
        // Auto-hide banner after 4 seconds
        setTimeout(() => setShowBanner(false), 4000);
      }
    } catch { /* ignore non-JSON messages */ }
  }

  function handleLoadEnd() {
    setPageLoaded(true);
  }

  function handleNavigationStateChange(navState: WebViewNavigation) {
    // Detect login wall — LinkedIn redirects to /login or /checkpoint
    const url = navState.url.toLowerCase();
    if (
      url.includes('/login') ||
      url.includes('/checkpoint') ||
      url.includes('/authwall') ||
      url.includes('signin')
    ) {
      // Show a hint but don't close — user can log in inside the WebView
    }
  }

  const platformLabel = platform === 'linkedin' ? 'LinkedIn' : 'Naukri';
  const platformColor = platform === 'linkedin' ? '#0A66C2' : '#FF7555';

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{jobTitle}</Text>
          <Text style={styles.headerSub} numberOfLines={1}>{company}</Text>
        </View>
        <View style={[styles.platformBadge, { backgroundColor: platformColor + '22', borderColor: platformColor + '55' }]}>
          <Text style={[styles.platformText, { color: platformColor }]}>{platformLabel}</Text>
        </View>
      </View>

      {/* Fill result banner */}
      {showBanner && fillResult && (
        <View style={[styles.banner, fillResult.success ? styles.bannerSuccess : styles.bannerWarn]}>
          <Text style={styles.bannerText}>
            {fillResult.success
              ? `✅ Auto-filled ${fillResult.fieldsFilled} field${fillResult.fieldsFilled !== 1 ? 's' : ''} — review and submit`
              : '⚠️ Could not find form fields — please fill manually'}
          </Text>
        </View>
      )}

      {/* Loading indicator */}
      {!pageLoaded && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={C.accent} />
          <Text style={styles.loadingText}>Loading {platformLabel}…</Text>
        </View>
      )}

      {/* WebView */}
      {injectionScript ? (
        <WebView
          ref={webViewRef}
          source={{ uri: applyUrl }}
          userAgent={CHROME_ANDROID_UA}
          injectedJavaScript={injectionScript}
          onMessage={handleMessage}
          onLoadEnd={handleLoadEnd}
          onNavigationStateChange={handleNavigationStateChange}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          style={styles.webview}
        />
      ) : (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={C.accent} />
          <Text style={styles.loadingText}>Preparing…</Text>
        </View>
      )}

      {/* Bottom hint */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Fields pre-filled from your profile · Review carefully before submitting
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    borderBottomWidth: 1,
    borderBottomColor: C.borderSub,
    gap: S.sm,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: C.textSub,
    fontSize: T.sm,
    fontWeight: T.bold,
  },
  headerCenter: {
    flex: 1,
  },
  headerTitle: {
    fontSize: T.sm,
    fontWeight: T.semibold,
    color: C.text,
  },
  headerSub: {
    fontSize: T.xs,
    color: C.textSub,
    marginTop: 1,
  },
  platformBadge: {
    paddingHorizontal: S.sm,
    paddingVertical: 3,
    borderRadius: R.pill,
    borderWidth: 1,
  },
  platformText: {
    fontSize: T.xs,
    fontWeight: T.bold,
  },
  banner: {
    paddingHorizontal: S.lg,
    paddingVertical: S.sm,
  },
  bannerSuccess: {
    backgroundColor: 'rgba(0, 200, 150, 0.12)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 200, 150, 0.25)',
  },
  bannerWarn: {
    backgroundColor: 'rgba(255, 165, 0, 0.12)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 165, 0, 0.25)',
  },
  bannerText: {
    fontSize: T.xs,
    color: C.text,
    fontWeight: T.medium,
  },
  webview: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: S.md,
    zIndex: 10,
  },
  loadingText: {
    color: C.textSub,
    fontSize: T.base,
  },
  footer: {
    paddingHorizontal: S.lg,
    paddingVertical: S.sm,
    borderTopWidth: 1,
    borderTopColor: C.borderSub,
  },
  footerText: {
    fontSize: T.xs,
    color: C.textDim,
    textAlign: 'center',
  },
});

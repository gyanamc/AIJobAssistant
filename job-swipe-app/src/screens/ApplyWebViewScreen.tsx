import React, { useRef, useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, SafeAreaView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewNavigation } from 'react-native-webview';
import { getItem, KEYS } from '../utils/storage';
import { useApplicationStore } from '../store/useApplicationStore';
import { useJobStore } from '../store/useJobStore';
import type { ResumeSummary, UserPreferences } from '../types';
import { C, T, R, S, SHADOW } from '../theme';

// Chrome Android user-agent — prevents LinkedIn from showing "use the app" prompt
const CHROME_ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

// ── JS Injection Script ───────────────────────────────────────────────────────
// Injected after page load. Fills form fields using the user's profile data.
// Uses React native setter approach for LinkedIn (React-controlled inputs).
// Retries up to 3 times with 2s intervals to handle slow SPA rendering.
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
  let attempts = 0;
  const MAX_ATTEMPTS = 3;
  const RETRY_INTERVAL = 2000;

  // ── React-controlled input filler (LinkedIn) ──────────────────────────────
  function fillReactInput(el, val) {
    if (!el || !val || el.value === val) return false;
    try {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    } catch(e) { return false; }
  }

  function fillReactTextarea(el, val) {
    if (!el || !val || el.value === val) return false;
    try {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    } catch(e) { return false; }
  }

  // ── Standard DOM input filler (Naukri) ────────────────────────────────────
  function fillInput(el, val) {
    if (!el || !val || el.value === val) return false;
    try {
      el.focus();
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    } catch(e) { return false; }
  }

  // ── Try a list of selectors, fill the first match ─────────────────────────
  function tryFill(selectors, value, isTextarea, useReact) {
    if (!value) return false;
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          let ok = false;
          if (isTextarea) ok = fillReactTextarea(el, value);
          else if (useReact) ok = fillReactInput(el, value);
          else ok = fillInput(el, value);
          if (ok) { filled++; return true; }
        }
      } catch(e) {}
    }
    return false;
  }

  // ── LinkedIn selectors ────────────────────────────────────────────────────
  function fillLinkedIn() {
    // Phone number
    tryFill([
      'input[name="phoneNumber"]',
      'input[id*="phoneNumber"]',
      'input[aria-label="Phone number"]',
      'input[aria-label*="Phone"]',
      'input[aria-label*="phone"]',
      '.jobs-easy-apply-form-section__phone input',
      'input[data-test-text-entity-list-form-input]',
    ], profile.phone, false, true);

    // City / Location
    tryFill([
      'input[name="city"]',
      'input[aria-label="City"]',
      'input[aria-label*="City"]',
      'input[aria-label*="city"]',
      'input[aria-label*="location"]',
      'input[aria-label*="Location"]',
    ], profile.location, false, true);

    // Cover letter textarea
    tryFill([
      'textarea[aria-label="Cover letter"]',
      'textarea[aria-label*="cover letter"]',
      'textarea[aria-label*="Cover letter"]',
      'textarea[name="coverLetter"]',
      '.jobs-easy-apply-form-section__cover-letter textarea',
      'textarea[id*="cover"]',
      'textarea[placeholder*="cover"]',
    ], profile.coverLetter, true, true);

    // Additional text fields — fill with relevant profile info if empty
    // (LinkedIn sometimes asks "Years of experience", "LinkedIn profile URL", etc.)
    const additionalInputs = document.querySelectorAll(
      '.jobs-easy-apply-form-element input[type="text"]:not([value])'
    );
    additionalInputs.forEach(input => {
      const label = (input.getAttribute('aria-label') || '').toLowerCase();
      if (label.includes('linkedin') || label.includes('profile') || label.includes('url')) {
        // Skip URL fields
      } else if (label.includes('year') || label.includes('experience')) {
        // Skip numeric fields
      }
    });
  }

  // ── Naukri selectors ──────────────────────────────────────────────────────
  function fillNaukri() {
    // Full name
    tryFill([
      'input[name="name"]',
      'input[name="fullName"]',
      '#applicantName',
      '#fullName',
      'input[placeholder="Name"]',
      'input[placeholder="Full Name"]',
      'input[placeholder*="name"]',
      'input[placeholder*="Name"]',
      'input[id*="name"]',
      'input[id*="Name"]',
    ], profile.name, false, false);

    // Email
    tryFill([
      'input[name="email"]',
      'input[type="email"]',
      '#applicantEmail',
      '#email',
      'input[placeholder*="Email"]',
      'input[placeholder*="email"]',
      'input[id*="email"]',
    ], profile.email, false, false);

    // Mobile / Phone
    tryFill([
      'input[name="mobile"]',
      'input[name="phone"]',
      'input[name="mobileNumber"]',
      'input[type="tel"]',
      '#applicantMobile',
      '#mobile',
      '#phone',
      'input[placeholder*="Mobile"]',
      'input[placeholder*="mobile"]',
      'input[placeholder*="Phone"]',
      'input[placeholder*="phone"]',
      'input[id*="mobile"]',
      'input[id*="phone"]',
    ], profile.phone, false, false);

    // Cover letter / Message
    tryFill([
      'textarea[name="coverLetter"]',
      'textarea[name="message"]',
      '#coverLetter',
      '#message',
      'textarea[placeholder*="cover letter"]',
      'textarea[placeholder*="Cover Letter"]',
      'textarea[placeholder*="message"]',
      'textarea[placeholder*="Message"]',
      'textarea[id*="cover"]',
      'textarea[id*="message"]',
    ], profile.coverLetter, true, false);
  }

  // ── Main fill function with retry ─────────────────────────────────────────
  function runFill() {
    attempts++;
    const prevFilled = filled;

    if (platform === 'linkedin') fillLinkedIn();
    else if (platform === 'naukri') fillNaukri();

    const newFills = filled - prevFilled;

    if (filled > 0 || attempts >= MAX_ATTEMPTS) {
      // Report result back to React Native
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'FILL_RESULT',
        success: filled > 0,
        fieldsFilled: filled,
        attempts: attempts,
      }));
    } else {
      // Retry — form may not have rendered yet
      setTimeout(runFill, RETRY_INTERVAL);
    }
  }

  // ── Timeout fallback — report failure after 10s regardless ───────────────
  const timeoutId = setTimeout(() => {
    if (filled === 0) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'FILL_RESULT',
        success: false,
        fieldsFilled: 0,
        attempts: attempts,
        timedOut: true,
      }));
    }
  }, 10000);

  // Start first attempt after 2s (SPA rendering delay)
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
      draftId?: string;   // if set, we update this draft's status on "Mark as Applied"
      jobId?: string;     // for marking swipe record as applied
    };
  };
  navigation: any;
}

export default function ApplyWebViewScreen({ route, navigation }: Props) {
  const { applyUrl, platform, coverLetter, jobTitle, company, draftId, jobId } = route.params;

  const webViewRef = useRef<any>(null);
  const [pageLoaded, setPageLoaded] = useState(false);
  const [fillResult, setFillResult] = useState<{ success: boolean; fieldsFilled: number } | null>(null);
  const [injectionScript, setInjectionScript] = useState<string>('');
  const [showBanner, setShowBanner] = useState(false);
  const [markedApplied, setMarkedApplied] = useState(false);

  const { updateDraft } = useApplicationStore();
  const { markAutoApplied } = useJobStore();

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
        // Keep failure banner visible longer so user sees it
        const hideDelay = data.success ? 5000 : 8000;
        setTimeout(() => setShowBanner(false), hideDelay);
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

  async function handleMarkApplied() {
    // Update draft status to 'applied'
    if (draftId) {
      await updateDraft(draftId, { status: 'applied' });
    }
    // Mark swipe record
    if (jobId) {
      markAutoApplied(jobId);
    }
    setMarkedApplied(true);
    // Navigate back to Applications tab after a short delay
    setTimeout(() => {
      navigation.navigate('Main', { screen: 'Applications' });
    }, 600);
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

      {/* Bottom action bar */}
      <View style={styles.footer}>
        <Text style={styles.footerHint}>
          Fields pre-filled · Review carefully before submitting
        </Text>
        <TouchableOpacity
          style={[styles.markAppliedBtn, markedApplied && styles.markAppliedBtnDone]}
          onPress={handleMarkApplied}
          disabled={markedApplied}
        >
          <Text style={styles.markAppliedBtnText}>
            {markedApplied ? '✅ Marked as Applied' : '✓ I Submitted — Mark as Applied'}
          </Text>
        </TouchableOpacity>
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
    gap: S.sm,
  },
  footerHint: {
    fontSize: T.xs,
    color: C.textDim,
    textAlign: 'center',
  },
  markAppliedBtn: {
    paddingVertical: 13,
    borderRadius: R.pill,
    backgroundColor: C.accent,
    alignItems: 'center',
    ...SHADOW.subtle,
  },
  markAppliedBtnDone: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
  },
  markAppliedBtnText: {
    fontSize: T.base,
    fontWeight: T.bold,
    color: C.black,
  },
});

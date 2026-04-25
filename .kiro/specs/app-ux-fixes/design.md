# App UX Fixes — Bugfix Design

## Overview

This document provides the technical design for fixing five UX and functional bugs in the AntiGravity job-swipe Android app. The fixes span authentication deep-linking, job matching query construction, swipe deck card visibility, notification branding, and onboarding typography refinement.

---

## Glossary

- **Deep Link**: A URL scheme (`jobswipeapp://`) that allows external apps (like browsers) to open specific screens in the app
- **Intent Filter**: Android manifest declaration that tells the OS which URLs should route to the app
- **AUTO-APPLY**: Feature that automatically applies to jobs scoring above a threshold without human-in-the-loop review
- **Toast/Snackbar**: Non-blocking in-app notification that auto-dismisses
- **Animated.Value**: React Native Reanimated shared value for declarative animations

---

## Bug Details

### Bug 1 — Google Sign-In OAuth Callback Never Returns to App

**Root Cause**: `AndroidManifest.xml` declares an intent filter with `android:host="auth"` but is missing `android:pathPrefix="/callback"`. When the OAuth provider redirects to `jobswipeapp://auth/callback`, Android fails to match the full URL and leaves the user in the browser.

**Fix**: Add `<data android:pathPrefix="/callback" />` to the existing intent filter in `AndroidManifest.xml`.

**File**: `job-swipe-app/android/app/src/main/AndroidManifest.xml`

**Change**:
```xml
<intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="jobswipeapp" android:host="auth" />
    <data android:pathPrefix="/callback" />  <!-- ADD THIS LINE -->
</intent-filter>
```

---

### Bug 2 — Low Match Scores and AUTO-APPLY Button Never Appears

**Root Cause**: The query construction in `useJobStore.fetchFeed` is reasonable but the fallback when no resume is uploaded is a hardcoded generic string `'software engineer developer'`. Also, `UserPreferences.target_roles` and `preferred_locations` are not used to enrich the query.

**Fix**: 
1. Read `UserPreferences` from storage in `fetchFeed`
2. If resume is missing, use `prefs.target_roles.join(', ')` as the fallback query
3. Include `prefs.preferred_locations` in the query string to improve relevance

**File**: `job-swipe-app/src/store/useJobStore.ts`

**Changes**:
```typescript
fetchFeed: async () => {
  const { swipeHistory, isLoading } = get();
  if (isLoading) return;
  set({ isLoading: true, error: null });
  try {
    const [resumeSummary, prefs] = await Promise.all([
      getItem<{ experience_summary: string; skills: string[]; target_roles: string[]; }>(KEYS.RESUME_SUMMARY),
      getItem<UserPreferences>(KEYS.PREFERENCES),
    ]);

    // Build a rich query string from all resume fields + preferences
    const parts = [
      resumeSummary?.experience_summary ?? '',
      (resumeSummary?.target_roles ?? prefs?.target_roles ?? []).join(', '),
      (resumeSummary?.skills ?? []).slice(0, 20).join(', '),
      (prefs?.preferred_locations ?? []).join(', '),
    ].filter(Boolean);
    
    // Fallback: use target roles from prefs if no resume
    const summary = parts.length > 0 
      ? parts.join('. ') 
      : (prefs?.target_roles ?? []).join(', ') || 'software engineer developer';

    const excludeIds = swipeHistory.map(r => r.job_id).join(',');
    const data = await fetchJobFeed(summary, excludeIds || undefined, 50);

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
```

---

### Bug 3 — Swipe Left Leaves a Blank Screen (Next Card Invisible)

**Root Cause**: In `SwipeDeck.tsx`, the `scale` animated style sets `opacity: isTop ? 1 : 0` for non-top cards, making them completely invisible. When the top card is swiped away, the next card starts at opacity 0 and never animates to 1.

**Fix**: Change non-top card opacity to 0.85 (visible but dimmed). Use `withTiming` to animate opacity to 1 when a card becomes the top card.

**File**: `job-swipe-app/src/components/SwipeDeck.tsx`

**Changes**:
```typescript
const scale = useAnimatedStyle(() => ({
  transform: [{ scale: isTop ? 1 : 0.95 }],
  opacity: withTiming(isTop ? 1 : 0.85, { duration: 200 }),  // CHANGED: 0.85 instead of 0, with animation
}));
```

---

### Bug 4 — Notifications Use Plain System Alerts Instead of AntiGravity-Branded Toasts

**Root Cause**: All non-destructive feedback uses `Alert.alert()` system dialogs that don't match the AntiGravity dark theme.

**Fix**: Create a branded `Toast` component and `useToast` hook. Replace `Alert.alert` for non-destructive feedback in `ProfileScreen`, `OnboardingScreen`, and `HILReviewScreen`. Keep `Alert.alert` for destructive confirmations.

**New File**: `job-swipe-app/src/components/Toast.tsx`

```typescript
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';

interface ToastProps {
  message: string;
  type?: 'success' | 'error';
  visible: boolean;
  onDismiss: () => void;
}

export default function Toast({ message, type = 'success', visible, onDismiss }: ToastProps) {
  const opacity = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.delay(3000),
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(() => onDismiss());
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.container, { opacity }]}>
      <View style={[styles.toast, type === 'error' && styles.toastError]}>
        <Text style={styles.message}>{message}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', top: 60, left: 20, right: 20, zIndex: 9999, alignItems: 'center' },
  toast: { backgroundColor: '#0e1212', borderLeftWidth: 4, borderLeftColor: '#7dd3a8', borderRadius: 12, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
  toastError: { borderLeftColor: '#ef4444' },
  message: { color: '#f9fafb', fontSize: 15, fontWeight: '600' },
});
```

**New Hook**: `job-swipe-app/src/hooks/useToast.ts`

```typescript
import { useState } from 'react';

export function useToast() {
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  };

  const hideToast = () => setToast(null);

  return { toast, showToast, hideToast };
}
```

**Changes in screens**:
- `ProfileScreen.tsx`: Replace `Alert.alert('Resume updated', ...)` and `Alert.alert('Saved', ...)` with `showToast(...)`
- `OnboardingScreen.tsx`: Replace `Alert.alert('Resume uploaded', ...)` with `showToast(...)`
- `HILReviewScreen.tsx`: Replace `Alert.alert('Saved', ...)` with `showToast(...)`
- Keep `Alert.alert` for Sign Out and Reset History confirmations (destructive actions)

---

### Bug 5 — Onboarding Typography Too Large and Layout Unpolished

**Root Cause**: `slideTitle: fontSize 26`, `sproutBtnText: fontSize 18`, `graphicEmoji: fontSize 100` are oversized. Layout lacks subtle animations and tight spacing.

**Fix**: Reduce font sizes, add `letterSpacing`, and apply fade-in animation on slide content.

**File**: `job-swipe-app/src/screens/OnboardingScreen.tsx`

**Changes**:
```typescript
// In styles:
slideTitle: { fontSize: 20, fontWeight: '700', color: '#f9fafb', marginBottom: 16, textAlign: 'center', letterSpacing: 0.3 },
slideSubtitle: { fontSize: 15, color: '#9ca3af', textAlign: 'center', lineHeight: 22, paddingHorizontal: 12 },
graphicEmoji: { fontSize: 64, opacity: 0.9 },
sproutBtnText: { color: '#0e1212', fontWeight: '800', fontSize: 15 },
graphicPlaceholder: { width: 160, height: 160, justifyContent: 'center', alignItems: 'center', marginBottom: 32 },
```

**Add fade-in animation**:
```typescript
// At the top of the component:
const fadeAnim = React.useRef(new Animated.Value(0)).current;

React.useEffect(() => {
  Animated.timing(fadeAnim, {
    toValue: 1,
    duration: 400,
    useNativeDriver: true,
  }).start();
}, [currentIndex]);

// Wrap slide content in Animated.View:
<Animated.View style={{ opacity: fadeAnim }}>
  <View style={styles.graphicPlaceholder}>
    <Text style={styles.graphicEmoji}>{item.emoji}</Text>
  </View>
  <Text style={styles.slideTitle}>{item.title}</Text>
  <Text style={styles.slideSubtitle}>{item.sub}</Text>
</Animated.View>
```

---

## Testing Strategy

### Bug 1 — Deep Link Testing
- Manual test: Tap "Continue with Google", complete OAuth in browser, verify app opens and user is authenticated
- Check `adb logcat` for intent filter match confirmation

### Bug 2 — Query Construction Testing
- Unit test: Mock `getItem` to return no resume but prefs with target_roles, verify query uses target_roles
- Unit test: Mock resume + prefs, verify query includes all fields
- Manual test: Upload resume, check if match scores improve

### Bug 3 — Swipe Deck Visibility Testing
- Manual test: Swipe left, verify next card is immediately visible
- Visual test: Verify non-top cards are slightly dimmed (opacity 0.85)

### Bug 4 — Toast Testing
- Manual test: Upload resume, verify branded toast appears and auto-dismisses
- Manual test: Save preferences, verify toast appears
- Manual test: Tap Sign Out, verify Alert.alert confirmation dialog still appears (not replaced)

### Bug 5 — Onboarding Typography Testing
- Visual test: Verify font sizes are reduced and layout feels more premium
- Manual test: Scroll carousel, verify fade-in animation on each slide

---

## Correctness Properties

**Property 1 (Bug 1 Fix)**: For all OAuth callback URLs matching `jobswipeapp://auth/callback`, the app SHALL receive the deep link and authenticate the user.

**Property 2 (Bug 2 Fix)**: For all users with target_roles in preferences but no resume, the query SHALL use target_roles instead of the hardcoded fallback.

**Property 3 (Bug 3 Fix)**: For all swipe events, the next card SHALL be visible immediately after the top card is removed.

**Property 4 (Bug 4 Fix)**: For all non-destructive feedback events, the system SHALL display a branded toast instead of Alert.alert.

**Property 5 (Bug 5 Fix)**: For all onboarding slides, the typography SHALL use reduced font sizes and the content SHALL fade in on slide change.

---

## Preservation Properties

**Preservation 1**: Normal app launch and existing auth flows remain unchanged.

**Preservation 2**: Jobs scoring >= threshold still trigger AUTO-APPLY.

**Preservation 3**: Top card rendering, swipe gestures, and overlays remain unchanged.

**Preservation 4**: Destructive-action confirmation dialogs (Sign Out, Reset History) continue to use Alert.alert.

**Preservation 5**: Onboarding navigation and data persistence remain unchanged.

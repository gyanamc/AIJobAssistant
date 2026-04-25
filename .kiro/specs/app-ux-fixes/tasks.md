# Implementation Plan

- [x] 1. Fix Google Sign-In deep link (AndroidManifest.xml)
  - File: `job-swipe-app/android/app/src/main/AndroidManifest.xml`
  - Add `<data android:pathPrefix="/callback" />` to the existing intent filter for `jobswipeapp://auth`
  - This allows Android to match the full OAuth callback URL `jobswipeapp://auth/callback`
  - Test: Tap "Continue with Google", complete OAuth, verify app opens and user is authenticated
  - _Requirements: 2.1, 2.2, 2.3_

- [x] 2. Improve job matching query construction (useJobStore.ts)
  - File: `job-swipe-app/src/store/useJobStore.ts`
  - Read `UserPreferences` from storage in `fetchFeed`
  - Include `prefs.target_roles` and `prefs.preferred_locations` in the query string
  - Use `prefs.target_roles` as fallback when no resume is uploaded (instead of hardcoded 'software engineer developer')
  - Test: Mock no resume but prefs with target_roles, verify query uses target_roles
  - _Requirements: 2.4, 2.5, 2.6_

- [x] 3. Fix swipe left blank screen (SwipeDeck.tsx)
  - File: `job-swipe-app/src/components/SwipeDeck.tsx`
  - Change non-top card opacity from 0 to 0.85 in the `scale` animated style
  - Use `withTiming` to animate opacity to 1 when a card becomes the top card
  - Test: Swipe left, verify next card is immediately visible
  - _Requirements: 2.7, 2.8, 2.9_

- [x] 4. Create branded Toast component and replace Alert.alert for non-destructive feedback

  - [x] 4.1 Create Toast component
    - New file: `job-swipe-app/src/components/Toast.tsx`
    - Dark `#0e1212` background, `#7dd3a8` success accent, `#ef4444` error accent
    - Auto-dismiss after 3 seconds with fade-in/fade-out animation
    - _Requirements: 2.10, 2.13_

  - [x] 4.2 Create useToast hook
    - New file: `job-swipe-app/src/hooks/useToast.ts`
    - Provides `showToast(message, type)` and `hideToast()` functions
    - _Requirements: 2.10_

  - [x] 4.3 Replace Alert.alert in ProfileScreen
    - File: `job-swipe-app/src/screens/ProfileScreen.tsx`
    - Replace `Alert.alert('Resume updated', ...)` with `showToast('Resume updated')`
    - Replace `Alert.alert('Saved', 'Preferences updated.')` with `showToast('Preferences updated')`
    - Keep `Alert.alert` for Sign Out and Reset History confirmations (destructive actions)
    - _Requirements: 2.10, 2.11_

  - [x] 4.4 Replace Alert.alert in OnboardingScreen
    - File: `job-swipe-app/src/screens/OnboardingScreen.tsx`
    - Replace `Alert.alert('Resume uploaded', ...)` with `showToast('Resume uploaded')`
    - _Requirements: 2.10_

  - [x] 4.5 Replace Alert.alert in HILReviewScreen
    - File: `job-swipe-app/src/screens/HILReviewScreen.tsx`
    - Replace `Alert.alert('Saved', ...)` with `showToast('Draft saved')` or `showToast('Auto-applied!')`
    - Keep error Alert in the catch block (or replace with `showToast('Failed to save. Please try again.', 'error')`)
    - _Requirements: 2.12, 2.13_

- [x] 5. Refine onboarding typography and add animations (OnboardingScreen.tsx)
  - File: `job-swipe-app/src/screens/OnboardingScreen.tsx`
  - Reduce `slideTitle` from `fontSize: 26` to `fontSize: 20`, add `letterSpacing: 0.3`
  - Reduce `sproutBtnText` from `fontSize: 18` to `fontSize: 15`
  - Reduce `graphicEmoji` from `fontSize: 100` to `fontSize: 64`
  - Reduce `graphicPlaceholder` dimensions from `200x200` to `160x160`
  - Add fade-in animation on slide content using `Animated.Value` that triggers on `currentIndex` change
  - Test: Scroll carousel, verify font sizes are smaller and fade-in animation plays
  - _Requirements: 2.14, 2.15, 2.16, 2.17_

- [x] 6. Manual testing checkpoint
  - Test Bug 1: Complete Google Sign-In flow end-to-end
  - Test Bug 2: Verify improved match scores with enriched query
  - Test Bug 3: Swipe left multiple times, verify no blank screens
  - Test Bug 4: Trigger all toast scenarios (resume upload, save prefs, save draft)
  - Test Bug 5: Review onboarding screens for premium feel
  - Verify all preservation properties (destructive confirmations still use Alert.alert, etc.)

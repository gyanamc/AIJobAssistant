# Implementation Plan: Guest Mode Auth

## Overview

This implementation converts the existing forced sign-in flow into a guest-first experience with deferred authentication. The core changes involve refactoring the auth store to support in-app OAuth via WebView, creating a new modal-based auth gate that triggers only on apply actions, and updating all screens to handle guest state gracefully.

## Tasks

- [x] 1. Refactor useAuthStore for in-app OAuth
  - [x] 1.1 Remove signInWithGoogle and Linking.openURL calls
    - Delete the existing `signInWithGoogle` function that calls `Linking.openURL`
    - Remove all `Linking.addEventListener` and `Linking.getInitialURL` deep link listeners
    - _Requirements: 3.1, 3.3_
  
  - [x] 1.2 Implement getOAuthUrl method
    - Add `getOAuthUrl: () => Promise<string>` to AuthStore interface
    - Call `supabase.auth.signInWithOAuth` with `skipBrowserRedirect: true`
    - Return `data.url` without opening browser
    - _Requirements: 3.1, 3.2_
  
  - [x] 1.3 Implement handleOAuthCallback method
    - Add `handleOAuthCallback: (url: string) => Promise<void>` to AuthStore interface
    - Parse fragment/query params from callback URL
    - Call `supabase.auth.setSession` with extracted tokens
    - Persist session to AsyncStorage
    - Update store state (`session`, `isAuthenticated`)
    - _Requirements: 3.3, 3.6, 4.1_
  
  - [ ]* 1.4 Write unit tests for auth store methods
    - Test `getOAuthUrl` returns valid URL without side effects
    - Test `handleOAuthCallback` correctly parses tokens and updates state
    - Test error handling for malformed callback URLs
    - _Requirements: 3.3, 4.1_

- [x] 2. Create OAuthWebView component
  - [x] 2.1 Implement OAuthWebView with WebView integration
    - Create `src/components/OAuthWebView.tsx` with props: `onSuccess`, `onCancel`, `onError`
    - Call `useAuthStore(s => s.getOAuthUrl)` on mount
    - Render `react-native-webview` WebView pointed at OAuth URL
    - Show ActivityIndicator during load (`onLoadStart` / `onLoadEnd`)
    - _Requirements: 3.1, 3.6_
  
  - [x] 2.2 Implement deep link interception
    - Add `onShouldStartLoadWithRequest` handler
    - Check if URL starts with `jobswipeapp://auth/callback`
    - If match: call `handleOAuthCallback(url)`, call `onSuccess()`, return `false`
    - If no match: allow navigation
    - _Requirements: 3.3_
  
  - [x] 2.3 Add timeout and navigation guards
    - Implement 15-second load timeout with `useRef` + `setTimeout`
    - Call `onError('Connection timed out')` if `onLoadEnd` not fired
    - Add `onNavigationStateChange`: if URL is not Google/Supabase domain, call `onCancel()`
    - _Requirements: 3.4, 3.5_
  
  - [ ]* 2.4 Write unit tests for OAuthWebView
    - Test timeout triggers error callback
    - Test navigation to non-OAuth URL triggers cancel
    - Test successful callback interception calls onSuccess
    - _Requirements: 3.4, 3.5_

- [x] 3. Create AuthGateModal screen
  - [x] 3.1 Implement AuthGateModal with state machine
    - Create `src/screens/AuthGateModal.tsx`
    - Define route params: `{ pendingJob?: JobCard; returnTo?: 'Applications' | 'Profile' }`
    - Implement three states: `idle`, `loading`, `error`
    - In `idle`: show "Sign in to Apply" copy + "Continue with Google" button
    - In `loading`: render `OAuthWebView`
    - In `error`: show error message + retry button
    - _Requirements: 2.1, 2.2, 3.1_
  
  - [x] 3.2 Wire OAuthWebView callbacks
    - On `onSuccess`: check if `pendingJob` exists → navigate to `HILReview` with job
    - On `onSuccess`: check if `returnTo` exists → `navigation.goBack()`
    - On `onCancel`: dismiss WebView, return to `idle` state
    - On `onError(msg)`: dismiss WebView, show error state with retry
    - _Requirements: 2.3, 2.4, 2.5_
  
  - [ ]* 3.3 Write integration tests for AuthGateModal
    - Test successful auth flow navigates to HILReview with pendingJob
    - Test cancel returns to idle state
    - Test error shows retry UI
    - _Requirements: 2.3, 2.4, 2.5_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update AppNavigator for AuthGateModal
  - [x] 5.1 Replace Auth screen with AuthGateModal
    - Remove `Auth` screen from RootStackParamList
    - Add `AuthGate: { pendingJob?: JobCard; returnTo?: 'Applications' | 'Profile' }` to RootStackParamList
    - Replace `<Stack.Screen name="Auth" />` with `<Stack.Screen name="AuthGate" component={AuthGateModal} options={{ presentation: 'modal' }} />`
    - _Requirements: 2.1_

- [x] 6. Update SwipeDeckScreen for guest mode
  - [x] 6.1 Replace Auth navigation with AuthGate
    - Find `navigation.navigate('Auth', { pendingJob: job })` in `handleSwipeRight`
    - Replace with `navigation.navigate('AuthGate', { pendingJob: job })`
    - Verify existing `!isAuthenticated` guard remains unchanged
    - _Requirements: 2.1, 2.2_

- [x] 7. Update ProfileScreen for guest mode
  - [x] 7.1 Add navigation prop and guest sign-in prompt
    - Add `navigation` prop to ProfileScreen (use `useNavigation` hook if not passed)
    - When `!isAuthenticated`: replace "Not signed in" row with TouchableOpacity
    - On press: call `navigation.navigate('AuthGate', { returnTo: 'Profile' })`
    - _Requirements: 5.1, 5.3, 5.4_

- [x] 8. Update ApplicationsScreen for guest mode
  - [x] 8.1 Add navigation prop and guest empty state
    - Add `navigation` prop to ApplicationsScreen (use `useNavigation` hook if not passed)
    - When `drafts.length === 0` and `!isAuthenticated`: show guest-specific empty state
    - Include "Sign in to see your applications" prompt + button
    - On button press: call `navigation.navigate('AuthGate', { returnTo: 'Applications' })`
    - _Requirements: 5.2, 5.3, 5.4_

- [x] 9. Remove forced sign-in from app launch
  - [x] 9.1 Verify guest browsing works without auth
    - Ensure `AppNavigator` routes to `Main` tabs after onboarding without checking auth
    - Verify `useAuthStore.loadSession` is called but does not block navigation
    - Test that guest users can browse SwipeDeck, view job details, and swipe left without auth
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- The design uses TypeScript, so all code will be written in TypeScript
- Android-only scope means no iOS-specific WebView configuration needed
- Checkpoints ensure incremental validation at logical breakpoints

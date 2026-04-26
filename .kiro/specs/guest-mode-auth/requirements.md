# Requirements Document

## Introduction

The AntiGravity mobile app currently requires users to sign in with Google before they can browse or swipe jobs. This creates unnecessary friction at the top of the funnel. This feature removes that barrier by introducing a guest mode: users can browse and swipe the job feed without any account. Authentication is deferred until the moment a user actually tries to apply for a job.

Additionally, the current OAuth flow opens the system browser and exposes a raw Supabase URL (e.g. `fqwocsqfzzkqbdmzadhz.supabase.co`) to the user. This is a branding and security concern. The sign-in flow must be handled entirely in-app using a WebView so that no Supabase-branded URL is ever visible to the user.

## Glossary

- **App**: The AntiGravity React Native mobile application.
- **Guest_User**: A user who has completed onboarding but has not authenticated with Google OAuth.
- **Authenticated_User**: A user who has successfully completed Google OAuth sign-in and holds a valid session.
- **Auth_Gate**: The modal screen that intercepts unauthenticated apply attempts and prompts sign-in.
- **OAuth_WebView**: An in-app WebView component that renders the Google OAuth consent page without exposing the underlying Supabase URL.
- **Swipe_Deck**: The main job browsing screen (`SwipeDeckScreen`) where users swipe right to apply or left to skip.
- **Apply_Action**: Any user gesture that initiates a job application — swiping right on a card or tapping the apply (✓) button.
- **Deep_Link**: The custom URL scheme `jobswipeapp://auth/callback` used to return OAuth tokens to the app.
- **Session**: A persisted Supabase auth session containing access and refresh tokens stored in AsyncStorage.

---

## Requirements

### Requirement 1: Guest Browsing

**User Story:** As a guest user, I want to browse and swipe through job listings without signing in, so that I can evaluate the app's value before committing to an account.

#### Acceptance Criteria

1. THE App SHALL allow a user who has completed onboarding to reach the Swipe_Deck without requiring authentication.
2. WHILE a user is in guest mode, THE Swipe_Deck SHALL display the full job feed, match scores, and job detail modals identically to an Authenticated_User.
3. WHILE a user is in guest mode, THE Swipe_Deck SHALL allow left-swipe (skip) actions without requiring authentication.
4. WHILE a user is in guest mode, THE App SHALL NOT redirect the user to any sign-in screen on app launch or during passive browsing.
5. THE App SHALL persist the guest browsing state across app restarts until the user explicitly signs in or signs out.

---

### Requirement 2: Auth-Gated Apply Action

**User Story:** As a guest user, I want to be prompted to sign in only when I try to apply for a job, so that the sign-in request feels contextual and justified.

#### Acceptance Criteria

1. WHEN a Guest_User performs an Apply_Action, THE App SHALL pause the application flow and navigate to the Auth_Gate modal.
2. WHEN the Auth_Gate is presented, THE App SHALL retain the job that triggered the Apply_Action so it can be resumed after sign-in.
3. WHEN an Authenticated_User performs an Apply_Action, THE App SHALL proceed directly to the HILReview screen without showing the Auth_Gate.
4. IF a Guest_User dismisses the Auth_Gate without signing in, THEN THE App SHALL return the user to the Swipe_Deck with the job deck in its previous state.
5. WHEN a Guest_User successfully signs in via the Auth_Gate, THE App SHALL automatically resume the pending Apply_Action for the retained job.

---

### Requirement 3: In-App OAuth WebView

**User Story:** As a user signing in, I want the Google sign-in flow to happen inside the app, so that I never see any Supabase-branded URLs or leave the app experience.

#### Acceptance Criteria

1. WHEN sign-in is initiated, THE OAuth_WebView SHALL render the Google OAuth consent page inside a React Native modal without opening the system browser.
2. THE OAuth_WebView SHALL use a custom redirect URL that does not contain the string "supabase" in any visible URL bar, page title, or navigation UI.
3. WHEN the OAuth provider redirects to the Deep_Link URL after consent, THE OAuth_WebView SHALL intercept the redirect before it leaves the WebView and extract the auth tokens.
4. IF the OAuth_WebView fails to load the consent page within 15 seconds, THEN THE Auth_Gate SHALL display an error message and a retry button.
5. IF the user navigates away from the Google consent page to an unrelated URL within the OAuth_WebView, THEN THE OAuth_WebView SHALL close and return the user to the Auth_Gate.
6. WHEN auth tokens are successfully extracted from the redirect URL, THE App SHALL close the OAuth_WebView and complete the session setup without any visible Supabase URL being shown.

---

### Requirement 4: Session Persistence and State Sync

**User Story:** As a returning user, I want my sign-in to persist across app restarts, so that I don't have to sign in every time I open the app.

#### Acceptance Criteria

1. WHEN a user successfully signs in, THE App SHALL persist the Session to AsyncStorage.
2. WHEN the App is launched, THE App SHALL restore a valid Session from AsyncStorage and set the user as Authenticated_User without requiring re-authentication.
3. WHEN a stored Session has an `expires_at` timestamp in the past, THE App SHALL treat the user as a Guest_User and clear the expired Session from AsyncStorage.
4. WHEN a user signs out, THE App SHALL remove the Session from AsyncStorage and revert the user to Guest_User state.
5. WHILE a valid Session exists, THE App SHALL proactively refresh the Session before it expires to maintain uninterrupted Authenticated_User status.

---

### Requirement 5: Profile and Applications Screens for Guest Users

**User Story:** As a guest user, I want to see the Profile and Applications tabs, so that I understand what features are available and am motivated to sign in.

#### Acceptance Criteria

1. WHILE a user is in guest mode, THE App SHALL display the Profile screen with a sign-in prompt instead of profile data.
2. WHILE a user is in guest mode, THE App SHALL display the Applications screen with an empty state and a sign-in prompt instead of application history.
3. WHEN a Guest_User taps the sign-in prompt on the Profile or Applications screen, THE App SHALL navigate to the Auth_Gate modal without a pending job.
4. WHEN a Guest_User successfully signs in from the Profile or Applications screen, THE App SHALL return the user to the originating screen and display their data.

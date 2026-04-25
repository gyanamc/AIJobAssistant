# Bugfix Requirements Document

## Introduction

This document covers five UX and functional bugs in the AntiGravity job-swipe Android app. The issues span authentication (Google Sign-In OAuth callback never returns to the app), job discovery (low match scores and the AUTO-APPLY button never appearing), swipe interaction (swiping left leaves a blank screen because the next card is invisible), notification branding (all feedback uses plain system `Alert.alert()` dialogs that clash with the dark AntiGravity theme), and onboarding typography (font sizes are too large and the overall layout feels unpolished). Fixing these issues is required for the app to be usable end-to-end.

---

## Bug Analysis

### Bug 1 — Google Sign-In OAuth Callback Never Returns to App

### Current Behavior (Defect)

1.1 WHEN the user taps "Continue with Google" THEN the system opens the OAuth URL in the device browser via `Linking.openURL`  
1.2 WHEN the OAuth provider redirects to `jobswipeapp://auth/callback` after successful login THEN the system does not route the callback URL back to the app because `AndroidManifest.xml` declares `android:host="auth"` without `android:pathPrefix="/callback"`, causing Android to fail to match the full deep-link URL  
1.3 WHEN the deep-link is not matched by Android THEN the system leaves the user stranded in the browser with no way to return to the app, and `handleDeepLink` in `useAuthStore.ts` is never invoked

### Expected Behavior (Correct)

2.1 WHEN the user taps "Continue with Google" THEN the system SHALL open the OAuth URL in the device browser  
2.2 WHEN the OAuth provider redirects to `jobswipeapp://auth/callback` THEN the system SHALL route the URL back to the app by matching the intent filter that declares `android:scheme="jobswipeapp"`, `android:host="auth"`, and `android:pathPrefix="/callback"`  
2.3 WHEN the deep-link is received by the app THEN the system SHALL invoke `handleDeepLink`, extract the access and refresh tokens from the URL, call `supabase.auth.setSession`, persist the session, and update `useAuthStore` so `isAuthenticated` becomes `true`

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the app is launched normally from the home screen THEN the system SHALL CONTINUE TO open the launcher activity without triggering the deep-link handler  
3.2 WHEN the user is already authenticated THEN the system SHALL CONTINUE TO skip the sign-in flow and navigate directly to the main screen  
3.3 WHEN the user taps "Cancel" on the AuthScreen THEN the system SHALL CONTINUE TO navigate back without altering the authentication state

---

### Bug 2 — Low Match Scores and AUTO-APPLY Button Never Appears

### Current Behavior (Defect)

1.4 WHEN `fetchFeed` is called and the resume summary contains `experience_summary`, `target_roles`, and `skills` THEN the system constructs the query string by joining those fields with `. ` and sends it as `resume_summary` to the backend  
1.5 WHEN the backend returns jobs with match scores below the `auto_apply_threshold` (default 80) for all cards in the deck THEN the system never sets `autoApply = true` in `useApplicationFlow`, so the AUTO-APPLY button is never shown in `HILReviewScreen`  
1.6 WHEN the user has not uploaded a resume THEN the system falls back to the literal string `'software engineer developer'` as the query, producing generic low-relevance results

### Expected Behavior (Correct)

2.4 WHEN `fetchFeed` is called with a populated resume summary THEN the system SHALL construct a richer, more targeted query that includes the candidate's target roles, top skills, experience level, and preferred locations so that the backend vector search returns higher-relevance matches  
2.5 WHEN the backend returns at least one job whose `match_score` is greater than or equal to `auto_apply_threshold` THEN the system SHALL set `autoApply = true` for that job and display the AUTO-APPLY button in `HILReviewScreen`  
2.6 WHEN the user has not uploaded a resume but has set target roles in preferences THEN the system SHALL use the target roles as the fallback query instead of the hardcoded generic string

### Unchanged Behavior (Regression Prevention)

3.4 WHEN the user has already swiped on a set of jobs THEN the system SHALL CONTINUE TO exclude those job IDs from the feed via the `exclude_ids` parameter  
3.5 WHEN the deck has fewer than 5 cards remaining THEN the system SHALL CONTINUE TO trigger an automatic background fetch  
3.6 WHEN the device is offline THEN the system SHALL CONTINUE TO serve jobs from the local cache without making a network request

---

### Bug 3 — Swipe Left Leaves a Blank Screen (Next Card Invisible)

### Current Behavior (Defect)

1.7 WHEN the deck renders non-top cards THEN the system applies `opacity: 0` via the `scale` animated style in `SwipeDeck.tsx`, making all cards behind the top card completely invisible  
1.8 WHEN the top card is swiped away THEN the system removes it from the deck array, promoting the next card to index 0 (top), but that card was rendered at `opacity: 0` and no animation transitions it to `opacity: 1`, so the screen appears blank  
1.9 WHEN the user swipes left repeatedly THEN the system continues to show a blank deck until a re-render cycle eventually corrects the opacity, resulting in a broken swipe experience

### Expected Behavior (Correct)

2.7 WHEN non-top cards are rendered in the deck THEN the system SHALL display them at a reduced but visible opacity (e.g. 0.7) so the stack depth is perceivable  
2.8 WHEN a card becomes the top card (index 0) after the previous top card is swiped away THEN the system SHALL animate its opacity from the reduced value to 1.0 so the transition is smooth and the card is immediately visible  
2.9 WHEN the deck contains only one card THEN the system SHALL display that card at full opacity

### Unchanged Behavior (Regression Prevention)

3.7 WHEN the top card is being dragged THEN the system SHALL CONTINUE TO show the APPLY/SKIP overlay labels and the background color tint  
3.8 WHEN a swipe does not exceed the threshold THEN the system SHALL CONTINUE TO spring the card back to its original position  
3.9 WHEN the deck is empty THEN the system SHALL CONTINUE TO show the empty-state screen

---

### Bug 4 — Notifications Use Plain System Alerts Instead of AntiGravity-Branded Toasts

### Current Behavior (Defect)

1.10 WHEN the user uploads a resume successfully THEN the system shows a plain `Alert.alert('Resume uploaded', ...)` system dialog that does not match the AntiGravity dark theme  
1.11 WHEN the user saves preferences THEN the system shows a plain `Alert.alert('Saved', 'Preferences updated.')` system dialog  
1.12 WHEN a draft application is saved or auto-applied THEN the system shows a plain `Alert.alert('Saved', ...)` system dialog  
1.13 WHEN any of these system dialogs appear THEN the system renders a white modal overlay that breaks the dark `#0e1212` immersive experience and requires a tap to dismiss

### Expected Behavior (Correct)

2.10 WHEN the user uploads a resume successfully THEN the system SHALL display a branded in-app toast/snackbar with a dark `#0e1212` background, `#7dd3a8` accent text, and the confirmation message, which auto-dismisses after approximately 3 seconds without requiring user interaction  
2.11 WHEN the user saves preferences THEN the system SHALL display the same branded toast confirming the save  
2.12 WHEN a draft application is saved or auto-applied THEN the system SHALL display the branded toast with the appropriate confirmation message  
2.13 WHEN an error occurs (e.g. upload failed, save failed) THEN the system SHALL display the branded toast with a red error accent so the user is informed without leaving the dark theme

### Unchanged Behavior (Regression Prevention)

3.10 WHEN the user triggers a destructive action (e.g. Sign Out, Reset Swipe History) THEN the system SHALL CONTINUE TO use a confirmation dialog (`Alert.alert` with Cancel/Confirm options) because these require explicit user acknowledgement  
3.11 WHEN the app is in an offline state THEN the system SHALL CONTINUE TO show the `OfflineBanner` component independently of the toast system

---

### Bug 5 — Onboarding Typography Too Large and Layout Unpolished

### Current Behavior (Defect)

1.14 WHEN the onboarding welcome carousel renders THEN the system displays `slideTitle` at `fontSize: 26` and `sproutBtnText` at `fontSize: 18`, which appear oversized and heavy on mobile screens  
1.15 WHEN the onboarding carousel renders the slide graphic THEN the system displays `graphicEmoji` at `fontSize: 100`, which dominates the layout and leaves insufficient whitespace for a premium feel  
1.16 WHEN the user views the onboarding screens THEN the system presents a layout that lacks subtle entrance animations, tight letter-spacing, and the refined proportions expected of a premium product

### Expected Behavior (Correct)

2.14 WHEN the onboarding welcome carousel renders THEN the system SHALL display `slideTitle` at a reduced font size (e.g. `fontSize: 22`) with tighter `letterSpacing` and `fontWeight: '700'` for a more refined heading  
2.15 WHEN the onboarding carousel renders the slide graphic THEN the system SHALL display the emoji/graphic at a reduced size (e.g. `fontSize: 72`) with proportionally adjusted container dimensions to create more breathing room  
2.16 WHEN the onboarding carousel renders the Continue button THEN the system SHALL display `sproutBtnText` at a reduced font size (e.g. `fontSize: 16`) consistent with a premium button style  
2.17 WHEN each onboarding slide becomes active THEN the system SHALL apply a subtle fade-in or slide-up entrance animation to the slide content so the transition feels polished

### Unchanged Behavior (Regression Prevention)

3.12 WHEN the user taps "Continue" on the last slide THEN the system SHALL CONTINUE TO advance to the resume upload step  
3.13 WHEN the user scrolls the carousel manually THEN the system SHALL CONTINUE TO update the pagination dots to reflect the active slide  
3.14 WHEN the user completes onboarding THEN the system SHALL CONTINUE TO persist preferences and navigate to the main swipe screen

---

## Bug Condition Summary

### Bug Condition Functions

```pascal
FUNCTION isBugCondition_1(X)
  // Bug 1: Deep-link callback not routed back to app
  INPUT: X of type DeepLinkEvent
  OUTPUT: boolean
  RETURN X.url STARTS_WITH "jobswipeapp://auth/callback"
         AND AndroidManifest LACKS pathPrefix "/callback" in deep-link intent filter
END FUNCTION

FUNCTION isBugCondition_2(X)
  // Bug 2: AUTO-APPLY never shown
  INPUT: X of type JobCard
  OUTPUT: boolean
  RETURN X.match_score < auto_apply_threshold
         AND all cards in deck satisfy this condition
END FUNCTION

FUNCTION isBugCondition_3(X)
  // Bug 3: Next card invisible after swipe
  INPUT: X of type CardRenderState
  OUTPUT: boolean
  RETURN X.cardIndex > 0  // non-top card rendered with opacity: 0
END FUNCTION

FUNCTION isBugCondition_4(X)
  // Bug 4: Plain system alert used for non-destructive feedback
  INPUT: X of type FeedbackEvent
  OUTPUT: boolean
  RETURN X.type IN { 'resume_uploaded', 'draft_saved', 'prefs_saved', 'auto_applied' }
END FUNCTION

FUNCTION isBugCondition_5(X)
  // Bug 5: Onboarding typography oversized
  INPUT: X of type OnboardingStyle
  OUTPUT: boolean
  RETURN X.slideTitle_fontSize >= 26
         OR X.sproutBtnText_fontSize >= 18
         OR X.graphicEmoji_fontSize >= 100
END FUNCTION
```

### Preservation Properties

```pascal
// For all bugs: non-buggy inputs must behave identically before and after the fix
FOR ALL X WHERE NOT isBugCondition_1(X) DO
  ASSERT F(X) = F'(X)  // Normal app launch and existing auth flows unchanged
END FOR

FOR ALL X WHERE NOT isBugCondition_2(X) DO
  ASSERT F(X) = F'(X)  // Jobs scoring >= threshold still trigger AUTO-APPLY
END FOR

FOR ALL X WHERE NOT isBugCondition_3(X) DO
  ASSERT F(X) = F'(X)  // Top card rendering, swipe gestures, overlays unchanged
END FOR

FOR ALL X WHERE NOT isBugCondition_4(X) DO
  ASSERT F(X) = F'(X)  // Destructive-action confirmation dialogs unchanged
END FOR

FOR ALL X WHERE NOT isBugCondition_5(X) DO
  ASSERT F(X) = F'(X)  // Onboarding navigation and data persistence unchanged
END FOR
```

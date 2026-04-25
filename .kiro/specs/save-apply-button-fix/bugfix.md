# Bugfix Requirements Document

## Introduction

The "Confirm & Save" button (and "AUTO-APPLY" button) on `HILReviewScreen` appears to respond to taps visually but produces no observable effect — no draft is saved, no alert is shown, and no navigation occurs. The root cause is an unhandled exception inside the `handleConfirm` async function: `uuidv4()` from the `uuid` package throws at runtime in React Native because `crypto.getRandomValues` is not polyfilled, and the absence of a `try/catch` block means the error is silently swallowed, preventing the `Alert.alert` and `navigation.navigate('Main')` calls from ever executing. A secondary issue is that `setItem` inside the Zustand `set()` callback in `useApplicationStore.saveDraft` is not awaited, meaning storage writes are fire-and-forget even when the save does proceed.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the user taps "Confirm & Save" on HILReviewScreen THEN the system silently swallows the runtime error thrown by `uuidv4()` and does nothing — no draft is saved, no alert is shown, and no navigation occurs.

1.2 WHEN `uuidv4()` is called without the `react-native-get-random-values` polyfill imported before `uuid` THEN the system throws a `TypeError: crypto.getRandomValues is not a function` error at runtime.

1.3 WHEN `saveDraft` is called and `setItem` executes inside the Zustand `set()` synchronous callback THEN the system does not await the async storage write, meaning the draft may not be persisted before the function resolves.

1.4 WHEN `handleConfirm` throws any error THEN the system provides no error feedback to the user because there is no `try/catch` block wrapping the function body.

### Expected Behavior (Correct)

2.1 WHEN the user taps "Confirm & Save" on HILReviewScreen THEN the system SHALL save the draft application, show a confirmation alert, and navigate to the Main screen.

2.2 WHEN `uuidv4()` is called THEN the system SHALL generate a valid UUID without throwing, because the `react-native-get-random-values` polyfill is imported at the app entry point before `uuid` is used.

2.3 WHEN `saveDraft` is called THEN the system SHALL await the `setItem` storage write so that the draft is fully persisted before the function resolves.

2.4 WHEN `handleConfirm` encounters any error THEN the system SHALL catch the error and display a user-facing error alert (e.g., "Failed to save. Please try again.") instead of silently failing.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the user taps "Skip" on HILReviewScreen THEN the system SHALL CONTINUE TO navigate to the Main screen without saving a draft.

3.2 WHEN the user taps "AUTO-APPLY" on HILReviewScreen THEN the system SHALL CONTINUE TO save the draft with `status: 'auto-applied'`, mark the job as auto-applied, show a confirmation alert, and navigate to the Main screen.

3.3 WHEN the cover letter generation times out THEN the system SHALL CONTINUE TO display the manual entry fallback UI with a "Save Draft" button.

3.4 WHEN the user edits the generated cover letter before confirming THEN the system SHALL CONTINUE TO save the edited text as the draft cover letter.

3.5 WHEN `loadDrafts` is called THEN the system SHALL CONTINUE TO load and return all previously persisted draft applications from storage.

---

## Bug Condition Pseudocode

**Bug Condition Function** — identifies inputs that trigger the silent failure:

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type TapEvent on HILReviewScreen confirm/auto-apply button
  OUTPUT: boolean

  // Bug is triggered whenever handleConfirm is invoked without the uuid polyfill
  RETURN react-native-get-random-values IS NOT imported before uuid in app entry point
END FUNCTION
```

**Property: Fix Checking**

```pascal
// For all confirm/auto-apply taps where the bug condition holds
FOR ALL X WHERE isBugCondition(X) DO
  result ← handleConfirm'(X)
  ASSERT draft IS saved in store
  ASSERT Alert.alert WAS called with confirmation message
  ASSERT navigation.navigate('Main') WAS called
  ASSERT no unhandled exception propagated to the user
END FOR
```

**Property: Preservation Checking**

```pascal
// For all non-buggy inputs (polyfill present, no storage failure)
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT handleConfirm(X) = handleConfirm'(X)
  // i.e., save + alert + navigate behaviour is identical
END FOR
```

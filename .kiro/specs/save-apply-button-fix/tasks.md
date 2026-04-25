# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Silent Failure When Polyfill Missing
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the silent failure in `handleConfirm`
  - **Scoped PBT Approach**: Scope the property to the concrete failing case — mock `uuidv4` to throw `TypeError: crypto.getRandomValues is not a function`, invoke `handleConfirm('draft')`, and assert that `Alert.alert` IS called with a confirmation message and `navigation.navigate('Main')` IS called
  - Test that `handleConfirm('draft')` completes successfully (saves draft, shows alert, navigates) for any valid job object and cover letter string (from Bug Condition in design: `isBugCondition(X)` = polyfill not imported before uuid)
  - Run test on UNFIXED code — expect FAILURE (confirms the bug: no alert, no navigation, silent rejection)
  - Document counterexamples found (e.g., "`handleConfirm` rejects silently — `Alert.alert` and `navigation.navigate` are never called because `uuidv4()` throws before `saveDraft` is reached")
  - Also verify: when `saveDraft` throws, `handleConfirm` shows an error alert — assert `Alert.alert` IS called with an error message (will also fail on unfixed code, confirming missing try/catch)
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.4_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Confirm Interactions and Storage Consistency
  - **IMPORTANT**: Follow observation-first methodology — run UNFIXED code with non-buggy inputs first, observe outputs, then write tests
  - Observe: tapping "Skip" calls `navigation.navigate('Main')` without calling `saveDraft` on unfixed code
  - Observe: `loadDrafts` reads from storage and populates `drafts` state correctly on unfixed code
  - Observe: `handleConfirm('auto-applied')` calls `markAutoApplied(job.id)` and saves with `status: 'auto-applied'` (when polyfill is present / `uuidv4` is mocked to succeed)
  - Observe: edited cover letter text is what gets saved in the draft (cover letter value flows through correctly)
  - Write property-based tests:
    - For all valid job objects and cover letter strings (non-empty, empty, special chars, long strings): verify `saveDraft` stores the draft at the head of `drafts` and calls `setItem` with the full updated array
    - For all non-confirm interactions (Skip taps): verify `saveDraft` is never called and `drafts` state is unchanged
    - For random sequences of `saveDraft` / `updateDraft` / `deleteDraft` calls: verify in-memory state and storage remain consistent after each operation
  - Verify all tests PASS on UNFIXED code (confirms baseline behavior to preserve)
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Fix the `RootStackParamList` type for `HILReview` in `AppNavigator.tsx`
  - File: `job-swipe-app/src/navigation/AppNavigator.tsx`
  - Change `HILReview: { job: any; coverLetter: string }` to `HILReview: { job: any; autoApply: boolean }`
  - This matches the actual params destructured in `HILReviewScreen.tsx`: `const { job, autoApply } = route.params`
  - The current type is incorrect and will cause TypeScript errors when navigating to `HILReview` with the correct params
  - _Requirements: 2.1, 2.2_

- [x] 4. Install `react-native-get-random-values` package
  - Check if `react-native-get-random-values` is already listed in `job-swipe-app/package.json`
  - If not installed, run `npm install react-native-get-random-values` inside `job-swipe-app/`
  - For iOS, run `npx pod-install` inside `job-swipe-app/ios/` after installing
  - Verify the package appears in `node_modules` and `package.json` dependencies
  - _Requirements: 2.2_

- [x] 5. Apply the three code fixes

  - [x] 5.1 Add polyfill import as the very first import in `App.tsx`
    - File: `job-swipe-app/App.tsx`
    - Insert `import 'react-native-get-random-values';` as the absolute first line, before all other imports
    - Import order is critical — this polyfill must load before any module that transitively imports `uuid`
    - _Bug_Condition: `isBugCondition(X)` = `react-native-get-random-values` IS NOT imported before `uuid` in `App.tsx`_
    - _Expected_Behavior: `uuidv4()` generates a valid UUID without throwing `TypeError: crypto.getRandomValues is not a function`_
    - _Preservation: All existing imports and app bootstrap logic remain unchanged_
    - _Requirements: 2.1, 2.2_

  - [x] 5.2 Wrap `handleConfirm` in `HILReviewScreen.tsx` with try/catch
    - File: `job-swipe-app/src/screens/HILReviewScreen.tsx`
    - Wrap the entire body of `handleConfirm` in a `try/catch` block
    - In the `catch` block, call `Alert.alert('Error', 'Failed to save. Please try again.')`
    - The happy-path logic (build draft, `saveDraft`, `markAutoApplied`, alert, navigate) remains identical
    - _Bug_Condition: `handleConfirm` has no `try/catch`, so any thrown error (e.g., from `uuidv4()`) is silently swallowed_
    - _Expected_Behavior: On error, user sees "Failed to save. Please try again." alert; on success, draft is saved, confirmation alert shown, navigation to Main occurs_
    - _Preservation: Skip button, AUTO-APPLY flow, timeout fallback UI, and cover letter editing are unaffected_
    - _Requirements: 2.1, 2.4_

  - [x] 5.3 Refactor `saveDraft`, `updateDraft`, `deleteDraft` in `useApplicationStore.ts` to await `setItem` outside `set()` callback
    - File: `job-swipe-app/src/store/useApplicationStore.ts`
    - For each of `saveDraft`, `updateDraft`, `deleteDraft`: compute the new drafts array first, call `set({ drafts })` synchronously, then `await setItem(KEYS.DRAFT_APPLICATIONS, drafts)` in the outer async scope
    - Remove `setItem` calls from inside the synchronous `set(state => { ... })` callback
    - This ensures storage writes are fully awaited before the function resolves, preventing data loss if the app is backgrounded immediately after the in-memory update
    - _Bug_Condition: `setItem` is called inside the synchronous Zustand `set()` callback without being awaited, making storage writes fire-and-forget_
    - _Expected_Behavior: `saveDraft` (and `updateDraft`, `deleteDraft`) fully persist the draft to storage before resolving, so callers can trust the save is complete_
    - _Preservation: `loadDrafts` behavior and the shape of `drafts` state are unchanged_
    - _Requirements: 2.3_

  - [x] 5.4 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Silent Failure When Polyfill Missing
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior (draft saved, alert shown, navigation occurs)
    - When this test passes, it confirms the fix resolves the silent failure
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed — `handleConfirm` completes successfully and shows error alert on failure)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 5.5 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Confirm Interactions and Storage Consistency
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions — Skip, AUTO-APPLY, loadDrafts, cover letter editing, timeout fallback all behave identically)
    - Confirm all tests still pass after fix (no regressions)

- [x] 6. Checkpoint — Ensure all tests pass
  - Run the full test suite for `job-swipe-app`
  - Ensure all tests pass; ask the user if any questions arise
  - Verify TypeScript compiles without errors (check `HILReview` param type fix in `AppNavigator.tsx` is consistent with all navigation call sites)
  - Confirm the polyfill import is the first line in `App.tsx` and no import has been accidentally reordered

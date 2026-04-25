/**
 * Bug Condition Exploration Test — Property 1: Silent Failure When Polyfill Missing
 *
 * **Validates: Requirements 1.1, 1.2, 1.4**
 *
 * CRITICAL: This test MUST FAIL on unfixed code — failure confirms the bug exists.
 * DO NOT attempt to fix the test or the code when it fails.
 * NOTE: This test encodes the expected behavior — it will validate the fix when it
 *       passes after implementation.
 *
 * Bug Condition (isBugCondition):
 *   react-native-get-random-values IS NOT imported before uuid in App.tsx,
 *   causing uuidv4() to throw TypeError: crypto.getRandomValues is not a function.
 *   Since handleConfirm has no try/catch, the error is silently swallowed —
 *   no alert, no navigation, nothing.
 *
 * Documented Counterexamples (observed on unfixed code):
 *   - handleConfirm('draft') rejects silently: Alert.alert is never called and
 *     navigation.navigate is never called because uuidv4() throws before saveDraft
 *     is reached and there is no try/catch to recover.
 *   - When saveDraft throws, handleConfirm also rejects silently: Alert.alert is
 *     never called with an error message because there is no catch block.
 */

import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import * as fc from 'fast-check';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock uuid so we can control whether uuidv4 throws (simulating missing polyfill)
jest.mock('uuid', () => ({
  v4: jest.fn(),
}));

// Mock the application store
jest.mock('../store/useApplicationStore', () => ({
  useApplicationStore: jest.fn(),
}));

// Mock the job store
jest.mock('../store/useJobStore', () => ({
  useJobStore: jest.fn(),
}));

// Mock the API
jest.mock('../api/jobsApi', () => ({
  generateCoverLetter: jest.fn().mockResolvedValue('Generated cover letter text'),
}));

// Mock storage utils
jest.mock('../utils/storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  KEYS: {
    RESUME_SUMMARY: 'resume_summary',
    DRAFT_APPLICATIONS: 'draft_applications',
  },
}));

// Mock navigation components used by the screen
jest.mock('../components/MatchScoreBadge', () => {
  const { Text } = require('react-native');
  return () => <Text>MatchScoreBadge</Text>;
});

jest.mock('../components/LoadingOverlay', () => {
  const { View } = require('react-native');
  return () => <View />;
});

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { v4 as uuidv4 } from 'uuid';
import { useApplicationStore } from '../store/useApplicationStore';
import { useJobStore } from '../store/useJobStore';
import HILReviewScreen from '../screens/HILReviewScreen';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockUuidv4 = uuidv4 as jest.MockedFunction<typeof uuidv4>;
const mockUseApplicationStore = useApplicationStore as jest.MockedFunction<typeof useApplicationStore>;
const mockUseJobStore = useJobStore as jest.MockedFunction<typeof useJobStore>;

/** Build a minimal valid JobCard for route params */
function makeJob(overrides: Partial<{
  id: string;
  title: string;
  company: string;
  description: string;
  apply_url: string;
  match_score: number | null;
}> = {}) {
  return {
    id: 'job-123',
    title: 'Software Engineer',
    company: 'Acme Corp',
    location: 'Remote',
    source: 'linkedin' as const,
    description: 'Build great software.',
    excerpt: 'Build great software.',
    match_score: 85,
    apply_url: 'https://example.com/apply',
    ...overrides,
  };
}

/** Build mock route and navigation objects */
function makeNavigation() {
  return { navigate: jest.fn() };
}

function makeRoute(job = makeJob(), autoApply = false) {
  return { params: { job, autoApply } };
}

/** Set up store mocks with controllable saveDraft */
function setupStoreMocks(saveDraftImpl?: () => Promise<void>) {
  const saveDraft = jest.fn().mockImplementation(saveDraftImpl ?? (() => Promise.resolve()));
  const markAutoApplied = jest.fn();

  mockUseApplicationStore.mockReturnValue({
    drafts: [],
    saveDraft,
    updateDraft: jest.fn(),
    deleteDraft: jest.fn(),
    loadDrafts: jest.fn(),
  } as any);

  mockUseJobStore.mockReturnValue({
    jobs: [],
    markAutoApplied,
    setJobs: jest.fn(),
    loadJobs: jest.fn(),
  } as any);

  return { saveDraft, markAutoApplied };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('HILReviewScreen — Bug Condition Exploration (Property 1)', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  // ── Property 1a: uuidv4 throws (polyfill missing) → handleConfirm should still alert + navigate ──

  /**
   * **Validates: Requirements 1.1, 1.2, 2.4**
   *
   * Bug Condition: uuidv4() throws TypeError (polyfill missing).
   * Expected (post-fix): Alert.alert IS called with an ERROR message (try/catch catches it)
   *   and navigation.navigate is NOT called (save failed, so no navigation).
   * Actual (unfixed): SILENT FAILURE — no alert at all, no navigation.
   *
   * This test WILL FAIL on unfixed code (no alert shown), confirming the bug.
   * After the fix, the try/catch catches the error and shows an error alert.
   */
  it('Property 1a: when uuidv4 throws (polyfill missing), handleConfirm should show error alert (not silent)', async () => {
    // Simulate the bug condition: polyfill not imported, crypto.getRandomValues unavailable
    mockUuidv4.mockImplementation(() => {
      throw new TypeError('crypto.getRandomValues is not a function');
    });

    const { saveDraft } = setupStoreMocks();
    const navigation = makeNavigation();
    const route = makeRoute();

    const { getByText } = render(
      <HILReviewScreen route={route} navigation={navigation} />
    );

    // Wait for cover letter generation to complete
    await waitFor(() => {
      expect(getByText('Confirm & Save')).toBeTruthy();
    });

    // Tap "Confirm & Save" — this triggers handleConfirm('draft')
    await act(async () => {
      fireEvent.press(getByText('Confirm & Save'));
    });

    // EXPECTED (post-fix): Alert.alert IS called with an error message (try/catch works)
    // ACTUAL (unfixed): Alert.alert is NEVER called — silent failure
    expect(alertSpy).toHaveBeenCalledWith(
      'Error',
      expect.stringMatching(/failed to save/i),
    );

    // Navigation should NOT occur when save fails
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  /**
   * **Validates: Requirements 1.1, 1.2, 2.4**
   *
   * Property-based variant: for any valid job object and cover letter string,
   * when uuidv4 throws (polyfill missing), handleConfirm should show an error
   * alert (not silently fail) after the fix.
   *
   * This test WILL FAIL on unfixed code for all generated inputs (no alert at all).
   */
  it('Property 1a (PBT): for any valid job + cover letter, uuidv4 throw → error alert shown (not silent)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate varied job objects
        fc.record({
          id: fc.uuid(),
          title: fc.string({ minLength: 1, maxLength: 100 }),
          company: fc.string({ minLength: 1, maxLength: 100 }),
          description: fc.string({ minLength: 0, maxLength: 500 }),
          apply_url: fc.webUrl(),
          match_score: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
        }),
        // Generate varied cover letter strings (empty, short, long, special chars)
        fc.string({ minLength: 0, maxLength: 1000 }),
        async (jobOverrides, _coverLetterText) => {
          jest.clearAllMocks();
          alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

          // Bug condition: uuidv4 throws
          mockUuidv4.mockImplementation(() => {
            throw new TypeError('crypto.getRandomValues is not a function');
          });

          setupStoreMocks();
          const navigation = makeNavigation();
          const job = makeJob(jobOverrides);
          const route = makeRoute(job);

          const { getByText, unmount } = render(
            <HILReviewScreen route={route} navigation={navigation} />
          );

          await waitFor(() => {
            expect(getByText('Confirm & Save')).toBeTruthy();
          });

          await act(async () => {
            fireEvent.press(getByText('Confirm & Save'));
          });

          // Post-fix: error alert should be shown (try/catch works); pre-fix: silent failure (no alert)
          expect(alertSpy).toHaveBeenCalledWith('Error', expect.stringMatching(/failed to save/i));
          // Navigation should NOT occur when save fails
          expect(navigation.navigate).not.toHaveBeenCalled();

          unmount();
          alertSpy.mockRestore();
        },
      ),
      { numRuns: 10, verbose: true },
    );
  });

  // ── Property 1b: saveDraft throws → handleConfirm should show error alert ──

  /**
   * **Validates: Requirements 1.4**
   *
   * When saveDraft throws (any error), handleConfirm should catch it and
   * show a user-facing error alert.
   *
   * This test WILL FAIL on unfixed code (no try/catch in handleConfirm),
   * confirming the missing error handling.
   */
  it('Property 1b: when saveDraft throws, handleConfirm should show an error alert', async () => {
    // uuidv4 succeeds (polyfill present scenario), but saveDraft throws
    mockUuidv4.mockReturnValue('mock-uuid-1234-5678-abcd-ef0123456789');

    setupStoreMocks(async () => {
      throw new Error('Storage write failed');
    });

    const navigation = makeNavigation();
    const route = makeRoute();

    const { getByText } = render(
      <HILReviewScreen route={route} navigation={navigation} />
    );

    await waitFor(() => {
      expect(getByText('Confirm & Save')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Confirm & Save'));
    });

    // EXPECTED (post-fix): Alert.alert IS called with an error message
    // ACTUAL (unfixed): Alert.alert is NEVER called — silent failure
    expect(alertSpy).toHaveBeenCalledWith(
      'Error',
      expect.stringMatching(/failed to save/i),
    );

    // Navigation should NOT occur when save fails
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * Property-based variant: for any valid job object, when saveDraft throws,
   * handleConfirm should always show an error alert (never silently fail).
   */
  it('Property 1b (PBT): for any valid job, saveDraft throw → error alert shown', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          id: fc.uuid(),
          title: fc.string({ minLength: 1, maxLength: 100 }),
          company: fc.string({ minLength: 1, maxLength: 100 }),
          description: fc.string({ minLength: 0, maxLength: 500 }),
          apply_url: fc.webUrl(),
          match_score: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
        }),
        async (jobOverrides) => {
          jest.clearAllMocks();
          alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

          // uuidv4 succeeds, but saveDraft throws
          mockUuidv4.mockReturnValue('mock-uuid-1234-5678-abcd-ef0123456789');
          setupStoreMocks(async () => {
            throw new Error('Storage write failed');
          });

          const navigation = makeNavigation();
          const job = makeJob(jobOverrides);
          const route = makeRoute(job);

          const { getByText, unmount } = render(
            <HILReviewScreen route={route} navigation={navigation} />
          );

          await waitFor(() => {
            expect(getByText('Confirm & Save')).toBeTruthy();
          });

          await act(async () => {
            fireEvent.press(getByText('Confirm & Save'));
          });

          // Post-fix: error alert should be shown; pre-fix: silent failure
          expect(alertSpy).toHaveBeenCalledWith(
            'Error',
            expect.stringMatching(/failed to save/i),
          );
          expect(navigation.navigate).not.toHaveBeenCalled();

          unmount();
          alertSpy.mockRestore();
        },
      ),
      { numRuns: 10, verbose: true },
    );
  });
});

/**
 * Preservation Property Tests — Property 2: Non-Confirm Interactions and Storage Consistency
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 *
 * IMPORTANT: These tests are written BEFORE the fix is applied.
 * They observe baseline behavior on UNFIXED code and must ALL PASS on unfixed code.
 * After the fix is applied (Task 5), re-running these tests confirms no regressions.
 *
 * Observations on unfixed code:
 *   - Tapping "Skip" calls navigation.navigate('Main') without calling saveDraft
 *   - loadDrafts reads from storage and populates drafts state correctly
 *   - handleConfirm('auto-applied') calls markAutoApplied(job.id) and saves with
 *     status: 'auto-applied' (when uuidv4 is mocked to succeed)
 *   - Edited cover letter text is what gets saved in the draft
 *   - saveDraft stores the draft at the head of drafts and calls setItem with the
 *     full updated array
 */

import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import * as fc from 'fast-check';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock uuid so we can control uuidv4 (simulate polyfill present — success path)
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

// Mock storage utils — we capture setItem calls to verify storage consistency
jest.mock('../utils/storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  KEYS: {
    RESUME_SUMMARY: 'resume_summary',
    DRAFT_APPLICATIONS: 'draft_applications',
  },
}));

// Mock navigation components
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
import { setItem, getItem, KEYS } from '../utils/storage';
import HILReviewScreen from '../screens/HILReviewScreen';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockUuidv4 = uuidv4 as jest.MockedFunction<typeof uuidv4>;
const mockUseApplicationStore = useApplicationStore as jest.MockedFunction<typeof useApplicationStore>;
const mockUseJobStore = useJobStore as jest.MockedFunction<typeof useJobStore>;
const mockSetItem = setItem as jest.MockedFunction<typeof setItem>;
const mockGetItem = getItem as jest.MockedFunction<typeof getItem>;

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

function makeNavigation() {
  return { navigate: jest.fn() };
}

function makeRoute(job = makeJob(), autoApply = false) {
  return { params: { job, autoApply } };
}

/** Set up store mocks with controllable saveDraft */
function setupStoreMocks(saveDraftImpl?: (draft: any) => Promise<void>) {
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

// ─── fast-check arbitraries ───────────────────────────────────────────────────

/** Arbitrary for a valid job object */
const jobArb = fc.record({
  id: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 100 }),
  company: fc.string({ minLength: 1, maxLength: 100 }),
  description: fc.string({ minLength: 0, maxLength: 500 }),
  apply_url: fc.webUrl(),
  match_score: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
});

/** Arbitrary for cover letter strings (empty, short, long, special chars) */
const coverLetterArb = fc.string({ minLength: 0, maxLength: 2000 });

/** Arbitrary for a DraftApplication */
const draftArb = fc.record({
  id: fc.uuid(),
  job_id: fc.uuid(),
  job_title: fc.string({ minLength: 1, maxLength: 100 }),
  company: fc.string({ minLength: 1, maxLength: 100 }),
  apply_url: fc.webUrl(),
  cover_letter: fc.string({ minLength: 0, maxLength: 2000 }),
  status: fc.constantFrom('draft' as const, 'auto-applied' as const),
  created_at: fc.date().map(d => d.toISOString()),
  updated_at: fc.date().map(d => d.toISOString()),
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Preservation Property Tests — Property 2', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    // Default: uuidv4 succeeds (polyfill present scenario)
    mockUuidv4.mockReturnValue('mock-uuid-1234-5678-abcd-ef0123456789');
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  // ── 3.1: Skip Preservation ────────────────────────────────────────────────

  /**
   * **Validates: Requirement 3.1**
   *
   * Observation: tapping "Skip" calls navigation.navigate('Main') without
   * calling saveDraft on unfixed code.
   *
   * Property: For all valid job objects, tapping "Skip" SHALL navigate to Main
   * without calling saveDraft and without changing drafts state.
   *
   * MUST PASS on unfixed code (baseline behavior to preserve).
   */
  it('3.1 (unit): tapping Skip navigates to Main without calling saveDraft', async () => {
    const { saveDraft } = setupStoreMocks();
    const navigation = makeNavigation();
    const route = makeRoute();

    const { getByText } = render(
      <HILReviewScreen route={route} navigation={navigation} />
    );

    await waitFor(() => {
      expect(getByText('Skip')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Skip'));
    });

    // Skip should navigate to Main
    expect(navigation.navigate).toHaveBeenCalledWith('Main');
    // Skip should NOT call saveDraft
    expect(saveDraft).not.toHaveBeenCalled();
  });

  /**
   * **Validates: Requirement 3.1**
   *
   * Property-based variant: for any valid job object, tapping "Skip" SHALL
   * never call saveDraft and SHALL always navigate to Main.
   *
   * MUST PASS on unfixed code.
   */
  it('3.1 (PBT): for any valid job, Skip never calls saveDraft and always navigates to Main', async () => {
    await fc.assert(
      fc.asyncProperty(
        jobArb,
        async (jobOverrides) => {
          jest.clearAllMocks();
          alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
          mockUuidv4.mockReturnValue('mock-uuid-1234-5678-abcd-ef0123456789');

          const { saveDraft } = setupStoreMocks();
          const navigation = makeNavigation();
          const job = makeJob(jobOverrides);
          const route = makeRoute(job, false);

          const { getByText, unmount } = render(
            <HILReviewScreen route={route} navigation={navigation} />
          );

          await waitFor(() => {
            expect(getByText('Skip')).toBeTruthy();
          });

          await act(async () => {
            fireEvent.press(getByText('Skip'));
          });

          // Skip must navigate to Main
          expect(navigation.navigate).toHaveBeenCalledWith('Main');
          // Skip must NOT call saveDraft
          expect(saveDraft).not.toHaveBeenCalled();

          unmount();
          alertSpy.mockRestore();
        },
      ),
      { numRuns: 10, verbose: true },
    );
  });

  // ── 3.2: AUTO-APPLY Preservation ─────────────────────────────────────────

  /**
   * **Validates: Requirement 3.2**
   *
   * Observation: handleConfirm('auto-applied') calls markAutoApplied(job.id)
   * and saves with status: 'auto-applied' (when uuidv4 is mocked to succeed).
   *
   * Property: For all valid job objects, tapping AUTO-APPLY SHALL save the draft
   * with status 'auto-applied', call markAutoApplied(job.id), show a confirmation
   * alert, and navigate to Main.
   *
   * MUST PASS on unfixed code (when uuidv4 is mocked to succeed).
   */
  it('3.2 (unit): AUTO-APPLY saves with status auto-applied and calls markAutoApplied', async () => {
    let capturedDraft: any = null;
    const { saveDraft, markAutoApplied } = setupStoreMocks(async (draft) => {
      capturedDraft = draft;
    });
    const navigation = makeNavigation();
    const job = makeJob();
    const route = makeRoute(job, true); // autoApply = true to show AUTO-APPLY button

    const { getByText } = render(
      <HILReviewScreen route={route} navigation={navigation} />
    );

    await waitFor(() => {
      expect(getByText('⚡ AUTO-APPLY')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('⚡ AUTO-APPLY'));
    });

    // saveDraft should be called
    expect(saveDraft).toHaveBeenCalledTimes(1);
    // Draft should have status 'auto-applied'
    expect(capturedDraft).not.toBeNull();
    expect(capturedDraft.status).toBe('auto-applied');
    expect(capturedDraft.job_id).toBe(job.id);
    // markAutoApplied should be called with the job id
    expect(markAutoApplied).toHaveBeenCalledWith(job.id);
    // Alert should be shown
    expect(alertSpy).toHaveBeenCalledWith('Saved', expect.stringMatching(/auto-applied/i));
    // Navigation should occur
    expect(navigation.navigate).toHaveBeenCalledWith('Main');
  });

  /**
   * **Validates: Requirement 3.2**
   *
   * Property-based variant: for any valid job object, AUTO-APPLY SHALL always
   * save with status 'auto-applied' and call markAutoApplied.
   *
   * MUST PASS on unfixed code (when uuidv4 is mocked to succeed).
   */
  it('3.2 (PBT): for any valid job, AUTO-APPLY always saves status auto-applied and calls markAutoApplied', async () => {
    await fc.assert(
      fc.asyncProperty(
        jobArb,
        async (jobOverrides) => {
          jest.clearAllMocks();
          alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
          mockUuidv4.mockReturnValue('mock-uuid-1234-5678-abcd-ef0123456789');

          let capturedDraft: any = null;
          const { saveDraft, markAutoApplied } = setupStoreMocks(async (draft) => {
            capturedDraft = draft;
          });
          const navigation = makeNavigation();
          const job = makeJob(jobOverrides);
          const route = makeRoute(job, true); // autoApply = true

          const { getByText, unmount } = render(
            <HILReviewScreen route={route} navigation={navigation} />
          );

          await waitFor(() => {
            expect(getByText('⚡ AUTO-APPLY')).toBeTruthy();
          });

          await act(async () => {
            fireEvent.press(getByText('⚡ AUTO-APPLY'));
          });

          expect(saveDraft).toHaveBeenCalledTimes(1);
          expect(capturedDraft).not.toBeNull();
          expect(capturedDraft.status).toBe('auto-applied');
          expect(capturedDraft.job_id).toBe(job.id);
          expect(markAutoApplied).toHaveBeenCalledWith(job.id);
          expect(navigation.navigate).toHaveBeenCalledWith('Main');

          unmount();
          alertSpy.mockRestore();
        },
      ),
      { numRuns: 10, verbose: true },
    );
  });

  // ── 3.4: Cover Letter Edit Preservation ──────────────────────────────────

  /**
   * **Validates: Requirement 3.4**
   *
   * Observation: edited cover letter text is what gets saved in the draft.
   *
   * Property: For all valid job objects and cover letter strings, when the user
   * edits the cover letter and confirms, the saved draft SHALL contain the
   * edited text (not the original generated text).
   *
   * MUST PASS on unfixed code (when uuidv4 is mocked to succeed).
   */
  it('3.4 (unit): edited cover letter text is saved in the draft', async () => {
    let capturedDraft: any = null;
    setupStoreMocks(async (draft) => {
      capturedDraft = draft;
    });
    const navigation = makeNavigation();
    const route = makeRoute();

    const { getByText, getByPlaceholderText } = render(
      <HILReviewScreen route={route} navigation={navigation} />
    );

    await waitFor(() => {
      expect(getByText('Confirm & Save')).toBeTruthy();
    });

    // Edit the cover letter
    const editedText = 'My custom edited cover letter text';
    await act(async () => {
      fireEvent.changeText(
        getByPlaceholderText('Cover letter will appear here…'),
        editedText,
      );
    });

    // Confirm & Save
    await act(async () => {
      fireEvent.press(getByText('Confirm & Save'));
    });

    // The saved draft should contain the edited text
    expect(capturedDraft).not.toBeNull();
    expect(capturedDraft.cover_letter).toBe(editedText);
  });

  /**
   * **Validates: Requirement 3.4**
   *
   * Property-based variant: for any valid job object and any cover letter string,
   * the saved draft SHALL always contain exactly the text that was entered.
   *
   * MUST PASS on unfixed code (when uuidv4 is mocked to succeed).
   */
  it('3.4 (PBT): for any job and cover letter string, the edited text is always saved verbatim', async () => {
    await fc.assert(
      fc.asyncProperty(
        jobArb,
        // Cover letters: non-empty strings (empty string won't trigger a visible change in the editor)
        fc.string({ minLength: 1, maxLength: 500 }),
        async (jobOverrides, editedCoverLetter) => {
          jest.clearAllMocks();
          alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
          mockUuidv4.mockReturnValue('mock-uuid-1234-5678-abcd-ef0123456789');

          let capturedDraft: any = null;
          setupStoreMocks(async (draft) => {
            capturedDraft = draft;
          });
          const navigation = makeNavigation();
          const job = makeJob(jobOverrides);
          const route = makeRoute(job, false);

          const { getByText, getByPlaceholderText, unmount } = render(
            <HILReviewScreen route={route} navigation={navigation} />
          );

          await waitFor(() => {
            expect(getByText('Confirm & Save')).toBeTruthy();
          });

          await act(async () => {
            fireEvent.changeText(
              getByPlaceholderText('Cover letter will appear here…'),
              editedCoverLetter,
            );
          });

          await act(async () => {
            fireEvent.press(getByText('Confirm & Save'));
          });

          // The saved draft must contain exactly the edited text
          expect(capturedDraft).not.toBeNull();
          expect(capturedDraft.cover_letter).toBe(editedCoverLetter);

          unmount();
          alertSpy.mockRestore();
        },
      ),
      { numRuns: 10, verbose: true },
    );
  });

  // ── 3.5: loadDrafts Preservation ─────────────────────────────────────────

  /**
   * **Validates: Requirement 3.5**
   *
   * Observation: loadDrafts reads from storage and populates drafts state correctly.
   *
   * Property: loadDrafts SHALL read from storage and set drafts state to the
   * stored array (or [] if nothing is stored).
   *
   * MUST PASS on unfixed code.
   */
  it('3.5 (unit): loadDrafts reads from storage and populates drafts state', async () => {
    // Import the real store (not mocked) for this test
    const { useApplicationStore: realStore } = jest.requireActual('../store/useApplicationStore');

    const storedDrafts = [
      {
        id: 'draft-1',
        job_id: 'job-1',
        job_title: 'Engineer',
        company: 'Acme',
        apply_url: 'https://example.com',
        cover_letter: 'Hello',
        status: 'draft' as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    // Mock getItem to return stored drafts
    mockGetItem.mockResolvedValueOnce(storedDrafts as any);

    await realStore.getState().loadDrafts();

    const { drafts } = realStore.getState();
    expect(drafts).toEqual(storedDrafts);
    expect(mockGetItem).toHaveBeenCalledWith(KEYS.DRAFT_APPLICATIONS);
  });

  it('3.5 (unit): loadDrafts sets drafts to [] when storage is empty', async () => {
    const { useApplicationStore: realStore } = jest.requireActual('../store/useApplicationStore');

    // Mock getItem to return null (nothing stored)
    mockGetItem.mockResolvedValueOnce(null);

    await realStore.getState().loadDrafts();

    const { drafts } = realStore.getState();
    expect(drafts).toEqual([]);
  });

  // ── saveDraft Storage Consistency ─────────────────────────────────────────

  /**
   * **Validates: Requirements 3.1, 3.5**
   *
   * Property: For all valid DraftApplication objects, saveDraft SHALL store the
   * draft at the HEAD of the drafts array and call setItem with the full updated
   * array.
   *
   * MUST PASS on unfixed code (the in-memory state update and setItem call both
   * happen on unfixed code; only the await is missing).
   */
  it('saveDraft (unit): stores draft at head of drafts and calls setItem with full array', async () => {
    const { useApplicationStore: realStore } = jest.requireActual('../store/useApplicationStore');

    // Reset store state
    realStore.setState({ drafts: [] });
    mockSetItem.mockResolvedValue(undefined);

    const draft = {
      id: 'new-draft-id',
      job_id: 'job-1',
      job_title: 'Engineer',
      company: 'Acme',
      apply_url: 'https://example.com',
      cover_letter: 'Hello world',
      status: 'draft' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await realStore.getState().saveDraft(draft);

    const { drafts } = realStore.getState();
    // Draft should be at the head
    expect(drafts[0]).toEqual(draft);
    expect(drafts).toHaveLength(1);
    // setItem should have been called with the full updated array
    expect(mockSetItem).toHaveBeenCalledWith(KEYS.DRAFT_APPLICATIONS, [draft]);
  });

  /**
   * **Validates: Requirements 3.1, 3.5**
   *
   * Property-based variant: for any valid DraftApplication, saveDraft SHALL
   * always prepend the draft to the existing list and call setItem with the
   * full updated array.
   *
   * MUST PASS on unfixed code.
   */
  it('saveDraft (PBT): for any draft, it is always stored at head and setItem called with full array', async () => {
    await fc.assert(
      fc.asyncProperty(
        draftArb,
        fc.array(draftArb, { minLength: 0, maxLength: 5 }),
        async (newDraft, existingDrafts) => {
          jest.clearAllMocks();
          mockSetItem.mockResolvedValue(undefined);

          const { useApplicationStore: realStore } = jest.requireActual('../store/useApplicationStore');
          // Set up existing drafts
          realStore.setState({ drafts: existingDrafts });

          await realStore.getState().saveDraft(newDraft);

          const { drafts } = realStore.getState();
          // New draft must be at the head
          expect(drafts[0]).toEqual(newDraft);
          // Total length must be existingDrafts.length + 1
          expect(drafts).toHaveLength(existingDrafts.length + 1);
          // setItem must have been called with the full updated array
          expect(mockSetItem).toHaveBeenCalledWith(
            KEYS.DRAFT_APPLICATIONS,
            [newDraft, ...existingDrafts],
          );
        },
      ),
      { numRuns: 20, verbose: true },
    );
  });

  // ── Random Sequence: saveDraft / updateDraft / deleteDraft Consistency ────

  /**
   * **Validates: Requirements 3.1, 3.5**
   *
   * Property: For random sequences of saveDraft / updateDraft / deleteDraft calls,
   * in-memory state and storage SHALL remain consistent after each operation.
   *
   * Consistency means: after each operation, setItem is called with the same
   * array that is in the in-memory drafts state.
   *
   * MUST PASS on unfixed code.
   */
  it('(PBT): random sequences of saveDraft/updateDraft/deleteDraft keep state and storage consistent', async () => {
    type Op =
      | { type: 'save'; draft: ReturnType<typeof draftArb['generate']>['value'] }
      | { type: 'update'; updates: { cover_letter: string } }
      | { type: 'delete' };

    const opArb = fc.oneof(
      draftArb.map(draft => ({ type: 'save' as const, draft })),
      fc.string({ minLength: 0, maxLength: 200 }).map(cl => ({
        type: 'update' as const,
        updates: { cover_letter: cl },
      })),
      fc.constant({ type: 'delete' as const }),
    );

    await fc.assert(
      fc.asyncProperty(
        fc.array(opArb, { minLength: 1, maxLength: 10 }),
        async (ops) => {
          jest.clearAllMocks();
          mockSetItem.mockResolvedValue(undefined);

          const { useApplicationStore: realStore } = jest.requireActual('../store/useApplicationStore');
          realStore.setState({ drafts: [] });

          for (const op of ops) {
            const currentDrafts = realStore.getState().drafts;

            if (op.type === 'save') {
              await realStore.getState().saveDraft(op.draft);
              const afterDrafts = realStore.getState().drafts;
              // New draft at head
              expect(afterDrafts[0]).toEqual(op.draft);
              // setItem called with the current in-memory state
              const lastSetItemCall = mockSetItem.mock.calls[mockSetItem.mock.calls.length - 1];
              expect(lastSetItemCall[0]).toBe(KEYS.DRAFT_APPLICATIONS);
              expect(lastSetItemCall[1]).toEqual(afterDrafts);
            } else if (op.type === 'update' && currentDrafts.length > 0) {
              const targetId = currentDrafts[0].id;
              await realStore.getState().updateDraft(targetId, op.updates);
              const afterDrafts = realStore.getState().drafts;
              // Updated draft should have the new cover_letter
              const updated = afterDrafts.find(d => d.id === targetId);
              expect(updated?.cover_letter).toBe(op.updates.cover_letter);
              // setItem called with the current in-memory state
              const lastSetItemCall = mockSetItem.mock.calls[mockSetItem.mock.calls.length - 1];
              expect(lastSetItemCall[0]).toBe(KEYS.DRAFT_APPLICATIONS);
              expect(lastSetItemCall[1]).toEqual(afterDrafts);
            } else if (op.type === 'delete' && currentDrafts.length > 0) {
              const targetId = currentDrafts[0].id;
              await realStore.getState().deleteDraft(targetId);
              const afterDrafts = realStore.getState().drafts;
              // Deleted draft should not be in state
              expect(afterDrafts.find(d => d.id === targetId)).toBeUndefined();
              // setItem called with the current in-memory state
              const lastSetItemCall = mockSetItem.mock.calls[mockSetItem.mock.calls.length - 1];
              expect(lastSetItemCall[0]).toBe(KEYS.DRAFT_APPLICATIONS);
              expect(lastSetItemCall[1]).toEqual(afterDrafts);
            }
            // If update/delete on empty list, skip — no-op
          }
        },
      ),
      { numRuns: 20, verbose: true },
    );
  });
});

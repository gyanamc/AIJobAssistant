/**
 * Guest Mode Integration Tests - Task 9
 * 
 * Validates: Guest users can browse and swipe jobs without authentication
 * 
 * Context from Task 9:
 * - AppNavigator routes to Main tabs after onboarding without checking auth
 * - useAuthStore.loadSession is called but does not block navigation
 * - Guest users can browse SwipeDeck, view job details, and swipe left without auth
 * - No auth gate appears until user tries to apply (swipe right)
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import SwipeDeckScreen from '../screens/SwipeDeckScreen';
import { useAuthStore } from '../store/useAuthStore';
import { useJobStore } from '../store/useJobStore';
import { useApplicationStore } from '../store/useApplicationStore';
import { useApplicationFlow } from '../store/useApplicationFlow';
import { getItem, KEYS } from '../utils/storage';
import type { JobCard } from '../types';

// Mock stores and utilities
jest.mock('../store/useAuthStore');
jest.mock('../store/useJobStore');
jest.mock('../store/useApplicationStore');
jest.mock('../store/useApplicationFlow');
jest.mock('../utils/storage');
jest.mock('../api/jobsApi');

const mockNavigate = jest.fn();
const mockNavigation = { navigate: mockNavigate };

describe('Task 9.1: Verify guest browsing works without auth', () => {
  const sampleJobs: JobCard[] = [
    {
      id: 'job-1',
      job_title: 'Software Engineer',
      company: 'TechCorp',
      location: 'Bangalore',
      source: 'linkedin',
      description: 'Great opportunity',
      excerpt: 'Great opportunity',
      match_score: 85,
      apply_url: 'https://example.com/apply',
      posted_date: '2024-01-15',
    },
    {
      id: 'job-2',
      job_title: 'Frontend Developer',
      company: 'StartupXYZ',
      location: 'Remote',
      source: 'naukri',
      description: 'Build amazing UIs',
      excerpt: 'Build amazing UIs',
      match_score: 78,
      apply_url: 'https://example.com/apply2',
      posted_date: '2024-01-14',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock guest user (not authenticated)
    (useAuthStore as unknown as jest.Mock).mockImplementation((selector) => {
      const state = {
        session: null,
        isAuthenticated: false,
        loadSession: jest.fn().mockResolvedValue(undefined),
        signOut: jest.fn(),
      };
      return selector ? selector(state) : state;
    });

    // Mock job store with sample jobs
    (useJobStore as unknown as jest.Mock).mockImplementation((selector) => {
      const state = {
        deck: sampleJobs,
        isLoading: false,
        isOffline: false,
        error: null,
        fetchFeed: jest.fn(),
        swipeLeft: jest.fn(),
        resetHistory: jest.fn(),
        loadCache: jest.fn().mockResolvedValue(undefined),
      };
      return selector ? selector(state) : state;
    });

    // Mock application store
    (useApplicationStore as unknown as jest.Mock).mockImplementation((selector) => {
      const state = {
        drafts: [],
        loadDrafts: jest.fn().mockResolvedValue(undefined),
        saveDraft: jest.fn(),
        updateDraft: jest.fn(),
        deleteDraft: jest.fn(),
      };
      return selector ? selector(state) : state;
    });

    // Mock application flow
    (useApplicationFlow as unknown as jest.Mock).mockReturnValue({
      handleApply: jest.fn(),
    });

    // Mock storage - onboarding complete
    (getItem as jest.Mock).mockImplementation((key) => {
      if (key === KEYS.PREFERENCES) {
        return Promise.resolve({ onboarding_complete: true });
      }
      return Promise.resolve(null);
    });
  });

  test('Guest user can browse SwipeDeck without authentication', () => {
    const { getByText } = render(
      <SwipeDeckScreen navigation={mockNavigation} />
    );

    // Verify job content is visible to guest
    expect(getByText('TechCorp')).toBeTruthy();
    expect(getByText('Jobs')).toBeTruthy();
  });

  test('Guest user can swipe left (skip) without authentication', () => {
    const mockSwipeLeft = jest.fn();
    
    (useJobStore as unknown as jest.Mock).mockImplementation((selector) => {
      const state = {
        deck: sampleJobs,
        isLoading: false,
        isOffline: false,
        error: null,
        fetchFeed: jest.fn(),
        swipeLeft: mockSwipeLeft,
      };
      return selector ? selector(state) : state;
    });

    const { getByText } = render(
      <SwipeDeckScreen navigation={mockNavigation} />
    );

    // Skip button should be functional for guest
    const skipButton = getByText('✕');
    fireEvent.press(skipButton);
    expect(mockSwipeLeft).toHaveBeenCalled();
  });

  test('Guest user sees AuthGate when trying to apply (swipe right)', () => {
    const { getByText } = render(
      <SwipeDeckScreen navigation={mockNavigation} />
    );

    // Pressing apply should navigate to AuthGate with pending job
    fireEvent.press(getByText('✓'));
    
    expect(mockNavigate).toHaveBeenCalledWith('AuthGate', {
      pendingJob: sampleJobs[0],
    });
  });

  test('Authenticated user does NOT see AuthGate when applying', () => {
    const mockHandleApply = jest.fn();
    
    // Mock authenticated user
    (useAuthStore as unknown as jest.Mock).mockImplementation((selector) => {
      const state = {
        session: {
          access_token: 'token',
          refresh_token: 'refresh',
          user_id: 'user-123',
          email: 'user@example.com',
          expires_at: Date.now() / 1000 + 3600,
        },
        isAuthenticated: true,
        loadSession: jest.fn(),
      };
      return selector ? selector(state) : state;
    });

    (useApplicationFlow as unknown as jest.Mock).mockReturnValue({
      handleApply: mockHandleApply,
    });

    const { getByText } = render(
      <SwipeDeckScreen navigation={mockNavigation} />
    );

    // Pressing apply should call handleApply directly, not navigate to AuthGate
    fireEvent.press(getByText('✓'));
    
    expect(mockNavigate).not.toHaveBeenCalledWith('AuthGate', expect.anything());
    expect(mockHandleApply).toHaveBeenCalledWith(sampleJobs[0]);
  });

  test('SwipeDeckScreen renders all UI elements for guest users', () => {
    const { getByText } = render(
      <SwipeDeckScreen navigation={mockNavigation} />
    );

    // Verify all key UI elements are present
    expect(getByText('Jobs')).toBeTruthy();
    expect(getByText('TechCorp')).toBeTruthy();
    expect(getByText('✕')).toBeTruthy(); // Skip button
    expect(getByText('✓')).toBeTruthy(); // Apply button
    expect(getByText('← skip · apply →')).toBeTruthy();
  });

  test('Guest user can view job details without authentication', () => {
    const { getByText } = render(
      <SwipeDeckScreen navigation={mockNavigation} />
    );

    // Job details should be visible
    expect(getByText('TechCorp')).toBeTruthy();
    expect(getByText('StartupXYZ')).toBeTruthy();
    
    // Deck count should be visible
    expect(getByText('2')).toBeTruthy();
  });
});

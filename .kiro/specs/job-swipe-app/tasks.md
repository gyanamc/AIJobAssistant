# Implementation Plan: Job Swipe App

## Overview

Implement the Job Swipe App in two parallel tracks:
1. **Backend** — add three new FastAPI endpoints and the `job_listings` table to `backend/main.py`
2. **Mobile** — scaffold a new React Native app in `job-swipe-app/` with Zustand stores, navigation, swipe deck, and all screens

Tasks are sequenced so the backend is ready before mobile API integration begins.

---

## Tasks

- [x] 1. Backend: create `job_listings` table and DB migration
  - Add `job_listings` table DDL (id, title, company, location, source, description, apply_url, embedding vector(768), scraped_at, updated_at) to `init_db()` in `backend/main.py`
  - Add `ivfflat` index on the embedding column
  - _Requirements: 13.1, 13.2_

- [x] 2. Backend: implement `GET /api/v1/jobs/feed`
  - [x] 2.1 Add Pydantic response models `JobCardResponse` and `FeedResponse`
    - Fields: id, title, company, location, source, description, excerpt (≤300 chars), match_score (0–100), apply_url
    - _Requirements: 13.1, 13.3_
  - [x] 2.2 Implement the endpoint handler
    - Accept `resume_summary` (required), `exclude_ids` (optional, comma-separated), `limit` (optional, default 20)
    - Embed `resume_summary` via `embed()`, run cosine similarity query against `job_listings`, compute match_score as `round((1 - distance) * 100, 1)`, order descending, filter `exclude_ids`, return `excerpt` as `description[:300]`
    - _Requirements: 13.1, 13.2, 13.3, 13.4_
  - [ ]* 2.3 Write property tests for `/jobs/feed` (pytest + hypothesis)
    - **Property 20: Feed results are ordered by match score descending**
    - **Validates: Requirements 13.2**
    - **Property 19: Job feed response fields are always complete**
    - **Validates: Requirements 13.3**
    - **Property 21: exclude_ids filtering removes all specified jobs**
    - **Validates: Requirements 13.4**

- [x] 3. Backend: implement `POST /api/v1/jobs/cover-letter`
  - [x] 3.1 Add `CoverLetterRequest` Pydantic model (job_id, job_title, company, job_description, resume_summary)
    - _Requirements: 13.5_
  - [x] 3.2 Implement the endpoint handler
    - Build a prompt from job details + resume_summary, call `ollama_chat` internally (or reuse the `/api/v1/ollama/chat` logic), return `{ "cover_letter": string }`
    - Return HTTP 503 if Ollama is unreachable, HTTP 504 on timeout
    - _Requirements: 13.5, 13.6, 13.7_
  - [ ]* 3.3 Write property test for cover letter endpoint
    - **Property 22: Cover letter generation always returns non-empty string**
    - **Validates: Requirements 13.6**

- [x] 4. Backend: implement `POST /api/v1/resume/parse`
  - [x] 4.1 Add multipart file upload handler
    - Accept PDF (`application/pdf`) and plain-text (`text/plain`) files ≤ 5 MB
    - Return HTTP 400 for unsupported type, HTTP 413 for oversized file
    - _Requirements: 13.8, 1.2, 1.3_
  - [x] 4.2 Implement text extraction and LLM parsing
    - Extract text from PDF using `pypdf` (add to `backend/requirements.txt`), pass raw text to Ollama with a structured extraction prompt, return JSON with fields: name, email, phone, skills, experience_summary, target_roles
    - _Requirements: 1.5, 13.8_
  - [ ]* 4.3 Write property tests for resume parse endpoint
    - **Property 1: File validation accepts only valid types and sizes**
    - **Validates: Requirements 1.2, 1.3**
    - **Property 2: Resume parse response always contains required fields**
    - **Validates: Requirements 1.5**

- [x] 5. Checkpoint — Backend endpoints complete
  - Ensure all three endpoints return correct responses with a local Ollama instance; run `pytest backend/` to confirm no regressions.

- [x] 6. React Native app scaffold
  - [x] 6.1 Initialise the project
    - Run `npx react-native init job-swipe-app --template react-native-template-typescript` at repo root
    - _Requirements: (project setup)_
  - [x] 6.2 Install dependencies
    - `react-native-deck-swiper`, `zustand`, `@react-native-async-storage/async-storage`, `@react-navigation/native`, `@react-navigation/stack`, `@react-navigation/bottom-tabs`, `@supabase/supabase-js`, `react-native-document-picker`, `@react-native-community/netinfo`, `fast-check` (dev), `@testing-library/react-native` (dev)
    - _Requirements: (project setup)_
  - [x] 6.3 Create the directory structure
    - Create `src/screens/`, `src/components/`, `src/store/`, `src/api/`, `src/utils/`, `src/navigation/` as empty directories with placeholder index files
    - _Requirements: (project setup)_

- [x] 7. Implement AsyncStorage utilities and local data models
  - [x] 7.1 Create `src/utils/storage.ts`
    - Implement typed `getItem<T>`, `setItem<T>`, `removeItem` helpers wrapping AsyncStorage with `@jsa:` key prefix
    - _Requirements: 1.6, 7.6, 10.4, 14.1, 14.4_
  - [ ]* 7.2 Write property test for storage round-trip
    - **Property 3: Resume summary storage round-trip**
    - **Validates: Requirements 1.6**
    - **Property 6: Auth session storage round-trip**
    - **Validates: Requirements 4.2**
    - **Property 9: Draft application storage round-trip**
    - **Validates: Requirements 5.6, 7.6, 14.4_**
    - **Property 23: Job card cache round-trip**
    - **Validates: Requirements 14.1**
  - [x] 7.3 Create `src/utils/network.ts`
    - Implement `isConnected()` using `@react-native-community/netinfo` and a `withRetry(fn, maxRetries=2)` exponential-backoff wrapper for GET requests
    - _Requirements: 14.2, 14.3_

- [x] 8. Implement Zustand stores
  - [x] 8.1 Create `src/store/useAuthStore.ts`
    - State: `session: AuthSession | null`, `isAuthenticated: boolean`
    - Actions: `signInWithGoogle()` (Supabase OAuth), `signOut()` (clears session key only, preserves drafts/history), `refreshSession()`, `loadSession()` (hydrate from AsyncStorage on app start)
    - _Requirements: 4.1, 4.2, 4.4, 12.3, 12.4, 12.5_
  - [ ]* 8.2 Write property test for sign-out data preservation
    - **Property 17: Sign-out preserves drafts and swipe history**
    - **Validates: Requirements 12.5**
  - [x] 8.3 Create `src/store/useJobStore.ts`
    - State: `deck: JobCard[]`, `swipeHistory: SwipeRecord[]`, `isLoading`, `isOffline`, `error`
    - Actions: `fetchFeed()` (embeds exclude_ids from history, calls `/jobs/feed`, deduplicates client-side, caches to AsyncStorage), `swipeRight(job)` (records `{direction:'right', status:'interested'}`), `swipeLeft(job)` (records `{direction:'left', status:'skipped'}`), `resetHistory()`, `loadCache()` (hydrate from AsyncStorage)
    - Auto-trigger `fetchFeed()` when `deck.length < 3`
    - _Requirements: 2.2, 2.4, 2.5, 3.1, 3.2, 3.7, 10.1, 10.2, 10.3, 10.4_
  - [ ]* 8.4 Write property tests for swipe record creation
    - **Property 4: Swipe right always records an "interested" entry**
    - **Validates: Requirements 3.1, 3.7, 10.1**
    - **Property 5: Swipe left always records a "skipped" entry**
    - **Validates: Requirements 3.2, 3.7**
    - **Property 13: Deck refetch is triggered when fewer than 3 cards remain**
    - **Validates: Requirements 2.4**
    - **Property 14: Swipe history IDs are always included in feed requests**
    - **Validates: Requirements 2.5, 10.2**
    - **Property 15: Client-side deduplication removes all history-present jobs**
    - **Validates: Requirements 10.3**
    - **Property 16: Swipe history persists across store reloads**
    - **Validates: Requirements 10.4**
  - [x] 8.5 Create `src/store/useApplicationStore.ts`
    - State: `drafts: DraftApplication[]`
    - Actions: `saveDraft(draft)`, `updateDraft(id, updates)`, `deleteDraft(id)`, `loadDrafts()` (hydrate from AsyncStorage)
    - _Requirements: 5.6, 7.1, 7.3, 7.4, 7.5, 7.6_
  - [ ]* 8.6 Write property test for draft deletion
    - **Property 10: Deleting a draft removes it from the store**
    - **Validates: Requirements 7.4, 7.5**

- [x] 9. Implement API layer
  - [x] 9.1 Create `src/api/jobsApi.ts`
    - Implement `apiFetch<T>` with friendly HTTP error mapping (no raw codes exposed), `fetchJobFeed(resumeSummary, excludeIds, limit)`, `generateCoverLetter(req: CoverLetterRequest)`
    - _Requirements: 2.2, 5.2, 13.1, 13.5, 14.5_
  - [ ]* 9.2 Write property test for error message safety
    - **Property 24: API errors never expose raw HTTP codes or stack traces to the user**
    - **Validates: Requirements 14.5**
  - [x] 9.3 Create `src/api/resumeApi.ts`
    - Implement `parseResume(file: DocumentPickerResponse)` — multipart POST to `/api/v1/resume/parse`, client-side pre-validation of type and size before upload
    - _Requirements: 1.2, 1.3, 1.4_
  - [ ]* 9.4 Write property test for client-side file validation
    - **Property 1: File validation accepts only valid types and sizes** (client-side validator)
    - **Validates: Requirements 1.2, 1.3**
  - [x] 9.5 Create `src/api/profileApi.ts`
    - Implement `syncProfile(resumeSummary, prefs)` — POST to `/api/v1/profile/sync` with `shareAnonymized: true`
    - _Requirements: 1.8_

- [x] 10. Implement shared UI components
  - [x] 10.1 Create `src/components/MatchScoreBadge.tsx`
    - Props: `score: number | null`; renders colour-coded badge (green ≥80, yellow 50–79, red <50); renders "No score — upload resume" text when score is null
    - _Requirements: 8.1, 8.2, 8.5, 11.4_
  - [ ]* 10.2 Write property test for score badge colour mapping
    - **Property 12: Match score badge colour mapping is always correct**
    - **Validates: Requirements 8.2**
    - **Property 25: No score badge renders when resume is absent**
    - **Validates: Requirements 8.5, 11.4**
  - [x] 10.3 Create `src/components/JobCard.tsx`
    - Props: `job: JobCard`, `onSwipeRight`, `onSwipeLeft`, `onTap`; renders title, company, location, source, excerpt, `MatchScoreBadge`
    - _Requirements: 2.3, 8.1_
  - [ ]* 10.4 Write property test for job card rendering
    - **Property 11: Job card always renders all required fields**
    - **Validates: Requirements 2.3, 8.1**
  - [x] 10.5 Create `src/components/OfflineBanner.tsx`
    - Renders a dismissible banner when `useJobStore.isOffline === true`
    - _Requirements: 14.2_
  - [x] 10.6 Create `src/components/LoadingOverlay.tsx`
    - Full-screen semi-transparent overlay with activity indicator and optional message prop
    - _Requirements: 2.7, 5.3_

- [x] 11. Implement navigation
  - Create `src/navigation/AppNavigator.tsx`
  - Root navigator checks `useAuthStore` + `UserPreferences.onboarding_complete` to route to Onboarding Stack or Main Tab Navigator
  - Main Tab Navigator: SwipeDeckScreen, ApplicationsScreen, ProfileScreen
  - Modal stack: JobDetailSheet, HILReviewScreen, AuthScreen
  - _Requirements: 11.1, 11.2, 11.5_

- [x] 12. Implement screens
  - [x] 12.1 Create `src/screens/OnboardingScreen.tsx`
    - Three-step flow: welcome → resume upload (calls `parseResume` + `syncProfile`, stores `ResumeSummary`) → preferences (target roles, locations, stored as `UserPreferences`)
    - Skip button on resume step; sets `onboarding_complete: true` on finish
    - _Requirements: 11.1, 11.2, 11.3, 11.4_
  - [x] 12.2 Create `src/screens/SwipeDeckScreen.tsx`
    - Renders `react-native-deck-swiper` with `JobCard` renderer, APPLY/SKIP overlay labels, ✓/✗ tap buttons
    - Calls `useJobStore.swipeRight/Left`, shows `LoadingOverlay` while fetching, shows empty-state with refresh button when deck is empty, shows `OfflineBanner`
    - Swipe-right disabled when offline
    - _Requirements: 2.1, 2.6, 2.7, 2.8, 3.1–3.6, 14.2_
  - [x] 12.3 Create `src/screens/JobDetailSheet.tsx`
    - Modal bottom sheet: full description, company, location, source, match score, AI reasoning, Apply/Skip buttons, link to original posting
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - [x] 12.4 Create `src/screens/AuthScreen.tsx`
    - Google sign-in button calling `useAuthStore.signInWithGoogle()`; dismisses and resumes pending application flow on success; cancel returns to deck
    - _Requirements: 4.1, 4.2, 4.3_
  - [x] 12.5 Create `src/screens/HILReviewScreen.tsx`
    - Shows match score, editable cover letter text field, Confirm and Skip buttons
    - On confirm: calls `useApplicationStore.saveDraft()`, shows confirmation, returns to deck
    - On timeout (30 s): shows error with manual-write or skip options
    - _Requirements: 5.1–5.9_
  - [x] 12.6 Create `src/screens/ApplicationsScreen.tsx`
    - Lists `DraftApplication[]` from `useApplicationStore`; tap to view full cover letter + job details; edit/re-save for "draft" status; delete with confirmation
    - _Requirements: 7.1–7.5_
  - [x] 12.7 Create `src/screens/ProfileScreen.tsx`
    - Shows Google avatar + name when authenticated; resume upload/re-upload (re-parses + re-syncs); target roles + locations editor; AUTO-APPLY threshold picker (70–95 step 5); sign-out button; Reset Swipe History button
    - _Requirements: 12.1–12.6, 10.5_
  - [ ]* 12.8 Write property test for AUTO-APPLY threshold validation
    - **Property 18: AUTO-APPLY threshold validation**
    - **Validates: Requirements 12.6**

- [x] 13. Implement AUTO-APPLY and HIL routing logic
  - In `SwipeDeckScreen` (or a `useApplicationFlow` hook): after auth check, read `match_score` vs. `auto_apply_threshold`; if score ≥ threshold show AUTO-APPLY option, else go straight to HIL; on AUTO-APPLY failure fall back to HIL
  - Record "auto-applied" status in swipe history and application store
  - _Requirements: 6.1–6.5_
  - [ ]* 13.1 Write property tests for score-based routing
    - **Property 7: HIL flow is triggered for all scores below 80**
    - **Validates: Requirements 5.1**
    - **Property 8: AUTO-APPLY option is shown for all scores at or above 80**
    - **Validates: Requirements 6.1**

- [x] 14. Checkpoint — Core flows complete
  - Ensure all unit and property tests pass (`jest --runInBand`); manually verify swipe → HIL → draft save and swipe → AUTO-APPLY flows in simulator.

- [x] 15. Wire offline resilience and connectivity monitoring
  - In `useJobStore`, subscribe to `NetInfo` and set `isOffline`; on reconnect call `fetchFeed()` and retry any pending `syncProfile` calls
  - On app start, call `loadCache()` to hydrate deck from AsyncStorage if offline
  - _Requirements: 14.1, 14.2, 14.3_

- [x] 16. Final checkpoint — Ensure all tests pass
  - Run `jest --runInBand` in `job-swipe-app/` and `pytest backend/` — all tests must pass. Ask the user if any questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use `fast-check` (mobile) and `hypothesis` (backend) with minimum 100 iterations
- The backend track (tasks 1–5) can be worked in parallel with the scaffold track (task 6) before converging at task 9

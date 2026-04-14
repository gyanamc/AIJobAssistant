# Requirements Document

## Introduction

The Job Swipe App is a React Native mobile application (iOS + Android) that lets job seekers discover and apply to jobs using a Tinder-like swipe interface. Job cards are sourced from LinkedIn and Naukri via the existing Railway FastAPI backend. Swiping right triggers an AI-assisted application flow (Human-in-the-Loop: AI generates a cover letter, attaches the user's resume, and saves as a draft); high-match jobs additionally offer a one-tap AUTO-APPLY path. Swiping left skips the job. Users can upload a resume and receive AI-powered recommendations without signing in, but must authenticate via Google (Supabase Auth) before any application action is taken. All AI operations (resume parsing, match scoring, cover letter generation) are performed via the Railway backend proxy using Ollama `llama3.2:1b` — no paid LLM is used.

---

## Glossary

- **App**: The React Native mobile application for iOS and Android.
- **Backend**: The existing FastAPI service deployed on Railway.
- **Job_Card**: A single job listing displayed in the swipe deck, sourced from LinkedIn or Naukri.
- **Swipe_Deck**: The stack of Job_Cards presented to the user for swiping.
- **Match_Score**: A numeric relevance score (0–100) computed by the AI_Agent by comparing the user's resume against a job description.
- **AI_Agent**: The server-side agent running on the Backend that parses resumes, computes Match_Score values, and generates cover letters using Ollama.
- **Ollama**: The self-hosted LLM service (`llama3.2:1b`) running on Railway, accessed via the Backend proxy at `/api/v1/ollama/chat`.
- **Cover_Letter**: A short, AI-generated application letter tailored to a specific Job_Card and the user's resume.
- **Draft_Application**: A pending application record containing the Cover_Letter and resume, saved locally and/or to the Backend before submission.
- **HIL**: Human-in-the-Loop — the review step where the user reads and optionally edits the AI-generated Cover_Letter before confirming submission.
- **AUTO-APPLY**: An automated application path available for jobs with Match_Score ≥ 80 that bypasses HIL and submits the application directly.
- **Resume**: A PDF or text file uploaded by the user from their device.
- **Resume_Summary**: A structured text representation of the user's resume, extracted by the AI_Agent and stored on the Backend via `/api/v1/profile/sync`.
- **Supabase_Auth**: The Google OAuth authentication service provided by Supabase, shared with the existing Backend.
- **Vector_Search**: The semantic similarity search performed by the Backend at `/api/v1/recruiter/search` (repurposed for job-to-candidate matching).
- **Swipe_History**: A local record of all jobs the user has swiped right or left on, used to prevent duplicate cards.
- **Notification**: An in-app or push notification informing the user of application status changes.

---

## Requirements

### Requirement 1: Resume Upload and Parsing

**User Story:** As a job seeker, I want to upload my resume so that the app can personalise job recommendations and generate cover letters on my behalf.

#### Acceptance Criteria

1. THE App SHALL provide a resume upload entry point accessible from the onboarding screen and the profile settings screen.
2. WHEN a user selects a file, THE App SHALL accept PDF and plain-text (.txt) resume files up to 5 MB in size.
3. IF a user selects a file larger than 5 MB or of an unsupported type, THEN THE App SHALL display an error message stating the file size or type constraint and not upload the file.
4. WHEN a valid resume file is selected, THE App SHALL upload the file to the Backend for parsing.
5. WHEN the Backend receives a resume file, THE AI_Agent SHALL extract structured fields (name, email, phone, skills, experience summary, target roles) and return a Resume_Summary.
6. WHEN the Resume_Summary is returned, THE App SHALL store it locally on the device and display a confirmation to the user.
7. THE App SHALL allow resume upload and recommendation viewing without requiring the user to be authenticated.
8. WHEN a Resume_Summary is available, THE App SHALL POST the profile to `/api/v1/profile/sync` with `shareAnonymized=true` to enable Backend-side vector matching.
9. IF the Backend is unreachable during resume upload, THEN THE App SHALL display an error message and retain the locally stored resume for retry.

---

### Requirement 2: Job Feed and Swipe Deck

**User Story:** As a job seeker, I want to see a swipeable deck of job cards so that I can quickly browse relevant jobs.

#### Acceptance Criteria

1. THE App SHALL display a Swipe_Deck of Job_Cards on the main screen after a resume has been uploaded.
2. WHEN the Swipe_Deck is loaded, THE App SHALL fetch job listings from the Backend using the user's Resume_Summary as the search query against the existing vector search endpoint.
3. THE App SHALL display each Job_Card with the following fields: job title, company name, location, job source (LinkedIn or Naukri), Match_Score, and a short description excerpt (≤ 300 characters).
4. THE App SHALL pre-load at least 5 Job_Cards in the Swipe_Deck at any time, fetching more from the Backend when fewer than 3 cards remain.
5. THE App SHALL exclude jobs already present in the user's Swipe_History from the fetched results.
6. IF the Backend returns no new jobs, THEN THE App SHALL display an empty-state message indicating no more jobs are available and offer a refresh action.
7. WHILE the Swipe_Deck is loading, THE App SHALL display a loading indicator in place of the card stack.
8. IF the Backend is unreachable when loading the job feed, THEN THE App SHALL display an error message and a retry button.

---

### Requirement 3: Swipe Gestures

**User Story:** As a job seeker, I want to swipe right to apply and swipe left to skip, so that I can make fast decisions about jobs.

#### Acceptance Criteria

1. WHEN a user swipes a Job_Card to the right, THE App SHALL record the action as "interested" in the Swipe_History and trigger the application flow for that job.
2. WHEN a user swipes a Job_Card to the left, THE App SHALL record the action as "skipped" in the Swipe_History and remove the card from the Swipe_Deck without any further action.
3. THE App SHALL provide on-screen tap buttons (✓ and ✗) as alternatives to swipe gestures that produce the same outcomes as right and left swipes respectively.
4. WHEN a card is swiped in either direction, THE App SHALL animate the card off-screen in the corresponding direction within 300 ms.
5. WHEN a card is swiped right, THE App SHALL display a visual "APPLY" overlay on the card during the swipe animation.
6. WHEN a card is swiped left, THE App SHALL display a visual "SKIP" overlay on the card during the swipe animation.
7. THE App SHALL record each swipe action (job ID, direction, timestamp) in the Swipe_History stored on the device.

---

### Requirement 4: Authentication Gate for Applying

**User Story:** As a job seeker, I want to sign in with Google before applying, so that my applications are linked to my account.

#### Acceptance Criteria

1. WHEN a user swipes right on a Job_Card and is not authenticated, THE App SHALL pause the application flow and display a Google sign-in prompt.
2. WHEN the user completes Google OAuth via Supabase_Auth, THE App SHALL store the session token securely on the device and resume the application flow for the job that triggered the prompt.
3. IF the user dismisses the sign-in prompt without authenticating, THEN THE App SHALL cancel the application flow and return the user to the Swipe_Deck without recording the job as applied.
4. WHEN an authenticated session expires, THE App SHALL prompt the user to re-authenticate before allowing any further application actions.
5. THE App SHALL allow unauthenticated users to continue swiping left (skipping) without requiring sign-in.

---

### Requirement 5: Human-in-the-Loop Application Flow

**User Story:** As a job seeker, I want to review and edit an AI-generated cover letter before applying, so that I can ensure the application represents me accurately.

#### Acceptance Criteria

1. WHEN an authenticated user swipes right on a Job_Card with Match_Score < 80, THE App SHALL initiate the HIL flow.
2. WHEN the HIL flow is initiated, THE App SHALL call the Backend AI_Agent to generate a Cover_Letter tailored to the Job_Card and the user's Resume_Summary.
3. WHILE the Cover_Letter is being generated, THE App SHALL display a loading indicator with the message "Generating your cover letter…".
4. WHEN the Cover_Letter is returned, THE App SHALL display it in an editable text field alongside the job details.
5. THE App SHALL allow the user to edit the Cover_Letter text before confirming.
6. WHEN the user confirms the Cover_Letter, THE App SHALL save a Draft_Application containing the Cover_Letter and a reference to the user's resume.
7. WHEN a Draft_Application is saved, THE App SHALL display a confirmation message and return the user to the Swipe_Deck.
8. IF the AI_Agent fails to generate a Cover_Letter within 30 seconds, THEN THE App SHALL display an error message and offer the user the option to write a cover letter manually or skip the application.
9. THE App SHALL display the Match_Score prominently in the HIL review screen.

---

### Requirement 6: AUTO-APPLY Flow

**User Story:** As a job seeker, I want high-match jobs to be applied to automatically so that I don't miss strong opportunities.

#### Acceptance Criteria

1. WHEN an authenticated user swipes right on a Job_Card with Match_Score ≥ 80, THE App SHALL display an AUTO-APPLY option alongside the standard HIL option.
2. WHEN the user selects AUTO-APPLY, THE App SHALL call the Backend AI_Agent to generate a Cover_Letter and immediately submit the Draft_Application without presenting a HIL review step.
3. WHEN AUTO-APPLY submission succeeds, THE App SHALL display a confirmation notification stating the job has been applied to automatically.
4. IF AUTO-APPLY submission fails, THEN THE App SHALL fall back to the HIL flow and notify the user that manual review is required.
5. THE App SHALL record AUTO-APPLY actions in the Swipe_History with a status of "auto-applied".
6. THE App SHALL display the Match_Score threshold for AUTO-APPLY eligibility (≥ 80) to the user in the settings screen.

---

### Requirement 7: Draft Applications Management

**User Story:** As a job seeker, I want to view and manage my saved draft applications, so that I can track what I've applied to.

#### Acceptance Criteria

1. THE App SHALL provide a "My Applications" screen listing all Draft_Applications with their job title, company, application date, and status (draft, auto-applied).
2. WHEN a user taps a Draft_Application, THE App SHALL display the full Cover_Letter and job details.
3. THE App SHALL allow the user to edit and re-save a Draft_Application that has status "draft".
4. THE App SHALL allow the user to delete a Draft_Application from the list.
5. WHEN a Draft_Application is deleted, THE App SHALL remove it from local storage and display a confirmation.
6. THE App SHALL persist Draft_Applications in local device storage so they are available offline.

---

### Requirement 8: Match Score and AI Recommendations

**User Story:** As a job seeker, I want to see how well each job matches my profile so that I can prioritise my applications.

#### Acceptance Criteria

1. WHEN a Job_Card is displayed in the Swipe_Deck, THE App SHALL show the Match_Score as a percentage badge on the card.
2. THE App SHALL colour-code the Match_Score badge: green for scores ≥ 80, yellow for scores 50–79, and red for scores < 50.
3. WHEN a user taps a Job_Card to expand it, THE App SHALL display a short AI-generated reasoning text explaining why the job matches or does not match the user's profile.
4. THE AI_Agent SHALL compute Match_Score by comparing the Resume_Summary embedding against the job description embedding using cosine similarity via the Backend vector search.
5. IF a Match_Score cannot be computed (e.g., no resume uploaded), THEN THE App SHALL display the Job_Card without a score badge and label it "No score — upload resume".

---

### Requirement 9: Job Card Detail View

**User Story:** As a job seeker, I want to read the full job description before deciding to apply, so that I can make an informed decision.

#### Acceptance Criteria

1. WHEN a user taps on a Job_Card in the Swipe_Deck, THE App SHALL display a detail sheet with the full job description, company name, location, job source, Match_Score, and AI reasoning.
2. THE App SHALL provide "Apply" and "Skip" action buttons within the detail sheet that produce the same outcomes as right and left swipes respectively.
3. WHEN the detail sheet is open, THE App SHALL display a link or button to view the original job posting on LinkedIn or Naukri.
4. WHEN the user dismisses the detail sheet, THE App SHALL return to the Swipe_Deck with the same card on top.

---

### Requirement 10: Swipe History and Deduplication

**User Story:** As a job seeker, I want to avoid seeing the same job twice so that my feed stays fresh.

#### Acceptance Criteria

1. THE App SHALL maintain a Swipe_History record on the device containing the job IDs of all swiped jobs.
2. WHEN fetching new Job_Cards from the Backend, THE App SHALL include the list of swiped job IDs so the Backend can exclude them from results.
3. IF the Backend cannot filter by swiped IDs, THEN THE App SHALL filter duplicates client-side before adding cards to the Swipe_Deck.
4. THE App SHALL persist the Swipe_History across app restarts using local device storage.
5. THE App SHALL provide a "Reset Swipe History" option in settings that clears the Swipe_History and refreshes the job feed.

---

### Requirement 11: Onboarding Flow

**User Story:** As a new user, I want a guided onboarding experience so that I can set up my profile and start swiping quickly.

#### Acceptance Criteria

1. WHEN the App is launched for the first time, THE App SHALL display an onboarding flow consisting of: a welcome screen, a resume upload screen, and a preferences screen (target roles, preferred locations).
2. WHEN the user completes onboarding, THE App SHALL navigate to the main Swipe_Deck screen.
3. THE App SHALL allow the user to skip the resume upload step during onboarding and upload later from the profile settings screen.
4. WHEN the user skips resume upload, THE App SHALL display Job_Cards without Match_Score badges and prompt the user to upload a resume from within the Swipe_Deck screen.
5. THE App SHALL not display the onboarding flow on subsequent launches if onboarding has already been completed.

---

### Requirement 12: Profile and Settings Screen

**User Story:** As a job seeker, I want to manage my profile and app preferences so that my recommendations stay relevant.

#### Acceptance Criteria

1. THE App SHALL provide a profile screen where the user can view and update their uploaded resume, target roles, and preferred locations.
2. WHEN the user uploads a new resume, THE App SHALL re-parse it via the AI_Agent and update the stored Resume_Summary and Backend profile.
3. THE App SHALL display the user's Google account name and profile picture when authenticated.
4. THE App SHALL provide a sign-out option that clears the Supabase_Auth session token from the device.
5. WHEN the user signs out, THE App SHALL retain locally stored Draft_Applications and Swipe_History on the device.
6. THE App SHALL display the AUTO-APPLY Match_Score threshold setting (default: 80) and allow the user to adjust it between 70 and 95 in increments of 5.

---

### Requirement 13: Backend API Extensions for Job Feed

**User Story:** As a developer, I want the Backend to serve job listings to the mobile app so that the Swipe_Deck is populated with real data.

#### Acceptance Criteria

1. THE Backend SHALL expose a `GET /api/v1/jobs/feed` endpoint that accepts a `resume_summary` query parameter and returns a ranked list of Job_Cards.
2. WHEN `GET /api/v1/jobs/feed` is called, THE Backend SHALL perform a vector similarity search using the resume summary embedding against stored job listings from LinkedIn and Naukri scrapers.
3. THE Backend SHALL return each Job_Card with: job ID, title, company, location, source (linkedin/naukri), description, Match_Score, and apply URL.
4. THE Backend SHALL accept an optional `exclude_ids` parameter (comma-separated job IDs) and omit those jobs from the response.
5. THE Backend SHALL expose a `POST /api/v1/jobs/cover-letter` endpoint that accepts a job ID and Resume_Summary and returns an AI-generated Cover_Letter string using Ollama.
6. WHEN `POST /api/v1/jobs/cover-letter` is called, THE AI_Agent SHALL generate the Cover_Letter using the `llama3.2:1b` model via the Ollama proxy at `/api/v1/ollama/chat`.
7. IF Ollama is unavailable when generating a Cover_Letter, THEN THE Backend SHALL return HTTP 503 with a descriptive error message.
8. THE Backend SHALL expose a `POST /api/v1/resume/parse` endpoint that accepts a resume file (PDF or text) and returns a structured Resume_Summary JSON object.

---

### Requirement 14: Offline and Error Resilience

**User Story:** As a job seeker, I want the app to handle network errors gracefully so that I don't lose my work when connectivity is poor.

#### Acceptance Criteria

1. THE App SHALL cache the most recently fetched batch of Job_Cards in local storage so they remain viewable when the device is offline.
2. WHEN the device is offline, THE App SHALL display a banner indicating offline mode and disable swipe-right (apply) actions.
3. WHEN connectivity is restored, THE App SHALL automatically retry any pending Backend requests and remove the offline banner.
4. THE App SHALL persist Draft_Applications locally so they are not lost during network outages or app restarts.
5. IF any Backend API call returns an error, THEN THE App SHALL display a user-friendly error message and not expose raw HTTP status codes or stack traces to the user.

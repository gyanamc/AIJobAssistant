# AI Job Assistant Extension (v2.1.0)

## v2.1.0 release summary (November 8, 2026)

- Application tracker with eight stages, per-job dates, recruiter details, notes, last-updated timestamps, stage counters, search, filters, and deletion confirmation.
- Follow-up dashboard classifies local calendar dates as overdue, due today, or upcoming; users can complete or reschedule follow-ups without notification/alarm permissions.
- Narrow-panel comparison for up to three saved jobs, including evidence scores, coverage reliability, skills, status, and original URLs. Missing values are explicitly unavailable and no ranking is fabricated.
- Evidence-based actionable insights separate resume-supported strengths, missing essential requirements, and learning recommendations.
- Legacy saved jobs are migrated in place with tracker defaults while IDs, URLs, evaluation data, and CSV compatibility are preserved. Save refreshes retain tracker fields.
- CSV export adds status, application date, follow-up date, contact name/email, and notes with RFC-style quote/newline escaping.
- BYOK keys remain local at rest and are never sent to the AI Job Assistant backend; user-initiated requests transmit them directly to the selected provider for authentication.
- Gemini uses the documented `x-goog-api-key` header and active `gemini-3.8-flash` generateContent endpoint. No new Chrome permissions were added.
- Packaging: run `python3 scripts/build_zip.py` from the repository root. It produces and validates `dist/AIJobAssistant-v2.1.0.zip` with `manifest.json` at the archive root.

Known limitations: reminders are in-extension only; comparison selection lasts for the current side-panel session; headless MV3 smoke testing verifies service-worker startup and side-panel resource resolution but not visible native side-panel interaction.

## 1. Selected Anthropic Model and API Compatibility
- **Model Identifier**: `claude-sonnet-5` (centralized in `background/background.js` as `const ANTHROPIC_MODEL`).
- **Endpoint**: Anthropic Messages API (`POST https://api.anthropic.com/v1/messages`).
- **API Version**: `anthropic-version: 2026-10-21`.
- **Browser Header**: `anthropic-dangerous-direct-browser-access: true` is included to permit direct client-side BYOK requests without requiring an intermediary proxy.
- **Shared Implementation**: Single shared helper `requestAnthropicText()` handles all Anthropic requests:
  - Job Evaluation (`evalWithAnthropic`)
  - Cover Letter Generation (`callLLM`)
  - Resume Summary Rewriting (`callLLM`)
- **Payload Structure**: Strictly sends `model`, `max_tokens`, optional `system`, and `messages: [{ role: 'user', content: prompt }]`. No deprecated parameters are sent.
- **Error Handling & Key Safety**: Specifically translates HTTP 400, 401, 403, 429, and 500+ into sanitized, user-friendly error messages via `providerHttpError`. API keys and raw network traces are never surfaced in logs, error toasts, or the DOM.

## 2. Resume Rewriting Factuality Safeguards
- **Input Validation**: `rewriteResume()` validates that `resumeSummary` exists and is non-empty after trimming whitespace before any LLM call. If missing or whitespace-only, it aborts immediately and instructs the user to complete their Profile tab.
- **Factuality Constraints**: The prompt strictly enforces that candidate facts originate solely from the candidate's existing resume summary.
- **Explicit Inventions Prohibited**: Prohibits inventing employers, job titles, employment dates, certifications, technical skills, projects, revenue, cost savings, metrics, or increasing years of experience. Job requirements cannot be converted into candidate qualifications. Missing requirements are omitted rather than fabricated.
- **Summary Scope**: Restricts output to a concise 3–4 sentence tailored summary.
- **Empty Output Protection**: Verifies the returned text is non-empty; reports an error if the model produces blank output.
- **Profile Integrity**: Tailored summaries are displayed for user review in the UI and can be copied. The original profile in `chrome.storage.local` is never overwritten.
- **Transparency Notice**: The UI displays: *"AI-generated using your existing profile information. Review for accuracy before using. Your saved profile is not changed."*

## 3. Scoring Coverage and Minimum Classification Threshold
- **Dimensions & Weights**:
  - Skills: 40% (token-matched against resume)
  - Requirements: 35%
  - Responsibilities: 25%
- **Item Weights**: Critical (2.0), Important (1.0), Preferred/Excellent (0.5).
- **Deterministic Scoring**: Computed purely from assessment token and evidence matching; `Math.random()` is completely eliminated.
- **Coverage Object (`scoreCoverage`)**:
  - `availability`: flags for skills, requirements, and responsibilities.
  - `availableDimensions`: list of assessed dimensions.
  - `assessedDimensions`: count (0 to 3).
  - `totalDimensions`: 3.
  - `coveragePercentage`: percentage of dimensions assessed.
  - `status`: `'full'` (3), `'partial'` (1–2), or `'unavailable'` (0).
  - `minimumDimensionsForClassification`: 2.
  - `meetsClassificationThreshold`: boolean (`assessedDimensions >= 2`).
- **Classification Policy**:
  - Numeric score threshold (`score >= 60`) determines `is_match` **only** when `assessedDimensions >= 2`.
  - With fewer than 2 dimensions, the model's normalized `is_match` decision is preserved, preventing single-dimension skew from misclassifying jobs.
- **Unavailable Dimensions**: Unassessed dimensions remain `null` and are not treated as zero; available weights are normalized.
- **Saved Jobs Retention**: `scoreCoverage` metadata is preserved across automatic background saves, manual saves, and legacy saved job renderings.

## 4. Profile Consent Integration Test Behavior
- **Explicit Versioned Consent**: Consent requires `shareAnonymized === true` and `shareConsentVersion === 1`.
- **First-Time Users**: Sharing defaults to `false`; no background sync to `/api/v1/profile/sync` is performed.
- **Legacy Profiles**: Existing `true` values lacking the current consent version (e.g. from v2.0.6 or unversioned profiles) are treated as unconfirmed and default to unchecked in the UI.
- **Opt-In Flow**: Checking the box and saving profile writes `shareConsentVersion: 1` and triggers profile synchronization to the recruiter platform.
- **Opt-Out Flow**: Unchecking the box disables sharing and prevents future synchronization.
- **Data Deletion Disclosure**: The consent UI and documentation explicitly note that disabling sharing prevents future synchronization but does not delete previously synced records from the backend.

## 5. Security & DOM Testing Methodology
- **Browser Execution**: End-to-end integration tests (`tests/browser_integration.py` invoked via `tests/browser-integration.test.js`) execute in real headless Google Chrome using Playwright.
- **Malicious Payload Injection**: Attacks containing `<script>`, `<img onerror=...>`, `<svg onload=...>`, and `javascript:...` are injected into:
  - Job Title, Company, Description, Location
  - AI Reasoning, Matched Skills, Missing Skills
  - Cover Letter, External Apply URL, Contact Email
  - Saved Job records and Legacy saved records
- **Verification**:
  - Script execution check (`window.__xssExecuted === false`).
  - No `<script>`, `<img>`, or `<svg>` tags injected into DOM trees.
  - Payloads rendered strictly as harmless text via safe DOM manipulation (`textContent` / `createTextNode`).
  - `safeExternalUrl()` blocks `javascript:`, `data:`, and non-HTTP/HTTPS URLs.

## 6. Removal of Unsolicited Review Prompt
- The unsolicited "Rate 5-Stars" in-app review prompt loop after 3 successful scans has been completely excised:
  - HTML container `#reviewPromptCard`, buttons `#rate5StarsBtn` and `#maybeLaterBtn` removed.
  - JavaScript handlers `setupReviewPrompt()` and `handleSuccessfulScan()` removed.
  - Associated state tracking (`successfulScans`, `hasReviewed`) removed from runtime execution.

## 7. Outstanding Limitations
- **Client-Side Direct BYOK**: In BYOK mode, requests originate directly from the extension to provider APIs (OpenAI, Anthropic, Gemini). While keys are stored only in `chrome.storage.local` and never transmitted to our servers, users must safeguard their local browser environments.
- **Candidate Profile Server Deletion**: Disabling sharing halts future syncs; backend profile deletion requires verified candidate ownership, which is not yet present on the unauthenticated sync endpoint.

## 8. v2.0.9 — Final Hardening Pass (November 7, 2026)

### 8a. Historical Score Coverage Compatibility Fix
- **Bug fixed**: `normalizeCoverage()` previously inferred a `partial` or `full` coverage status from raw numeric `skillsScore`/`reqsScore`/`respScore` fields on legacy saved-job records that pre-date the `scoreCoverage` metadata object (introduced in v2.0.8). Some of those scores were produced by the earlier `Math.random()`-based implementation, so inferring coverage from them was incorrect.
- **Fix**: When no valid `scoreCoverage` object is present, `normalizeCoverage()` now returns `{ status: 'legacy', assessedDimensions: 0, totalDimensions: 3 }`. The UI renders "Legacy — coverage unknown" (analysis view) or "Coverage: Legacy" (saved-job chip). No historical records are modified or deleted.

### 8b. Privacy Disclosure Accuracy
- **Corrected `privacy-policy.html`**: Previous wording stated job data was "not sent to any server unless you enable profile sharing" — this was inaccurate. AI evaluation (job scoring, cover letter, resume rewriting) always sends the job title, description, and resume summary to an AI provider. The updated policy accurately documents all four provider paths (free tier via backend proxy to Groq/Ollama; OpenAI BYOK; Gemini BYOK; Anthropic BYOK), what is NOT transmitted (API keys, saved job history), and explicitly notes that backend/provider data retention cannot be verified from the extension code alone.
- **Corrected `CHROMEWEBSTORE.md`**: Removed the blanket "does not collect or transmit user data off-device" statement, which contradicted the AI evaluation data flow. Replaced with an accurate breakdown by provider path.

### 8c. Real MV3 Extension Smoke Test
- **Added `tests/mv3_smoke.py`**: Loads `extension-v2/` as a real unpacked Chrome extension via Chrome/CDP with `--load-extension` / `--headless=new`. Verifies service-worker registration, side-panel resource resolution, runtime API access, extension identity, and service-worker errors. It does not claim visible side-panel rendering, JavaScript initialization, UI interaction, or provider-request interception in headless mode.
- **Added `tests/mv3-smoke.test.js`**: Node.js runner that invokes `mv3_smoke.py` and surfaces skip/pass/fail to the Node test reporter.

### 8d. Test Prerequisites Documentation
- **Added `tests/TESTING.md`**: Complete guide with prerequisite versions, install commands, and exact test-run commands for all three test layers (unit, mocked DOM, real MV3 smoke).
- **Added `tests/requirements.txt`**: Python dependency file (`playwright>=1.40.0`) for reproducible installs.

### 8e. Regression Review — No Issues Found
- No `Math.random()` present in scoring logic.
- No unsafe `innerHTML` injection.
- `shareAnonymized` defaults to `false`.
- Resume rewriting validates non-empty resume before LLM call; factuality constraints enforced in prompt.
- Anthropic uses `claude-sonnet-5` / `anthropic-version: 2026-10-21`.
- All LLM provider errors handled via `providerHttpError`.
- Missing score dimensions remain `null`, not fabricated.
- LinkedIn, Naukri, saved jobs, and CSV export unchanged.
- No unnecessary permissions added; no secrets committed.



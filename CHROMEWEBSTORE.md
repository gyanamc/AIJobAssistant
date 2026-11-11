# Chrome Web Store Listing — AI Job Assistant

> Last Updated: 2026-11-08

## Store Listing

**Extension Name** [REQUIRED]
AI Job Assistant

**Short Description** [REQUIRED]
AI-powered job matcher for LinkedIn and Naukri. Auto-evaluates jobs against your resume. Free to use.

**Detailed Description** [REQUIRED]
AI Job Assistant is your ultimate companion for job hunting on LinkedIn and Naukri. It uses advanced language models to analyze job descriptions and compare them against your resume summary and target roles in real-time.

Key Features:
- Resume Match Score: Instantly see how well your skills, requirements, and responsibilities match the job description.
- Cover Letter Generation: Generate a custom, professional, 2-paragraph cover letter tailored directly to the job post.
- Local Storage & Privacy: Saved jobs, settings, and API keys are kept on your device. Job and resume data is sent to AI providers only when you trigger an evaluation (see Privacy Policy for full details).
- Flexible LLM Integration: Use our free recommended model tier or connect your own API keys for OpenAI, Gemini, or Anthropic.

How to Use:
1. Open the extension side panel.
2. Select target roles, locations, and copy-paste your resume summary into the Profile tab.
3. Browse job listings on LinkedIn or Naukri. Click on any job card to automatically fetch details and generate match scores and custom cover letters.

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
Evaluates and scores job description fit against a user's resume in a side panel.

**Primary Language** [REQUIRED]
English

---

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | icons/icon128.png |
| Screenshot 1 [REQUIRED] | 1280×800 or 640×400 | ⬜ Not created | |
| Screenshot 2 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ Not created | |

---

## Permissions Justification

Every permission listed below is required for the core functionality of the AI Job Assistant extension:

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Required to locally store user profile info (resume summary, target roles) and saved jobs history. |
| `activeTab` | permissions | Allows temporary access to the active job details page on LinkedIn or Naukri. |
| `sidePanel` | permissions | Enables the side panel layout UI for seamless parallel browsing. |
| `tabs` | permissions | Used to query the active tab's URL to verify the platform (LinkedIn/Naukri) and reload the active page when requested. |
| `downloads` | permissions | Allows the user to export their saved jobs list as a CSV file to their local machine. |
| `https://*.linkedin.com/*` | host_permissions | Necessary to parse job postings and inject content scripts for automatic job analysis on LinkedIn. |
| `https://*.naukri.com/*` | host_permissions | Necessary to parse job postings and inject content scripts for automatic job analysis on Naukri. |
| `https://api.openai.com/*` | host_permissions | Required to send user-initiated job scoring and cover letter requests to OpenAI if the user uses a custom OpenAI API key. |
| `https://api.anthropic.com/*` | host_permissions | Required to send user-initiated job scoring and cover letter requests to Anthropic if the user uses a custom Anthropic API key. |
| `https://generativelanguage.googleapis.com/*` | host_permissions | Required to send user-initiated job scoring and cover letter requests to Google Gemini Studio if the user uses a custom Gemini API key. |
| `https://*.railway.app/*` | host_permissions | Used to connect with the backend server for syncing target profiles (if enabled) and processing free-tier Ollama/Groq requests. |

---

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Yes, in the following limited ways:

- **AI Evaluation (job scoring, cover letter, resume rewriting):** When an AI evaluation is triggered, the job title, description, and your resume summary are transmitted to an AI provider. The specific provider depends on your configuration:
  - **Free tier:** Sent via our backend proxy (Railway.app) to Groq's API (with Ollama as fallback).
  - **OpenAI BYOK:** Sent directly from your browser to `api.openai.com`.
  - **Google Gemini BYOK:** Sent directly from your browser to `generativelanguage.googleapis.com`.
  - **Anthropic BYOK:** Sent directly from your browser to `api.anthropic.com`.
- **BYOK authentication:** Keys are stored in `chrome.storage.local`, are not sent to our backend, and are transmitted directly to the selected provider to authenticate user-initiated requests.
- **Profile Sharing (opt-in only):** If you explicitly enable "Share Anonymized Profile", your resume summary, target roles, locations, and skills are sent to our backend server. Disabled by default.
- **What is NOT transmitted to our backend:** BYOK API keys, saved job history, session logs, and settings. BYOK keys necessarily go directly to the selected provider for authentication. No data is transmitted during ordinary browsing — only when evaluation is triggered or profile sharing is explicitly enabled.

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

---

## Privacy Policy

**Privacy Policy URL** [REQUIRED]
https://gyanamc.github.io/AIJobAssistant/privacy-policy.html

---

## Distribution

**Visibility**: Public
**Regions**: All regions
**Pricing**: Free

---

## Developer Info

**Publisher Name** [REQUIRED]
AI Job Assistant Developer

**Contact Email** [REQUIRED]
support@gyanam.store

---

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 2.1.0 | 2026-11-08 | Added application tracking, follow-up management, three-job comparison, actionable fit insights, tracker CSV fields, backward-compatible saved-job migration, corrected BYOK disclosures, and moved Gemini authentication to the `x-goog-api-key` header with an active model. No new permissions. | Draft |
| 2.0.9 | 2026-11-07 | Fixed legacy score coverage labelling (historical records no longer silently upgraded to partial/full coverage); corrected privacy disclosures in privacy-policy.html and CHROMEWEBSTORE.md to accurately reflect AI evaluation data flow; added real MV3 unpacked extension smoke test; added test prerequisites documentation. | Draft |
| 2.0.8 | 2026-11-07 | Modernized Anthropic Claude Sonnet 5 integration, added factuality safeguards for resume rewriting, introduced multi-dimensional scoring coverage with minimum classification thresholds, hardened DOM/URL safety, and removed review prompt loop. | Draft |
| 2.0.7 | 2026-06-17 | Quality and security improvements, deterministic scoring, profile sharing consent. | Published |
| 2.0.6 | 2026-05-10 | Initial MV3 release with side panel and custom BYOK integrations. | Published |

# Product Overview

**AI Job Assistant** (branded "AntiGravity") is a multi-surface AI-powered job hunting platform targeting the Indian job market (LinkedIn + Naukri).

## Components

1. **Browser Extension (extension-v2)** — Chrome extension (Manifest V3) with a side panel UI. Automatically evaluates jobs as users browse LinkedIn/Naukri, scores them against the user's resume, generates cover letters, and saves matched jobs. Supports free mode (backend proxy) and BYOK (OpenAI, Gemini, Anthropic).

2. **Mobile App (job-swipe-app)** — React Native app with a Tinder-style swipe interface for job discovery. Users swipe right to apply, left to skip. Includes AI match scoring, cover letter generation, and a Human-in-the-Loop (HIL) review flow before auto-applying.

3. **Recruiter Platform (recruiter-app)** — Vanilla JS web app for recruiters to search anonymized candidate profiles using semantic/vector search. Candidates opt-in to share profiles; recruiters pay per PII reveal (freemium model).

4. **Backend API (backend/)** — FastAPI service deployed on Railway. Handles Ollama/Groq LLM proxying, candidate profile sync with vector embeddings (pgvector), recruiter search, PII unmasking with event-based billing, and job evaluation.

## Key Business Rules
- Candidate PII is always masked by default; recruiters consume "events" to unmask
- Free tier: 10 unmask events per recruiter
- Candidate profile sharing requires explicit opt-in (`shareAnonymized: true`)
- First recruiter search is free; second requires Supabase auth

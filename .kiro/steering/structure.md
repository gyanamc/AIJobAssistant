# Project Structure

This is a monorepo with four independent sub-projects sharing a common backend.

```
/
├── backend/                  # FastAPI backend (Python)
│   ├── main.py               # All routes, DB init, LLM helpers — single file
│   ├── requirements.txt
│   └── Procfile              # Railway deployment
│
├── extension-v2/             # Chrome extension (Manifest V3, Vanilla JS)
│   ├── manifest.json
│   ├── background/
│   │   └── background.js     # Service worker — bot logic, LLM calls, message routing
│   ├── scripts/
│   │   ├── content_linkedin.js   # DOM scraping for LinkedIn job pages
│   │   └── content_naukri.js     # DOM scraping for Naukri job pages
│   └── sidepanel/
│       ├── sidepanel.html
│       ├── sidepanel.css
│       └── sidepanel.js      # All UI logic — settings, profile, job analysis, saved jobs
│
├── job-swipe-app/            # React Native mobile app
│   ├── App.tsx               # Root — initializes stores, wraps with GestureHandler + SafeArea
│   ├── src/
│   │   ├── api/              # API layer (jobsApi, profileApi, resumeApi)
│   │   ├── components/       # Shared UI components (JobCard, SwipeDeck, Toast, etc.)
│   │   ├── hooks/            # Custom React hooks
│   │   ├── navigation/       # AppNavigator (Stack + Tab setup)
│   │   ├── screens/          # Screen components
│   │   │   ├── SwipeDeckScreen.tsx   # Main swipe UI
│   │   │   ├── HILReviewScreen.tsx   # Human-in-the-loop review before auto-apply
│   │   │   ├── ApplicationsScreen.tsx
│   │   │   ├── ProfileScreen.tsx
│   │   │   ├── OnboardingScreen.tsx
│   │   │   ├── AuthScreen.tsx
│   │   │   └── JobDetailSheet.tsx    # Modal job detail
│   │   ├── store/            # Zustand stores
│   │   │   ├── useAuthStore.ts       # Auth + Supabase client
│   │   │   ├── useJobStore.ts        # Job feed + cache
│   │   │   ├── useApplicationStore.ts # Draft applications
│   │   │   └── useApplicationFlow.ts  # Auto-apply flow state
│   │   ├── utils/            # storage.ts (AsyncStorage helpers), network.ts
│   │   ├── types.ts          # Shared TypeScript interfaces
│   │   └── __tests__/        # Jest + fast-check property-based tests
│   ├── android/              # Android native project
│   └── ios/                  # iOS native project
│
├── recruiter-app/            # Recruiter web app (Vanilla JS, no build)
│   ├── index.html
│   ├── style.css
│   └── app.js                # All logic — auth, search, unmask, render
│
├── data/                     # Local cookie/profile JSON files (not committed to prod)
├── db/                       # Standalone DB helper (legacy)
└── .kiro/
    ├── specs/                # Feature/bugfix specs
    └── steering/             # AI steering documents (this folder)
```

## Conventions

- **Backend**: All API logic lives in `backend/main.py` (single-file pattern). New endpoints follow the existing `@app.post/get` pattern with Pydantic request models.
- **Mobile stores**: One Zustand store per domain. Stores handle their own AsyncStorage persistence. Access stores with selector pattern: `useStore(s => s.field)`.
- **Mobile screens**: Each screen is a default export. Screens use stores directly — no prop drilling.
- **Extension**: All UI state is in `chrome.storage.local`. The background service worker is the single source of truth for bot state and LLM calls. Content scripts only scrape and message the background.
- **Types**: Shared types for the mobile app live in `src/types.ts`. No shared types across sub-projects.
- **Tests**: Property-based tests use `fast-check`. Test files follow `*.test.tsx` naming and live in `src/__tests__/`.
- **No monorepo tooling**: Each sub-project manages its own dependencies independently. There is no root `package.json` or workspace config.

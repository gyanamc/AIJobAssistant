# Tech Stack

## Backend (`backend/`)
- **Runtime**: Python 3.x
- **Framework**: FastAPI with Uvicorn
- **Database**: PostgreSQL + pgvector extension (vector similarity search); SQLite for local dev
- **ORM**: SQLAlchemy (raw `text()` queries, no ORM models)
- **LLMs**: Ollama (local, `nomic-embed-text` for embeddings, `llama3.2:1b` for reasoning) + Groq API (`llama-3.1-8b-instant` for job evaluation)
- **Auth**: Supabase JWT verification via Bearer token
- **HTTP client**: httpx (async)
- **Deployment**: Railway (Procfile-based), `DATABASE_URL` env var auto-injected

### Key env vars
```
OLLAMA_HOST, DATABASE_URL, MAX_FREE_EVENTS, SUPABASE_URL, SUPABASE_SERVICE_KEY, GROQ_API_KEY
```

### Common commands
```bash
# Install deps
pip install -r backend/requirements.txt

# Run locally
uvicorn backend.main:app --reload

# Production (Railway uses Procfile)
# web: uvicorn main:app --host 0.0.0.0 --port $PORT
```

---

## Mobile App (`job-swipe-app/`)
- **Framework**: React Native 0.73.6 (bare workflow, not Expo)
- **Language**: TypeScript 5.0
- **Navigation**: React Navigation v6 (Stack + Bottom Tabs)
- **State management**: Zustand v4
- **Auth**: Supabase JS v2 (Google OAuth via deep link `jobswipeapp://auth/callback`)
- **Gestures/Animation**: react-native-gesture-handler + react-native-reanimated
- **Storage**: AsyncStorage
- **Testing**: Jest + `@testing-library/react-native` + `fast-check` (property-based testing)
- **Bundler**: Metro

### Common commands
```bash
cd job-swipe-app

# Install
npm install

# iOS
npx pod-install ios
npm run ios

# Android
npm run android

# Metro bundler (run manually)
npm run start

# Tests (single run)
npm test -- --runInBand

# Lint
npm run lint
```

---

## Browser Extension (`extension-v2/`)
- **Manifest**: V3
- **Architecture**: Service worker background script + content scripts per platform + side panel UI
- **Language**: Vanilla JS (no build step)
- **Storage**: `chrome.storage.local`
- **Supported platforms**: LinkedIn, Naukri
- **AI modes**: Free (backend proxy at Railway), BYOK (OpenAI / Gemini / Anthropic direct)

No build step — load `extension-v2/` directly as an unpacked extension in Chrome.

---

## Recruiter App (`recruiter-app/`)
- **Stack**: Vanilla HTML/CSS/JS (no framework, no build step)
- **Auth**: Supabase JS CDN (Google OAuth)
- **API**: Calls backend Railway deployment

---

## Infrastructure
- **Backend hosting**: Railway (`aijobassistant-production.up.railway.app`)
- **Database**: PostgreSQL on Railway with pgvector
- **Auth provider**: Supabase (shared across mobile app and recruiter app)

# Requirements Document

## Introduction

This feature adds a "Free" AI model option to the AI Job Assistant Chrome extension. It replaces the broken "Built-in Gemini Nano" option with a two-tier fallback chain: first attempting Groq's free API (using `llama-3.1-8b-instant`), then falling back to a self-hosted Ollama instance proxied through the Railway.app FastAPI backend. Both the Ollama backend URL and the Ollama model name are user-configurable in the extension's Settings panel.

## Glossary

- **Extension**: The AI Job Assistant Chrome MV3 extension (`extension-v2/`).
- **Background**: The extension service worker (`extension-v2/background/background.js`) that handles all LLM calls.
- **Settings_Panel**: The settings view rendered in `extension-v2/sidepanel/sidepanel.html` and managed by `extension-v2/sidepanel/sidepanel.js`.
- **Groq_Client**: The component within Background responsible for calling the Groq REST API.
- **Ollama_Proxy**: The FastAPI endpoint added to `backend/main.py` that forwards requests to a locally-running Ollama instance.
- **Ollama_Client**: The component within Background responsible for calling the Ollama_Proxy.
- **Free_Model**: The new AI model option identified by the value `"free"` in `chrome.storage.local`.
- **Groq_API_Key**: The user-supplied API key for `console.groq.com`, stored locally in `chrome.storage.local`.
- **Ollama_Backend_URL**: The user-configurable URL of the Railway-hosted Ollama_Proxy, stored locally in `chrome.storage.local`. Default: the user's Railway deployment URL.
- **Ollama_Model**: The user-configurable Ollama model name, stored locally in `chrome.storage.local`. Default: `llama3.2:1b`.

---

## Requirements

### Requirement 1: Free Model Option in Settings

**User Story:** As a user, I want to select a "Free" AI model option in Settings, so that I can use the extension without paying for a commercial API key.

#### Acceptance Criteria

1. THE Settings_Panel SHALL display a selectable option labelled "Free (Groq + Ollama fallback)" with value `"free"` in the AI Model dropdown.
2. WHEN the user selects the `"free"` model option, THE Settings_Panel SHALL replace the "Built-in Gemini Nano (Free)" option with the new "Free (Groq + Ollama fallback)" option.
3. WHEN the user selects the `"free"` model option, THE Settings_Panel SHALL display an input field for the Groq API Key labelled "Groq API Key (optional)".
4. WHEN the user selects the `"free"` model option, THE Settings_Panel SHALL display an input field for the Ollama Backend URL labelled "Ollama Backend URL" with a placeholder showing the default Railway URL format.
5. WHEN the user selects the `"free"` model option, THE Settings_Panel SHALL display an input field for the Ollama Model labelled "Ollama Model" pre-filled with the default value `llama3.2:1b`.
6. WHEN the user saves Settings with the `"free"` model selected, THE Settings_Panel SHALL persist `aiModel`, `groqApiKey`, `ollamaBackendUrl`, and `ollamaModel` to `chrome.storage.local`.

---

### Requirement 2: Groq API Integration

**User Story:** As a user, I want the extension to call the Groq API first when the Free model is selected, so that I get fast, free LLM responses when my Groq key is available.

#### Acceptance Criteria

1. WHEN the `"free"` model is selected and a non-empty `groqApiKey` is stored, THE Groq_Client SHALL send a chat completion request to `https://api.groq.com/openai/v1/chat/completions` using model `llama-3.1-8b-instant`.
2. WHEN the Groq API returns a successful HTTP 200 response, THE Groq_Client SHALL parse the response and return the LLM output to the caller.
3. THE Groq_Client SHALL set `response_format: { type: "json_object" }` and `temperature: 0.3` on all requests to ensure structured JSON output.
4. IF the Groq API returns a non-200 HTTP status, THEN THE Groq_Client SHALL return a failure result containing the HTTP status code.
5. IF a network error occurs during the Groq API call, THEN THE Groq_Client SHALL return a failure result containing the error message.
6. IF `groqApiKey` is empty or absent, THEN THE Groq_Client SHALL return a failure result without making a network request.

---

### Requirement 3: Ollama Proxy Endpoint on Railway Backend

**User Story:** As a developer, I want the Railway FastAPI backend to expose an Ollama proxy endpoint, so that the Chrome extension can reach a self-hosted Ollama instance without CORS issues.

#### Acceptance Criteria

1. THE Ollama_Proxy SHALL expose a `POST /api/v1/ollama/chat` endpoint that accepts a JSON body containing `model` (string) and `messages` (array of `{role, content}` objects).
2. WHEN a valid request is received, THE Ollama_Proxy SHALL forward the request to the Ollama `/api/chat` endpoint at `http://localhost:11434` (or the `OLLAMA_HOST` environment variable if set).
3. WHEN Ollama returns a successful response, THE Ollama_Proxy SHALL return the response body to the caller with HTTP 200.
4. IF Ollama is unreachable, THEN THE Ollama_Proxy SHALL return HTTP 503 with a JSON error body `{"detail": "Ollama service unavailable"}`.
5. IF Ollama returns a non-200 status, THEN THE Ollama_Proxy SHALL propagate the status code and error body to the caller.
6. THE Ollama_Proxy SHALL accept an `options` field in the request body to allow passing Ollama-specific parameters (e.g., `temperature`).

---

### Requirement 4: Ollama Client with Fallback Logic

**User Story:** As a user, I want the extension to automatically fall back to Ollama when Groq fails, so that job evaluation continues uninterrupted even without a Groq key or when rate-limited.

#### Acceptance Criteria

1. WHEN the `"free"` model is selected, THE Background SHALL first attempt the Groq_Client and, only if it returns a failure result, attempt the Ollama_Client.
2. WHEN the Ollama_Client is invoked, THE Ollama_Client SHALL send a POST request to `{ollamaBackendUrl}/api/v1/ollama/chat` using the configured `ollamaModel`.
3. WHEN the Ollama_Proxy returns a successful response, THE Ollama_Client SHALL parse the response and return the LLM output to the caller.
4. IF the Ollama_Client request fails (network error or non-200 response), THEN THE Background SHALL return a failure result with a message indicating both Groq and Ollama are unavailable.
5. WHEN the `"free"` model is selected and `ollamaBackendUrl` is empty or absent, THE Ollama_Client SHALL return a failure result without making a network request.
6. THE Background SHALL log which provider (Groq or Ollama) was used for each successful LLM call.

---

### Requirement 5: Configurable Ollama Backend URL and Model

**User Story:** As a user, I want to configure the Ollama backend URL and model in Settings, so that I can point the extension to my own Railway deployment and choose a model that fits my hardware.

#### Acceptance Criteria

1. THE Settings_Panel SHALL read `ollamaBackendUrl` from `chrome.storage.local` on load and populate the Ollama Backend URL field.
2. THE Settings_Panel SHALL read `ollamaModel` from `chrome.storage.local` on load and populate the Ollama Model field, defaulting to `llama3.2:1b` if not set.
3. WHEN the user clears the Ollama Backend URL field and saves, THE Settings_Panel SHALL persist an empty string for `ollamaBackendUrl`.
4. WHEN the user clears the Ollama Model field and saves, THE Settings_Panel SHALL persist `llama3.2:1b` as the default value for `ollamaModel`.

---

### Requirement 6: Removal of Broken Gemini Nano Option

**User Story:** As a user, I want the broken "Built-in Gemini Nano" option removed from the AI Model dropdown, so that I am not confused by a non-functional choice.

#### Acceptance Criteria

1. THE Settings_Panel SHALL NOT display the `"gemini"` (Built-in Gemini Nano) option in the AI Model dropdown.
2. WHEN a user's stored `aiModel` value is `"gemini"` (from a previous session), THE Settings_Panel SHALL treat it as `"free"` and display the Free model fields accordingly.
3. THE Background SHALL NOT invoke `evalWithGeminiNano` for any new evaluation requests.

---

### Requirement 7: Cover Letter and Resume Rewrite with Free Model

**User Story:** As a user, I want cover letter generation and resume rewriting to also use the Free model fallback chain, so that all AI features work consistently with my chosen model.

#### Acceptance Criteria

1. WHEN the `"free"` model is selected and `generateCoverLetter` is called, THE Background SHALL use the Groq → Ollama fallback chain to generate the cover letter.
2. WHEN the `"free"` model is selected and `rewriteResume` is called, THE Background SHALL use the Groq → Ollama fallback chain to rewrite the resume summary.
3. IF both Groq and Ollama fail during cover letter or resume rewrite, THEN THE Background SHALL return `{ success: false, error: "Free LLM unavailable: <reason>" }`.

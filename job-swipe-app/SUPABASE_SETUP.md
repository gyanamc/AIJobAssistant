# Supabase Google Provider Setup for Native Sign-In

This document describes the manual steps required in the Supabase dashboard to configure the Google provider for native Google Sign-In (task 9.3 of the `native-google-signin` spec).

**Validates: Requirements 8.5**

---

## Why This Configuration Is Required

The `@react-native-google-signin/google-signin` SDK generates a Google ID token on-device and exchanges it with Supabase via `supabase.auth.signInWithIdToken({ provider: 'google', token: idToken })`. For Supabase to accept this token, two things must be true:

1. The **Client ID** in the Supabase Google provider must match the Web Client ID used to configure the SDK (`GoogleSignin.configure({ webClientId: ... })`).
2. The **"Skip nonce check"** option must be enabled, because the native SDK does not embed a nonce in the ID token it returns. Without this toggle, Supabase will reject every token with a nonce validation error.

---

## Step-by-Step Instructions

### 1. Open the Supabase Dashboard

Navigate to [https://supabase.com/dashboard](https://supabase.com/dashboard) and select the project used by the job-swipe-app.

### 2. Go to Authentication → Providers

In the left sidebar, click **Authentication**, then click **Providers** in the sub-menu.

```
Supabase Dashboard
└── Authentication
    └── Providers          ← click here
```

### 3. Expand the Google Provider

Scroll down the provider list and click on **Google** to expand its configuration panel.

### 4. Enable the Google Provider

Make sure the **Enable Sign in with Google** toggle is turned **ON**.

### 5. Set the Client ID

In the **Client ID (for iOS)** field (also labelled "Web Client ID" in some dashboard versions), enter the following value exactly:

```
574051414310-knp661clnlioh0nhnpkkvj62855lnon5.apps.googleusercontent.com
```

> This is the OAuth 2.0 Web Client ID from Google Cloud Console. It must match the value of `GOOGLE_WEB_CLIENT_ID` in `src/store/useAuthStore.ts` and the `webClientId` passed to `GoogleSignin.configure()`.

### 6. Set the Client Secret

Enter the corresponding **Client Secret** for the Web Client ID from Google Cloud Console. This value can be found in the Google Cloud Console under **APIs & Services → Credentials → OAuth 2.0 Client IDs → Web client**.

> If you do not have the client secret, retrieve it from Google Cloud Console before proceeding.

### 7. Enable "Skip nonce check"

Locate the **Skip nonce check** toggle and turn it **ON**.

> **This is mandatory.** The native `@react-native-google-signin/google-signin` SDK does not include a nonce in the ID token it returns. If this toggle is off, Supabase will reject every sign-in attempt with a nonce mismatch error, even when the token itself is valid.

### 8. Save the Configuration

Click the **Save** button at the bottom of the Google provider panel.

---

## Verification Checklist

After saving, confirm the following in the dashboard:

- [ ] Google provider is **enabled**
- [ ] Client ID is set to `574051414310-knp661clnlioh0nhnpkkvj62855lnon5.apps.googleusercontent.com`
- [ ] Client Secret is populated
- [ ] **Skip nonce check** is **ON**

---

## Cross-Reference: SDK Configuration in Code

The Web Client ID configured above must match the constant in the AuthStore:

```typescript
// src/store/useAuthStore.ts
const GOOGLE_WEB_CLIENT_ID =
  '574051414310-knp661clnlioh0nhnpkkvj62855lnon5.apps.googleusercontent.com';

GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
```

If these values diverge, `supabase.auth.signInWithIdToken` will return an `invalid_grant` or audience mismatch error.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `invalid nonce` error from Supabase | "Skip nonce check" is off | Enable the toggle and save |
| `invalid_grant` or audience mismatch | Client ID in Supabase doesn't match `GOOGLE_WEB_CLIENT_ID` | Ensure both values are identical |
| `No session returned` thrown by AuthStore | Supabase accepted the token but returned no session | Check that the Google provider is enabled and the Client Secret is correct |
| Sign-in works on Android but not iOS (or vice versa) | Platform-specific `google-services.json` / `GoogleService-Info.plist` mismatch | See `android/` and `ios/` native configuration — the CLIENT_ID in those files must also match |

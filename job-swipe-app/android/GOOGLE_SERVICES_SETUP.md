# Android Google Services Setup

## Current Status

`android/app/google-services.json` is a **placeholder** file. It contains the correct
package name (`com.antigravity.jobs`) and the Web Client ID
(`369645233419-8ila29dtmod6bm5hd0fo95ns9e7ehg52.apps.googleusercontent.com`), but the
Android-specific OAuth client entries still need real SHA-1 fingerprints before Google
Sign-In will work on a device or emulator.

Without the correct SHA-1 entries you will see:
- `DEVELOPER_ERROR` / `ApiException: 10` on Android debug builds
- Sign-in silently failing on Play Store release builds

---

## Steps to complete the setup

### 1. Obtain your SHA-1 fingerprints

**Debug keystore** (already in `android/app/debug.keystore`):
```bash
cd android
./gradlew signingReport
```
Copy the `SHA1` value from the `debug` variant output.

**Release keystore** (your production signing key):
```bash
keytool -list -v -keystore /path/to/your/release.keystore -alias your_alias
```
Copy the `SHA1` value.

### 2. Register the fingerprints in Google Cloud Console

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Open (or create) the **Android OAuth 2.0 Client ID** for `com.antigravity.jobs`
3. Add both SHA-1 fingerprints (debug + release) to the client
4. Save

### 3. Regenerate `google-services.json`

1. In the [Firebase Console](https://console.firebase.google.com/) (or Google Cloud Console),
   download the updated `google-services.json` for the `com.antigravity.jobs` app
2. Replace `android/app/google-services.json` with the downloaded file
3. Verify the file contains `oauth_client` entries with `client_type: 1` for each SHA-1

### 4. Verify the file structure

The final `google-services.json` must contain at minimum:
- A `client_type: 3` entry for the Web Client ID (already present in the placeholder)
- A `client_type: 1` entry with `certificate_hash` = debug SHA-1
- A `client_type: 1` entry with `certificate_hash` = release SHA-1

Both `client_type: 1` entries must have `package_name: "com.antigravity.jobs"`.

### 5. Test

Run a debug build and attempt Google Sign-In. A successful sign-in (no `ApiException: 10`)
confirms the SHA-1 entries are correct.

---

## Placeholder values to replace

| Field | Placeholder value | Replace with |
|---|---|---|
| `mobilesdk_app_id` | `1:369645233419:android:REPLACE_WITH_APP_ID` | Value from Firebase/GCC console |
| Debug `client_id` | `REPLACE_WITH_ANDROID_DEBUG_CLIENT_ID` | Android debug OAuth client ID |
| Debug `certificate_hash` | `REPLACE_WITH_DEBUG_SHA1_FINGERPRINT` | Output of `./gradlew signingReport` |
| Release `client_id` | `REPLACE_WITH_ANDROID_RELEASE_CLIENT_ID` | Android release OAuth client ID |
| Release `certificate_hash` | `REPLACE_WITH_RELEASE_SHA1_FINGERPRINT` | Release keystore SHA-1 |
| `current_key` | `REPLACE_WITH_ANDROID_API_KEY` | Android API key from GCC console |

The Web Client ID (`369645233419-8ila29dtmod6bm5hd0fo95ns9e7ehg52.apps.googleusercontent.com`)
is already correct and must not be changed — it matches the value used in
`GoogleSignin.configure()` and the Supabase Google provider.

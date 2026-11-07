# Testing Guide — AI Job Assistant Extension v2

This document describes the complete test suite for `extension-v2/` and the exact prerequisites and commands needed to run it.

---

## Test layer overview

| Test file | Layer | Runtime | Browser |
|-----------|-------|---------|---------|
| `background.test.js` | Unit tests | Node.js built-in `node:test` | None |
| `policies.test.js` | Unit tests | Node.js built-in `node:test` | None |
| `coverage-compat.test.js` | Unit tests | Node.js built-in `node:test` | None |
| `browser-integration.test.js` | Mocked DOM tests | Node.js → Python → Playwright | Chromium (mocked `chrome.*` APIs via `file://` URL) |
| `mv3-smoke.test.js` | Real unpacked-extension smoke test | Node.js → Python → Playwright | Google Chrome ≥ 112 (real `chrome-extension://` URL, real service worker) |

> **Important distinction**: `browser-integration.test.js` exercises the side-panel HTML with *mocked* `chrome.*` globals — it does not load the extension. `mv3-smoke.test.js` loads the *real* unpacked extension via `--load-extension` and uses the real `chrome-extension://` origin, real APIs and the real MV3 background service worker.

---

## Prerequisites

### 1. Node.js ≥ 18

Required for the `node:test` built-in module used by all Node.js test runners.

```bash
node --version   # must print v18.0.0 or higher
```

Download: https://nodejs.org/

### 2. Python ≥ 3.9

Required for the Playwright-based browser and smoke tests.

```bash
python3 --version   # must print 3.9 or higher
```

Download: https://www.python.org/

### 3. Playwright Python package

```bash
pip install -r extension-v2/tests/requirements.txt
# or directly:
pip install "playwright>=1.40.0"
```

### 4. Playwright browser binaries

For the **mocked DOM tests** (`browser_integration.py`), Playwright's bundled Chromium is sufficient:

```bash
playwright install chromium
```

### 5. Google Chrome ≥ 112 (for the real MV3 smoke test only)

The real unpacked-extension smoke test (`mv3_smoke.py`) requires Google Chrome at:

```
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome   (macOS)
```

Chrome ≥ 112 is required for `--headless=new` mode, which is the only headless mode that supports loading unpacked extensions.

If Chrome is absent, the smoke test prints a clear SKIP message and exits with code 0 (not a failure). The other test layers are unaffected.

Download Google Chrome: https://www.google.com/chrome/

---

## Running the tests

### Unit tests only (fastest — no browser needed)

```bash
node --test extension-v2/tests/background.test.js extension-v2/tests/policies.test.js extension-v2/tests/coverage-compat.test.js
```

### Mocked DOM browser integration tests

Requires Playwright and Chromium (see prerequisites 3 & 4):

```bash
node --test extension-v2/tests/browser-integration.test.js
```

You can also run the Python script directly for verbose output:

```bash
python3 extension-v2/tests/browser_integration.py
```

### Real MV3 extension smoke test

Requires Google Chrome ≥ 112 (see prerequisite 5):

```bash
node --test extension-v2/tests/mv3-smoke.test.js
```

Or directly via Python for verbose output:

```bash
python3 extension-v2/tests/mv3_smoke.py
```

### Full test suite (all layers)

```bash
node --test extension-v2/tests/background.test.js \
              extension-v2/tests/policies.test.js \
              extension-v2/tests/coverage-compat.test.js \
              extension-v2/tests/browser-integration.test.js \
              extension-v2/tests/mv3-smoke.test.js
```

Or using a glob (requires Node.js ≥ 20 for glob support in `--test`):

```bash
node --test 'extension-v2/tests/*.test.js'
```

### Syntax check only (no test execution)

```bash
node --check extension-v2/background/background.js \
              extension-v2/sidepanel/sidepanel.js \
              extension-v2/lib/policies.js \
              extension-v2/scripts/content_linkedin.js \
              extension-v2/scripts/content_naukri.js
```

---

## Missing prerequisites — what you will see

| Situation | Behaviour |
|-----------|-----------|
| Python 3 not installed | `mv3-smoke.test.js` and `browser-integration.test.js` print a clear skip message; the Node test passes (skip, not failure) |
| `playwright` package not installed | `browser_integration.py` / `mv3_smoke.py` print an `ImportError` with install instructions and exit 0 |
| `playwright install chromium` not run | Playwright raises a browser-not-found error; install instructions are printed |
| Chrome not at the standard path | `mv3_smoke.py` prints `SKIP: Chrome not found` and exits 0 |
| Node.js < 18 | `node:test` module not available; install Node.js ≥ 18 |

---

## CI notes

- Unit tests and mocked DOM tests can run in any CI environment with Node.js and Python installed.
- The real MV3 smoke test requires a full Chrome installation and a display (or `--headless=new` support). It is safe to skip in headless CI environments that do not provide Chrome — the skip is reported clearly and is not treated as a pass.
- No real external AI API calls are made during any test. AI endpoint URLs are either mocked (unit/DOM tests) or intercepted and aborted (smoke test).


/**
 * mv3-smoke.test.js — Node.js runner for the real MV3 extension smoke test.
 *
 * This is a SEPARATE test layer from browser-integration.test.js.
 * It invokes mv3_smoke.py which loads the actual unpacked extension in a real
 * Chrome/Chromium process (not a mocked environment).
 *
 * Test layer summary:
 *   background.test.js          — Unit tests (Node vm, no browser)
 *   policies.test.js            — Unit tests (Node vm, no browser)
 *   coverage-compat.test.js     — Unit tests (Node vm, no browser)
 *   browser-integration.test.js — Mocked DOM tests (Playwright + mocked chrome.*)
 *   mv3-smoke.test.js           — Real unpacked MV3 extension smoke test (THIS FILE)
 *
 * The smoke test requires:
 *   - Python >= 3.9
 *   - websockets Python package (pip install websockets)
 *   - Google Chrome >= 112 for --headless=new extension-loading support
 *
 * If prerequisites are missing, mv3_smoke.py exits 0 with a SKIP message.
 * This runner surfaces that message via stdout and passes the Node test, since
 * a missing environment dependency is not a code defect. The skip reason is
 * printed so CI logs are clear about what did and did not run.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('Real MV3 extension smoke test — unpacked extension loads in Chrome', (t) => {
  const script = path.join(__dirname, 'mv3_smoke.py');

  // Confirm Python 3 is available; if not, skip with a clear message.
  const pythonCheck = spawnSync('python3', ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (pythonCheck.error || pythonCheck.status !== 0) {
    t.skip('Python 3 not available — install Python >= 3.9 to run the MV3 smoke test');
    return;
  }

  const result = spawnSync('python3', [script], {
    encoding: 'utf8',
    timeout: 60000,   // allow up to 60s for Chrome launch + page load
    cwd: path.dirname(script),
  });

  // Print all output so test reporters show what happened (pass, skip, or fail)
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  // mv3_smoke.py exits 0 for both PASS and SKIP; exits 1 only on actual failures.
  // This means a "missing Chrome" situation is surfaced as a skip, not a false pass.
  assert.equal(
    result.status,
    0,
    `MV3 smoke test failed (exit ${result.status}).\n` +
    `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
});


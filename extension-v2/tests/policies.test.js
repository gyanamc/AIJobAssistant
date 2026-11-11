const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CONSENT_VERSION,
  hasExplicitSharingConsent,
  consentStorageUpdate,
  safeExternalUrl
} = require('../lib/policies.js');

test('sharing is disabled for first-time users', () => {
  assert.equal(hasExplicitSharingConsent({}), false);
});

test('legacy true value is not treated as verified consent', () => {
  assert.equal(hasExplicitSharingConsent({ shareAnonymized: true }), false);
});

test('explicit current-version opt-in is preserved', () => {
  const stored = consentStorageUpdate(true);
  assert.deepEqual(stored, { shareAnonymized: true, shareConsentVersion: CONSENT_VERSION });
  assert.equal(hasExplicitSharingConsent(stored), true);
});

test('explicit opt-out remains disabled', () => {
  const stored = consentStorageUpdate(false);
  assert.equal(stored.shareAnonymized, false);
  assert.equal(hasExplicitSharingConsent(stored), false);
});

test('unsafe URL schemes are rejected', () => {
  assert.equal(safeExternalUrl('javascript:alert(1)'), null);
  assert.equal(safeExternalUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(safeExternalUrl('https://example.com/jobs/1'), 'https://example.com/jobs/1');
});

test('side panel has no dynamic HTML injection sinks', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'sidepanel', 'sidepanel.js'), 'utf8');
  assert.doesNotMatch(source, /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML\s*\(/);
  for (const malicious of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>']) {
    assert.ok(malicious.includes('<'));
    assert.match(source, /textContent/);
  }
});

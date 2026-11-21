const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CONSENT_VERSION,
  hasExplicitSharingConsent,
  consentStorageUpdate,
  safeExternalUrl,
  shouldShowReviewPrompt,
  getWebStoreReviewUrl,
  extractSkillsFromText,
  getSuggestedSkills,
  mergeUserSkills,
  removeUserSkill,
  generateFollowUpEmailTemplate,
  calculateSearchCardMatchHeuristic
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

test('review prompt is withheld for new users with no milestone activity', () => {
  assert.equal(shouldShowReviewPrompt({}), false);
  assert.equal(shouldShowReviewPrompt({ positiveScansCount: 2 }), false);
  assert.equal(shouldShowReviewPrompt({ coverLettersCount: 1 }), false);
});

test('review prompt triggers on interview/offer milestone', () => {
  assert.equal(shouldShowReviewPrompt({ trackerMilestonesCount: 1 }), true);
});

test('review prompt triggers on 5+ strong matching scans', () => {
  assert.equal(shouldShowReviewPrompt({ positiveScansCount: 5 }), true);
});

test('review prompt triggers on 2+ generated cover letters', () => {
  assert.equal(shouldShowReviewPrompt({ coverLettersCount: 2 }), true);
});

test('review prompt respects hasReviewed and reviewOptOut', () => {
  assert.equal(shouldShowReviewPrompt({ trackerMilestonesCount: 2, hasReviewed: true }), false);
  assert.equal(shouldShowReviewPrompt({ positiveScansCount: 10, reviewOptOut: true }), false);
});

test('review prompt respects 14-day snooze cooldown', () => {
  const now = 1700000000000;
  const recentPrompt = now - (7 * 86400 * 1000); // 7 days ago
  assert.equal(shouldShowReviewPrompt({ trackerMilestonesCount: 1, lastPromptedAt: recentPrompt }, now), false);

  const oldPrompt = now - (15 * 86400 * 1000); // 15 days ago
  assert.equal(shouldShowReviewPrompt({ trackerMilestonesCount: 1, lastPromptedAt: oldPrompt }, now), true);
});

test('getWebStoreReviewUrl formats valid review URL with extension id', () => {
  assert.equal(
    getWebStoreReviewUrl('abcdefghijklmnop'),
    'https://chromewebstore.google.com/detail/abcdefghijklmnop/reviews'
  );
  assert.equal(
    getWebStoreReviewUrl(''),
    'https://chromewebstore.google.com/'
  );
});

test('extractSkillsFromText extracts known technical skills from text', () => {
  const sample = 'Experienced engineer proficient in Python, FastAPI, Docker, and PostgreSQL with some React experience.';
  const extracted = extractSkillsFromText(sample);
  assert.ok(extracted.includes('Python'));
  assert.ok(extracted.includes('FastAPI'));
  assert.ok(extracted.includes('Docker'));
  assert.ok(extracted.includes('PostgreSQL'));
  assert.ok(extracted.includes('React'));
  assert.equal(extracted.includes('Ruby'), false);
});

test('getSuggestedSkills recommends relevant complementary skills', () => {
  const confirmed = ['Python', 'FastAPI'];
  const suggested = getSuggestedSkills(confirmed, 'Backend Engineer');
  assert.ok(Array.isArray(suggested));
  assert.ok(suggested.length > 0);
  // Should suggest Docker or PostgreSQL, but not already confirmed Python
  assert.equal(suggested.includes('Python'), false);
  assert.equal(suggested.includes('FastAPI'), false);
  assert.ok(suggested.includes('Docker') || suggested.includes('PostgreSQL') || suggested.includes('Redis'));
});

test('mergeUserSkills deduplicates and cleans incoming skills', () => {
  const existing = ['Python', 'Docker'];
  const incoming = ['docker', 'fastapi', '  Python  ', 'Kubernetes'];
  const merged = mergeUserSkills(existing, incoming);
  assert.deepEqual(merged, ['Python', 'Docker', 'fastapi', 'Kubernetes']);
});

test('removeUserSkill removes specified skill case-insensitively', () => {
  const skills = ['Python', 'Docker', 'FastAPI'];
  const updated = removeUserSkill(skills, 'docker');
  assert.deepEqual(updated, ['Python', 'FastAPI']);
});

test('generateFollowUpEmailTemplate generates personalized follow-up with role and recruiter', () => {
  const job = {
    title: 'Senior Machine Learning Engineer',
    company: 'Acme AI',
    contactName: 'Sarah Connor',
    appliedDate: '2026-11-10',
    matchedSkills: ['Python', 'PyTorch']
  };
  const { subject, body } = generateFollowUpEmailTemplate(job);
  assert.ok(subject.includes('Senior Machine Learning Engineer'));
  assert.ok(subject.includes('Acme AI'));
  assert.ok(body.includes('Sarah Connor'));
  assert.ok(body.includes('Senior Machine Learning Engineer'));
  assert.ok(body.includes('Python, PyTorch'));
});

test('calculateSearchCardMatchHeuristic returns realistic match scores', () => {
  const skills = ['Python', 'React', 'Docker'];
  const targetRoles = 'Full Stack Engineer, Python Developer';

  // High match: role matches and skills match
  const score1 = calculateSearchCardMatchHeuristic(
    'Senior Full Stack Engineer',
    'Looking for Python, React, and Docker developer',
    skills,
    targetRoles
  );
  assert.ok(score1 >= 80, `Expected score1 >= 80, got ${score1}`);

  // Low match: unrelated role with no matching skills
  const score2 = calculateSearchCardMatchHeuristic(
    'Chief Marketing Officer',
    'Drive brand awareness and performance marketing',
    skills,
    targetRoles
  );
  assert.ok(score2 <= 55, `Expected score2 <= 55, got ${score2}`);
});

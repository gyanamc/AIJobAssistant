/**
 * Regression tests for normalizeCoverage() — Issue 1 fix (v2.0.9)
 *
 * Guards against historical score coverage compatibility regressions.
 * Legacy saved-job records (created before v2.0.8's scoreCoverage field) must
 * never be silently upgraded to partial or full coverage status merely because
 * raw numeric score fields are present.
 *
 * Uses the Node.js built-in test runner (node:test). No network access; no
 * external dependencies.
 *
 * NOTE: normalizeCoverage is imported from lib/coverage.js (the shared
 * production module). This test file no longer duplicates the implementation.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Import from shared production module
const { normalizeCoverage } = require(path.join(__dirname, '..', 'lib', 'coverage.js'));

// ---------------------------------------------------------------------------
// 1. Legacy record with all three numeric scores but no scoreCoverage
//    → must NOT be promoted to partial/full; must be labelled 'legacy'
// ---------------------------------------------------------------------------
test('legacy record with all three numeric scores and no scoreCoverage → status legacy', () => {
  const scores = { skillsScore: 80, reqsScore: 70, respScore: 65 };
  const result = normalizeCoverage(undefined, scores);
  assert.equal(result.status, 'legacy',
    'All three numeric scores present but no scoreCoverage object must not infer coverage');
  assert.equal(result.assessedDimensions, 0);
  assert.equal(result.totalDimensions, 3);
});

// ---------------------------------------------------------------------------
// 2. Legacy record with one or two numeric scores and no scoreCoverage
//    → must also be labelled 'legacy', not 'partial'
// ---------------------------------------------------------------------------
test('legacy record with one numeric score and no scoreCoverage → status legacy', () => {
  const scores = { skillsScore: 60 };
  const result = normalizeCoverage(null, scores);
  assert.equal(result.status, 'legacy');
  assert.equal(result.assessedDimensions, 0);
});

test('legacy record with two numeric scores and no scoreCoverage → status legacy', () => {
  const scores = { skillsScore: 70, reqsScore: 55 };
  const result = normalizeCoverage(undefined, scores);
  assert.equal(result.status, 'legacy');
  assert.equal(result.assessedDimensions, 0);
});

// ---------------------------------------------------------------------------
// 3. New record with valid full coverage (all dimensions assessed)
//    → pass through unchanged
// ---------------------------------------------------------------------------
test('new record with valid full scoreCoverage → preserved as-is', () => {
  const coverage = { assessedDimensions: 3, totalDimensions: 3, status: 'full' };
  const result = normalizeCoverage(coverage, {});
  assert.equal(result.status, 'full');
  assert.equal(result.assessedDimensions, 3);
  assert.equal(result.totalDimensions, 3);
  // Must be the same object reference — not rebuilt
  assert.equal(result, coverage);
});

// ---------------------------------------------------------------------------
// 4. New record with valid partial coverage
//    → pass through unchanged
// ---------------------------------------------------------------------------
test('new record with valid partial scoreCoverage → preserved as-is', () => {
  const coverage = { assessedDimensions: 2, totalDimensions: 3, status: 'partial' };
  const result = normalizeCoverage(coverage, { skillsScore: 80, reqsScore: 70, respScore: null });
  assert.equal(result.status, 'partial');
  assert.equal(result.assessedDimensions, 2);
  assert.equal(result.totalDimensions, 3);
  assert.equal(result, coverage);
});

// ---------------------------------------------------------------------------
// 5. Record with missing or malformed coverage data
//    5a. Empty object (no assessedDimensions / totalDimensions integers)
//    5b. Non-object value (string)
//    5c. Object with wrong types for required fields
// ---------------------------------------------------------------------------
test('malformed scoreCoverage — empty object → status legacy', () => {
  const result = normalizeCoverage({}, { skillsScore: 80, reqsScore: 70, respScore: 65 });
  assert.equal(result.status, 'legacy',
    'An empty scoreCoverage object without integer dimension fields must not infer coverage');
  assert.equal(result.assessedDimensions, 0);
});

test('malformed scoreCoverage — string value → status legacy', () => {
  const result = normalizeCoverage('partial', { skillsScore: 80 });
  // 'partial' is a string; Number.isInteger(undefined) is false → falls to legacy
  assert.equal(result.status, 'legacy');
});

test('malformed scoreCoverage — non-integer dimensions → status legacy', () => {
  // assessedDimensions is a string "3", not an integer — must not be trusted
  const badCoverage = { assessedDimensions: '3', totalDimensions: '3', status: 'full' };
  const result = normalizeCoverage(badCoverage, {});
  assert.equal(result.status, 'legacy',
    'String dimension values must not pass the integer guard');
});

test('malformed scoreCoverage — null → status legacy', () => {
  const result = normalizeCoverage(null, {});
  assert.equal(result.status, 'legacy');
});

// ---------------------------------------------------------------------------
// 6. No arguments (edge case — both parameters default)
// ---------------------------------------------------------------------------
test('no arguments → status legacy with safe defaults', () => {
  const result = normalizeCoverage();
  assert.equal(result.status, 'legacy');
  assert.equal(result.assessedDimensions, 0);
  assert.equal(result.totalDimensions, 3);
});

// ---------------------------------------------------------------------------
// 7. Valid scoreCoverage with 'unavailable' status
//    (a valid object produced by deterministic scorer when no data is available)
//    → must pass through; it is a valid newly-generated record
// ---------------------------------------------------------------------------
test('valid scoreCoverage with unavailable status → preserved as-is', () => {
  const coverage = { assessedDimensions: 0, totalDimensions: 3, status: 'unavailable' };
  const result = normalizeCoverage(coverage, {});
  assert.equal(result.status, 'unavailable');
  assert.equal(result.assessedDimensions, 0);
  assert.equal(result, coverage);
});

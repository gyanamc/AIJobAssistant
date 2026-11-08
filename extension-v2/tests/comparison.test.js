/**
 * Tests for Job Comparison feature
 * Uses the Node.js built-in test runner (node:test). No jest, no mocha.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Import normalizeCoverage from shared production module
const { normalizeCoverage } = require(path.join(__dirname, '..', 'lib', 'coverage.js'));

// ---------------------------------------------------------------------------
// Comparison selection management (pure JS logic, no DOM)
// Mirrors the addToCompare / removeFromCompare logic from sidepanel.js
// ---------------------------------------------------------------------------

function makeSelection() {
  let compareSelection = [];

  function addToCompare(job) {
    const key = job.id || job.url;
    const alreadyIn = compareSelection.find(j =>
      (j.id && j.id === key) || (j.url && j.url === key)
    );
    if (alreadyIn) return; // already selected — do not add again
    if (compareSelection.length >= 3) return; // max 3
    compareSelection.push(job);
  }

  function removeFromCompare(key) {
    compareSelection = compareSelection.filter(j =>
      !((j.id && j.id === key) || (j.url && j.url === key))
    );
  }

  function getSelection() { return compareSelection; }

  return { addToCompare, removeFromCompare, getSelection };
}

// ---------------------------------------------------------------------------
// Tests: selection limits
// ---------------------------------------------------------------------------
test('addToCompare — max 3 jobs can be selected', () => {
  const { addToCompare, getSelection } = makeSelection();
  addToCompare({ id: 'j1', title: 'Job 1' });
  addToCompare({ id: 'j2', title: 'Job 2' });
  addToCompare({ id: 'j3', title: 'Job 3' });
  addToCompare({ id: 'j4', title: 'Job 4' }); // should be ignored
  assert.equal(getSelection().length, 3, 'should have exactly 3 jobs');
  assert.ok(!getSelection().find(j => j.id === 'j4'), '4th job must not be in selection');
});

test('addToCompare — adding same job twice does not duplicate', () => {
  const { addToCompare, getSelection } = makeSelection();
  addToCompare({ id: 'j1', title: 'Job 1' });
  addToCompare({ id: 'j1', title: 'Job 1' }); // duplicate by id
  assert.equal(getSelection().length, 1);
});

test('addToCompare — duplicate detection by url when id is empty', () => {
  const { addToCompare, getSelection } = makeSelection();
  addToCompare({ id: '', url: 'https://jobs.com/1', title: 'Job 1' });
  addToCompare({ id: '', url: 'https://jobs.com/1', title: 'Job 1' }); // same url
  assert.equal(getSelection().length, 1);
});

test('removeFromCompare — removes correct job', () => {
  const { addToCompare, removeFromCompare, getSelection } = makeSelection();
  addToCompare({ id: 'j1', title: 'Job 1' });
  addToCompare({ id: 'j2', title: 'Job 2' });
  addToCompare({ id: 'j3', title: 'Job 3' });
  removeFromCompare('j2');
  assert.equal(getSelection().length, 2);
  assert.ok(!getSelection().find(j => j.id === 'j2'), 'j2 must be removed');
  assert.ok(getSelection().find(j => j.id === 'j1'), 'j1 must still be there');
  assert.ok(getSelection().find(j => j.id === 'j3'), 'j3 must still be there');
});

test('removeFromCompare — removing non-existent job is a no-op', () => {
  const { addToCompare, removeFromCompare, getSelection } = makeSelection();
  addToCompare({ id: 'j1', title: 'Job 1' });
  removeFromCompare('nonexistent');
  assert.equal(getSelection().length, 1);
});

// ---------------------------------------------------------------------------
// Tests: coverage labelling in comparison
// ---------------------------------------------------------------------------
test('comparison — legacy coverage (no scoreCoverage) → labeled Legacy', () => {
  const job = { title: 'Dev', score: 75 }; // no scoreCoverage field
  const cov = normalizeCoverage(job.scoreCoverage, job);
  assert.equal(cov.status, 'legacy');
  // The comparison table shows 'Legacy' for this
  const displayLabel = cov.status === 'legacy' ? 'Legacy'
    : cov.status === 'unavailable' ? 'Not available'
    : `${cov.assessedDimensions}/${cov.totalDimensions}`;
  assert.equal(displayLabel, 'Legacy');
});

test('comparison — unavailable coverage → labeled Not available', () => {
  const job = {
    title: 'Dev',
    scoreCoverage: { assessedDimensions: 0, totalDimensions: 3, status: 'unavailable' }
  };
  const cov = normalizeCoverage(job.scoreCoverage, job);
  assert.equal(cov.status, 'unavailable');
  const displayLabel = cov.status === 'legacy' ? 'Legacy'
    : cov.status === 'unavailable' ? 'Not available'
    : `${cov.assessedDimensions}/${cov.totalDimensions}`;
  assert.equal(displayLabel, 'Not available');
});

test('comparison — full coverage → shows dimension fraction', () => {
  const job = {
    title: 'Dev',
    scoreCoverage: { assessedDimensions: 3, totalDimensions: 3, status: 'full' }
  };
  const cov = normalizeCoverage(job.scoreCoverage, job);
  const displayLabel = cov.status === 'legacy' ? 'Legacy'
    : cov.status === 'unavailable' ? 'Not available'
    : `${cov.assessedDimensions}/${cov.totalDimensions}`;
  assert.equal(displayLabel, '3/3');
});

test('comparison — job with no scoreCoverage field → Legacy', () => {
  const job = { title: 'Dev', score: 80 };
  const cov = normalizeCoverage(undefined, job);
  assert.equal(cov.status, 'legacy');
});

test('comparison — unavailable score field → shows Not available string', () => {
  const job = { title: 'Dev', score: null };
  const scoreDisplay = Number.isFinite(job.score) ? `${job.score}%` : 'Not available';
  assert.equal(scoreDisplay, 'Not available');
});

test('comparison — job with no scoreCoverage field → shows Legacy label', () => {
  const job = {}; // completely empty
  const cov = normalizeCoverage(job.scoreCoverage, job);
  assert.equal(cov.status, 'legacy');
  const label = cov.status === 'legacy' ? 'Legacy' : 'other';
  assert.equal(label, 'Legacy');
});


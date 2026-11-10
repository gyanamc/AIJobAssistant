/**
 * Tests for TrackerLib (lib/tracker.js)
 * Uses the Node.js built-in test runner (node:test). No jest, no mocha.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// ---------------------------------------------------------------------------
// In-memory chrome.storage.local mock (must be set up before require)
// ---------------------------------------------------------------------------
let _storage = {};
global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        const result = {};
        (Array.isArray(keys) ? keys : [keys]).forEach(k => { result[k] = _storage[k]; });
        cb(result);
      },
      set: (obj, cb) => {
        Object.assign(_storage, obj);
        if (cb) cb();
      }
    }
  },
  runtime: { lastError: null }
};

function resetStorage(initial = {}) {
  _storage = { ...initial };
}

const TrackerLib = require(path.join(__dirname, '..', 'lib', 'tracker.js'));
const { migrateRecord, mergeTrackerFields, calculateStats, localDateString, updateTrackerFields, APPLICATION_STATUSES, csvCell, buildSavedJobsCsv, sameJob } = TrackerLib;

test('manual and automatic saves identify the same listing across URL fields', () => {
  const tracked = { id: '123', url: 'https://jobs.example/listing', applyUrl: 'https://jobs.example/apply', applicationStatus: 'Interview', notes: 'Keep me' };
  assert.equal(sameJob(tracked, { url: tracked.url }), true);
  assert.equal(sameJob(tracked, { url: tracked.applyUrl }), true);
  assert.equal(sameJob(tracked, { id: '123', url: 'https://other.example' }), true);
  assert.equal(sameJob(tracked, { id: '456', url: 'https://other.example' }), false);
  assert.equal(mergeTrackerFields({ ...tracked, title: 'Updated' }, tracked).notes, 'Keep me');
});

// ---------------------------------------------------------------------------
// migrateRecord()
// ---------------------------------------------------------------------------
test('migrateRecord — legacy record (no applicationStatus) → adds Saved status', () => {
  const legacy = { title: 'Engineer', company: 'Acme', url: 'https://jobs.com/1' };
  const result = migrateRecord(legacy);
  assert.equal(result.applicationStatus, 'Saved');
  assert.equal(result.appliedDate, '');
  assert.equal(result.followUpDate, '');
  assert.equal(result.contactName, '');
  assert.equal(result.notes, '');
  // Original fields preserved
  assert.equal(result.title, 'Engineer');
  assert.equal(result.company, 'Acme');
});

test('migrateRecord — already-migrated record (has applicationStatus) → unchanged', () => {
  const migrated = {
    title: 'PM',
    applicationStatus: 'Applied',
    appliedDate: '2024-01-15',
    notes: 'First round done'
  };
  const result = migrateRecord(migrated);
  assert.equal(result.applicationStatus, 'Applied');
  assert.equal(result.appliedDate, '2024-01-15');
  assert.equal(result.notes, 'First round done');
  // Must be the exact same object (no copy on already-migrated)
  assert.equal(result, migrated);
});

// ---------------------------------------------------------------------------
// mergeTrackerFields()
// ---------------------------------------------------------------------------
test('mergeTrackerFields — preserves existing status when updates do not include it', () => {
  const existing = { title: 'Dev', applicationStatus: 'Interview', notes: 'Went well' };
  const result = mergeTrackerFields(existing, { notes: 'Updated notes' });
  assert.equal(result.applicationStatus, 'Interview'); // unchanged
  assert.equal(result.notes, 'Updated notes');         // updated
});

test('mergeTrackerFields — updates status when explicitly provided', () => {
  const existing = { title: 'Dev', applicationStatus: 'Applied' };
  const result = mergeTrackerFields(existing, { applicationStatus: 'Interview' });
  assert.equal(result.applicationStatus, 'Interview');
});

test('mergeTrackerFields — sets defaults for missing fields', () => {
  const existing = {};
  const result = mergeTrackerFields(existing);
  assert.equal(result.applicationStatus, 'Saved');
  assert.equal(result.appliedDate, '');
  assert.equal(result.followUpDate, '');
  assert.equal(result.contactName, '');
  assert.equal(result.contactEmail, '');
  assert.equal(result.notes, '');
  assert.equal(result.trackerUpdatedAt, null);
});

// ---------------------------------------------------------------------------
// calculateStats()
// ---------------------------------------------------------------------------
test('calculateStats — with mixed status jobs → correct totals', () => {
  const jobs = [
    { applicationStatus: 'Applied' },
    { applicationStatus: 'Interview' },
    { applicationStatus: 'Offer' },
    { applicationStatus: 'Rejected' },
    { applicationStatus: 'Saved' },
    { applicationStatus: 'Withdrawn' },
  ];
  const stats = calculateStats(jobs);
  assert.equal(stats.total, 6);
  // Applied + Assessment + Interview + Offer + Rejected + Withdrawn all count as 'applied'
  assert.equal(stats.applied, 5); // Applied, Interview, Offer, Rejected, Withdrawn
  assert.equal(stats.interviews, 1);
  assert.equal(stats.offers, 1);
  assert.equal(stats.rejections, 1);
  assert.equal(stats.overdue, 0);
  assert.equal(stats.dueToday, 0);
  assert.equal(stats.upcoming, 0);
});

test('calculateStats — follow-up dates → overdue/today/upcoming correctly classified', () => {
  const today = localDateString(new Date());
  // Create a date that is definitely in the past
  const yesterday = localDateString(new Date(Date.now() - 86400000));
  // Create a date that is definitely in the future
  const tomorrow  = localDateString(new Date(Date.now() + 86400000));

  const jobs = [
    { applicationStatus: 'Applied',   followUpDate: yesterday },
    { applicationStatus: 'Interview', followUpDate: today },
    { applicationStatus: 'Applied',   followUpDate: tomorrow },
    { applicationStatus: 'Saved' } // no followUpDate
  ];
  const stats = calculateStats(jobs);
  assert.equal(stats.overdue,  1, 'one overdue follow-up');
  assert.equal(stats.dueToday, 1, 'one due today');
  assert.equal(stats.upcoming, 1, 'one upcoming follow-up');
});

test('calculateStats — empty array → all zeros', () => {
  const stats = calculateStats([]);
  assert.equal(stats.total, 0);
  assert.equal(stats.applied, 0);
  assert.equal(stats.overdue, 0);
});

// ---------------------------------------------------------------------------
// localDateString()
// ---------------------------------------------------------------------------
test('localDateString — returns YYYY-MM-DD format', () => {
  const date = new Date(2024, 0, 15); // Jan 15 2024
  const result = localDateString(date);
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/, 'must match YYYY-MM-DD format');
  assert.equal(result, '2024-01-15');
});

// ---------------------------------------------------------------------------
// Duplicate job detection
// ---------------------------------------------------------------------------
test('duplicate detection — same id → not saved twice', async () => {
  resetStorage({ savedJobs: [{ id: 'job-1', url: 'https://example.com/j1', applicationStatus: 'Saved' }] });
  // updateTrackerFields finds by id or url — if id matches, only one record should exist
  await updateTrackerFields('job-1', { applicationStatus: 'Applied' });
  const saved = _storage.savedJobs;
  assert.equal(saved.length, 1, 'should not create a duplicate');
  assert.equal(saved[0].applicationStatus, 'Applied');
});

test('duplicate detection — same url → not saved twice', async () => {
  resetStorage({ savedJobs: [{ id: '', url: 'https://example.com/j2', applicationStatus: 'Saved' }] });
  await updateTrackerFields('https://example.com/j2', { applicationStatus: 'Interview' });
  const saved = _storage.savedJobs;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].applicationStatus, 'Interview');
});

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------
test('APPLICATION_STATUSES — all 8 statuses are present', () => {
  const expected = ['Saved', 'Planning to Apply', 'Applied', 'Assessment', 'Interview', 'Offer', 'Rejected', 'Withdrawn'];
  assert.equal(APPLICATION_STATUSES.length, 8);
  expected.forEach(s => assert.ok(APPLICATION_STATUSES.includes(s), `missing status: ${s}`));
});

// ---------------------------------------------------------------------------
// CSV export format
// ---------------------------------------------------------------------------
test('CSV escape — commas and quotes in field values are escaped', () => {
  const withComma = 'Google, Inc.';
  const withQuote = 'He said "hello"';
  const withBoth  = 'Title, with "quotes"';

  assert.equal(csvCell(withComma), '"Google, Inc."');
  assert.equal(csvCell(withQuote), '"He said ""hello"""');
  assert.equal(csvCell(withBoth),  '"Title, with ""quotes"""');
});

test('CSV export includes tracker fields and safely preserves newlines', () => {
  const csv = buildSavedJobsCsv([{
    title: 'Engineer', company: 'A, Inc.', applicationStatus: 'Interview',
    appliedDate: '2026-11-01', followUpDate: '2026-11-09', contactName: 'Riya',
    contactEmail: 'riya@example.com', notes: 'First line\nSecond "quoted" line'
  }], 'en-US');
  assert.match(csv, /"Application Status"/);
  assert.match(csv, /"Interview"/);
  assert.match(csv, /"First line\nSecond ""quoted"" line"/);
  assert.doesNotMatch(csv, /apiKey|sk-[A-Za-z0-9]/i);
});

test('CSV neutralizes formula leading text while retaining numbers and dates', () => {
  for (const value of ['=1+1', '+SUM(1)', '-cmd', '@formula', '  =1', '\n@formula']) {
    assert.equal(csvCell(value), `"'${value}"`);
  }
  assert.equal(csvCell(42), '"42"');
  assert.equal(csvCell('2026-11-08'), '"2026-11-08"');
});


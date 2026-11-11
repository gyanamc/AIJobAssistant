// extension-v2/lib/tracker.js
// Application tracker — storage helpers for the job application pipeline.
// All writes preserve existing application fields (status, notes, follow-up)
// to prevent auto-save from overwriting user edits.

(function (exports) {
  'use strict';

  const APPLICATION_STATUSES = [
    'Saved',
    'Planning to Apply',
    'Applied',
    'Assessment',
    'Interview',
    'Offer',
    'Rejected',
    'Withdrawn'
  ];
  function sameJob(a, b) {
    return Boolean((a.id && b.id && String(a.id) === String(b.id)) ||
      (a.url && (a.url === b.url || a.url === b.applyUrl)) ||
      (a.applyUrl && (a.applyUrl === b.url || a.applyUrl === b.applyUrl)));
  }
  let storageUpdateQueue = Promise.resolve();

  /**
   * Merge application tracking fields into a saved job entry without
   * overwriting any existing tracker data.
   * @param {object} existing - Record already in storage (may be legacy)
   * @param {object} [updates] - New values to apply
   * @returns {object} Merged record
   */
  function mergeTrackerFields(existing, updates = {}) {
    const requestedStatus = updates.applicationStatus ?? existing.applicationStatus ?? 'Saved';
    return {
      ...existing,
      applicationStatus: APPLICATION_STATUSES.includes(requestedStatus) ? requestedStatus : 'Saved',
      appliedDate:       updates.appliedDate       ?? existing.appliedDate       ?? '',
      followUpDate:      updates.followUpDate      ?? existing.followUpDate      ?? '',
      contactName:       updates.contactName       ?? existing.contactName       ?? '',
      contactEmail:      updates.contactEmail      ?? existing.contactEmail      ?? '',
      notes:             updates.notes             ?? existing.notes             ?? '',
      trackerUpdatedAt:  updates.trackerUpdatedAt  ?? existing.trackerUpdatedAt  ?? null
    };
  }

  /**
   * Migrate a legacy saved job to include tracker fields.
   * Never overwrites existing tracker data.
   */
  function migrateRecord(record) {
    if (record.applicationStatus !== undefined) return record; // already migrated
    return mergeTrackerFields(record);
  }

  /**
   * Calculate dashboard statistics from an array of saved jobs.
   */
  function calculateStats(savedJobs) {
    const today = localDateString(new Date());
    return savedJobs.reduce((stats, job) => {
      const status = job.applicationStatus || 'Saved';
      stats.total++;
      if (status === 'Applied' || status === 'Assessment' || status === 'Interview' ||
          status === 'Offer' || status === 'Rejected' || status === 'Withdrawn') {
        stats.applied++;
      }
      if (status === 'Interview') stats.interviews++;
      if (status === 'Offer') stats.offers++;
      if (status === 'Rejected') stats.rejections++;
      if (job.followUpDate) {
        if (job.followUpDate < today) stats.overdue++;
        else if (job.followUpDate === today) stats.dueToday++;
        else stats.upcoming++;
      }
      return stats;
    }, { total: 0, applied: 0, interviews: 0, offers: 0, rejections: 0, dueToday: 0, overdue: 0, upcoming: 0 });
  }

  /**
   * Return a YYYY-MM-DD string in the user's local timezone.
   */
  function localDateString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const CSV_HEADERS = [
    'Date Saved', 'Job Title', 'Company', 'Location', 'Job Type', 'Salary',
    'Match Score', 'Skills Score', 'Req Score', 'Resp Score',
    'Matched Skills', 'Missing Skills', 'Apply URL', 'Contact Email',
    'AI Reasoning', 'Cover Letter', 'Application Status', 'Applied Date',
    'Follow-Up Date', 'Contact Name', 'Notes'
  ];

  function csvCell(value) {
    let text = String(value ?? '');
    if (typeof value === 'string' && /^[\s\uFEFF]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function buildSavedJobsCsv(savedJobs, locale = 'en-IN') {
    const rows = savedJobs.map(job => {
      const savedDate = job.savedAt ? new Date(job.savedAt) : null;
      return [
        savedDate && !Number.isNaN(savedDate.getTime()) ? savedDate.toLocaleString(locale) : '',
        job.title, job.company, job.location, job.jobType, job.salary,
        job.score, job.skillsScore, job.reqsScore, job.respScore,
        Array.isArray(job.matchedSkills) ? job.matchedSkills.join('; ') : '',
        Array.isArray(job.missingSkills) ? job.missingSkills.join('; ') : '',
        job.applyUrl || job.url, job.contactEmail, job.reasoning, job.coverLetter,
        job.applicationStatus || 'Saved', job.appliedDate, job.followUpDate,
        job.contactName, job.notes
      ].map(csvCell).join(',');
    });
    return [CSV_HEADERS.map(csvCell).join(','), ...rows].join('\r\n');
  }

  /**
   * Safely update a single saved job's tracker fields in chrome.storage.local.
   * Never overwrites non-tracker fields (score, skills, etc.).
   * @param {string} jobKey - id or url used as identifier
   * @param {object} updates - Tracker fields to update
   * @returns {Promise<void>}
   */
  function updateTrackerFields(jobKey, updates) {
    const operation = () => new Promise((resolve, reject) => {
      chrome.storage.local.get(['savedJobs'], (data) => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        const saved = (data.savedJobs || []).map(job => {
          const matches =
            (jobKey && job.id && job.id === jobKey) ||
            (jobKey && job.url && job.url === jobKey);
          if (!matches) return job;
          return mergeTrackerFields(job, {
            ...updates,
            trackerUpdatedAt: new Date().toISOString()
          });
        });
        if (!saved.some(job =>
          (jobKey && job.id && job.id === jobKey) ||
          (jobKey && job.url && job.url === jobKey)
        )) {
          reject(new Error('Application record was not found.'));
          return;
        }
        chrome.storage.local.set({ savedJobs: saved }, () => {
          if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
          resolve();
        });
      });
    });
    const result = storageUpdateQueue.then(operation, operation);
    storageUpdateQueue = result.catch(() => {});
    return result;
  }

  exports.APPLICATION_STATUSES = APPLICATION_STATUSES;
  exports.sameJob             = sameJob;
  exports.mergeTrackerFields   = mergeTrackerFields;
  exports.migrateRecord        = migrateRecord;
  exports.calculateStats       = calculateStats;
  exports.localDateString      = localDateString;
  exports.CSV_HEADERS          = CSV_HEADERS;
  exports.csvCell              = csvCell;
  exports.buildSavedJobsCsv    = buildSavedJobsCsv;
  exports.updateTrackerFields  = updateTrackerFields;

})(typeof module !== 'undefined' ? module.exports : (self.TrackerLib = self.TrackerLib || {}));


// extension-v2/lib/coverage.js
// Shared coverage normalization — used by sidepanel.js and unit tests.
// Do NOT duplicate this logic elsewhere.

(function (exports) {
  'use strict';

  /**
   * Normalize a scoreCoverage object from storage.
   * Only trust objects that carry verified integer dimension metadata
   * produced by the deterministic scoring engine (v2.0.8+).
   *
   * @param {*} coverage - Raw value from storage
   * @param {object} [scores] - Fallback scores object (not used to infer coverage)
   * @returns {{ status: string, assessedDimensions: number, totalDimensions: number }}
   */
  function normalizeCoverage(coverage, scores = {}) {
    if (
      coverage &&
      Number.isInteger(coverage.assessedDimensions) &&
      Number.isInteger(coverage.totalDimensions)
    ) {
      return coverage;
    }
    return { assessedDimensions: 0, totalDimensions: 3, status: 'legacy' };
  }

  exports.normalizeCoverage = normalizeCoverage;

})(typeof module !== 'undefined' ? module.exports : (self.CoverageLib = self.CoverageLib || {}));


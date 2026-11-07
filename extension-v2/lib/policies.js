(function (root) {
  'use strict';

  const CONSENT_VERSION = 1;

  function hasExplicitSharingConsent(data) {
    return data?.shareAnonymized === true && data?.shareConsentVersion === CONSENT_VERSION;
  }

  function consentStorageUpdate(enabled) {
    return {
      shareAnonymized: enabled === true,
      shareConsentVersion: CONSENT_VERSION
    };
  }

  function safeExternalUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch (_) {
      return null;
    }
  }

  const policies = {
    CONSENT_VERSION,
    hasExplicitSharingConsent,
    consentStorageUpdate,
    safeExternalUrl
  };

  root.ExtensionPolicies = policies;
  if (typeof module !== 'undefined' && module.exports) module.exports = policies;
})(typeof globalThis !== 'undefined' ? globalThis : this);

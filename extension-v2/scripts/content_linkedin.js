// content_linkedin.js — AI Job Assistant v2
//
// DESIGN PRINCIPLE: This script does NOT track which jobs have been processed.
// That responsibility belongs entirely to the background worker, which is the
// only stable context that survives SPA navigations and re-injections.
// The content script simply finds the next unprocessed-looking card, clicks it,
// extracts data, and sends it. The background deduplicates by job ID.

(function () {
  // Prevent multiple intervals if Chrome injects this script more than once
  // into the same document (e.g. dynamic injection + manifest injection).
  if (document.__ajaRunning) return;
  document.__ajaRunning = true;

  let scrapeTimer = null;
  let tickRunning = false;

  function extLog(msg) {
    chrome.runtime.sendMessage({ type: 'FORWARD_LOG', message: msg }).catch(() => {});
  }

  extLog('LinkedIn content script ready.');

  // ── Loop control ──────────────────────────────────────────────────────────
  function startLoop() {
    if (scrapeTimer) return;
    scrapeTimer = setInterval(safeTick, 4000);
    extLog('LinkedIn loop started.');
  }

  function stopLoop() {
    clearInterval(scrapeTimer);
    scrapeTimer = null;
    tickRunning = false;
  }

  function safeTick() {
    if (tickRunning) return;
    tickRunning = true;
    tick().finally(() => { tickRunning = false; });
  }

  // ── Main tick ─────────────────────────────────────────────────────────────
  async function tick() {
    const { botRunning } = await getStorage(['botRunning']);
    if (!botRunning) { stopLoop(); return; }

    // Find all job cards on the page
    const cards = Array.from(document.querySelectorAll(
      '.job-card-container[data-job-id], li[data-occludable-job-id]'
    ));
    if (!cards.length) { scrollList(); return; }

    // Pick the first card that hasn't been visually marked yet
    // (green = match, dimmed = no match, grey = skipped)
    // We use the outline style as a visual marker to avoid re-processing
    let card = null, jobId = null;
    for (const c of cards) {
      const id = c.getAttribute('data-job-id') || c.getAttribute('data-occludable-job-id');
      if (!id) continue;
      // Skip cards we've already processed in this page session (visual marker)
      const outline = c.style.outline || '';
      if (outline && outline !== '2px solid #448aff') continue; // already processed
      if (!outline) {
        card = c; jobId = id;
        break;
      }
    }

    if (!card) { scrollList(); return; }

    // Mark as in-progress immediately (blue outline)
    card.style.outline = '2px solid #448aff';
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.click();
    await sleep(1500);

    const title    = getText(['.job-details-jobs-unified-top-card__job-title', 'h1.t-24', '.jobs-unified-top-card__job-title']);
    const company  = getText(['.job-details-jobs-unified-top-card__company-name a', '.jobs-unified-top-card__company-name']);
    const desc     = getText(['#job-details', '.jobs-description__content', '.jobs-description', 'article.jobs-description']);
    const location = getText(['.job-details-jobs-unified-top-card__bullet', '.jobs-unified-top-card__bullet']);
    const jobType  = getText(['.job-details-jobs-unified-top-card__job-insight span', '.jobs-unified-top-card__workplace-type']);
    const salary   = getText(['.job-details-jobs-unified-top-card__salary-info', '.compensation__salary']);

    if (!title || !desc) {
      card.style.outline = '2px solid #5a5e75'; // grey = skipped
      extLog(`Skipping ${jobId} — no details.`);
      return;
    }

    const externalBtn = document.querySelector('a.jobs-apply-button[href], a[data-tracking-control-name*="apply"][href]');
    const applyUrl    = externalBtn?.href || `https://www.linkedin.com/jobs/view/${jobId}/`;

    card.style.outline = '2px solid #ff9800'; // orange = evaluating
    extLog(`Evaluating: ${title.substring(0, 40)}...`);

    await new Promise(resolve => {
      chrome.runtime.sendMessage({
        type: 'EVALUATE_JOB',
        data: {
          id: jobId, title, company, description: desc,
          url: `https://www.linkedin.com/jobs/view/${jobId}/`,
          applyUrl, contactEmail: extractEmail(desc),
          location: location || '', jobType: jobType || 'Full-time', salary: salary || ''
        }
      }, (res) => {
        if (chrome.runtime.lastError) {
          card.style.outline = '2px solid #5a5e75';
          resolve(); return;
        }
        if (res?.success && res.evaluation?.is_match) {
          card.style.outline = '3px solid #00c853';
          card.style.background = '#00c85308';
          extLog(`✅ Match: ${title.substring(0, 40)}`);
        } else if (res?.success) {
          card.style.outline = '1px solid rgb(42,45,62)';
          card.style.opacity = '0.6';
          extLog(`❌ No match: ${title.substring(0, 40)}`);
        } else if (res?.reason === 'Already evaluated') {
          // Background already processed this job — just mark it visually
          card.style.outline = '1px solid #5a5e75';
          card.style.opacity = '0.7';
        } else {
          card.style.outline = '2px solid #ff5252';
          extLog(`⚠️ ${res?.reason || res?.error || 'unknown'}`);
        }
        resolve();
      });
    });
  }

  // ── Message listener ──────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((req) => {
    if (req.type === 'START_SCRAPING') startLoop();
    if (req.type === 'STOP_SCRAPING')  stopLoop();
  });

  chrome.storage.local.get(['botRunning'], ({ botRunning }) => {
    if (botRunning) startLoop();
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function getText(selectors) {
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el?.innerText?.trim()) return el.innerText.trim();
    }
    return '';
  }
  function extractEmail(text) {
    const m = (text || '').match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    return m ? m[0] : '';
  }
  function scrollList() {
    const l = document.querySelector('.jobs-search-results-list, .scaffold-layout__list');
    if (l) l.scrollTop += 800; else window.scrollBy(0, 800);
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function getStorage(keys) { return new Promise(r => chrome.storage.local.get(keys, r)); }
})();

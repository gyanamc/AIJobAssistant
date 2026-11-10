// content_linkedin.js — AI Job Assistant v2
//
// DESIGN PRINCIPLE: This script does NOT track which jobs have been processed.
// That responsibility belongs entirely to the background worker, which is the
// only stable context that survives SPA navigations and re-injections.
// The content script simply finds the next unprocessed-looking card, clicks it,
// extracts data, and sends it. The background deduplicates by job ID.
//
// LinkedIn now redirects /jobs/search/ → /jobs/search-results/ (SDUI). That UI
// uses div[role=button][componentkey] cards and has no data-job-id attributes.
// Job IDs appear in the URL as ?currentJobId= after a card click. This script
// supports both the legacy list UI and the SDUI search-results UI.
//
// NOTE: Do NOT call chrome.runtime.getURL() or inject <script>/<img> from
// extension URLs into LinkedIn. That would require web_accessible_resources and
// make this extension fingerprintable by LinkedIn's AedEvent probes.

(function () {
  if (document.documentElement.dataset.ajaLinkedin === '1') return;
  document.documentElement.dataset.ajaLinkedin = '1';
  document.__ajaRunning = true;

  let scrapeTimer = null;
  let tickRunning = false;
  let publicJobSent = false;
  const publicJobsSeen = new Set();

  function isExtensionAlive() {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  function retireIfDead() {
    if (isExtensionAlive()) return false;
    stopLoop();
    return true;
  }

  function extLog(msg) {
    if (!isExtensionAlive()) return;
    chrome.runtime.sendMessage({ type: 'FORWARD_LOG', message: msg }).catch(() => {});
  }

  extLog('LinkedIn content script ready.');

  function startLoop() {
    if (retireIfDead()) return;
    if (scrapeTimer) return;
    scrapeTimer = setInterval(safeTick, 6000);
    extLog('LinkedIn loop started.');
  }

  function stopLoop() {
    clearInterval(scrapeTimer);
    scrapeTimer = null;
    tickRunning = false;
  }

  function safeTick() {
    if (retireIfDead()) return;
    if (tickRunning) return;
    tickRunning = true;
    tick().finally(() => { tickRunning = false; });
  }

  function isSduiJobsPage() {
    return /\/jobs\/search-results\/?/i.test(location.pathname);
  }

  function getCurrentJobId() {
    return new URLSearchParams(location.search).get('currentJobId') || '';
  }

  function findLegacyCards() {
    return Array.from(document.querySelectorAll(
      '.job-card-container[data-job-id], li[data-occludable-job-id]'
    ));
  }

  // SDUI cards are role=button nodes with a componentkey. Filter out tiny
  // chrome controls by requiring multi-line job-like text.
  function findSduiCards() {
    return Array.from(document.querySelectorAll('div[role="button"][componentkey]'))
      .filter((el) => {
        const text = (el.innerText || '').trim();
        if (text.length < 40) return false;
        const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
        return lines.length >= 2;
      });
  }

  function parseSduiCard(card) {
    const raw = (card.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const skip = /^(viewed|promoted|saved|verified job|easy apply)$/i;
    const noise = /(alumni|clicked apply|people clicked|connections work|posted\b|\bago$|responded)/i;
    const lines = [];
    for (const line of raw) {
      if (skip.test(line) || noise.test(line)) continue;
      if (lines.length && lines[lines.length - 1] === line) continue;
      lines.push(line);
    }
    // Often: ["Title (Verified job)", "Title", "Company", "Location"] → drop badge-only first line
    if (lines.length >= 2 && /\(verified job\)$/i.test(lines[0])) lines.shift();
    return {
      title: lines[0] || '',
      company: lines[1] || '',
      location: lines[2] || ''
    };
  }

  function getSduiDescription() {
    const about = Array.from(document.querySelectorAll('h2, h3'))
      .find((h) => /about the job/i.test(h.innerText || ''));
    if (!about) return '';
    let root = about.parentElement;
    for (let i = 0; i < 6 && root; i++) {
      const text = (root.innerText || '').trim();
      if (text.length > 400) {
        return text.replace(/^about the job\s*/i, '').trim();
      }
      root = root.parentElement;
    }
    return '';
  }

  function getSduiDetailMeta() {
    const about = Array.from(document.querySelectorAll('h2, h3'))
      .find((h) => /about the job/i.test(h.innerText || ''));
    if (!about) return { title: '', company: '', location: '', jobType: '' };
    // Walk up to a panel that also contains an Apply control, then parse its head lines.
    let panel = about.parentElement;
    for (let i = 0; i < 8 && panel; i++) {
      const hasApply = Array.from(panel.querySelectorAll('button, a')).some((el) => {
        const label = `${el.innerText || ''} ${el.getAttribute('aria-label') || ''}`;
        return /\bapply\b/i.test(label);
      });
      const panelText = (panel.innerText || '').trim();
      if (hasApply && panelText.length > 120) break;
      panel = panel.parentElement;
    }
    if (!panel) return { title: '', company: '', location: '', jobType: '' };
    const lines = textHeadLines(panel.innerText || '', 12);
    // Typical head: Company, Title, "City · time · social proof", workplace/type chips, Apply
    const company = lines[0] || '';
    const title = lines[1] || '';
    const locLine = lines.find((l) => /·/.test(l)) || lines[2] || '';
    const location = locLine.split('·')[0].trim();
    const jobType = lines.find((l) =>
      /^(on-site|hybrid|remote|full-time|part-time|contract|temporary|internship)$/i.test(l)
    ) || '';
    return { title, company, location, jobType };
  }

  function textHeadLines(text, limit) {
    return String(text).split('\n').map((s) => s.trim()).filter(Boolean).slice(0, limit);
  }

  async function waitForJobIdChange(previousId, timeoutMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const id = getCurrentJobId();
      if (id && id !== previousId) return id;
      await sleep(200);
    }
    return getCurrentJobId() || previousId || '';
  }

  async function tick() {
    if (retireIfDead()) return;

    const { botRunning } = await getStorage(['botRunning']);
    if (!isExtensionAlive()) return;
    if (!botRunning) { stopLoop(); return; }

    // Public search cards navigate to a standalone /jobs/view/ page. Extract
    // its full description there; the search card itself has only a teaser.
    if (/\/jobs\/view\//.test(window.location.pathname)) {
      if (publicJobSent) return;
      const match = window.location.pathname.match(/-(\d+)\/?$/);
      const title = getText(['h1']);
      const desc = getText(['.show-more-less-html__markup', '.description__text']);
      if (!match || !title || !desc) {
        extLog('LinkedIn job page has no usable title or description.');
        return;
      }
      publicJobSent = true;
      const company = getText(['.topcard__org-name-link', '.topcard__flavor']) || 'Unknown';
      extLog(`Evaluating: ${title.substring(0, 40)}...`);
      chrome.runtime.sendMessage({ type: 'EVALUATE_JOB', data: {
        id: match[1], title, company, description: desc,
        url: `https://www.linkedin.com/jobs/view/${match[1]}/`,
        applyUrl: window.location.href, contactEmail: extractEmail(desc),
        location: getText(['.topcard__flavor--bullet', '.topcard__flavor']),
        jobType: '', salary: ''
      } }, (res) => {
        if (chrome.runtime.lastError) return;
        extLog(res?.success ? `Evaluated: ${title.substring(0, 40)} — score ${res.evaluation?.score ?? 'unavailable'}`
          : `Evaluation failed: ${res?.reason || res?.error || 'unknown'}`);
      });
      return;
    }

    const publicCards = Array.from(document.querySelectorAll('.base-search-card a.base-card__full-link[href*="/jobs/view/"]'));
    if (publicCards.length && !findLegacyCards().length && !findSduiCards().length) {
      const link = publicCards.find(item => !publicJobsSeen.has(item.href));
      if (!link) { scrollList(); return; }
      publicJobsSeen.add(link.href);
      try {
        const response = await fetch(link.href);
        if (!response.ok) throw new Error(`Job page HTTP ${response.status}`);
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        const id = new URL(link.href).pathname.match(/-(\d+)\/?$/)?.[1];
        const title = doc.querySelector('h1')?.textContent?.trim();
        const description = doc.querySelector('.show-more-less-html__markup, .description__text')?.textContent?.trim();
        if (!id || !title || !description) throw new Error('Job details unavailable');
        extLog(`Evaluating: ${title.substring(0, 40)}...`);
        const result = await chrome.runtime.sendMessage({ type: 'EVALUATE_JOB', data: {
          id, title, company: doc.querySelector('.topcard__org-name-link, .topcard__flavor')?.textContent?.trim() || 'Unknown',
          description, url: `https://www.linkedin.com/jobs/view/${id}/`, applyUrl: link.href,
          contactEmail: extractEmail(description), location: '', jobType: '', salary: ''
        } });
        extLog(result?.success ? `Evaluated: ${title.substring(0, 40)} — score ${result.evaluation?.score ?? 'unavailable'}`
          : `Evaluation failed: ${result?.reason || result?.error || 'unknown'}`);
      } catch (error) {
        extLog(`Could not process public LinkedIn job: ${error.message}`);
      }
      return;
    }

    const sdui = isSduiJobsPage() || findLegacyCards().length === 0;
    const cards = sdui ? findSduiCards() : findLegacyCards();
    if (!cards.length) {
      extLog(sdui ? 'No SDUI job cards found — scrolling.' : 'No legacy job cards found — scrolling.');
      scrollList();
      return;
    }

    let card = null;
    let legacyJobId = null;
    for (const c of cards) {
      const outline = c.style.outline || '';
      if (outline) continue;
      if (!sdui) {
        const id = c.getAttribute('data-job-id') || c.getAttribute('data-occludable-job-id');
        if (!id) continue;
        legacyJobId = id;
      }
      card = c;
      break;
    }

    if (!card) { scrollList(); return; }

    const previousId = getCurrentJobId();
    const cardMeta = sdui ? parseSduiCard(card) : null;

    card.style.outline = '2px solid #448aff';
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.click();
    await sleep(sdui ? 1800 : 1500);
    if (retireIfDead()) return;

    let jobId = legacyJobId;
    if (sdui) {
      jobId = await waitForJobIdChange(previousId);
    }
    if (!jobId) {
      card.style.outline = '2px solid #5a5e75';
      extLog('Skipping card — could not resolve job id.');
      return;
    }

    let title = '';
    let company = '';
    let desc = '';
    let location = '';
    let jobType = '';
    let salary = '';

    if (sdui) {
      const detail = getSduiDetailMeta();
      title = detail.title || cardMeta.title || '';
      company = detail.company || cardMeta.company || '';
      location = detail.location || cardMeta.location || '';
      jobType = detail.jobType || '';
      desc = getSduiDescription();
      // Fallback: classic selectors still appear on some hybrid renders
      if (!title) title = getText(['.job-details-jobs-unified-top-card__job-title', 'h1.t-24', '.jobs-unified-top-card__job-title']);
      if (!company) company = getText(['.job-details-jobs-unified-top-card__company-name a', '.jobs-unified-top-card__company-name']);
      if (!desc) desc = getText(['#job-details', '.jobs-description__content', '.jobs-description', 'article.jobs-description']);
    } else {
      title    = getText(['.job-details-jobs-unified-top-card__job-title', 'h1.t-24', '.jobs-unified-top-card__job-title']);
      company  = getText(['.job-details-jobs-unified-top-card__company-name a', '.jobs-unified-top-card__company-name']);
      desc     = getText(['#job-details', '.jobs-description__content', '.jobs-description', 'article.jobs-description']);
      location = getText(['.job-details-jobs-unified-top-card__bullet', '.jobs-unified-top-card__bullet']);
      jobType  = getText(['.job-details-jobs-unified-top-card__job-insight span', '.jobs-unified-top-card__workplace-type']);
      salary   = getText(['.job-details-jobs-unified-top-card__salary-info', '.compensation__salary']);
    }

    if (!title || !desc) {
      card.style.outline = '2px solid #5a5e75';
      extLog(`Skipping ${jobId} — no details (title=${!!title}, desc=${!!desc}).`);
      return;
    }

    const externalBtn = document.querySelector('a.jobs-apply-button[href], a[data-tracking-control-name*="apply"][href]');
    const applyUrl = externalBtn?.href || `https://www.linkedin.com/jobs/view/${jobId}/`;

    card.style.outline = '2px solid #ff9800';
    extLog(`Evaluating: ${title.substring(0, 40)}...`);

    await new Promise((resolve) => {
      if (!isExtensionAlive()) { resolve(); return; }
      chrome.runtime.sendMessage({
        type: 'EVALUATE_JOB',
        data: {
          id: jobId,
          title,
          company: company || 'Unknown',
          description: desc,
          url: `https://www.linkedin.com/jobs/view/${jobId}/`,
          applyUrl,
          contactEmail: extractEmail(desc),
          location: location || '',
          jobType: jobType || 'Full-time',
          salary: salary || ''
        }
      }, (res) => {
        if (!isExtensionAlive() || chrome.runtime.lastError) {
          if (isExtensionAlive()) card.style.outline = '2px solid #5a5e75';
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

  chrome.runtime.onMessage.addListener((req) => {
    if (retireIfDead()) return;
    if (req.type === 'START_SCRAPING') startLoop();
    if (req.type === 'STOP_SCRAPING')  stopLoop();
  });

  chrome.storage.local.get(['botRunning'], ({ botRunning }) => {
    if (retireIfDead()) return;
    if (botRunning) startLoop();
  });

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
    const l = document.querySelector(
      '.jobs-search-results-list, .scaffold-layout__list, main#workspace, main, [role="main"]'
    );
    if (l && typeof l.scrollBy === 'function') l.scrollBy(0, 800);
    else if (l) l.scrollTop += 800;
    else window.scrollBy(0, 800);
  }
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function getStorage(keys) {
    return new Promise((r) => {
      if (!isExtensionAlive()) { r({}); return; }
      try {
        chrome.storage.local.get(keys, (result) => {
          if (chrome.runtime.lastError) { r({}); return; }
          r(result || {});
        });
      } catch (_) {
        r({});
      }
    });
  }
})();

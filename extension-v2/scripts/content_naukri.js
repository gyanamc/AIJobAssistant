// content_naukri.js — AI Job Assistant v2
//
// Do NOT call chrome.runtime.getURL() or inject extension-hosted assets into
// the page. Leaving web_accessible_resources undeclared avoids fingerprinting.

(function () {
  if (window.__ajaNaukri) return;
  window.__ajaNaukri = true;

  let scrapeTimer = null;
  let badgeInterval = null;
  let tickRunning = false;

  const seenIds = new Set();

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
    if (badgeInterval) clearInterval(badgeInterval);
    return true;
  }

  function renderNaukriSearchBadges() {
    if (!isExtensionAlive()) return;
    try {
      chrome.storage.local.get(['userSkills', 'targetRoles'], (data) => {
        if (chrome.runtime.lastError || !data) return;
        const skills = data.userSkills || [];
        const roles = data.targetRoles || '';
        if (!skills.length && !roles) return;

        const cards = document.querySelectorAll('.srp-jobtuple-wrapper, .jobTuple, article.jobTuple');
        cards.forEach((card) => {
          if (card.querySelector('.aija-search-badge')) return;

          const titleEl = card.querySelector('a.title, a.job-title');
          if (!titleEl) return;

          const titleText = (titleEl.innerText || '').trim();
          if (titleText.length < 3) return;

          const snippetText = (card.innerText || '').trim();
          const calculateMatch = (typeof ExtensionPolicies !== 'undefined' && ExtensionPolicies.calculateSearchCardMatchHeuristic)
            ? ExtensionPolicies.calculateSearchCardMatchHeuristic
            : null;

          const score = calculateMatch
            ? calculateMatch(titleText, snippetText, skills, roles)
            : 70;

          const badge = document.createElement('span');
          badge.className = 'aija-search-badge';
          const isHigh = score >= 75;
          badge.style.cssText = 'display:inline-flex;align-items:center;gap:2px;background:' +
            (isHigh ? '#00c85320' : '#ff980020') + ';border:1px solid ' +
            (isHigh ? '#00c85380' : '#ff980080') + ';color:' +
            (isHigh ? '#00c853' : '#ff9800') + ';border-radius:10px;padding:1px 6px;font-size:10px;font-weight:700;margin-left:6px;vertical-align:middle;white-space:nowrap;pointer-events:none;';
          badge.textContent = `⚡ ${score}%`;
          titleEl.appendChild(badge);
        });
      });
    } catch (_) {}
  }

  badgeInterval = setInterval(renderNaukriSearchBadges, 3000);
  setTimeout(renderNaukriSearchBadges, 1000);

  if (isExtensionAlive()) {
    chrome.storage.local.get(['processedJobIds'], ({ processedJobIds = [] }) => {
      if (chrome.runtime.lastError) return;
      processedJobIds.forEach(id => seenIds.add(String(id)));
    });
  }

  function hasProcessed(id) { return seenIds.has(String(id)); }
  function markProcessed(id) {
    if (!isExtensionAlive()) return;
    const key = String(id);
    if (seenIds.has(key)) return;
    seenIds.add(key);
    chrome.storage.local.get(['processedJobIds'], ({ processedJobIds = [] }) => {
      if (chrome.runtime.lastError) return;
      if (!processedJobIds.includes(key)) {
        processedJobIds.push(key);
        if (processedJobIds.length > 2000) processedJobIds.splice(0, processedJobIds.length - 2000);
        chrome.storage.local.set({ processedJobIds });
      }
    });
  }

  function extLog(msg) {
    if (!isExtensionAlive()) return;
    chrome.runtime.sendMessage({ type: 'FORWARD_LOG', message: msg }).catch(() => {});
  }

  extLog('Naukri content script ready.');

  function startLoop() {
    if (retireIfDead()) return;
    if (scrapeTimer) return;
    scrapeTimer = setInterval(safeTick, 4000);
    extLog('Naukri loop started.');
  }

  function stopLoop() {
    clearInterval(scrapeTimer);
    scrapeTimer = null;
    tickRunning = false;
    if (isExtensionAlive()) extLog('Naukri loop stopped.');
  }

  function safeTick() {
    if (retireIfDead()) return;
    if (tickRunning) return;
    tickRunning = true;
    tick().finally(() => { tickRunning = false; });
  }

  async function tick() {
    if (retireIfDead()) return;

    const { botRunning } = await getStorage(['botRunning']);
    if (!isExtensionAlive()) return;
    if (!botRunning) { stopLoop(); return; }

    const cards = document.querySelectorAll('.srp-jobtuple-wrapper');
    if (!cards.length) { extLog('No job cards found.'); return; }

    let card = null, jobId = null;
    for (const c of cards) {
      const titleEl = c.querySelector('a.title, a.job-title');
      const id = c.getAttribute('data-job-id') || titleEl?.href;
      if (id && !hasProcessed(id)) {
        card = c; jobId = id;
        markProcessed(id);
        break;
      }
    }
    if (!card) { extLog('All visible Naukri jobs processed.'); return; }

    card.style.outline = '2px solid #448aff';
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const titleEl    = card.querySelector('a.title, a.job-title');
    const companyEl  = card.querySelector('a.comp-name, .company_name');
    const snippetEl  = card.querySelector('.job-desc');
    const skillEls   = card.querySelectorAll('.dot-wrapper li, .tag-li');
    const salaryEl   = card.querySelector('.sal-wrap, .salary');
    const locationEl = card.querySelector('.loc-wrap, .location');

    if (!titleEl) { card.style.outline = '2px solid #5a5e75'; return; }

    const skills = Array.from(skillEls).map(s => s.innerText.trim()).join(', ');
    const desc   = (snippetEl?.innerText?.trim() || '') + (skills ? `\n\nSkills: ${skills}` : '');

    card.style.outline = '2px solid #ff9800';
    extLog(`Evaluating: ${titleEl.innerText.trim().substring(0, 40)}...`);

    await new Promise(resolve => {
      if (!isExtensionAlive()) { resolve(); return; }
      chrome.runtime.sendMessage({
        type: 'EVALUATE_JOB',
        data: {
          id: jobId,
          title:        titleEl.innerText.trim(),
          company:      companyEl?.innerText.trim() || 'Unknown',
          description:  desc,
          url:          titleEl.href,
          applyUrl:     titleEl.href,
          contactEmail: extractEmail(desc),
          location:     locationEl?.innerText.trim() || 'India',
          jobType:      'Full-time',
          salary:       salaryEl?.innerText.trim() || ''
        }
      }, (res) => {
        if (!isExtensionAlive() || chrome.runtime.lastError) { resolve(); return; }
        if (res?.success && res.evaluation?.is_match) {
          card.style.outline = '3px solid #00c853';
          card.style.background = '#00c85308';
          extLog(`✅ Match: ${titleEl.innerText.trim().substring(0, 40)}`);
        } else if (res?.success) {
          card.style.outline = '1px solid #2a2d3e';
          card.style.opacity = '0.6';
          extLog(`❌ No match: ${titleEl.innerText.trim().substring(0, 40)}`);
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

  function extractEmail(text) {
    const m = (text || '').match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    return m ? m[0] : '';
  }
  function getStorage(keys) {
    return new Promise(r => {
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

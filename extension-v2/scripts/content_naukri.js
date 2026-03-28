// content_naukri.js — AI Job Assistant v2
(function () {
  if (window.__ajaNaukri) return;
  window.__ajaNaukri = true;

  let scrapeTimer = null;
  let tickRunning = false;

  const seenIds = new Set();
  chrome.storage.local.get(['processedJobIds'], ({ processedJobIds = [] }) => {
    processedJobIds.forEach(id => seenIds.add(String(id)));
  });

  function hasProcessed(id) { return seenIds.has(String(id)); }
  function markProcessed(id) {
    const key = String(id);
    if (seenIds.has(key)) return;
    seenIds.add(key);
    chrome.storage.local.get(['processedJobIds'], ({ processedJobIds = [] }) => {
      if (!processedJobIds.includes(key)) {
        processedJobIds.push(key);
        if (processedJobIds.length > 2000) processedJobIds.splice(0, processedJobIds.length - 2000);
        chrome.storage.local.set({ processedJobIds });
      }
    });
  }

  function extLog(msg) {
    chrome.runtime.sendMessage({ type: 'FORWARD_LOG', message: msg }).catch(() => {});
  }

  extLog('Naukri content script ready.');

  function startLoop() {
    if (scrapeTimer) return;
    scrapeTimer = setInterval(safeTick, 4000);
    extLog('Naukri loop started.');
  }

  function stopLoop() {
    clearInterval(scrapeTimer);
    scrapeTimer = null;
    tickRunning = false;
    extLog('Naukri loop stopped.');
  }

  function safeTick() {
    if (tickRunning) return;
    tickRunning = true;
    tick().finally(() => { tickRunning = false; });
  }

  async function tick() {
    const { botRunning } = await getStorage(['botRunning']);
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
        if (chrome.runtime.lastError) { resolve(); return; }
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
    if (req.type === 'START_SCRAPING') startLoop();
    if (req.type === 'STOP_SCRAPING')  stopLoop();
  });

  chrome.storage.local.get(['botRunning'], ({ botRunning }) => {
    if (botRunning) startLoop();
  });

  function extractEmail(text) {
    const m = (text || '').match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    return m ? m[0] : '';
  }
  function getStorage(keys) { return new Promise(r => chrome.storage.local.get(keys, r)); }
})();

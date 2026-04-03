// sidepanel.js — AI Job Assistant v2

document.addEventListener('DOMContentLoaded', () => {

  // ── State ──────────────────────────────────────────────────────────────────
  let currentView = 'analysis';
  let currentJob  = null;

  // Theme cycle: dark → light → system → dark
  const THEMES = ['dark', 'light', 'system'];
  const THEME_ICONS = { dark: '🌙', light: '☀️', system: '⚙️' };

  // ── Element refs ───────────────────────────────────────────────────────────
  const botToggle      = document.getElementById('botToggle');
  const botLabel       = document.getElementById('botLabel');
  const refreshBtn     = document.getElementById('refreshBtn');
  const themeBtn       = document.getElementById('themeBtn');
  const botStatusBanner = document.getElementById('botStatusBanner');
  const bannerStartBtn = document.getElementById('bannerStartBtn');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const loadingText    = document.getElementById('loadingText');

  // Views
  const idleView     = document.getElementById('idleView');
  const analysisView = document.getElementById('analysisView');
  const logView      = document.getElementById('logView');
  const settingsView = document.getElementById('settingsView');
  const profileView  = document.getElementById('profileView');
  const savedView    = document.getElementById('savedView');

  // Nav buttons
  const navBtns = document.querySelectorAll('.nav-btn');

  // ── Init ───────────────────────────────────────────────────────────────────
  loadStoredData();
  renderLogs();
  renderSavedJobs();
  setupCollapsibles();
  setupNav();
  setupBotToggle();
  setupActionButtons();
  setupSettings();
  setupProfile();
  setupTheme();
  listenForMessages();

  // ── Navigation ─────────────────────────────────────────────────────────────
  function setupNav() {
    navBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        switchView(view);
      });
    });
  }

  function switchView(view) {
    currentView = view;

    // Update nav active state
    navBtns.forEach(b => b.classList.toggle('active', b.dataset.view === view));

    // Hide all views
    [logView, settingsView, profileView, savedView].forEach(v => v.classList.add('hidden'));
    idleView.classList.add('hidden');
    analysisView.classList.add('hidden');

    if (view === 'analysis') {
      if (currentJob) {
        analysisView.classList.remove('hidden');
      } else {
        idleView.classList.remove('hidden');
      }
    } else if (view === 'log') {
      logView.classList.remove('hidden');
    } else if (view === 'settings') {
      settingsView.classList.remove('hidden');
    } else if (view === 'profile') {
      profileView.classList.remove('hidden');
    } else if (view === 'saved') {
      savedView.classList.remove('hidden');
      renderSavedJobs();
    }
  }

  // ── Bot Toggle ─────────────────────────────────────────────────────────────
  function setupBotToggle() {
    botToggle.addEventListener('change', () => {
      const running = botToggle.checked;
      chrome.storage.local.set({ botRunning: running });
      updateBotUI(running);
      chrome.runtime.sendMessage({ type: 'TOGGLE_BOT', state: running }).catch(() => {});

      if (running) {
        // Auto-redirect active tab to job search if on LinkedIn/Naukri
        chrome.storage.local.get(['targetRoles', 'targetLocations'], (data) => {
          const roles    = (data.targetRoles || '').split(',')[0].trim();
          const location = (data.targetLocations || '').split(',')[0].trim();

          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]) return;
            const url = tabs[0].url || '';
            try {
              const parsed = new URL(url);
              if (parsed.hostname.includes('linkedin.com') && roles) {
                const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(roles)}&location=${encodeURIComponent(location)}`;
                if (!url.includes(encodeURIComponent(roles))) {
                  chrome.tabs.update(tabs[0].id, { url: searchUrl });
                }
              } else if (parsed.hostname.includes('naukri.com') && roles) {
                const cleanRole = roles.replace(/\s+/g, '-').toLowerCase();
                const cleanLoc  = location.replace(/\s+/g, '-').toLowerCase();
                chrome.tabs.update(tabs[0].id, { url: `https://www.naukri.com/${cleanRole}-jobs-in-${cleanLoc}` });
              }
            } catch (_) {}
          });
        });
      }
    });

    // Banner "Start" button restarts the bot
    bannerStartBtn.addEventListener('click', () => {
      botToggle.checked = true;
      botToggle.dispatchEvent(new Event('change'));
    });
  }

  function updateBotUI(running) {
    botLabel.textContent = running ? 'Running' : 'Stopped';
    botLabel.classList.toggle('running', running);
    // Show/hide the paused banner
    botStatusBanner.classList.toggle('hidden', running);
  }

  // ── Collapsible sections ───────────────────────────────────────────────────
  function setupCollapsibles() {
    document.querySelectorAll('.section-header').forEach(header => {
      header.addEventListener('click', () => {
        const card = header.closest('.section-card');
        card.classList.toggle('collapsed');
      });
    });
  }

  // ── Load stored data ───────────────────────────────────────────────────────
  function loadStoredData() {
    chrome.storage.local.get([
      'botRunning', 'aiModel', 'apiKey', 'groqApiKey', 'ollamaBackendUrl', 'ollamaModel',
      'targetRoles', 'targetLocations', 'resumeSummary',
      'shareAnonymized', 'lastJob', 'theme', 'accentColor'
    ], (data) => {
      // Bot state
      botToggle.checked = !!data.botRunning;
      updateBotUI(!!data.botRunning);

      // Settings — treat legacy 'gemini' as 'free'
      const model = data.aiModel === 'gemini' ? 'free' : (data.aiModel || 'free');
      document.getElementById('aiModel').value = model;
      // Highlight the selected card
      document.querySelectorAll('.ai-option-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.value === model);
      });
      if (data.apiKey) document.getElementById('apiKey').value = data.apiKey;
      if (data.groqApiKey) document.getElementById('groqApiKey').value = data.groqApiKey;
      toggleApiKeyField(model);

      // Profile
      if (data.targetRoles)     document.getElementById('targetRoles').value     = data.targetRoles;
      if (data.targetLocations) document.getElementById('targetLocations').value = data.targetLocations;
      if (data.resumeSummary)   document.getElementById('resumeSummary').value   = data.resumeSummary;
      document.getElementById('shareAnonymized').checked = data.shareAnonymized !== false;

      // Resume filename — field removed, no-op

      // Theme
      applyTheme(data.theme || 'dark');
      applyAccent(data.accentColor || 'green');

      // Restore last job if any
      if (data.lastJob) {
        renderJobAnalysis(data.lastJob);
      }
    });
  }

  // ── Theme ──────────────────────────────────────────────────────────────────
  function setupTheme() {
    themeBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
      applyTheme(next);
      chrome.storage.local.set({ theme: next });
    });

    // Accent color swatches
    document.querySelectorAll('.swatch').forEach(btn => {
      btn.addEventListener('click', () => {
        const color = btn.dataset.color;
        applyAccent(color);
        chrome.storage.local.set({ accentColor: color });
      });
    });
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    themeBtn.textContent = THEME_ICONS[theme] || '🌙';
    themeBtn.title = `Theme: ${theme} (click to cycle)`;
  }

  function applyAccent(color) {
    document.documentElement.setAttribute('data-accent', color || 'green');
    // Update active swatch
    document.querySelectorAll('.swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.color === (color || 'green'));
    });
  }

  // ── Settings ───────────────────────────────────────────────────────────────
  function setupSettings() {
    // Card-based AI model selector
    const aiModelInput = document.getElementById('aiModel');
    const cards = document.querySelectorAll('.ai-option-card');

    function selectModel(value) {
      aiModelInput.value = value;
      cards.forEach(c => c.classList.toggle('selected', c.dataset.value === value));
      toggleApiKeyField(value);
    }

    cards.forEach(card => {
      card.addEventListener('click', () => selectModel(card.dataset.value));
    });

    // "Why own key?" toggle
    document.getElementById('whyOwnKey')?.addEventListener('click', () => {
      document.getElementById('whyOwnKeyText').classList.toggle('hidden');
    });

    document.getElementById('saveSettingsBtn').addEventListener('click', () => {
      const aiModel       = aiModelInput.value;
      const apiKey        = document.getElementById('apiKey').value.trim();
      const groqApiKey    = document.getElementById('groqApiKey')?.value.trim() || '';
      chrome.storage.local.set({ aiModel, apiKey, groqApiKey }, () => {
        showConfirm('settingsSaved');
      });
    });

    document.getElementById('clearHistoryBtn').addEventListener('click', () => {
      chrome.storage.local.remove('processedJobIds', () => {
        showConfirm('historyClearedMsg');
      });
    });
  }

  function toggleApiKeyField(model) {
    const section     = document.getElementById('apiKeySection');
    const label       = document.getElementById('apiKeyLabel');
    const freeSection = document.getElementById('freeModelSection');

    if (freeSection) freeSection.classList.toggle('hidden', model !== 'free');

    if (model === 'free') {
      section.classList.add('hidden');
    } else {
      section.classList.remove('hidden');
      const labels = { openai: 'OpenAI API Key', gemini_api: 'Gemini API Key', anthropic: 'Anthropic API Key' };
      label.textContent = labels[model] || 'API Key';
    }
  }

  // ── Profile ────────────────────────────────────────────────────────────────
  function setupProfile() {
    document.getElementById('saveProfileBtn').addEventListener('click', async () => {
      const targetRoles     = document.getElementById('targetRoles').value;
      const targetLocations = document.getElementById('targetLocations').value;
      const resumeSummary   = document.getElementById('resumeSummary').value;
      const shareAnonymized = document.getElementById('shareAnonymized').checked;

      chrome.storage.local.set({ targetRoles, targetLocations, resumeSummary, shareAnonymized }, async () => {
        showConfirm('profileSaved');

        // Sync to recruiter platform if consent given
        if (shareAnonymized && resumeSummary) {
          try {
            const res = await fetch('https://aijobassistant-production.up.railway.app/api/v1/profile/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                shareAnonymized,
                resumeSummary,
                targetRoles,
                targetLocations,
                skills: resumeSummary // backend extracts skills from summary
              })
            });
            if (res.ok) {
              addLog('Profile synced to recruiter platform.', 'success');
            }
          } catch (_) {
            // Non-fatal — local save already succeeded
          }
        }
      });
    });
  }

  // ── Action buttons ─────────────────────────────────────────────────────────
  function setupActionButtons() {
    document.getElementById('saveJobBtn').addEventListener('click', () => {
      if (!currentJob) return;
      saveJob(currentJob);
    });

    document.getElementById('coverLetterBtn').addEventListener('click', () => {
      if (!currentJob) return;
      const section = document.getElementById('coverLetterSection');
      const text    = document.getElementById('coverLetterText').textContent;
      if (text && text.length > 10) {
        section.classList.remove('hidden');
        section.scrollIntoView({ behavior: 'smooth' });
      } else {
        showLoading('Generating cover letter...');
        chrome.runtime.sendMessage({ type: 'GENERATE_COVER_LETTER', data: currentJob }, (res) => {
          if (chrome.runtime.lastError) { hideLoading(); return; }
          hideLoading();
          if (res && res.coverLetter) {
            document.getElementById('coverLetterText').textContent = res.coverLetter;
            section.classList.remove('hidden');
            section.scrollIntoView({ behavior: 'smooth' });
          }
        });
      }
    });

    document.getElementById('rewriteResumeBtn').addEventListener('click', () => {
      if (!currentJob) return;
      showLoading('Rewriting resume for this role...');
      chrome.runtime.sendMessage({ type: 'REWRITE_RESUME', data: currentJob }, (res) => {
        if (chrome.runtime.lastError) { hideLoading(); return; }
        hideLoading();
        if (res && res.rewritten) {
          addLog('Resume rewrite ready. Check cover letter section.', 'success');
          document.getElementById('coverLetterText').textContent = res.rewritten;
          document.getElementById('coverLetterSection').classList.remove('hidden');
        }
      });
    });

    document.getElementById('copyCoverLetter').addEventListener('click', () => {
      const text = document.getElementById('coverLetterText').textContent;
      navigator.clipboard.writeText(text).then(() => {
        document.getElementById('copyCoverLetter').textContent = 'Copied!';
        setTimeout(() => { document.getElementById('copyCoverLetter').textContent = 'Copy'; }, 2000);
      });
    });

    document.getElementById('clearLogsBtn').addEventListener('click', () => {
      chrome.storage.local.set({ sessionLogs: [] }, () => {
        document.getElementById('logList').innerHTML = '';
      });
    });

    document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);

    refreshBtn.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) chrome.tabs.reload(tabs[0].id);
      });
    });
  }

  // ── Render job analysis ────────────────────────────────────────────────────
  function renderJobAnalysis(jobResult) {
    currentJob = jobResult;

    // Switch to analysis view
    if (currentView === 'analysis') {
      idleView.classList.add('hidden');
      analysisView.classList.remove('hidden');
    }

    // Job summary
    document.getElementById('jobTitleText').textContent   = jobResult.title   || '--';
    document.getElementById('jobCompanyText').textContent = jobResult.company || '--';
    document.getElementById('metaLocation').textContent   = jobResult.location || 'India';
    document.getElementById('metaType').textContent       = jobResult.jobType  || 'Full-time';
    document.getElementById('metaSalary').textContent     = jobResult.salary   || 'Salary not specified';

    // Apply link & contact email
    const applyLink = document.getElementById('jobApplyLink');
    applyLink.href = jobResult.applyUrl || jobResult.url || '#';
    applyLink.style.display = (jobResult.applyUrl || jobResult.url) ? '' : 'none';

    const emailEl = document.getElementById('jobContactEmail');
    if (jobResult.contactEmail) {
      emailEl.textContent = '✉ ' + jobResult.contactEmail;
      emailEl.style.display = '';
    } else {
      emailEl.textContent = '';
      emailEl.style.display = 'none';
    }

    // Score
    const score = jobResult.evaluation?.score || 0;
    document.getElementById('scorePct').textContent = score ? `${score}%` : '--';
    setBar('barSkills',  'valSkills',  jobResult.evaluation?.skillsScore  || 0);
    setBar('barReqs',    'valReqs',    jobResult.evaluation?.reqsScore    || 0);
    setBar('barResp',    'valResp',    jobResult.evaluation?.respScore    || 0);

    // Skills
    renderSkills(jobResult.evaluation?.matchedSkills || [], jobResult.evaluation?.missingSkills || []);

    // Requirements
    renderList('reqsList', jobResult.evaluation?.requirements || []);

    // Responsibilities
    renderList('respList', jobResult.evaluation?.responsibilities || []);

    // Reasoning
    document.getElementById('reasoningText').textContent = jobResult.evaluation?.reasoning || '--';

    // Cover letter (if already generated)
    if (jobResult.evaluation?.cover_letter) {
      document.getElementById('coverLetterText').textContent = jobResult.evaluation.cover_letter;
      document.getElementById('coverLetterSection').classList.remove('hidden');
    } else {
      document.getElementById('coverLetterSection').classList.add('hidden');
    }
  }

  function setBar(barId, valId, pct) {
    const clamped = Math.min(100, Math.max(0, pct));
    document.getElementById(barId).style.width = `${clamped}%`;
    document.getElementById(valId).textContent = clamped ? `${clamped}%` : '--';
  }

  function renderSkills(matched, missing) {
    const container = document.getElementById('skillsChips');
    container.innerHTML = '';
    const total = matched.length + missing.length;
    document.getElementById('skillsCount').textContent = total ? `${matched.length}/${total}` : '';

    matched.forEach(skill => {
      const chip = document.createElement('span');
      chip.className = 'skill-chip matched';
      chip.innerHTML = `<span class="skill-dot"></span>${skill}`;
      container.appendChild(chip);
    });

    missing.forEach(skill => {
      const chip = document.createElement('span');
      chip.className = 'skill-chip missing';
      chip.innerHTML = `<span class="skill-dot"></span>${skill}`;
      container.appendChild(chip);
    });
  }

  function renderList(listId, items) {
    const ul = document.getElementById(listId);
    ul.innerHTML = '';
    if (!items.length) {
      ul.innerHTML = '<li class="req-item"><span class="req-text" style="color:var(--text-dim)">No data available.</span></li>';
      return;
    }
    items.forEach(item => {
      const li = document.createElement('li');
      li.className = 'req-item';
      const priority = item.priority || 'important';
      li.innerHTML = `
        <span class="req-check">&#9989;</span>
        <div class="req-content">
          <p class="req-text">${item.text || item}</p>
          <div class="req-tags">
            <span class="priority-tag ${priority}">${capitalize(priority)}</span>
          </div>
        </div>`;
      ul.appendChild(li);
    });
  }

  // ── Saved Jobs ─────────────────────────────────────────────────────────────
  function saveJob(jobResult) {
    // Manual save from "Save Job" button — just triggers a re-render
    // (auto-save already happened in background for matches)
    chrome.storage.local.get(['savedJobs'], (data) => {
      const saved = data.savedJobs || [];
      const exists = saved.find(j => j.url === (jobResult.applyUrl || jobResult.url));
      if (!exists) {
        // Manually saved job (e.g. non-match the user wants to keep)
        saved.unshift({
          title:        jobResult.title        || '',
          company:      jobResult.company      || '',
          location:     jobResult.location     || '',
          jobType:      jobResult.jobType      || 'Full-time',
          salary:       jobResult.salary       || '',
          url:          jobResult.url          || '',
          applyUrl:     jobResult.applyUrl     || jobResult.url || '',
          contactEmail: jobResult.contactEmail || '',
          score:        jobResult.evaluation?.score        || 0,
          skillsScore:  jobResult.evaluation?.skillsScore  || 0,
          reqsScore:    jobResult.evaluation?.reqsScore    || 0,
          respScore:    jobResult.evaluation?.respScore    || 0,
          matchedSkills: jobResult.evaluation?.matchedSkills || [],
          missingSkills: jobResult.evaluation?.missingSkills || [],
          reasoning:    jobResult.evaluation?.reasoning    || '',
          coverLetter:  jobResult.evaluation?.cover_letter || '',
          savedAt:      new Date().toISOString()
        });
        chrome.storage.local.set({ savedJobs: saved }, () => {
          addLog(`Saved: ${jobResult.title} at ${jobResult.company}`, 'success');
          renderSavedJobs();
        });
      } else {
        addLog('Already in saved jobs.', 'warn');
        renderSavedJobs();
      }
    });
  }

  function renderSavedJobs() {
    chrome.storage.local.get(['savedJobs'], (data) => {
      const container = document.getElementById('savedJobsList');
      const saved     = data.savedJobs || [];

      // Update count badge
      const countEl = document.getElementById('savedCount');
      if (countEl) countEl.textContent = saved.length ? `(${saved.length})` : '';

      if (!saved.length) {
        container.innerHTML = '<p class="empty-state">No saved jobs yet. Matches are saved here automatically.</p>';
        return;
      }

      container.innerHTML = '';
      saved.forEach((job, idx) => {
        const card = document.createElement('div');
        card.className = 'saved-job-card';

        const skillsHtml = (job.matchedSkills || []).slice(0, 8).map(s =>
          `<span class="sj-skill matched">${s}</span>`
        ).join('') + (job.missingSkills || []).slice(0, 3).map(s =>
          `<span class="sj-skill missing">${s}</span>`
        ).join('');

        const emailHtml = job.contactEmail
          ? `<span class="sj-email">✉ ${job.contactEmail}</span>` : '';

        const scoreColor = job.score >= 80 ? 'var(--accent)' : job.score >= 60 ? 'var(--orange)' : 'var(--red)';

        card.innerHTML = `
          <div class="sj-header">
            <div class="sj-title-wrap">
              <div class="sj-title">${job.title}</div>
              <div class="sj-company">${job.company}${job.location ? ' · ' + job.location : ''}</div>
            </div>
            <div class="sj-score" style="color:${scoreColor}">${job.score ? job.score + '%' : ''}</div>
          </div>

          <div class="sj-meta">
            ${job.salary ? `<span class="sj-chip">${job.salary}</span>` : ''}
            ${job.jobType ? `<span class="sj-chip">${job.jobType}</span>` : ''}
            <span class="sj-chip">Skills ${job.skillsScore || 0}%</span>
          </div>

          ${skillsHtml ? `<div class="sj-skills">${skillsHtml}</div>` : ''}

          <div class="sj-actions">
            <a class="sj-apply-btn" href="${job.applyUrl || job.url}" target="_blank">Apply ↗</a>
            ${emailHtml}
            <button class="sj-expand-btn" data-idx="${idx}">Details ▾</button>
            <button class="sj-delete-btn" data-idx="${idx}" title="Remove">✕</button>
          </div>

          <div class="sj-details hidden" id="sj-details-${idx}">
            ${job.reasoning ? `<div class="sj-section-label">AI Reasoning</div><p class="sj-reasoning">${job.reasoning}</p>` : ''}
            ${job.coverLetter ? `<div class="sj-section-label">Cover Letter <button class="sj-copy-btn" data-text="${encodeURIComponent(job.coverLetter)}">Copy</button></div><p class="sj-cover">${job.coverLetter}</p>` : ''}
            <div class="sj-section-label">Saved ${new Date(job.savedAt).toLocaleDateString('en-IN')}</div>
          </div>`;

        container.appendChild(card);
      });

      // Wire up expand/collapse, delete, copy buttons
      container.querySelectorAll('.sj-expand-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const details = document.getElementById(`sj-details-${btn.dataset.idx}`);
          const isOpen  = !details.classList.contains('hidden');
          details.classList.toggle('hidden', isOpen);
          btn.textContent = isOpen ? 'Details ▾' : 'Details ▴';
        });
      });

      container.querySelectorAll('.sj-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          chrome.storage.local.get(['savedJobs'], (d) => {
            const jobs = d.savedJobs || [];
            jobs.splice(Number(btn.dataset.idx), 1);
            chrome.storage.local.set({ savedJobs: jobs }, renderSavedJobs);
          });
        });
      });

      container.querySelectorAll('.sj-copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          navigator.clipboard.writeText(decodeURIComponent(btn.dataset.text)).then(() => {
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
          });
        });
      });
    });
  }

  function exportCsv() {
    chrome.storage.local.get(['savedJobs'], (data) => {
      const saved = data.savedJobs || [];
      if (!saved.length) { addLog('No saved jobs to export.', 'warn'); return; }

      const headers = [
        'Date Saved', 'Job Title', 'Company', 'Location', 'Job Type', 'Salary',
        'Match Score', 'Skills Score', 'Req Score', 'Resp Score',
        'Matched Skills', 'Missing Skills',
        'Apply URL', 'Contact Email',
        'AI Reasoning', 'Cover Letter'
      ];

      const rows = saved.map(j => [
        new Date(j.savedAt).toLocaleString('en-IN'),
        j.title, j.company, j.location, j.jobType, j.salary,
        j.score, j.skillsScore, j.reqsScore, j.respScore,
        (j.matchedSkills || []).join('; '),
        (j.missingSkills || []).join('; '),
        j.applyUrl || j.url,
        j.contactEmail,
        j.reasoning,
        j.coverLetter
      ].map(v => `"${String(v || '').replace(/"/g, '""')}"`));

      const csv  = [headers.map(h => `"${h}"`).join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url  = URL.createObjectURL(blob);

      chrome.downloads.download({
        url,
        filename: `ai-job-matches-${new Date().toISOString().slice(0,10)}.csv`,
        saveAs: false
      }, () => {
        if (chrome.runtime.lastError) {
          addLog(`Export failed: ${chrome.runtime.lastError.message}`, 'error');
        } else {
          addLog(`Exported ${saved.length} jobs to CSV.`, 'success');
        }
        URL.revokeObjectURL(url);
      });
    });
  }

  // ── Logs ───────────────────────────────────────────────────────────────────
  function addLog(msg, type = '') {
    const time = new Date().toLocaleTimeString([], { hour12: false });
    const full = `[${time}] ${msg}`;

    chrome.storage.local.get(['sessionLogs'], (data) => {
      const logs = data.sessionLogs || [];
      logs.unshift({ text: full, type });
      if (logs.length > 100) logs.pop();
      chrome.storage.local.set({ sessionLogs: logs });
    });

    appendLogItem({ text: full, type });

    // Also forward to background
    chrome.runtime.sendMessage({ type: 'FORWARD_LOG', message: msg }).catch(() => {});
  }

  function appendLogItem(log) {
    const ul = document.getElementById('logList');
    const li = document.createElement('li');
    li.className = `log-item ${log.type || ''}`;
    li.textContent = log.text;
    ul.prepend(li);
  }

  function renderLogs() {
    chrome.storage.local.get(['sessionLogs'], (data) => {
      const ul = document.getElementById('logList');
      ul.innerHTML = '';
      (data.sessionLogs || []).forEach(log => appendLogItem(log));
    });
  }

  // ── Loading overlay ────────────────────────────────────────────────────────
  function showLoading(text = 'Analyzing...') {
    loadingText.textContent = text;
    loadingOverlay.classList.remove('hidden');
  }

  function hideLoading() {
    loadingOverlay.classList.add('hidden');
  }

  // ── Listen for messages from content scripts / background ──────────────────
  function listenForMessages() {
    chrome.runtime.onMessage.addListener((request) => {
      if (request.type === 'LOG_MESSAGE') {
        const type = request.message.includes('✅') ? 'success'
                   : request.message.includes('❌') || request.message.includes('ERROR') ? 'error'
                   : request.message.includes('⚠️') ? 'warn' : '';
        appendLogItem({ text: request.message, type });
      }

      if (request.type === 'JOB_EVALUATED') {
        hideLoading();
        renderJobAnalysis(request.data);
        chrome.storage.local.set({ lastJob: request.data });
        switchView('analysis');
      }

      if (request.type === 'JOB_SAVED') {
        // Background finished writing match to storage — refresh saved tab
        renderSavedJobs();
      }

      if (request.type === 'JOB_EVALUATING') {
        showLoading(`Analyzing: ${request.title || 'job'}...`);
        switchView('analysis');
      }
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function showConfirm(id) {
    const el = document.getElementById(id);
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 2500);
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

});

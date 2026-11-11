// sidepanel.js — AI Job Assistant v2

document.addEventListener('DOMContentLoaded', () => {

  // ── State ──────────────────────────────────────────────────────────────────
  let currentView = 'analysis';
  let currentJob  = null;
  let compareSelection = []; // up to 3 jobs for side-by-side comparison
  let _trackerFilter = 'all';
  let _trackerSearch = '';
  let _appDetailKey  = null; // id or url of the job being edited
  const { hasExplicitSharingConsent, consentStorageUpdate, safeExternalUrl } = ExtensionPolicies;

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
  const trackerView  = document.getElementById('trackerView');
  const compareView  = document.getElementById('compareView');

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
  initTracker();
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
    [logView, settingsView, profileView, savedView, trackerView, compareView].forEach(v => v && v.classList.add('hidden'));
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
    } else if (view === 'tracker') {
      trackerView && trackerView.classList.remove('hidden');
      renderTracker(_trackerFilter, _trackerSearch);
    } else if (view === 'compare') {
      compareView && compareView.classList.remove('hidden');
      renderCompareView();
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
                // LinkedIn redirects classic /jobs/search/ to the SDUI
                // /jobs/search-results/ experience; open that URL directly.
                const searchUrl = `https://www.linkedin.com/jobs/search-results/?keywords=${encodeURIComponent(roles)}&location=${encodeURIComponent(location)}`;
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
      'botRunning', 'aiMode', 'aiModel', 'byokProvider',
      'openaiKey', 'geminiKey', 'anthropicKey',
      'targetRoles', 'targetLocations', 'resumeSummary',
      'shareAnonymized', 'shareConsentVersion', 'lastJob', 'theme', 'accentColor'
    ], (data) => {
      // Bot state
      botToggle.checked = !!data.botRunning;
      updateBotUI(!!data.botRunning);

      // Settings mode
      const mode = data.aiMode || 'free';
      applyMode(mode);

      // BYOK provider active state
      if (data.byokProvider) {
        applyProvider(data.byokProvider, false);
      }

      // Provider key status indicators
      updateKeyStatus('openai',     !!data.openaiKey);
      updateKeyStatus('gemini_api', !!data.geminiKey);
      updateKeyStatus('anthropic',  !!data.anthropicKey);

      // Profile
      if (data.targetRoles)     document.getElementById('targetRoles').value     = data.targetRoles;
      if (data.targetLocations) document.getElementById('targetLocations').value = data.targetLocations;
      if (data.resumeSummary)   document.getElementById('resumeSummary').value   = data.resumeSummary;
      // Historical `true` values predate explicit consent tracking and must be reconfirmed.
      document.getElementById('shareAnonymized').checked = hasExplicitSharingConsent(data);

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
  let _currentMode     = 'free';
  let _currentProvider = null;   // 'openai' | 'gemini_api' | 'anthropic'
  let _pendingProvider = null;   // provider whose modal is open

  function applyMode(mode) {
    _currentMode = mode;
    document.getElementById('modeFree').classList.toggle('active', mode === 'free');
    document.getElementById('modeBYOK').classList.toggle('active', mode === 'byok');
    document.getElementById('byokSection').classList.toggle('hidden', mode !== 'byok');
    document.getElementById('modeHint').textContent =
      mode === 'free'
        ? 'Uses our servers — no API key needed.'
        : 'Your API key is used directly from your browser.';
    // Sync hidden input for background.js
    const aiModelInput = document.getElementById('aiModel');
    if (mode === 'free') {
      aiModelInput.value = 'free';
    } else if (_currentProvider) {
      aiModelInput.value = _currentProvider;
    }
  }

  function applyProvider(provider, markActive) {
    if (markActive) {
      _currentProvider = provider;
      document.getElementById('aiModel').value = provider;
    }
    // Highlight active provider card
    document.querySelectorAll('.provider-btn').forEach(btn => {
      btn.classList.toggle('active', markActive && btn.dataset.provider === provider);
    });
  }

  function updateKeyStatus(provider, hasKey) {
    const statusMap = { openai: 'statusOpenAI', gemini_api: 'statusGemini', anthropic: 'statusAnthropic' };
    const el = document.getElementById(statusMap[provider]);
    if (!el) return;
    el.className = 'provider-key-status ' + (hasKey ? 'key-set' : 'no-key');
  }

  const PROVIDER_META = {
    openai:     { title: 'OpenAI API Key',     hint: 'Get a free key at platform.openai.com → API Keys.',      storageKey: 'openaiKey'     },
    gemini_api: { title: 'Google Gemini Key',  hint: 'Get a free key at aistudio.google.com → Get API key.',   storageKey: 'geminiKey'     },
    anthropic:  { title: 'Anthropic API Key',  hint: 'Get a key at console.anthropic.com → API Keys.',         storageKey: 'anthropicKey'  }
  };

  function openKeyModal(provider) {
    _pendingProvider = provider;
    const meta = PROVIDER_META[provider];
    document.getElementById('modalTitle').textContent = meta.title;
    document.getElementById('modalHint').textContent  = meta.hint;
    // Pre-fill if key already saved
    chrome.storage.local.get([meta.storageKey], (data) => {
      document.getElementById('modalApiKeyInput').value = data[meta.storageKey] || '';
      document.getElementById('apiKeyModal').classList.remove('hidden');
      document.getElementById('modalApiKeyInput').focus();
    });
  }

  function closeKeyModal() {
    document.getElementById('apiKeyModal').classList.add('hidden');
    document.getElementById('modalApiKeyInput').value = '';
    _pendingProvider = null;
  }

  function setupSettings() {
    // Mode buttons
    document.getElementById('modeFree').addEventListener('click', () => applyMode('free'));
    document.getElementById('modeBYOK').addEventListener('click', () => applyMode('byok'));

    // Provider buttons — open modal
    document.querySelectorAll('.provider-btn').forEach(btn => {
      btn.addEventListener('click', () => openKeyModal(btn.dataset.provider));
    });

    // Modal: close
    document.getElementById('modalClose').addEventListener('click',  closeKeyModal);
    document.getElementById('modalCancel').addEventListener('click', closeKeyModal);
    document.getElementById('apiKeyModal').addEventListener('click', (e) => {
      if (e.target === document.getElementById('apiKeyModal')) closeKeyModal();
    });

    // Modal: save key
    document.getElementById('modalSaveKey').addEventListener('click', () => {
      if (!_pendingProvider) return;
      const key  = document.getElementById('modalApiKeyInput').value.trim();
      const meta = PROVIDER_META[_pendingProvider];
      chrome.storage.local.set({ [meta.storageKey]: key }, () => {
        updateKeyStatus(_pendingProvider, !!key);
        applyProvider(_pendingProvider, true);
        closeKeyModal();
      });
    });

    // Save Settings button — persist mode + derive aiModel + apiKey for background.js
    document.getElementById('saveSettingsBtn').addEventListener('click', () => {
      const updates = { aiMode: _currentMode };
      if (_currentMode === 'free') {
        updates.aiModel = 'free';
        updates.apiKey  = '';
      } else if (_currentProvider) {
        updates.aiModel      = _currentProvider;
        updates.byokProvider = _currentProvider;
        const meta = PROVIDER_META[_currentProvider];
        chrome.storage.local.get([meta.storageKey], (data) => {
          chrome.storage.local.set({ ...updates, apiKey: data[meta.storageKey] || '' }, () => {
            showConfirm('settingsSaved');
          });
        });
        return;
      }
      chrome.storage.local.set(updates, () => showConfirm('settingsSaved'));
    });

    document.getElementById('clearHistoryBtn').addEventListener('click', () => {
      chrome.storage.local.remove('processedJobIds', () => {
        showConfirm('historyClearedMsg');
      });
    });
  }

  // ── Profile ────────────────────────────────────────────────────────────────
  function setupProfile() {
    document.getElementById('saveProfileBtn').addEventListener('click', async () => {
      const targetRoles     = document.getElementById('targetRoles').value;
      const targetLocations = document.getElementById('targetLocations').value;
      const resumeSummary   = document.getElementById('resumeSummary').value;
      const shareAnonymized = document.getElementById('shareAnonymized').checked;

      const profileUpdate = {
        targetRoles,
        targetLocations,
        resumeSummary,
        ...consentStorageUpdate(shareAnonymized)
      };

      chrome.storage.local.set(profileUpdate, async () => {
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
      const section = document.getElementById('resumeRewriteSection');
      const output = document.getElementById('resumeRewriteText');
      const error = document.getElementById('resumeRewriteError');
      error.textContent = '';
      error.classList.add('hidden');
      showLoading('Tailoring resume summary for this role...');
      chrome.runtime.sendMessage({ type: 'REWRITE_RESUME', data: currentJob }, (res) => {
        hideLoading();
        section.classList.remove('hidden');
        if (chrome.runtime.lastError) {
          output.textContent = '';
          error.textContent = 'The resume summary could not be generated. Please try again.';
          error.classList.remove('hidden');
        } else if (res?.success && res.rewritten) {
          output.textContent = res.rewritten;
          addLog('Tailored resume summary ready for review.', 'success');
        } else {
          output.textContent = '';
          error.textContent = res?.error || 'The resume summary could not be generated.';
          error.classList.remove('hidden');
        }
        section.scrollIntoView({ behavior: 'smooth' });
      });
    });

    document.getElementById('copyCoverLetter').addEventListener('click', () => {
      const text = document.getElementById('coverLetterText').textContent;
      navigator.clipboard.writeText(text).then(() => {
        document.getElementById('copyCoverLetter').textContent = 'Copied!';
        setTimeout(() => { document.getElementById('copyCoverLetter').textContent = 'Copy'; }, 2000);
      });
    });

    document.getElementById('copyResumeRewrite').addEventListener('click', () => {
      const text = document.getElementById('resumeRewriteText').textContent;
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        const button = document.getElementById('copyResumeRewrite');
        button.textContent = 'Copied!';
        setTimeout(() => { button.textContent = 'Copy Summary'; }, 2000);
      });
    });

    document.getElementById('saveApplyBtn').addEventListener('click', () => {
      if (!currentJob) return;

      const coverLetter = document.getElementById('coverLetterText').textContent;
      if (!coverLetter || coverLetter.length < 10) {
        addLog('No cover letter to save — generate one first.', 'warn');
        return;
      }

      const applyUrl = currentJob.applyUrl || currentJob.url || '';

      chrome.storage.local.get(['savedJobs'], (data) => {
        const saved = data.savedJobs || [];

        // Update existing entry or prepend new one
        const existingIdx = saved.findIndex(j => TrackerLib.sameJob(j, currentJob));

        const entry = {
          id:            String(currentJob.id  || ''),
          title:         currentJob.title        || '',
          company:       currentJob.company      || '',
          location:      currentJob.location     || '',
          jobType:       currentJob.jobType      || 'Full-time',
          salary:        currentJob.salary       || '',
          url:           currentJob.url          || '',
          applyUrl:      applyUrl,
          contactEmail:  currentJob.contactEmail || '',
          score:         currentJob.evaluation?.score        ?? null,
          skillsScore:   currentJob.evaluation?.skillsScore  ?? null,
          reqsScore:     currentJob.evaluation?.reqsScore    ?? null,
          respScore:     currentJob.evaluation?.respScore    ?? null,
          scoreCoverage: currentJob.evaluation?.scoreCoverage || null,
          matchedSkills: currentJob.evaluation?.matchedSkills || [],
          missingSkills: currentJob.evaluation?.missingSkills || [],
          reasoning:     currentJob.evaluation?.reasoning    || '',
          coverLetter:   coverLetter,
          savedAt:       new Date().toISOString()
        };

        if (existingIdx >= 0) {
          // Evaluation/cover-letter refreshes must never erase tracker data.
          saved[existingIdx] = TrackerLib.mergeTrackerFields({ ...saved[existingIdx], ...entry }, saved[existingIdx]);
        } else {
          saved.unshift(TrackerLib.mergeTrackerFields(entry));
          if (saved.length > 200) saved.pop();
        }

        chrome.storage.local.set({ savedJobs: saved }, () => {
          addLog(`✅ Saved with cover letter: ${currentJob.title} at ${currentJob.company}`, 'success');
          // Show inline confirmation
          const confirm = document.getElementById('saveApplyConfirm');
          confirm.classList.remove('hidden');
          setTimeout(() => confirm.classList.add('hidden'), 2500);
          // Open the job application page
          if (applyUrl && applyUrl !== '#') {
            const safeUrl = safeExternalUrl(applyUrl);
            if (safeUrl) chrome.tabs.create({ url: safeUrl });
          }
        });
      });
    });

    document.getElementById('clearLogsBtn').addEventListener('click', () => {
      chrome.storage.local.set({ sessionLogs: [] }, () => {
        document.getElementById('logList').replaceChildren();
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
    const safeApplyUrl = safeExternalUrl(jobResult.applyUrl || jobResult.url);
    applyLink.removeAttribute('href');
    applyLink.rel = 'noopener noreferrer';
    if (safeApplyUrl) applyLink.href = safeApplyUrl;
    applyLink.style.display = safeApplyUrl ? '' : 'none';

    const emailEl = document.getElementById('jobContactEmail');
    if (jobResult.contactEmail) {
      emailEl.textContent = '✉ ' + jobResult.contactEmail;
      emailEl.style.display = '';
    } else {
      emailEl.textContent = '';
      emailEl.style.display = 'none';
    }

    // Score
    const score = jobResult.evaluation?.score;
    document.getElementById('scorePct').textContent = Number.isFinite(score) ? `${score}%` : 'N/A';
    document.getElementById('scoreExplanation').textContent = jobResult.evaluation?.scoreExplanation
      || 'Compatibility score is based on available resume and job evidence.';
    const coverage = normalizeCoverage(jobResult.evaluation?.scoreCoverage, jobResult.evaluation);
    document.getElementById('scoreCoverage').textContent =
      coverage.status === 'legacy'      ? 'Assessment coverage: Legacy — coverage unknown' :
      coverage.status === 'unavailable' ? 'Assessment coverage: unavailable' :
      `Assessment coverage: ${coverage.assessedDimensions} of ${coverage.totalDimensions} dimensions${coverage.status === 'partial' ? ' (partial)' : ' (full)'}`;
    setBar('barSkills',  'valSkills',  jobResult.evaluation?.skillsScore);
    setBar('barReqs',    'valReqs',    jobResult.evaluation?.reqsScore);
    setBar('barResp',    'valResp',    jobResult.evaluation?.respScore);

    // Skills
    renderSkills(jobResult.evaluation?.matchedSkills || [], jobResult.evaluation?.missingSkills || []);

    // Requirements
    renderList('reqsList', jobResult.evaluation?.requirements || []);

    // Responsibilities
    renderList('respList', jobResult.evaluation?.responsibilities || []);

    // Reasoning
    document.getElementById('reasoningText').textContent = jobResult.evaluation?.reasoning || '--';

    // Insights panel
    renderInsights(jobResult.evaluation || {});

    // Cover letter (if already generated)
    if (jobResult.evaluation?.cover_letter) {
      document.getElementById('coverLetterText').textContent = jobResult.evaluation.cover_letter;
      document.getElementById('coverLetterSection').classList.remove('hidden');
    } else {
      document.getElementById('coverLetterSection').classList.add('hidden');
    }
    document.getElementById('resumeRewriteSection').classList.add('hidden');
    document.getElementById('resumeRewriteText').textContent = '';
    document.getElementById('resumeRewriteError').textContent = '';
  }

  function setBar(barId, valId, pct) {
    if (!Number.isFinite(pct)) {
      document.getElementById(barId).style.width = '0%';
      document.getElementById(valId).textContent = 'N/A';
      return;
    }
    const clamped = Math.min(100, Math.max(0, pct));
    document.getElementById(barId).style.width = `${clamped}%`;
    document.getElementById(valId).textContent = `${clamped}%`;
  }

  function renderSkills(matched, missing) {
    const container = document.getElementById('skillsChips');
    container.replaceChildren();
    const total = matched.length + missing.length;
    document.getElementById('skillsCount').textContent = total ? `${matched.length}/${total}` : '';

    matched.forEach(skill => {
      const chip = document.createElement('span');
      chip.className = 'skill-chip matched';
      const dot = document.createElement('span');
      dot.className = 'skill-dot';
      chip.append(dot, document.createTextNode(String(skill)));
      container.appendChild(chip);
    });

    missing.forEach(skill => {
      const chip = document.createElement('span');
      chip.className = 'skill-chip missing';
      const dot = document.createElement('span');
      dot.className = 'skill-dot';
      chip.append(dot, document.createTextNode(String(skill)));
      container.appendChild(chip);
    });
  }

  function renderList(listId, items) {
    const ul = document.getElementById(listId);
    ul.replaceChildren();
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'req-item';
      const text = document.createElement('span');
      text.className = 'req-text';
      text.style.color = 'var(--text-dim)';
      text.textContent = 'No data available.';
      li.appendChild(text);
      ul.appendChild(li);
      return;
    }
    items.forEach(item => {
      const li = document.createElement('li');
      li.className = 'req-item';
      const priority = ['critical', 'important', 'excellent'].includes(item?.priority) ? item.priority : 'important';
      const check = document.createElement('span');
      check.className = 'req-check';
      check.textContent = item?.matched === true ? '✅' : item?.matched === false ? '○' : '•';
      const content = document.createElement('div');
      content.className = 'req-content';
      const text = document.createElement('p');
      text.className = 'req-text';
      text.textContent = String(item?.text || item || '');
      const tags = document.createElement('div');
      tags.className = 'req-tags';
      const priorityTag = document.createElement('span');
      priorityTag.className = `priority-tag ${priority}`;
      priorityTag.textContent = capitalize(priority);
      tags.appendChild(priorityTag);
      content.append(text, tags);
      li.append(check, content);
      ul.appendChild(li);
    });
  }

  // ── Saved Jobs ─────────────────────────────────────────────────────────────
  function saveJob(jobResult) {
    // Manual save from "Save Job" button — just triggers a re-render
    // (auto-save already happened in background for matches)
    chrome.storage.local.get(['savedJobs'], (data) => {
      const saved = data.savedJobs || [];
      const exists = saved.find(j => TrackerLib.sameJob(j, jobResult));
      if (!exists) {
        // Manually saved job (e.g. non-match the user wants to keep)
        saved.unshift(TrackerLib.mergeTrackerFields({
          title:        jobResult.title        || '',
          company:      jobResult.company      || '',
          location:     jobResult.location     || '',
          jobType:      jobResult.jobType      || 'Full-time',
          salary:       jobResult.salary       || '',
          url:          jobResult.url          || '',
          applyUrl:     jobResult.applyUrl     || jobResult.url || '',
          contactEmail: jobResult.contactEmail || '',
          score:        jobResult.evaluation?.score        ?? null,
          skillsScore:  jobResult.evaluation?.skillsScore  ?? null,
          reqsScore:    jobResult.evaluation?.reqsScore    ?? null,
          respScore:    jobResult.evaluation?.respScore    ?? null,
          scoreCoverage: jobResult.evaluation?.scoreCoverage || null,
          matchedSkills: jobResult.evaluation?.matchedSkills || [],
          missingSkills: jobResult.evaluation?.missingSkills || [],
          reasoning:    jobResult.evaluation?.reasoning    || '',
          coverLetter:  jobResult.evaluation?.cover_letter || '',
          savedAt:      new Date().toISOString()
        }));
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
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'No saved jobs yet. Matches are saved here automatically.';
        container.replaceChildren(empty);
        return;
      }

      container.replaceChildren();
      saved.forEach((job, idx) => {
        const card = document.createElement('div');
        card.className = 'saved-job-card';

        const header = element('div', 'sj-header');
        const titleWrap = element('div', 'sj-title-wrap');
        titleWrap.append(
          element('div', 'sj-title', job.title),
          element('div', 'sj-company', `${job.company || ''}${job.location ? ` · ${job.location}` : ''}`)
        );
        const score = Number.isFinite(job.score) ? job.score : null;
        const scoreEl = element('div', 'sj-score', score === null ? 'N/A' : `${score}%`);
        scoreEl.style.color = score === null ? 'var(--text-dim)' : score >= 80 ? 'var(--accent)' : score >= 60 ? 'var(--orange)' : 'var(--red)';
        header.append(titleWrap, scoreEl);

        const meta = element('div', 'sj-meta');
        if (job.salary) meta.appendChild(element('span', 'sj-chip', job.salary));
        if (job.jobType) meta.appendChild(element('span', 'sj-chip', job.jobType));
        meta.appendChild(element('span', 'sj-chip', `Skills ${Number.isFinite(job.skillsScore) ? `${job.skillsScore}%` : 'N/A'}`));
        const coverage = normalizeCoverage(job.scoreCoverage, job);
        meta.appendChild(element('span', 'sj-chip',
          coverage.status === 'legacy'      ? 'Coverage: Legacy' :
          coverage.status === 'unavailable' ? 'Coverage N/A' :
          `Coverage ${coverage.assessedDimensions}/${coverage.totalDimensions}${coverage.status === 'partial' ? ' partial' : ''}`));

        const skills = element('div', 'sj-skills');
        (job.matchedSkills || []).slice(0, 8).forEach(skill => skills.appendChild(element('span', 'sj-skill matched', skill)));
        (job.missingSkills || []).slice(0, 3).forEach(skill => skills.appendChild(element('span', 'sj-skill missing', skill)));

        const actions = element('div', 'sj-actions');
        const applyUrl = safeExternalUrl(job.applyUrl || job.url);
        if (applyUrl) {
          const apply = element('a', 'sj-apply-btn', 'Apply ↗');
          apply.href = applyUrl;
          apply.target = '_blank';
          apply.rel = 'noopener noreferrer';
          actions.appendChild(apply);
        }
        if (job.contactEmail) actions.appendChild(element('span', 'sj-email', `✉ ${job.contactEmail}`));
        const expand = element('button', 'sj-expand-btn', 'Details ▾');
        expand.dataset.idx = String(idx);
        const remove = element('button', 'sj-delete-btn', '✕');
        remove.dataset.idx = String(idx);
        remove.title = 'Remove';
        actions.append(expand, remove);

        const details = element('div', 'sj-details hidden');
        details.id = `sj-details-${idx}`;
        if (job.reasoning) {
          details.append(element('div', 'sj-section-label', 'AI Reasoning'));
          details.append(element('p', 'sj-reasoning', job.reasoning));
        }
        if (job.coverLetter) {
          const label = element('div', 'sj-section-label', 'Cover Letter ');
          const copy = element('button', 'sj-copy-btn', 'Copy');
          copy.dataset.idx = String(idx);
          label.appendChild(copy);
          details.append(label, element('p', 'sj-cover', job.coverLetter));
        }
        const savedDate = job.savedAt ? new Date(job.savedAt) : null;
        const dateText = savedDate && !Number.isNaN(savedDate.getTime()) ? savedDate.toLocaleDateString('en-IN') : 'Unknown date';
        details.appendChild(element('div', 'sj-section-label', `Saved ${dateText}`));

        card.append(header, meta);
        if (skills.childElementCount) card.appendChild(skills);
        card.append(actions, details);

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
          const selected = saved[Number(btn.dataset.idx)];
          if (!confirm(`Remove "${selected?.title || 'this job'}" from saved jobs?`)) return;
          chrome.storage.local.get(['savedJobs'], (d) => {
            const jobs = d.savedJobs || [];
            jobs.splice(Number(btn.dataset.idx), 1);
            chrome.storage.local.set({ savedJobs: jobs }, renderSavedJobs);
          });
        });
      });

      container.querySelectorAll('.sj-copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const job = saved[Number(btn.dataset.idx)];
          navigator.clipboard.writeText(String(job?.coverLetter || '')).then(() => {
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
          });
        });
      });
    });
  }

  function element(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function normalizeCoverage(coverage, scores = {}) {
    // Delegate to shared lib/coverage.js module (CoverageLib).
    // This wrapper is kept for backward compatibility with existing call sites.
    return CoverageLib.normalizeCoverage(coverage, scores);
  }

  function exportCsv() {
    chrome.storage.local.get(['savedJobs'], (data) => {
      const saved = data.savedJobs || [];
      if (!saved.length) { addLog('No saved jobs to export.', 'warn'); return; }

      const csv = TrackerLib.buildSavedJobsCsv(saved);
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
      ul.replaceChildren();
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

  // ── Actionable Insights ────────────────────────────────────────────────────
  function buildInsights(evaluation) {
    const matchedSkills = evaluation.matchedSkills || [];
    const missingSkills = evaluation.missingSkills || [];
    const requirements  = evaluation.requirements  || [];

    // Strengths: matched skills + matched critical/important requirements
    const strengths = [];
    matchedSkills.slice(0, 3).forEach(s => strengths.push({ label: s, type: 'matched' }));
    requirements.filter(r => r.matched === true).forEach(r => {
      if (strengths.length < 3) strengths.push({ label: r.text, type: 'matched' });
    });

    // Gaps: unmatched requirements (critical first, then important)
    const essentialMissing = requirements.filter(r => r.priority === 'critical' && r.matched === false);
    const gaps = [];
    essentialMissing.slice(0, 3).forEach(r => gaps.push({ label: r.text, type: 'missing' }));
    if (gaps.length < 3) {
      requirements.filter(r => r.priority === 'important' && r.matched === false)
        .slice(0, 3 - gaps.length).forEach(r => gaps.push({ label: r.text, type: 'missing' }));
    }

    // Skills to consider
    const skillsToLearn = missingSkills.slice(0, 3).map(s => ({ label: s, type: 'tip' }));

    // Application tips
    const tips = [];
    if (matchedSkills.length > 0) {
      tips.push(`Highlight your ${matchedSkills.slice(0, 2).join(' and ')} experience in your cover letter.`);
    }
    if (essentialMissing.length > 0) {
      tips.push(`Address the gap in "${essentialMissing[0].text.substring(0, 60)}" — mention any adjacent experience.`);
    } else if (missingSkills.length > 0) {
      tips.push(`Consider obtaining skills in ${missingSkills.slice(0, 2).join(', ')} to strengthen your profile.`);
    }

    return { strengths, gaps, skillsToLearn, tips };
  }

  function renderInsights(evaluation) {
    const container = document.getElementById('insightsContent');
    if (!container) return;
    container.replaceChildren();

    const insights = buildInsights(evaluation);
    const hasContent = insights.strengths.length || insights.gaps.length || insights.skillsToLearn.length;

    if (!hasContent) {
      const msg = document.createElement('p');
      msg.className = 'reasoning-text';
      msg.style.paddingTop = '10px';
      msg.textContent = 'Insights will appear after a full evaluation with resume data.';
      container.appendChild(msg);
      return;
    }

    function insightGroup(title, items, icon) {
      if (!items.length) return null;
      const wrap = document.createElement('div');
      wrap.style.marginBottom = '10px';
      const h = document.createElement('div');
      h.className = 'insight-group-title';
      h.textContent = `${icon} ${title}`;
      wrap.appendChild(h);
      items.forEach(item => {
        const el = document.createElement('div');
        el.className = `insight-item insight-${item.type}`;
        el.textContent = item.label;
        wrap.appendChild(el);
      });
      return wrap;
    }

    const sections = [
      insightGroup('Strengths (in your resume)', insights.strengths, '✅'),
      insightGroup('Gaps (not found in resume)', insights.gaps, '⚠️'),
      insightGroup('Skills to consider learning', insights.skillsToLearn, '💡'),
    ];
    sections.forEach(s => s && container.appendChild(s));

    if (insights.tips.length) {
      const tipsWrap = document.createElement('div');
      tipsWrap.style.marginTop = '8px';
      const th = document.createElement('div');
      th.className = 'insight-group-title';
      th.textContent = '📌 Application Tips';
      tipsWrap.appendChild(th);
      insights.tips.forEach(tip => {
        const el = document.createElement('div');
        el.className = 'insight-item insight-tip';
        el.textContent = tip;
        tipsWrap.appendChild(el);
      });
      container.appendChild(tipsWrap);
    }
  }

  // ── Tracker ────────────────────────────────────────────────────────────────
  function initTracker() {
    // Filter buttons
    const filterBar = document.getElementById('trackerFilterBar');
    if (filterBar) {
      filterBar.addEventListener('click', (e) => {
        const btn = e.target.closest('.tracker-filter-btn');
        if (!btn) return;
        filterBar.querySelectorAll('.tracker-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _trackerFilter = btn.dataset.status;
        renderTracker(_trackerFilter, _trackerSearch);
      });
    }

    // Search input
    const searchInput = document.getElementById('trackerSearch');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        _trackerSearch = searchInput.value.trim().toLowerCase();
        renderTracker(_trackerFilter, _trackerSearch);
      });
    }

    // App detail modal buttons
    const closeBtn  = document.getElementById('appDetailClose');
    const cancelBtn = document.getElementById('appDetailCancel');
    const saveBtn   = document.getElementById('appDetailSave');
    if (closeBtn)  closeBtn.addEventListener('click', closeAppDetail);
    if (cancelBtn) cancelBtn.addEventListener('click', closeAppDetail);
    if (saveBtn)   saveBtn.addEventListener('click', saveAppDetail);
  }

  function renderTracker(filter = 'all', search = '') {
    chrome.storage.local.get(['savedJobs'], (data) => {
      const allJobs = (data.savedJobs || []).map(j => TrackerLib.migrateRecord(j));
      renderDashboardStats(allJobs);
      renderFollowUps(allJobs);

      let filtered = allJobs;
      if (filter !== 'all') {
        filtered = filtered.filter(j => (j.applicationStatus || 'Saved') === filter);
      }
      if (search) {
        filtered = filtered.filter(j =>
          (j.title || '').toLowerCase().includes(search) ||
          (j.company || '').toLowerCase().includes(search)
        );
      }

      const container = document.getElementById('trackerList');
      if (!container) return;
      container.replaceChildren();

      if (!filtered.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = allJobs.length
          ? 'No jobs match the current filter.'
          : 'No saved jobs yet. Save jobs from the analysis view.';
        container.appendChild(empty);
        return;
      }

      filtered.forEach(job => container.appendChild(renderTrackerCard(job)));
    });
  }

  function renderDashboardStats(savedJobs) {
    const stats = TrackerLib.calculateStats(savedJobs);
    const container = document.getElementById('trackerStats');
    if (!container) return;
    container.replaceChildren();

    const stageCounts = Object.fromEntries(TrackerLib.APPLICATION_STATUSES.map(status => [
      status,
      savedJobs.filter(job => (job.applicationStatus || 'Saved') === status).length
    ]));
    const chips = [
      { label: 'Total',      value: stats.total,      key: 'total' },
      ...TrackerLib.APPLICATION_STATUSES.map(status => ({ label: status, value: stageCounts[status], key: status })),
      { label: 'Submitted',  value: stats.applied,    key: 'applied' },
      { label: 'Due today',  value: stats.dueToday,   key: 'dueToday' },
      { label: 'Overdue',    value: stats.overdue,    key: 'overdue' },
    ];
    chips.forEach(c => {
      const chip = document.createElement('div');
      chip.className = 'stat-chip';
      if (c.key === 'overdue' && c.value > 0) chip.classList.add('stat-chip-overdue');
      if (c.key === 'offers'  && c.value > 0) chip.classList.add('stat-chip-offer');
      chip.append(
        element('span', 'stat-num', c.value),
        element('span', 'stat-label', c.label)
      );
      container.appendChild(chip);
    });
  }

  function renderFollowUps(savedJobs) {
    const today    = TrackerLib.localDateString(new Date());
    const overdue  = savedJobs.filter(j => j.followUpDate && j.followUpDate < today);
    const dueToday = savedJobs.filter(j => j.followUpDate && j.followUpDate === today);
    const upcoming = savedJobs.filter(j => j.followUpDate && j.followUpDate > today);

    const section = document.getElementById('followUpSection');
    if (!section) return;

    const hasAny = overdue.length || dueToday.length || upcoming.length;
    section.classList.toggle('hidden', !hasAny);

    function renderGroup(groupId, listId, jobs) {
      const group = document.getElementById(groupId);
      const list  = document.getElementById(listId);
      if (!group || !list) return;
      group.classList.toggle('hidden', !jobs.length);
      list.replaceChildren();
      jobs.forEach(job => {
        const item = document.createElement('div');
        item.className = 'followup-item';
        const text = element('span', 'followup-text', `${job.title || 'Job'} @ ${job.company || 'Unknown company'} — ${job.followUpDate}`);
        const complete = element('button', 'followup-complete-btn', 'Done');
        complete.setAttribute('aria-label', `Mark follow-up complete for ${job.title || 'job'}`);
        complete.addEventListener('click', () => {
          TrackerLib.updateTrackerFields(job.id || job.url, { followUpDate: '' })
            .then(() => renderTracker(_trackerFilter, _trackerSearch))
            .catch(err => addLog(`Failed to update follow-up: ${err.message}`, 'error'));
        });
        const reschedule = element('button', 'followup-reschedule-btn', 'Change');
        reschedule.addEventListener('click', () => openAppDetail(job.id || job.url));
        item.append(text, complete, reschedule);
        list.appendChild(item);
      });
    }

    renderGroup('followupOverdue',  'followupOverdueList',  overdue);
    renderGroup('followupToday',    'followupTodayList',    dueToday);
    renderGroup('followupUpcoming', 'followupUpcomingList', upcoming);
  }

  const STATUS_COLORS = {
    'Saved':            'var(--text-dim)',
    'Planning to Apply':'var(--blue)',
    'Applied':          'var(--accent)',
    'Assessment':       'var(--orange)',
    'Interview':        '#9c27b0',
    'Offer':            '#ffd700',
    'Rejected':         'var(--red)',
    'Withdrawn':        'var(--text-dim)'
  };

  function renderTrackerCard(job) {
    const card = document.createElement('div');
    card.className = 'tracker-card';

    const header = document.createElement('div');
    header.className = 'tracker-card-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'sj-title-wrap';
    titleWrap.appendChild(element('div', 'sj-title', job.title || 'Unknown Job'));
    titleWrap.appendChild(element('div', 'sj-company',
      `${job.company || ''}${job.location ? ` · ${job.location}` : ''}`));

    const statusBadge = document.createElement('span');
    statusBadge.className = 'app-status-badge';
    statusBadge.textContent = job.applicationStatus || 'Saved';
    statusBadge.style.color = STATUS_COLORS[job.applicationStatus] || 'var(--text-dim)';

    header.append(titleWrap, statusBadge);
    card.appendChild(header);

    // Follow-up indicator
    if (job.followUpDate) {
      const today = TrackerLib.localDateString(new Date());
      const followEl = document.createElement('div');
      followEl.className = 'followup-indicator';
      const isOverdue = job.followUpDate < today;
      const isToday   = job.followUpDate === today;
      followEl.textContent = `Follow-up: ${job.followUpDate}`;
      followEl.style.color = isOverdue ? 'var(--red)' : isToday ? 'var(--orange)' : 'var(--accent)';
      card.appendChild(followEl);
    }

    // Score chip
    const score = Number.isFinite(job.score) ? job.score : null;
    if (score !== null) {
      const metaRow = document.createElement('div');
      metaRow.className = 'sj-meta';
      metaRow.appendChild(element('span', 'sj-chip', `Match: ${score}%`));
      card.appendChild(metaRow);
    }

    // Actions
    const actions = document.createElement('div');
    actions.className = 'sj-actions';

    const editBtn = element('button', 'sj-expand-btn', '✏️ Edit');
    editBtn.addEventListener('click', () => openAppDetail(job.id || job.url));
    actions.appendChild(editBtn);

    const compareBtn = element('button', 'sj-expand-btn', '⚖️ Compare');
    compareBtn.addEventListener('click', () => {
      addToCompare(job);
      switchView('compare');
    });
    actions.appendChild(compareBtn);

    const applyUrl = safeExternalUrl(job.applyUrl || job.url);
    if (applyUrl) {
      const applyLink = element('a', 'sj-apply-btn', 'Apply ↗');
      applyLink.href = applyUrl;
      applyLink.target = '_blank';
      applyLink.rel = 'noopener noreferrer';
      actions.appendChild(applyLink);
    }

    const delBtn = element('button', 'sj-delete-btn', '✕');
    delBtn.title = 'Remove';
    delBtn.addEventListener('click', () => {
      if (!confirm(`Remove "${job.title}" from saved jobs?`)) return;
      chrome.storage.local.get(['savedJobs'], (d) => {
        const jobs = (d.savedJobs || []).filter(j =>
          !((job.id && j.id === job.id) || (job.url && j.url === job.url))
        );
        chrome.storage.local.set({ savedJobs: jobs }, () => renderTracker(_trackerFilter, _trackerSearch));
      });
    });
    actions.appendChild(delBtn);
    card.appendChild(actions);

    return card;
  }

  function openAppDetail(jobKey) {
    _appDetailKey = jobKey;
    chrome.storage.local.get(['savedJobs'], (data) => {
      const job = (data.savedJobs || []).find(j =>
        (jobKey && j.id && j.id === jobKey) || (jobKey && j.url && j.url === jobKey)
      );
      if (!job) return;
      const migrated = TrackerLib.migrateRecord(job);
      document.getElementById('appDetailTitle').textContent =
        `${migrated.title || 'Job'} @ ${migrated.company || ''}`;
      document.getElementById('appDetailStatus').value      = migrated.applicationStatus || 'Saved';
      document.getElementById('appDetailAppliedDate').value = migrated.appliedDate || '';
      document.getElementById('appDetailFollowUpDate').value = migrated.followUpDate || '';
      document.getElementById('appDetailContactName').value = migrated.contactName || '';
      document.getElementById('appDetailContactEmail').value = migrated.contactEmail || '';
      document.getElementById('appDetailNotes').value       = migrated.notes || '';
      const updated = migrated.trackerUpdatedAt ? new Date(migrated.trackerUpdatedAt) : null;
      document.getElementById('appDetailUpdatedAt').textContent =
        `Last updated: ${updated && !Number.isNaN(updated.getTime()) ? updated.toLocaleString() : 'Not yet updated'}`;
      document.getElementById('appDetailModal').classList.remove('hidden');
    });
  }

  function closeAppDetail() {
    document.getElementById('appDetailModal').classList.add('hidden');
    _appDetailKey = null;
  }

  function saveAppDetail() {
    if (!_appDetailKey) return;
    const updates = {
      applicationStatus: document.getElementById('appDetailStatus').value,
      appliedDate:       document.getElementById('appDetailAppliedDate').value,
      followUpDate:      document.getElementById('appDetailFollowUpDate').value,
      contactName:       document.getElementById('appDetailContactName').value,
      contactEmail:      document.getElementById('appDetailContactEmail').value,
      notes:             document.getElementById('appDetailNotes').value
    };
    TrackerLib.updateTrackerFields(_appDetailKey, updates)
      .then(() => {
        closeAppDetail();
        renderTracker(_trackerFilter, _trackerSearch);
      })
      .catch(err => addLog(`Failed to save: ${err.message}`, 'error'));
  }

  // ── Comparison ─────────────────────────────────────────────────────────────
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
    renderCompareView();
  }

  function renderCompareView() {
    // Update slots
    for (let i = 0; i < 3; i++) {
      const slot = document.getElementById(`compareSlot${i}`);
      if (!slot) continue;
      slot.replaceChildren();
      const job = compareSelection[i];
      if (job) {
        slot.className = 'compare-slot filled';
        slot.appendChild(element('div', 'compare-slot-title', job.title || 'Job'));
        slot.appendChild(element('div', 'compare-slot-company', job.company || ''));
        const removeBtn = element('button', 'sj-delete-btn', '✕');
        removeBtn.style.marginTop = '6px';
        removeBtn.addEventListener('click', () => removeFromCompare(job.id || job.url));
        slot.appendChild(removeBtn);
      } else {
        slot.className = 'compare-slot empty';
        const emptyText = document.createElement('span');
        emptyText.className = 'compare-slot-empty-text';
        emptyText.append(
          document.createTextNode(`Slot ${i + 1}`),
          document.createElement('br'),
          element('small', '', 'Go to Saved to add')
        );
        slot.appendChild(emptyText);
      }
    }

    // Clear compare button
    const clearBtn = document.getElementById('clearCompareBtn');
    if (clearBtn) {
      clearBtn.onclick = () => { compareSelection = []; renderCompareView(); };
    }

    renderComparisonTable(compareSelection);
  }

  function renderComparisonTable(jobs) {
    const container = document.getElementById('comparisonTable');
    if (!container) return;
    container.replaceChildren();

    if (jobs.length < 2) {
      container.appendChild(element('p', 'empty-state', 'Select at least 2 jobs to see a comparison.'));
      return;
    }

    const rows = [
          { label: 'Company',   fn: j => j.company || 'Not available' },
          { label: 'Role',      fn: j => j.title || 'Not available' },
          { label: 'Location',  fn: j => j.location || 'Not available' },
          { label: 'Work arrangement', fn: j => j.workArrangement || j.jobType || 'Not available' },
          { label: 'Salary',    fn: j => j.salary || 'Not available' },
          { label: 'Overall Fit', fn: j => Number.isFinite(j.score) ? `${j.score}%` : 'Not available' },
      { label: 'Skills Score', fn: j => Number.isFinite(j.skillsScore) ? `${j.skillsScore}%` : 'Not available' },
          { label: 'Requirements', fn: j => Number.isFinite(j.reqsScore) ? `${j.reqsScore}%` : 'Not available' },
          { label: 'Responsibilities', fn: j => Number.isFinite(j.respScore) ? `${j.respScore}%` : 'Not available' },
      { label: 'Coverage',  fn: j => {
        const cov = normalizeCoverage(j.scoreCoverage, j);
        if (cov.status === 'legacy')      return 'Legacy';
        if (cov.status === 'unavailable') return 'Not available';
        return `${cov.assessedDimensions}/${cov.totalDimensions}`;
      }},
      { label: 'App Status', fn: j => j.applicationStatus || 'Saved' },
          { label: 'Matched Skills', fn: j => (j.matchedSkills || []).slice(0, 5).join(', ') || 'Not available' },
          { label: 'Missing Skills', fn: j => (j.missingSkills || []).slice(0, 3).join(', ') || 'Not available' },
          { label: 'Job URL', fn: j => safeExternalUrl(j.applyUrl || j.url) || 'Not available' },
    ];

    const table = document.createElement('table');
    table.className = 'compare-table';

    // Header row
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headerRow.appendChild(element('th', 'compare-th', 'Field'));
    jobs.forEach(j => {
      headerRow.appendChild(element('th', 'compare-th',
        j.title ? j.title.substring(0, 25) : 'Job'));
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Data rows
    const tbody = document.createElement('tbody');
    rows.forEach(row => {
      const tr = document.createElement('tr');
      tr.appendChild(element('td', 'compare-label', row.label));
        jobs.forEach(j => {
          const cell = element('td', 'compare-value');
          const value = row.fn(j);
          if (row.label === 'Job URL' && value !== 'Not available') {
            const link = element('a', 'compare-job-link', 'Open posting ↗');
            link.href = value;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            cell.appendChild(link);
          } else {
            cell.textContent = value;
          }
          tr.appendChild(cell);
        });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

});

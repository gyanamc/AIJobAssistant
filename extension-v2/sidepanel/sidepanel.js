// sidepanel.js — AI Job Assistant v2

document.addEventListener('DOMContentLoaded', () => {

  // ── State ──────────────────────────────────────────────────────────────────
  let currentView = 'analysis';
  let currentJob  = null;
  let compareSelection = []; // up to 3 jobs for side-by-side comparison
  let _trackerFilter = 'all';
  let _trackerSearch = '';
  let _appDetailKey  = null; // id or url of the job being edited
  let _userSkills    = [];
  let _superpowerSkills = [];
  let _suggestedSkills  = [];
  const {
    hasExplicitSharingConsent,
    consentStorageUpdate,
    safeExternalUrl,
    extractSkillsFromText,
    getSuggestedSkills,
    mergeUserSkills,
    removeUserSkill
  } = ExtensionPolicies;

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
  setupReviewPrompt();
  checkReviewPrompt();
  setupApplicationQA();
  setupFollowUpModal();
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
      'userSkills', 'superpowerSkills', 'suggestedSkills',
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

      _userSkills = Array.isArray(data.userSkills) ? data.userSkills : [];
      _superpowerSkills = Array.isArray(data.superpowerSkills) ? data.superpowerSkills : [];
      _suggestedSkills = Array.isArray(data.suggestedSkills)
        ? data.suggestedSkills
        : getSuggestedSkills(_userSkills, data.targetRoles || '');

      renderConfirmedSkills(_userSkills, _superpowerSkills);
      renderSuggestedSkills(_suggestedSkills, _userSkills);
      updateProfileAttentionBadge(data.resumeSummary, _userSkills);
      updateProfileReadinessMeter(data.targetRoles, data.targetLocations, data.resumeSummary, _userSkills);
      updateOnboardingBanner(data.resumeSummary, _userSkills);
      renderUploadedResumesList();

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
    setupOnboardingBanner();
    setupResumeUpload();
    setupSkillsCuration();

    // Dynamically update readiness meter on input
    ['targetRoles', 'targetLocations', 'resumeSummary'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          const roles = document.getElementById('targetRoles')?.value || '';
          const locs = document.getElementById('targetLocations')?.value || '';
          const sum = document.getElementById('resumeSummary')?.value || '';
          updateProfileReadinessMeter(roles, locs, sum, _userSkills);
          updateProfileAttentionBadge(sum, _userSkills);
          updateOnboardingBanner(sum, _userSkills);
        });
      }
    });

    document.getElementById('saveProfileBtn').addEventListener('click', async () => {
      const targetRoles     = document.getElementById('targetRoles').value;
      const targetLocations = document.getElementById('targetLocations').value;
      const resumeSummary   = document.getElementById('resumeSummary').value;
      const shareAnonymized = document.getElementById('shareAnonymized').checked;

      const profileUpdate = {
        targetRoles,
        targetLocations,
        resumeSummary,
        userSkills: _userSkills,
        superpowerSkills: _superpowerSkills,
        suggestedSkills: _suggestedSkills,
        ...consentStorageUpdate(shareAnonymized)
      };

      chrome.storage.local.set(profileUpdate, async () => {
        showConfirm('profileSaved');
        updateProfileAttentionBadge(resumeSummary, _userSkills);
        updateProfileReadinessMeter(targetRoles, targetLocations, resumeSummary, _userSkills);
        updateOnboardingBanner(resumeSummary, _userSkills);

        // Sync to recruiter platform if consent given
        if (shareAnonymized && (resumeSummary || _userSkills.length)) {
          try {
            const res = await fetch('https://aijobassistant-production.up.railway.app/api/v1/profile/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                shareAnonymized,
                resumeSummary,
                targetRoles,
                targetLocations,
                skills: _userSkills.join(', ') || resumeSummary
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

  function updateProfileAttentionBadge(resumeSummary, userSkills = _userSkills) {
    const navProfile = document.getElementById('navProfile');
    if (!navProfile) return;
    const hasResume = Boolean((resumeSummary && resumeSummary.trim().length > 20) || (userSkills && userSkills.length >= 2));
    navProfile.classList.toggle('needs-attention', !hasResume);
    navProfile.title = hasResume ? 'Profile' : 'Profile (Action needed: upload resume or confirm skills)';
  }

  function updateProfileReadinessMeter(roles, locations, summary, userSkills = _userSkills) {
    const hasSkillsOrSummary = Boolean((userSkills && userSkills.length >= 3) || (summary && summary.trim().length > 20));
    const hasRoles = Boolean(roles && roles.trim().length > 0);
    const hasLocations = Boolean(locations && locations.trim().length > 0);

    let score = 0;
    if (hasSkillsOrSummary) score += 50;
    if (hasRoles) score += 25;
    if (hasLocations) score += 25;

    const pctEl = document.getElementById('profileMeterPct');
    const fillEl = document.getElementById('profileMeterFill');
    const hintEl = document.getElementById('profileMeterHint');

    if (pctEl) pctEl.textContent = `${score}%`;
    if (fillEl) fillEl.style.width = `${score}%`;
    if (hintEl) {
      if (score === 100) {
        hintEl.textContent = `Profile complete! ${userSkills.length ? `${userSkills.length} skills confirmed.` : 'Ready for job matching.'}`;
      } else if (score >= 75) {
        hintEl.textContent = 'Almost there! Add remaining target details for best results.';
      } else if (score >= 50) {
        hintEl.textContent = `${userSkills.length ? `${userSkills.length} skills confirmed!` : 'Resume added!'} Specify target roles & locations.`;
      } else {
        hintEl.textContent = 'Upload resume or add key skills to start matching jobs.';
      }
    }
  }

  function updateOnboardingBanner(resumeSummary, userSkills = _userSkills) {
    const banner = document.getElementById('onboardingBanner');
    if (!banner) return;
    const hasResume = Boolean((resumeSummary && resumeSummary.trim().length > 20) || (userSkills && userSkills.length >= 2));
    banner.classList.toggle('hidden', hasResume);
  }

  function renderConfirmedSkills(skills = [], superpowers = []) {
    const container = document.getElementById('confirmedSkillsChips');
    const countEl = document.getElementById('confirmedSkillsCount');
    if (!container) return;

    if (countEl) countEl.textContent = String(skills.length);
    container.replaceChildren();

    if (!skills.length) {
      const hint = element('span', 'skills-empty-hint', 'No skills confirmed yet. Upload your resume or add skills below.');
      hint.style.cssText = 'font-size:11px; color:var(--text-dim); padding:4px;';
      container.appendChild(hint);
      return;
    }

    const superSet = new Set((superpowers || []).map(s => String(s).toLowerCase()));

    skills.forEach(skill => {
      const isSuper = superSet.has(skill.toLowerCase());
      const chip = element('span', `skill-curate-chip${isSuper ? ' superpower' : ''}`);

      const starBtn = element('button', 'skill-star-btn', isSuper ? '⭐' : '☆');
      starBtn.title = isSuper ? 'Primary skill (weighted higher)' : 'Star as primary superpower skill';
      starBtn.type = 'button';
      starBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSuperpowerSkill(skill);
      });

      const label = element('span', 'skill-label-text', skill);

      const delBtn = element('button', 'skill-remove-btn', '✕');
      delBtn.title = `Remove ${skill}`;
      delBtn.type = 'button';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeConfirmedSkill(skill);
      });

      chip.append(starBtn, label, delBtn);
      container.appendChild(chip);
    });
  }

  function renderSuggestedSkills(suggested = [], confirmed = []) {
    const container = document.getElementById('suggestedSkillsChips');
    const box = document.getElementById('suggestedSkillsBox');
    if (!container) return;

    const confirmedSet = new Set((confirmed || []).map(s => String(s).toLowerCase()));
    const remaining = (suggested || []).filter(s => !confirmedSet.has(String(s).toLowerCase()));

    container.replaceChildren();

    if (!remaining.length) {
      if (box) box.classList.add('hidden');
      return;
    }

    if (box) box.classList.remove('hidden');

    remaining.slice(0, 10).forEach(skill => {
      const chip = element('button', 'skill-suggest-chip');
      chip.type = 'button';
      const icon = element('span', '', '+');
      icon.style.fontWeight = 'bold';
      icon.style.color = 'var(--accent)';
      const text = element('span', '', ` ${skill}`);
      chip.append(icon, text);
      chip.title = `Add ${skill} to your confirmed skills`;

      chip.addEventListener('click', () => {
        addConfirmedSkill(skill);
      });

      container.appendChild(chip);
    });
  }

  function renderSuggestedRoles(roles = []) {
    const box = document.getElementById('suggestedRolesBox');
    const container = document.getElementById('suggestedRolesChips');
    if (!box || !container) return;

    container.replaceChildren();
    if (!roles || !roles.length) {
      box.classList.add('hidden');
      return;
    }

    box.classList.remove('hidden');
    roles.forEach(role => {
      const pill = element('button', 'role-suggest-pill', `+ ${role}`);
      pill.type = 'button';
      pill.title = `Add "${role}" to target roles`;
      pill.addEventListener('click', () => {
        const input = document.getElementById('targetRoles');
        if (input) {
          const current = (input.value || '').split(',').map(s => s.trim()).filter(Boolean);
          if (!current.map(c => c.toLowerCase()).includes(role.toLowerCase())) {
            current.push(role);
            input.value = current.join(', ');
            chrome.storage.local.set({ targetRoles: input.value });
            pill.style.display = 'none';
          }
        }
      });
      container.appendChild(pill);
    });
  }

  function addConfirmedSkill(skill) {
    if (!skill || !skill.trim()) return;
    _userSkills = mergeUserSkills(_userSkills, [skill.trim()]);
    _suggestedSkills = removeUserSkill(_suggestedSkills, skill.trim());
    chrome.storage.local.set({ userSkills: _userSkills, suggestedSkills: _suggestedSkills }, () => {
      renderConfirmedSkills(_userSkills, _superpowerSkills);
      renderSuggestedSkills(_suggestedSkills, _userSkills);
      updateProfileAttentionBadge(document.getElementById('resumeSummary')?.value, _userSkills);
      updateOnboardingBanner(document.getElementById('resumeSummary')?.value, _userSkills);
      const roles = document.getElementById('targetRoles')?.value || '';
      const locs = document.getElementById('targetLocations')?.value || '';
      updateProfileReadinessMeter(roles, locs, document.getElementById('resumeSummary')?.value, _userSkills);
    });
  }

  function removeConfirmedSkill(skill) {
    _userSkills = removeUserSkill(_userSkills, skill);
    _superpowerSkills = removeUserSkill(_superpowerSkills, skill);
    chrome.storage.local.set({ userSkills: _userSkills, superpowerSkills: _superpowerSkills }, () => {
      renderConfirmedSkills(_userSkills, _superpowerSkills);
      const roles = document.getElementById('targetRoles')?.value || '';
      const freshSuggested = getSuggestedSkills(_userSkills, roles);
      _suggestedSkills = freshSuggested;
      renderSuggestedSkills(_suggestedSkills, _userSkills);
      updateProfileAttentionBadge(document.getElementById('resumeSummary')?.value, _userSkills);
      updateOnboardingBanner(document.getElementById('resumeSummary')?.value, _userSkills);
      const locs = document.getElementById('targetLocations')?.value || '';
      updateProfileReadinessMeter(roles, locs, document.getElementById('resumeSummary')?.value, _userSkills);
    });
  }

  function toggleSuperpowerSkill(skill) {
    const lower = skill.toLowerCase();
    const index = _superpowerSkills.findIndex(s => s.toLowerCase() === lower);
    if (index >= 0) {
      _superpowerSkills.splice(index, 1);
    } else {
      _superpowerSkills.push(skill);
    }
    chrome.storage.local.set({ superpowerSkills: _superpowerSkills }, () => {
      renderConfirmedSkills(_userSkills, _superpowerSkills);
    });
  }

  function setupSkillsCuration() {
    const input = document.getElementById('addSkillInput');
    const addBtn = document.getElementById('addSkillBtn');
    const clearBtn = document.getElementById('clearAllSkillsBtn');

    if (addBtn && input) {
      const handleAdd = () => {
        const val = (input.value || '').trim();
        if (val) {
          addConfirmedSkill(val);
          input.value = '';
        }
      };
      addBtn.addEventListener('click', handleAdd);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleAdd();
        }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        _userSkills = [];
        _superpowerSkills = [];
        chrome.storage.local.set({ userSkills: [], superpowerSkills: [] }, () => {
          renderConfirmedSkills([], []);
          const roles = document.getElementById('targetRoles')?.value || '';
          _suggestedSkills = getSuggestedSkills([], roles);
          renderSuggestedSkills(_suggestedSkills, []);
          const locs = document.getElementById('targetLocations')?.value || '';
          updateProfileReadinessMeter(roles, locs, document.getElementById('resumeSummary')?.value, []);
        });
      });
    }
  }

  function setupOnboardingBanner() {
    const ctaBtn = document.getElementById('onboardingCtaBtn');
    if (ctaBtn) {
      ctaBtn.addEventListener('click', () => {
        switchView('profile');
      });
    }
  }

  function renderUploadedResumesList() {
    chrome.storage.local.get(['uploadedResumes'], (data) => {
      const listEl = document.getElementById('uploadedResumesList');
      if (!listEl) return;
      const resumes = data.uploadedResumes || [];
      listEl.replaceChildren();
      if (!resumes.length) return;

      const header = element('div', 'uploaded-resumes-header', 'Uploaded Resumes:');
      header.style.cssText = 'font-size:11px; font-weight:600; color:var(--text-muted); margin:8px 0 4px;';
      listEl.appendChild(header);

      resumes.forEach((res, idx) => {
        const chip = element('div', 'uploaded-resume-chip');
        chip.style.cssText = 'display:flex; align-items:center; justify-content:space-between; background:var(--bg-elevated); padding:5px 8px; border-radius:4px; margin-bottom:4px; font-size:11px; border:1px solid var(--border);';

        const info = element('div', 'uploaded-resume-info');
        const icon = element('span', '', '📄 ');
        const name = element('strong', '', res.filename || 'Resume');
        const ver = element('span', '', ` (v${res.version || 1})`);
        const dateStr = res.uploadedAt ? new Date(res.uploadedAt).toLocaleDateString() : '';
        const date = element('span', '', ` · ${dateStr}`);
        date.style.color = 'var(--text-dim)';
        info.append(icon, name, ver, date);

        const delBtn = element('button', 'uploaded-resume-del', '✕');
        delBtn.style.cssText = 'background:none; border:none; color:var(--text-dim); cursor:pointer; font-size:12px; padding:0 4px;';
        delBtn.title = 'Remove record from extension';
        delBtn.addEventListener('click', () => {
          resumes.splice(idx, 1);
          chrome.storage.local.set({ uploadedResumes: resumes }, () => {
            renderUploadedResumesList();
          });
        });

        chip.append(info, delBtn);
        listEl.appendChild(chip);
      });
    });
  }

  function setupResumeUpload() {
    const dropzone = document.getElementById('resumeDropzone');
    const fileInput = document.getElementById('resumeFileInput');
    const statusBox = document.getElementById('resumeUploadStatus');
    const consentCb = document.getElementById('resumeStorageConsent');
    if (!dropzone || !fileInput) return;

    dropzone.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    ['dragleave', 'dragend'].forEach(evt => {
      dropzone.addEventListener(evt, () => dropzone.classList.remove('dragover'));
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleResumeFile(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        handleResumeFile(fileInput.files[0]);
      }
    });

    async function handleResumeFile(file) {
      if (!file) return;

      const validExts = ['.pdf', '.docx', '.txt'];
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      if (!validExts.includes(ext)) {
        showStatus('Invalid file type. Please upload a PDF, DOCX, or TXT document.', 'error');
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        showStatus('File size exceeds the 10 MB limit.', 'error');
        return;
      }

      showStatus(`Uploading & parsing "${file.name}"...`, 'info');

      try {
        const formData = new FormData();
        formData.append('file', file);

        const storageData = await new Promise(r => chrome.storage.local.get(['supabaseToken', 'uploadedResumes'], r));
        const headers = {};
        if (storageData.supabaseToken) {
          headers['Authorization'] = `Bearer ${storageData.supabaseToken}`;
        }

        const backendUrl = 'https://aijobassistant-production.up.railway.app/api/v1/resumes/upload';
        let uploadSucceeded = false;
        let responseData = null;

        try {
          const res = await fetch(backendUrl, {
            method: 'POST',
            headers,
            body: formData
          });
          if (res.ok) {
            responseData = await res.json();
            uploadSucceeded = true;
          }
        } catch (_) {
          // Backend offline or unreachable
        }

        if (uploadSucceeded && responseData) {
          showStatus(`✓ "${file.name}" uploaded & parsed (v${responseData.version || 1})!`, 'success');
          const summaryText = responseData.extracted_text ? responseData.extracted_text.trim() : '';
          if (summaryText) {
            document.getElementById('resumeSummary').value = summaryText;
          }

          let parsedSkills = responseData.parsed_info?.skills || [];
          let parsedSuggested = responseData.parsed_info?.suggested_skills || [];
          let parsedRoles = responseData.parsed_info?.target_roles || [];

          if (!parsedSkills.length && summaryText) {
            parsedSkills = extractSkillsFromText(summaryText);
          }
          if (!parsedSuggested.length) {
            parsedSuggested = getSuggestedSkills(parsedSkills, parsedRoles.join(', '));
          }

          _userSkills = mergeUserSkills(_userSkills, parsedSkills);
          _suggestedSkills = parsedSuggested.filter(s => !_userSkills.map(x => x.toLowerCase()).includes(s.toLowerCase()));

          const updatePayload = {
            resumeSummary: summaryText,
            userSkills: _userSkills,
            suggestedSkills: _suggestedSkills
          };

          if (parsedRoles.length > 0) {
            const currentRoles = document.getElementById('targetRoles')?.value || '';
            if (!currentRoles.trim()) {
              document.getElementById('targetRoles').value = parsedRoles.join(', ');
              updatePayload.targetRoles = parsedRoles.join(', ');
            }
            renderSuggestedRoles(parsedRoles);
          }

          renderConfirmedSkills(_userSkills, _superpowerSkills);
          renderSuggestedSkills(_suggestedSkills, _userSkills);
          updateProfileAttentionBadge(summaryText, _userSkills);
          updateOnboardingBanner(summaryText, _userSkills);
          const roles = document.getElementById('targetRoles')?.value || '';
          const locs = document.getElementById('targetLocations')?.value || '';
          updateProfileReadinessMeter(roles, locs, summaryText, _userSkills);

          const existingList = storageData.uploadedResumes || [];
          existingList.unshift({
            id: responseData.id,
            filename: responseData.filename || file.name,
            version: responseData.version || 1,
            uploadedAt: responseData.created_at || new Date().toISOString()
          });
          updatePayload.uploadedResumes = existingList.slice(0, 10);
          chrome.storage.local.set(updatePayload, () => {
            renderUploadedResumesList();
          });
        } else if (ext === '.txt') {
          const text = await file.text();
          document.getElementById('resumeSummary').value = text;
          const extracted = extractSkillsFromText(text);
          const suggested = getSuggestedSkills(extracted, '');
          _userSkills = mergeUserSkills(_userSkills, extracted);
          _suggestedSkills = suggested;
          chrome.storage.local.set({
            resumeSummary: text,
            userSkills: _userSkills,
            suggestedSkills: _suggestedSkills
          });
          renderConfirmedSkills(_userSkills, _superpowerSkills);
          renderSuggestedSkills(_suggestedSkills, _userSkills);
          updateProfileAttentionBadge(text, _userSkills);
          updateOnboardingBanner(text, _userSkills);
          const roles = document.getElementById('targetRoles')?.value || '';
          const locs = document.getElementById('targetLocations')?.value || '';
          updateProfileReadinessMeter(roles, locs, text, _userSkills);
          showStatus(`✓ Loaded text and extracted ${extracted.length} key skills from "${file.name}".`, 'success');
        } else {
          showStatus(`File "${file.name}" selected. Note: Connect backend for cloud persistence and automatic PDF/DOCX parsing.`, 'info');
        }
      } catch (err) {
        showStatus(`Upload error: ${err.message}`, 'error');
      }
    }

    function showStatus(msg, type) {
      if (!statusBox) return;
      statusBox.textContent = msg;
      statusBox.className = `upload-status-box status-${type}`;
      statusBox.classList.remove('hidden');
    }
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
            recordMilestone('coverLettersCount');
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
          recordMilestone('coverLettersCount');
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
    const scoreCard = document.querySelector('.score-card');
    if (scoreCard) scoreCard.classList.toggle('strong-match', Number.isFinite(score) && score >= 80);
    const scorePctEl = document.getElementById('scorePct');
    if (Number.isFinite(score)) {
      animateScoreCount(scorePctEl, score);
      if (score >= 70) {
        recordMilestone('positiveScansCount');
      }
    } else {
      scorePctEl.textContent = 'N/A';
    }
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
    renderSkillGapBridge(jobResult.evaluation?.missingSkills || []);

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

  function animateScoreCount(el, target, duration = 400) {
    if (!el) return;
    const startTime = performance.now();
    function tick(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(target * ease);
      el.textContent = `${current}%`;
      if (progress < 1) {
        requestAnimationFrame(tick);
      }
    }
    requestAnimationFrame(tick);
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
        const statusSelect = element('select', 'quick-status-select');
        (TrackerLib.APPLICATION_STATUSES || ['Saved', 'Planning to Apply', 'Applied', 'Assessment', 'Interview', 'Offer', 'Rejected', 'Withdrawn']).forEach(st => {
          const opt = element('option', '', st);
          opt.value = st;
          if (st === (job.applicationStatus || 'Saved')) opt.selected = true;
          statusSelect.appendChild(opt);
        });
        statusSelect.addEventListener('change', async (e) => {
          e.stopPropagation();
          const newStatus = e.target.value;
          const key = job.id || job.url || job.applyUrl;
          await TrackerLib.updateTrackerFields(key, { applicationStatus: newStatus });
          addLog(`Updated "${job.title || 'Job'}" status to ${newStatus}.`, 'info');
          if (newStatus === 'Interview' || newStatus === 'Offer') {
            recordMilestone('trackerMilestonesCount');
          }
          if (currentView === 'tracker') {
            renderTracker(_trackerFilter, _trackerSearch);
          }
        });
        actions.appendChild(statusSelect);

        const applyUrl = safeExternalUrl(job.applyUrl || job.url);
        if (applyUrl) {
          const apply = element('a', 'sj-apply-btn', 'Apply ↗');
          apply.href = applyUrl;
          apply.target = '_blank';
          apply.rel = 'noopener noreferrer';
          actions.appendChild(apply);
        }
        if (job.contactEmail) actions.appendChild(element('span', 'sj-email', `✉ ${job.contactEmail}`));
        const followUpBtn = element('button', 'sj-expand-btn', '✉️ Follow-Up');
        followUpBtn.title = 'Draft recruiter follow-up email';
        followUpBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openFollowUpModal(job);
        });
        actions.appendChild(followUpBtn);

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

    const followUpBtn = element('button', 'sj-expand-btn', '✉️ Follow-Up');
    followUpBtn.title = 'Draft recruiter follow-up email';
    followUpBtn.addEventListener('click', () => openFollowUpModal(job));
    actions.appendChild(followUpBtn);

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
        if (updates.applicationStatus === 'Interview' || updates.applicationStatus === 'Offer') {
          recordMilestone('trackerMilestonesCount');
        }
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

  // ── Delighted User Review System ───────────────────────────────────────────
  function recordMilestone(metricKey) {
    chrome.storage.local.get(['reviewPromptState'], (data) => {
      const state = data.reviewPromptState || {
        hasReviewed: false,
        reviewOptOut: false,
        lastPromptedAt: null,
        positiveScansCount: 0,
        coverLettersCount: 0,
        trackerMilestonesCount: 0
      };

      if (state.hasReviewed || state.reviewOptOut) return;

      state[metricKey] = (Number(state[metricKey]) || 0) + 1;
      chrome.storage.local.set({ reviewPromptState: state }, () => {
        checkReviewPrompt(state);
      });
    });
  }

  function checkReviewPrompt(stateOverride) {
    const runCheck = (state) => {
      if (!ExtensionPolicies.shouldShowReviewPrompt(state)) return;

      const card = document.getElementById('reviewPromptCard');
      if (!card) return;

      const step1 = document.getElementById('reviewStep1');
      const step2Happy = document.getElementById('reviewStep2Happy');
      const step2Feedback = document.getElementById('reviewStep2Feedback');

      if (step1) step1.classList.remove('hidden');
      if (step2Happy) step2Happy.classList.add('hidden');
      if (step2Feedback) step2Feedback.classList.add('hidden');
      card.classList.remove('hidden');

      state.lastPromptedAt = Date.now();
      chrome.storage.local.set({ reviewPromptState: state });
    };

    if (stateOverride) {
      runCheck(stateOverride);
    } else {
      chrome.storage.local.get(['reviewPromptState'], (data) => {
        runCheck(data.reviewPromptState || {});
      });
    }
  }

  function setupReviewPrompt() {
    const card = document.getElementById('reviewPromptCard');
    if (!card) return;

    // Dismiss button (✕)
    document.getElementById('reviewDismissBtn')?.addEventListener('click', () => {
      card.classList.add('hidden');
      chrome.storage.local.get(['reviewPromptState'], (data) => {
        const state = data.reviewPromptState || {};
        state.lastPromptedAt = Date.now();
        chrome.storage.local.set({ reviewPromptState: state });
      });
    });

    // Step 1: "Loving it! 😊"
    document.getElementById('reviewStepYesBtn')?.addEventListener('click', () => {
      document.getElementById('reviewStep1')?.classList.add('hidden');
      document.getElementById('reviewStep2Happy')?.classList.remove('hidden');
    });

    // Step 1: "Needs work 💬"
    document.getElementById('reviewStepNoBtn')?.addEventListener('click', () => {
      document.getElementById('reviewStep1')?.classList.add('hidden');
      document.getElementById('reviewStep2Feedback')?.classList.remove('hidden');
    });

    // Step 2A: "Rate on Web Store"
    document.getElementById('reviewRateStoreBtn')?.addEventListener('click', () => {
      card.classList.add('hidden');
      const extId = chrome.runtime?.id || '';
      const url = ExtensionPolicies.getWebStoreReviewUrl(extId);
      window.open(url, '_blank');
      chrome.storage.local.get(['reviewPromptState'], (data) => {
        const state = data.reviewPromptState || {};
        state.hasReviewed = true;
        chrome.storage.local.set({ reviewPromptState: state });
      });
    });

    // Step 2A: "Maybe later"
    document.getElementById('reviewLaterBtn')?.addEventListener('click', () => {
      card.classList.add('hidden');
      chrome.storage.local.get(['reviewPromptState'], (data) => {
        const state = data.reviewPromptState || {};
        state.lastPromptedAt = Date.now();
        chrome.storage.local.set({ reviewPromptState: state });
      });
    });

    // Step 2B: "Send Feedback"
    document.getElementById('reviewSendFeedbackBtn')?.addEventListener('click', () => {
      card.classList.add('hidden');
      chrome.storage.local.get(['reviewPromptState'], (data) => {
        const state = data.reviewPromptState || {};
        state.hasReviewed = true;
        chrome.storage.local.set({ reviewPromptState: state });
      });
    });

    // Step 2B: "Dismiss"
    document.getElementById('reviewFeedbackDismissBtn')?.addEventListener('click', () => {
      card.classList.add('hidden');
      chrome.storage.local.get(['reviewPromptState'], (data) => {
        const state = data.reviewPromptState || {};
        state.hasReviewed = true;
        chrome.storage.local.set({ reviewPromptState: state });
      });
    });

    // Settings voluntary "Rate on Chrome Web Store" button
    document.getElementById('settingsRateBtn')?.addEventListener('click', () => {
      const extId = chrome.runtime?.id || '';
      const url = ExtensionPolicies.getWebStoreReviewUrl(extId);
      window.open(url, '_blank');
      chrome.storage.local.get(['reviewPromptState'], (data) => {
        const state = data.reviewPromptState || {};
        state.hasReviewed = true;
        chrome.storage.local.set({ reviewPromptState: state });
      });
    });
  }

  // ── 1-Click Skill Gap Fixer & Bridge ───────────────────────────────────────
  function renderSkillGapBridge(missingSkills = []) {
    const bridgeBox = document.getElementById('skillGapBridgeBox');
    const bridgeChips = document.getElementById('skillGapBridgeChips');
    if (!bridgeBox || !bridgeChips) return;

    bridgeChips.replaceChildren();

    const confirmedLower = new Set(_userSkills.map(s => String(s).toLowerCase().trim()));
    const unconfirmedMissing = (missingSkills || []).filter(s => !confirmedLower.has(String(s).toLowerCase().trim()));

    if (!unconfirmedMissing.length) {
      bridgeBox.classList.add('hidden');
      return;
    }

    bridgeBox.classList.remove('hidden');

    unconfirmedMissing.slice(0, 6).forEach(skill => {
      const btn = element('button', 'skill-suggest-chip');
      btn.type = 'button';
      const icon = element('span', '', '+');
      icon.style.fontWeight = 'bold';
      icon.style.color = 'var(--accent)';
      const text = element('span', '', ` Add ${skill} & Re-score`);
      btn.append(icon, text);
      btn.title = `Add ${skill} to your confirmed skills and re-score this job`;

      btn.addEventListener('click', () => {
        addConfirmedSkill(skill);

        if (currentJob && currentJob.evaluation) {
          const evalObj = currentJob.evaluation;
          if (Array.isArray(evalObj.missingSkills)) {
            evalObj.missingSkills = evalObj.missingSkills.filter(s => String(s).toLowerCase() !== String(skill).toLowerCase());
          }
          if (Array.isArray(evalObj.matchedSkills) && !evalObj.matchedSkills.some(s => String(s).toLowerCase() === String(skill).toLowerCase())) {
            evalObj.matchedSkills.push(skill);
          }
          const prevScore = Number.isFinite(evalObj.score) ? evalObj.score : 60;
          const newScore = Math.min(98, prevScore + 10);
          evalObj.score = newScore;
          currentJob.score = newScore;
          currentJob.matchedSkills = evalObj.matchedSkills;
          currentJob.missingSkills = evalObj.missingSkills;

          chrome.storage.local.set({ lastJob: currentJob });
          addLog(`Added "${skill}" to confirmed profile! Re-scored job fit to ${newScore}%.`, 'success');
          renderJobAnalysis(currentJob);
        }
      });

      bridgeChips.appendChild(btn);
    });
  }

  // ── Recruiter Follow-Up Modal ──────────────────────────────────────────────
  function openFollowUpModal(job = {}) {
    const modal = document.getElementById('followUpModal');
    const subjInput = document.getElementById('followUpSubjectInput');
    const bodyText = document.getElementById('followUpBodyTextarea');
    const openMailBtn = document.getElementById('followUpOpenMailBtn');
    if (!modal) return;

    const { subject, body } = ExtensionPolicies.generateFollowUpEmailTemplate(job);
    if (subjInput) subjInput.value = subject;
    if (bodyText) bodyText.value = body;

    const updateMailto = () => {
      const recipient = job.contactEmail || '';
      const currentSubj = subjInput?.value || subject;
      const currentBody = bodyText?.value || body;
      const mailtoUrl = `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(currentSubj)}&body=${encodeURIComponent(currentBody)}`;
      if (openMailBtn) {
        openMailBtn.href = mailtoUrl;
      }
    };

    updateMailto();
    subjInput?.addEventListener('input', updateMailto);
    bodyText?.addEventListener('input', updateMailto);

    modal.classList.remove('hidden');
  }

  function setupFollowUpModal() {
    const modal = document.getElementById('followUpModal');
    const closeBtn = document.getElementById('followUpClose');
    const copyBtn = document.getElementById('followUpCopyBtn');

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        modal?.classList.add('hidden');
      });
    }

    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const subj = document.getElementById('followUpSubjectInput')?.value || '';
        const body = document.getElementById('followUpBodyTextarea')?.value || '';
        const fullText = `Subject: ${subj}\n\n${body}`;
        navigator.clipboard.writeText(fullText).then(() => {
          addLog('Follow-up email copied to clipboard.', 'success');
          copyBtn.textContent = '✓ Copied!';
          setTimeout(() => { copyBtn.textContent = '📋 Copy Email'; }, 2000);
        });
      });
    }
  }

  // ── Screening Q&A Assistant ────────────────────────────────────────────────
  function setupApplicationQA() {
    const select = document.getElementById('commonQuestionsSelect');
    const input = document.getElementById('customQuestionInput');
    const draftBtn = document.getElementById('draftAnswerBtn');
    const copyBtn = document.getElementById('copyQaAnswerBtn');
    const answerBox = document.getElementById('qaAnswerBox');
    const answerText = document.getElementById('qaAnswerText');

    if (select && input) {
      select.addEventListener('change', () => {
        if (select.value) {
          input.value = select.value;
        }
      });
    }

    if (draftBtn) {
      draftBtn.addEventListener('click', () => {
        const question = (input?.value || select?.value || '').trim();
        if (!question) {
          addLog('Please select or enter an application question.', 'warn');
          return;
        }
        if (!currentJob) {
          addLog('Select or view a job first to tailor your screening answer.', 'warn');
          return;
        }

        showLoading('Drafting tailored screening answer...');
        chrome.runtime.sendMessage({
          type: 'DRAFT_APPLICATION_ANSWER',
          data: { jobData: currentJob, question }
        }, (res) => {
          hideLoading();
          if (chrome.runtime.lastError) {
            addLog('Could not draft answer: ' + chrome.runtime.lastError.message, 'error');
            return;
          }
          if (res && res.success && res.answer) {
            if (answerText) answerText.textContent = res.answer;
            if (answerBox) answerBox.classList.remove('hidden');
            addLog('Screening answer drafted successfully!', 'success');
          } else {
            addLog('Answer draft failed: ' + (res?.error || 'Unknown error'), 'error');
          }
        });
      });
    }

    if (copyBtn && answerText) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(answerText.textContent).then(() => {
          addLog('Screening answer copied to clipboard.', 'success');
          copyBtn.textContent = '✓ Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
        });
      });
    }
  }

});

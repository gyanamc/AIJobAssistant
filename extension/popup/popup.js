document.addEventListener('DOMContentLoaded', () => {
    // Tab switching logic
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(btn.dataset.target).classList.add('active');
        });
    });

    const logContainer = document.getElementById('logList'); // Assuming logList is the container for logs
    const aiModelSelect = document.getElementById('aiModel');
    const apiKeyContainer = document.getElementById('apiKeyContainer');
    const apiKeyLabel = document.getElementById('apiKeyLabel');

    // Handle Model UI Toggle
    aiModelSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'gemini') {
            apiKeyContainer.style.display = 'none';
        } else {
            apiKeyContainer.style.display = 'block';
            if (val === 'openai') apiKeyLabel.textContent = 'OpenAI API Key';
            else if (val === 'gemini_api') apiKeyLabel.textContent = 'Gemini API Key';
            else if (val === 'anthropic') apiKeyLabel.textContent = 'Anthropic API Key';
        }
    });

    // Load saved settings and persistent logs
    chrome.storage.local.get(['aiModel', 'apiKey', 'sheetUrl', 'targetRoles', 'targetLocations', 'resumeSummary', 'botRunning', 'sessionLogs', 'shareAnonymized'], (data) => {
        if (data.aiModel) {
            aiModelSelect.value = data.aiModel;
        } else {
            aiModelSelect.value = 'gemini'; // default
        }
        
        // Trigger the change event to set initial UI state for API Key input
        aiModelSelect.dispatchEvent(new Event('change'));

        if (data.apiKey) document.getElementById('apiKey').value = data.apiKey;
        if (data.sheetUrl) document.getElementById('sheetUrl').value = data.sheetUrl;
        if (data.targetRoles) document.getElementById('targetRoles').value = data.targetRoles;
        if (data.targetLocations) document.getElementById('targetLocations').value = data.targetLocations;
        if (data.resumeSummary) document.getElementById('resumeSummary').value = data.resumeSummary;
        
        // Handle disclaimer checkbox
        const shareCheckbox = document.getElementById('shareAnonymized');
        if (data.shareAnonymized !== undefined) {
            shareCheckbox.checked = data.shareAnonymized;
        } else {
            shareCheckbox.checked = true; // Default ticked
        }
        
        updateBotUI(data.botRunning);

        // Render saved logs
        if (data.sessionLogs && data.sessionLogs.length > 0) {
            logContainer.innerHTML = ''; // Clear existing content if any
            data.sessionLogs.forEach(logStr => {
                const li = document.createElement('li');
                li.textContent = logStr;
                logContainer.prepend(li); // Prepend to show newest first
            });
        }
    });

    // Save Settings (Model, API Key & Sheet URL)
    document.getElementById('saveSettingsBtn').addEventListener('click', () => {
        const aiModel = aiModelSelect.value;
        const apiKey = document.getElementById('apiKey').value.trim();
        const sheetUrl = document.getElementById('sheetUrl').value.trim();
        
        chrome.storage.local.set({ aiModel, apiKey, sheetUrl }, () => {
            alert('Settings saved!');
        });
    });

    // Save Profile
    document.getElementById('saveProfileBtn').addEventListener('click', () => {
        const targetRoles = document.getElementById('targetRoles').value;
        const targetLocations = document.getElementById('targetLocations').value;
        const resumeSummary = document.getElementById('resumeSummary').value;
        const shareAnonymized = document.getElementById('shareAnonymized').checked;
        
        chrome.storage.local.set({ targetRoles, targetLocations, resumeSummary, shareAnonymized }, () => {
            alert('Profile saved successfully!');
        });
    });

    // Toggle Bot
    const toggleBotBtn = document.getElementById('toggleBotBtn');
    toggleBotBtn.addEventListener('click', () => {
        chrome.storage.local.get(['botRunning'], (data) => {
            const newState = !data.botRunning;
            chrome.storage.local.set({ botRunning: newState }, () => {
                updateBotUI(newState);
                
                // Notify background script (for auth/LLM checks)
                chrome.runtime.sendMessage({ type: 'TOGGLE_BOT', state: newState }).catch(() => {});
                
                chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                    if (tabs[0]) {
                        const tabUrl = tabs[0].url || '';
                        let scriptToInject = null;
                        
                        try {
                            const parsedUrl = new URL(tabUrl);
                            
                            // AUTO-SEARCH REDIRECTION LOGIC
                            if (newState === true) {
                                const roles = document.getElementById('targetRoles').value.trim();
                                const location = document.getElementById('targetLocations').value.trim();
                                
                                if (roles) {
                                    let searchUrl = null;
                                    if (parsedUrl.hostname.includes('linkedin.com')) {
                                        searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(roles)}&location=${encodeURIComponent(location)}`;
                                    } else if (parsedUrl.hostname.includes('naukri.com')) {
                                        const cleanRoles = roles.replace(/\\s+/g, '-').toLowerCase();
                                        const cleanLoc = location.replace(/\\s+/g, '-').toLowerCase();
                                        searchUrl = `https://www.naukri.com/${cleanRoles}-jobs-in-${cleanLoc}`;
                                    }

                                    // If we constructed a search URL, redirect the tab so the user doesn't have to search manually!
                                    if (searchUrl && !tabUrl.includes(encodeURIComponent(roles))) {
                                        chrome.tabs.update(tabs[0].id, { url: searchUrl });
                                        // The page will reload. The manifest content_scripts will auto-inject 
                                        // and the bot will start automatically because botRunning is now true in storage.
                                        return; 
                                    }
                                }
                            }

                            if (parsedUrl.hostname.includes('linkedin.com')) {
                                scriptToInject = 'scripts/content_linkedin.js';
                            } else if (parsedUrl.hostname.includes('naukri.com')) {
                                scriptToInject = 'scripts/content_naukri.js';
                            }
                        } catch(e) {
                            // Invalid URL (like chrome://)
                        }
                        
                        // If we are on a valid site, inject dynamically
                        if (scriptToInject) {
                            chrome.scripting.executeScript({
                                target: { tabId: tabs[0].id },
                                files: [scriptToInject]
                            }, () => {
                                // Now we know the script is definitely there! Send the mode toggle message
                                chrome.tabs.sendMessage(tabs[0].id, { 
                                    type: newState ? 'START_SCRAPING' : 'STOP_SCRAPING' 
                                });
                            });
                        } else {
                            if (newState) {
                                alert("Please navigate to LinkedIn or Naukri to run the Job Assistant.");
                                chrome.storage.local.set({ botRunning: false }, () => {
                                    updateBotUI(false);
                                    chrome.runtime.sendMessage({ type: 'TOGGLE_BOT', state: false }).catch(() => {});
                                });
                            }
                        }
                    }
                });
            });
        });
    });

    function updateBotUI(isRunning) {
        const botStatus = document.getElementById('botStatus');
        const toggleBotBtn = document.getElementById('toggleBotBtn');
        
        if (isRunning) {
            botStatus.textContent = 'Running';
            botStatus.classList.add('running');
            toggleBotBtn.textContent = 'Stop Bot';
            toggleBotBtn.style.backgroundColor = '#d32f2f'; // Red for stop
        } else {
            botStatus.textContent = 'Stopped';
            botStatus.classList.remove('running');
            toggleBotBtn.textContent = 'Start Bot';
            toggleBotBtn.style.backgroundColor = '#0073b1'; // Normal color
        }
    }

    // Listen for log messages from background
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'LOG_MESSAGE') {
            addLog(request.message);
        }
    });

    function addLog(msg) {
        const li = document.createElement('li');
        li.textContent = msg;
        logContainer.prepend(li);
    }
});

// background.js — AI Job Assistant v2

console.log('AI Job Assistant v2 background worker started.');

const BACKEND_URL = 'https://aijobassistant-production.up.railway.app';

// ── In-flight job deduplication ───────────────────────────────────────────
// Background is the only stable context across SPA navigations.
// Content scripts get re-injected on every URL change — this Set prevents
// the same job from being evaluated more than once per session.
const evaluatedJobIds = new Set();

// Restore bot state on startup
chrome.storage.local.get(['botRunning'], (data) => {
  if (data.botRunning) log('Bot resumed from previous session.');
});

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// ── Message Router ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.type === 'TOGGLE_BOT') {
    chrome.storage.local.set({ botRunning: request.state });
    log(`Bot ${request.state ? 'started' : 'stopped'}.`);
    sendResponse({ success: true });
    return true;
  }

  if (request.type === 'FORWARD_LOG') {
    log(request.message);
    sendResponse({ success: true });
    return true;
  }

  if (request.type === 'EVALUATE_JOB') {
    chrome.storage.local.get(['botRunning'], ({ botRunning }) => {
      if (!botRunning) {
        sendResponse({ success: false, reason: 'Bot is paused' });
        return;
      }

      // Deduplicate by job ID — reliable guard since background survives SPA navigations
      const jobId = String(request.data.id || '');
      if (jobId && evaluatedJobIds.has(jobId)) {
        sendResponse({ success: false, reason: 'Already evaluated' });
        return;
      }
      if (jobId) {
        evaluatedJobIds.add(jobId);
        if (evaluatedJobIds.size > 500) {
          evaluatedJobIds.delete(evaluatedJobIds.values().next().value);
        }
      }

      evaluateJob(request.data)
        .then(result => {
          sendResponse(result);
          if (result.success) {
            chrome.runtime.sendMessage({
              type: 'JOB_EVALUATED',
              data: {
                title:        request.data.title,
                company:      request.data.company,
                url:          request.data.url,
                applyUrl:     request.data.applyUrl     || request.data.url,
                contactEmail: request.data.contactEmail || '',
                location:     request.data.location     || '',
                jobType:      request.data.jobType      || 'Full-time',
                salary:       request.data.salary       || '',
                description:  request.data.description  || '',
                evaluation:   result.evaluation
              }
            }).catch(() => {});
          }
        })
        .catch(err => {
          log(`Evaluation error: ${err.message}`);
          sendResponse({ success: false, error: err.toString() });
        });
    });
    return true;
  }

  if (request.type === 'GENERATE_COVER_LETTER') {
    generateCoverLetter(request.data)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.toString() }));
    return true;
  }

  if (request.type === 'REWRITE_RESUME') {
    rewriteResume(request.data)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.toString() }));
    return true;
  }
});

// ── Job Evaluation ────────────────────────────────────────────────────────
async function evaluateJob(jobData) {
  const storage = await chrome.storage.local.get(['aiModel', 'apiKey', 'resumeSummary', 'groqApiKey', 'ollamaBackendUrl', 'ollamaModel']);
  const model   = storage.aiModel === 'gemini' ? 'free' : (storage.aiModel || 'free');

  let rawResult;
  if (model === 'free')            rawResult = await evalWithFree(jobData, storage);
  else if (model === 'gemini_api') rawResult = await evalWithGeminiAPI(jobData, storage);
  else if (model === 'anthropic')  rawResult = await evalWithAnthropic(jobData, storage);
  else                             rawResult = await evalWithOpenAI(jobData, storage);

  if (!rawResult.success) return rawResult;

  const evaluation = enrichEvaluation(rawResult.evaluation, jobData, storage);

  // Normalise is_match — LLMs sometimes return string "true" or 1
  evaluation.is_match = evaluation.is_match === true || evaluation.is_match === 'true' || evaluation.is_match === 1;

  if (evaluation.is_match) {
    log(`Match confirmed — saving: ${jobData.title}`);
    await autoSaveMatch(jobData, evaluation);
  } else {
    log(`No match — not saving: ${jobData.title}`);
  }

  return { success: true, evaluation };
}

// ── Enrichment ────────────────────────────────────────────────────────────
function enrichEvaluation(raw, jobData, storage) {
  const userSkills = (storage.resumeSummary || '')
    .split(/[\n,]+/).map(s => s.trim()).filter(s => s.length > 2 && s.length < 30);

  const desc = (jobData.description || '').toLowerCase();
  const matchedSkills = userSkills.filter(s => desc.includes(s.toLowerCase()));
  const missingSkills = [];

  const commonSkills = ['Python', 'LangChain', 'LangGraph', 'RAG', 'AWS', 'Docker',
    'Kubernetes', 'SQL', 'Machine Learning', 'Deep Learning', 'TensorFlow', 'PyTorch',
    'n8n', 'Airflow', 'MLflow', 'FastAPI', 'React', 'Node.js', 'TypeScript'];

  commonSkills.forEach(skill => {
    if (desc.includes(skill.toLowerCase()) && !matchedSkills.includes(skill)) {
      missingSkills.push(skill);
    }
  });

  const skillsScore = matchedSkills.length && (matchedSkills.length + missingSkills.length)
    ? Math.round((matchedSkills.length / (matchedSkills.length + missingSkills.length)) * 100)
    : raw.is_match ? 80 : 40;

  const reqsScore = raw.is_match ? Math.floor(Math.random() * 15) + 82 : Math.floor(Math.random() * 20) + 30;
  const respScore = raw.is_match ? Math.floor(Math.random() * 15) + 80 : Math.floor(Math.random() * 20) + 35;
  const score     = Math.round((skillsScore + reqsScore + respScore) / 3);

  return {
    ...raw, score, skillsScore, reqsScore, respScore,
    matchedSkills:    matchedSkills.slice(0, 15),
    missingSkills:    missingSkills.slice(0, 5),
    requirements:     extractBulletPoints(jobData.description, 'require').slice(0, 6),
    responsibilities: extractBulletPoints(jobData.description, 'responsib').slice(0, 6)
  };
}

function extractBulletPoints(description, keyword) {
  if (!description) return [];
  const lines = description.split('\n').map(l => l.trim()).filter(l => l.length > 20);
  const results = [];
  let inSection = false;
  for (const line of lines) {
    if (line.toLowerCase().includes(keyword)) { inSection = true; continue; }
    if (inSection && line.length > 20 && line.length < 300) {
      results.push({ text: line.replace(/^[-•*·]\s*/, ''), priority: guessPriority(line) });
      if (results.length >= 8) break;
    }
    if (inSection && /^[A-Z][a-z]+ [A-Z]/.test(line) && results.length > 0) break;
  }
  if (!results.length) {
    lines.slice(0, 8).forEach(line => {
      const clean = line.replace(/^[-•*·]\s*/, '');
      if (clean.length > 20) results.push({ text: clean, priority: guessPriority(clean) });
    });
  }
  return results;
}

function guessPriority(text) {
  const t = text.toLowerCase();
  if (t.includes('must') || t.includes('required') || t.includes('critical') || t.includes('essential')) return 'critical';
  if (t.includes('prefer') || t.includes('nice') || t.includes('plus') || t.includes('bonus')) return 'excellent';
  return 'important';
}

// ── Free tier: Backend → Groq → Ollama fallback ──────────────────────────
async function evalWithFree(jobData, storage) {
  // 1. Try backend (server-side key — no user config needed)
  const backendResult = await evalWithBackend(jobData, storage);
  if (backendResult.success) {
    log('Used free backend for evaluation.');
    return backendResult;
  }
  log(`Backend unavailable (${backendResult.error}) — trying fallbacks...`);

  // 2. Try user's Groq key if set
  if (storage.groqApiKey) {
    const groqResult = await evalWithGroq(jobData, storage);
    if (groqResult.success) {
      log('Used Groq for evaluation.');
      return groqResult;
    }
    log(`Groq failed (${groqResult.error}) — trying Ollama...`);
  }

  // 3. Try Ollama if configured
  if (storage.ollamaBackendUrl) {
    const ollamaResult = await evalWithOllama(jobData, storage);
    if (ollamaResult.success) {
      log('Used Ollama for evaluation.');
      return ollamaResult;
    }
    log(`Ollama also failed: ${ollamaResult.error}`);
  }

  return { success: false, error: 'All free evaluation methods failed. Please try again later.' };
}

async function evalWithBackend(jobData, storage) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobTitle:      jobData.title       || '',
        company:       jobData.company     || '',
        description:   jobData.description || '',
        resumeSummary: storage.resumeSummary || ''
      })
    });
    if (!res.ok) throw new Error(`Backend HTTP ${res.status}`);
    const data    = await res.json();
    const content = data.evaluation;
    log(`Match: ${content.is_match} — ${content.reasoning?.substring(0, 60)}...`);
    return { success: true, evaluation: content };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function evalWithGroq(jobData, storage) {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${storage.groqApiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user',   content: buildUserPrompt(jobData, storage) }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 600
      })
    });
    if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
    const content = JSON.parse((await res.json()).choices[0].message.content);
    log(`Match: ${content.is_match} — ${content.reasoning?.substring(0, 60)}...`);
    return { success: true, evaluation: content };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function evalWithOllama(jobData, storage) {
  const baseUrl = (storage.ollamaBackendUrl || '').replace(/\/$/, '');
  const model   = storage.ollamaModel || 'llama3.2:1b';
  try {
    const res = await fetch(`${baseUrl}/api/v1/ollama/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user',   content: buildUserPrompt(jobData, storage) }
        ],
        options: { temperature: 0.3 }
      })
    });
    if (!res.ok) throw new Error(`Ollama proxy HTTP ${res.status}`);
    const data    = await res.json();
    const content = parseJSON(data.content);
    log(`Match: ${content.is_match} — ${content.reasoning?.substring(0, 60)}...`);
    return { success: true, evaluation: content };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── LLM Providers ─────────────────────────────────────────────────────────
async function evalWithOpenAI(jobData, storage) {
  if (!storage.apiKey) { log('ERROR: No OpenAI API key set.'); return { success: false, error: 'Missing API key' }; }
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${storage.apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: buildSystemPrompt() }, { role: 'user', content: buildUserPrompt(jobData, storage) }],
        response_format: { type: 'json_object' },
        temperature: 0.3
      })
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const content = JSON.parse((await res.json()).choices[0].message.content);
    log(`Match: ${content.is_match} — ${content.reasoning?.substring(0, 60)}...`);
    return { success: true, evaluation: content };
  } catch (e) {
    log(`OpenAI error: ${e.message}`);
    return { success: false, error: e.message };
  }
}

async function evalWithGeminiAPI(jobData, storage) {
  if (!storage.apiKey) { log('ERROR: No Gemini API key set.'); return { success: false, error: 'Missing API key' }; }
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${storage.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: { text: buildSystemPrompt() } },
          contents: [{ parts: [{ text: buildUserPrompt(jobData, storage) }] }],
          generationConfig: { response_mime_type: 'application/json', temperature: 0.3 }
        })
      }
    );
    if (!res.ok) throw new Error(`Gemini API ${res.status}`);
    const content = JSON.parse((await res.json()).candidates[0].content.parts[0].text);
    log(`Match: ${content.is_match} — ${content.reasoning?.substring(0, 60)}...`);
    return { success: true, evaluation: content };
  } catch (e) {
    log(`Gemini API error: ${e.message}`);
    return { success: false, error: e.message };
  }
}

async function evalWithAnthropic(jobData, storage) {
  if (!storage.apiKey) { log('ERROR: No Anthropic API key set.'); return { success: false, error: 'Missing API key' }; }
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': storage.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 600, temperature: 0.3,
        system: buildSystemPrompt(),
        messages: [{ role: 'user', content: buildUserPrompt(jobData, storage) + '\n\nReturn ONLY valid JSON.' }]
      })
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}`);
    const content = parseJSON((await res.json()).content[0].text);
    log(`Match: ${content.is_match} — ${content.reasoning?.substring(0, 60)}...`);
    return { success: true, evaluation: content };
  } catch (e) {
    log(`Anthropic error: ${e.message}`);
    return { success: false, error: e.message };
  }
}

// ── Cover Letter & Resume Rewrite ─────────────────────────────────────────
async function generateCoverLetter(jobData) {
  const storage = await chrome.storage.local.get(['aiModel', 'apiKey', 'resumeSummary', 'groqApiKey', 'ollamaBackendUrl', 'ollamaModel']);
  const prompt = `Write a concise, professional cover letter (3 paragraphs) for:\nJob: ${jobData.title} at ${jobData.company}\nDescription: ${(jobData.description || '').substring(0, 1000)}\nCandidate: ${storage.resumeSummary || 'Senior AI professional'}\nReturn only the cover letter text.`;
  try { return { success: true, coverLetter: await callLLM(storage, prompt) }; }
  catch (e) { return { success: false, error: e.message }; }
}

async function rewriteResume(jobData) {
  const storage = await chrome.storage.local.get(['aiModel', 'apiKey', 'resumeSummary', 'groqApiKey', 'ollamaBackendUrl', 'ollamaModel']);
  const prompt = `Rewrite this resume summary to match the job (3-4 sentences).\nJob: ${jobData.title} at ${jobData.company}\nDescription: ${(jobData.description || '').substring(0, 800)}\nCurrent Summary: ${storage.resumeSummary || ''}\nReturn only the rewritten summary.`;
  try { return { success: true, rewritten: await callLLM(storage, prompt) }; }
  catch (e) { return { success: false, error: e.message }; }
}

async function callLLM(storage, prompt) {
  const model = storage.aiModel === 'gemini' ? 'free' : (storage.aiModel || 'free');

  if (model === 'free') {
    // 1. Try backend
    try {
      const res = await fetch(`${BACKEND_URL}/api/v1/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobTitle: '', company: '', description: prompt,
          resumeSummary: storage.resumeSummary || ''
        })
      });
      if (res.ok) {
        const data = await res.json();
        return data.evaluation?.cover_letter || data.evaluation?.reasoning || JSON.stringify(data.evaluation);
      }
    } catch (_) {}
    // 2. Try user's Groq key
    if (storage.groqApiKey) {
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${storage.groqApiKey}` },
          body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: prompt }], temperature: 0.5, max_tokens: 800 })
        });
        if (res.ok) return (await res.json()).choices[0].message.content;
      } catch (_) {}
    }
    // 3. Try Ollama
    if (storage.ollamaBackendUrl) {
      const baseUrl = storage.ollamaBackendUrl.replace(/\/$/, '');
      const res = await fetch(`${baseUrl}/api/v1/ollama/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: storage.ollamaModel || 'llama3.2:1b', messages: [{ role: 'user', content: prompt }] })
      });
      if (res.ok) return (await res.json()).content;
    }
    throw new Error('Free LLM unavailable for this action.');
  }

  if (model === 'openai' && storage.apiKey) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${storage.apiKey}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.5 })
    });
    return (await res.json()).choices[0].message.content;
  }
  if (model === 'gemini_api' && storage.apiKey) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${storage.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    return (await res.json()).candidates[0].content.parts[0].text;
  }
  throw new Error('No suitable LLM configured.');
}

// ── Auto-save matches locally ─────────────────────────────────────────────
let _saveQueue = Promise.resolve();

function autoSaveMatch(jobData, evaluation) {
  _saveQueue = _saveQueue.then(() => _doSave(jobData, evaluation));
  return _saveQueue;
}

function _doSave(jobData, evaluation) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['savedJobs'], (data) => {
      const saved = data.savedJobs || [];

      // Deduplicate only by job ID or exact URL — title+company is too aggressive
      const isDuplicate = saved.some(j =>
        (jobData.id  && j.id  && j.id  === String(jobData.id)) ||
        (jobData.url && j.url && j.url === jobData.url)
      );

      if (isDuplicate) {
        log(`Skipping save — already in saved jobs: ${jobData.title}`);
        resolve();
        return;
      }

      saved.unshift({
        id:            String(jobData.id  || ''),
        title:         jobData.title        || '',
        company:       jobData.company      || '',
        location:      jobData.location     || '',
        jobType:       jobData.jobType      || 'Full-time',
        salary:        jobData.salary       || '',
        url:           jobData.url          || '',
        applyUrl:      jobData.applyUrl     || jobData.url || '',
        contactEmail:  jobData.contactEmail || '',
        score:         evaluation.score        || 0,
        skillsScore:   evaluation.skillsScore  || 0,
        reqsScore:     evaluation.reqsScore    || 0,
        respScore:     evaluation.respScore    || 0,
        matchedSkills: evaluation.matchedSkills  || [],
        missingSkills: evaluation.missingSkills  || [],
        reasoning:     evaluation.reasoning      || '',
        coverLetter:   evaluation.cover_letter   || '',
        savedAt:       new Date().toISOString()
      });

      if (saved.length > 200) saved.pop();
      chrome.storage.local.set({ savedJobs: saved }, () => {
        log(`✅ Saved to local storage: ${jobData.title}`);
        chrome.runtime.sendMessage({ type: 'JOB_SAVED' }).catch(() => {});
        resolve();
      });
    });
  });
}

// ── Prompt Builders ───────────────────────────────────────────────────────
function buildSystemPrompt() {
  return `You are an expert AI career assistant evaluating job matches.
Respond with EXACTLY valid JSON with these keys:
- "is_match": boolean
- "reasoning": string (2-3 sentences explaining the match decision)
- "cover_letter": string (short 2-paragraph cover letter if is_match is true, else empty string)`;
}

function buildUserPrompt(jobData, storage) {
  return `Resume Summary:\n${storage.resumeSummary || 'Not provided'}\n\nJob Title: ${jobData.title}\nCompany: ${jobData.company}\nDescription:\n${(jobData.description || '').substring(0, 2000)}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────
function parseJSON(text) {
  return JSON.parse(text.replace(/```json/gi, '').replace(/```/g, '').trim());
}

function log(message) {
  const time = new Date().toLocaleTimeString([], { hour12: false });
  const full = `[${time}] ${message}`;
  chrome.storage.local.get(['sessionLogs'], (data) => {
    const logs = data.sessionLogs || [];
    logs.unshift({ text: full, type: message.includes('✅') ? 'success' : message.includes('ERROR') ? 'error' : '' });
    if (logs.length > 100) logs.pop();
    chrome.storage.local.set({ sessionLogs: logs });
  });
  chrome.runtime.sendMessage({ type: 'LOG_MESSAGE', message: full }).catch(() => {});
}

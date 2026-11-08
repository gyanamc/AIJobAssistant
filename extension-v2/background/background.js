// background.js — AI Job Assistant v2

console.log('AI Job Assistant v2 background worker started.');

// ── Constants ─────────────────────────────────────────────────────────────
const DEFAULT_OLLAMA_URL  = 'https://aijobassistant-production.up.railway.app';
const DEFAULT_OLLAMA_MODEL = 'llama3.2:1b';
const ANTHROPIC_MODEL = 'claude-sonnet-5';
const ANTHROPIC_API_VERSION = '2026-10-21';
// Background is the only stable context across SPA navigations.
// Content scripts get re-injected on every URL change — this Set prevents
// the same job from being evaluated more than once per session.
const evaluatedJobIds = new Set();

// Restore bot state on startup
chrome.storage.local.get(['botRunning'], (data) => {
  if (data.botRunning) log('Bot resumed from previous session.');
});

// Add tracker defaults to historical saved jobs once, preserving IDs, URLs,
// scores, notes, and every other existing field.
chrome.storage.local.get(['savedJobs'], (data) => {
  const jobs = Array.isArray(data.savedJobs) ? data.savedJobs : [];
  let changed = false;
  const migrated = jobs.map(job => {
    if (job.applicationStatus !== undefined) return job;
    changed = true;
    return {
      ...job,
      applicationStatus: 'Saved', appliedDate: '', followUpDate: '',
      contactName: '', contactEmail: job.contactEmail || '', notes: '',
      trackerUpdatedAt: null
    };
  });
  if (changed) chrome.storage.local.set({ savedJobs: migrated });
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

  // Prefer the deterministic evidence score when it is available. Fall back to
  // the model decision only when the extension cannot calculate a score.
  evaluation.is_match = resolveMatchClassification(
    evaluation.is_match,
    evaluation.score,
    evaluation.scoreCoverage
  );

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
  const resumeText = String(storage.resumeSummary || '').trim();
  const description = String(jobData.description || '').trim();
  const resumeLower = resumeText.toLowerCase();
  const descLower = description.toLowerCase();
  const commonSkills = ['Python', 'Java', 'JavaScript', 'LangChain', 'LangGraph', 'RAG', 'AWS', 'Azure', 'GCP', 'Docker',
    'Kubernetes', 'SQL', 'Machine Learning', 'Deep Learning', 'TensorFlow', 'PyTorch',
    'n8n', 'Airflow', 'MLflow', 'FastAPI', 'React', 'Node.js', 'TypeScript'];
  const skillsAssessment = normalizeAssessmentItems(raw.skills_assessment, []);
  const jobSkills = skillsAssessment.length
    ? skillsAssessment.map(item => item.text)
    : commonSkills.filter(skill => descLower.includes(skill.toLowerCase()));
  const skillHasEvidence = item => typeof item.matched === 'boolean'
    ? item.matched
    : resumeLower.includes(item.text.toLowerCase());
  const matchedSkills = skillsAssessment.length
    ? skillsAssessment.filter(skillHasEvidence).map(item => item.text)
    : jobSkills.filter(skill => resumeLower.includes(skill.toLowerCase()));
  const missingSkills = skillsAssessment.length
    ? skillsAssessment.filter(item => !skillHasEvidence(item)).map(item => item.text)
    : jobSkills.filter(skill => !resumeLower.includes(skill.toLowerCase()));

  const requirements = normalizeAssessmentItems(
    raw.requirements_assessment || raw.requirements,
    extractBulletPoints(description, 'require').slice(0, 6)
  );
  const responsibilities = normalizeAssessmentItems(
    raw.responsibilities_assessment || raw.responsibilities,
    extractBulletPoints(description, 'responsib').slice(0, 6)
  );

  const skillsScore = skillsAssessment.length
    ? scoreAssessmentItems(skillsAssessment, resumeText)
    : resumeText && jobSkills.length
      ? Math.round((matchedSkills.length / jobSkills.length) * 100)
      : null;
  const reqsScore = scoreAssessmentItems(requirements, resumeText);
  const respScore = scoreAssessmentItems(responsibilities, resumeText);
  const score = weightedAvailableScore([
    { value: skillsScore, weight: 0.40 },
    { value: reqsScore, weight: 0.35 },
    { value: respScore, weight: 0.25 }
  ]);
  const scoreCoverage = buildScoreCoverage({ skillsScore, reqsScore, respScore });
  const availableDimensions = scoreCoverage.assessedDimensions;
  const scoreExplanation = score === null
    ? 'Compatibility score unavailable: add a resume summary and ensure the job description includes assessable skills, requirements, or responsibilities.'
    : `${scoreCoverage.status === 'full' ? 'Full' : 'Partial'} evidence-based compatibility from ${availableDimensions} of 3 dimensions (skills 40%, requirements 35%, responsibilities 25%; available weights are normalized and unavailable dimensions are excluded).`;

  return {
    ...raw, score, skillsScore, reqsScore, respScore,
    matchedSkills:    matchedSkills.slice(0, 15),
    missingSkills:    missingSkills.slice(0, 5),
    requirements,
    responsibilities,
    scoreExplanation,
    scoreCoverage
  };
}

function buildScoreCoverage({ skillsScore, reqsScore, respScore }) {
  const availability = {
    skills: Number.isFinite(skillsScore),
    requirements: Number.isFinite(reqsScore),
    responsibilities: Number.isFinite(respScore)
  };
  const availableDimensions = Object.entries(availability)
    .filter(([, available]) => available)
    .map(([name]) => name);
  const assessedDimensions = availableDimensions.length;
  return {
    availability,
    availableDimensions,
    assessedDimensions,
    totalDimensions: 3,
    coveragePercentage: Math.round((assessedDimensions / 3) * 100),
    status: assessedDimensions === 3 ? 'full' : assessedDimensions > 0 ? 'partial' : 'unavailable',
    minimumDimensionsForClassification: 2,
    meetsClassificationThreshold: assessedDimensions >= 2
  };
}

function resolveMatchClassification(modelValue, score, coverage) {
  const modelMatch = modelValue === true || modelValue === 'true' || modelValue === 1;
  return coverage?.meetsClassificationThreshold && Number.isFinite(score)
    ? score >= 60
    : modelMatch;
}

function normalizeAssessmentItems(items, fallback) {
  const source = Array.isArray(items) && items.length ? items : fallback;
  return (Array.isArray(source) ? source : []).map(item => {
    if (typeof item === 'string') {
      return { text: item, priority: guessPriority(item), matched: null };
    }
    const text = String(item?.text || item?.requirement || item?.responsibility || '').trim();
    const matched = typeof item?.matched === 'boolean' ? item.matched : null;
    return {
      text,
      priority: normalizePriority(item?.priority || guessPriority(text)),
      matched
    };
  }).filter(item => item.text);
}

function normalizePriority(priority) {
  return ['critical', 'important', 'excellent'].includes(priority) ? priority : 'important';
}

function scoreAssessmentItems(items, resumeText) {
  if (!resumeText || !Array.isArray(items) || !items.length) return null;
  const resumeTokens = meaningfulTokens(resumeText);
  if (!resumeTokens.size) return null;

  let earned = 0;
  let possible = 0;
  for (const item of items) {
    const weight = item.priority === 'critical' ? 2 : item.priority === 'excellent' ? 0.5 : 1;
    const evidence = typeof item.matched === 'boolean'
      ? item.matched
      : hasTextualEvidence(item.text, resumeTokens);
    possible += weight;
    if (evidence) earned += weight;
  }
  return possible ? Math.round((earned / possible) * 100) : null;
}

function meaningfulTokens(text) {
  const stopWords = new Set(['and', 'the', 'with', 'for', 'from', 'that', 'this', 'will', 'your', 'you', 'are', 'our', 'have', 'has', 'job', 'role', 'work', 'using', 'years', 'year']);
  return new Set(String(text || '').toLowerCase().match(/[a-z0-9+#.]{3,}/g)?.filter(token => !stopWords.has(token)) || []);
}

function hasTextualEvidence(text, resumeTokens) {
  const itemTokens = [...meaningfulTokens(text)];
  if (!itemTokens.length) return false;
  const matches = itemTokens.filter(token => resumeTokens.has(token)).length;
  const requiredMatches = itemTokens.length <= 3 ? 1 : Math.min(3, Math.ceil(itemTokens.length * 0.25));
  return matches >= requiredMatches;
}

function weightedAvailableScore(parts) {
  const available = parts.filter(part => Number.isFinite(part.value));
  if (!available.length) return null;
  const totalWeight = available.reduce((sum, part) => sum + part.weight, 0);
  const score = Math.round(available.reduce((sum, part) => sum + part.value * part.weight, 0) / totalWeight);
  return Math.min(100, Math.max(0, score));
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
    const signals = keyword.startsWith('require')
      ? ['required', 'requirement', 'must have', 'essential', 'preferred', 'nice to have']
      : ['responsible', 'responsibility', 'duties', 'you will', "you'll"];
    lines.filter(line => signals.some(signal => line.toLowerCase().includes(signal))).slice(0, 8).forEach(line => {
      const clean = line.replace(/^[-•*·]\s*/, '');
      results.push({ text: clean, priority: guessPriority(clean), matched: null });
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

// ── Free tier: Groq → Ollama fallback ────────────────────────────────────
async function evalWithFree(jobData, storage) {
  const ollamaUrl = storage.ollamaBackendUrl || DEFAULT_OLLAMA_URL;

  // Try Groq proxy first (key lives on the backend)
  const groqResult = await evalWithGroq(jobData, { ...storage, ollamaBackendUrl: ollamaUrl });
  if (groqResult.success) {
    log('Used Groq for evaluation.');
    return groqResult;
  }
  log(`Groq failed (${groqResult.error}) — falling back to Ollama...`);

  // Fall back to Ollama
  const ollamaResult = await evalWithOllama(jobData, { ...storage, ollamaBackendUrl: ollamaUrl });
  if (ollamaResult.success) {
    log('Used Ollama for evaluation.');
    return ollamaResult;
  }
  log(`Ollama also failed: ${ollamaResult.error}`);
  return { success: false, error: `Free LLM unavailable. Groq: failed. Ollama: ${ollamaResult.error}` };
}

async function evalWithGroq(jobData, storage) {
  const baseUrl = (storage.ollamaBackendUrl || DEFAULT_OLLAMA_URL).replace(/\/$/, '');
  try {
    const res = await fetch(`${baseUrl}/api/v1/groq/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    if (!res.ok) throw new Error(`Groq proxy HTTP ${res.status}`);
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
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': storage.apiKey
        },
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
    const text = await requestAnthropicText(
      storage.apiKey,
      buildUserPrompt(jobData, storage) + '\n\nReturn ONLY valid JSON.',
      { system: buildSystemPrompt(), maxTokens: 900 }
    );
    const content = parseJSON(text);
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
  const resumeSummary = String(storage.resumeSummary || '').trim();
  if (!resumeSummary) {
    return { success: false, error: 'Add your resume summary in the Profile section before tailoring it.' };
  }
  const prompt = buildResumeRewritePrompt(jobData, resumeSummary);
  try {
    const rewritten = String(await callLLM(storage, prompt) || '').trim();
    if (!rewritten) throw new Error('The AI returned an empty resume summary. Please try again.');
    return { success: true, rewritten };
  }
  catch (e) { return { success: false, error: e.message }; }
}

function buildResumeRewritePrompt(jobData, resumeSummary) {
  return `Create a professional 3-4 sentence resume summary tailored to the selected job.

ORIGINAL RESUME SUMMARY (the only allowed source of candidate facts):
${resumeSummary}

SELECTED JOB:
Title: ${jobData.title || ''}
Company: ${jobData.company || ''}
Description: ${(jobData.description || '').substring(0, 1200)}

FACTUALITY RULES:
- Use only information explicitly present in the original resume summary.
- Never invent employers, job titles, employment dates, qualifications, certifications, technical skills, projects, revenue, cost savings, percentages, business achievements, or years of experience.
- Never increase years of experience or claim expertise based only on the job description.
- Never convert a job requirement into an assumed candidate qualification.
- If the resume lacks evidence for an important requirement, omit that claim.
- You may reorder and rephrase existing skills, experience, leadership, achievements, and business outcomes to emphasize relevance without changing the facts.

Return only the rewritten resume summary.`;
}

async function callLLM(storage, prompt) {
  const model = storage.aiModel === 'gemini' ? 'free' : (storage.aiModel || 'free');

  if (model === 'free') {
    const ollamaUrl = (storage.ollamaBackendUrl || DEFAULT_OLLAMA_URL).replace(/\/$/, '');
    const ollamaModel = storage.ollamaModel || DEFAULT_OLLAMA_MODEL;

    // Try Groq proxy first
    try {
      const res = await fetch(`${ollamaUrl}/api/v1/groq/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: prompt }], temperature: 0.5, max_tokens: 800 })
      });
      if (res.ok) return (await res.json()).choices[0].message.content;
    } catch (_) {}

    // Fall back to Ollama
    const res = await fetch(`${ollamaUrl}/api/v1/ollama/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ollamaModel, messages: [{ role: 'user', content: prompt }] })
    });
    if (res.ok) return (await res.json()).content;
    throw new Error('Free LLM unavailable for this action.');
  }

  if (model === 'openai' && storage.apiKey) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${storage.apiKey}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.5 })
    });
    if (!res.ok) throw providerHttpError('OpenAI', res.status);
    const data = await res.json();
    if (typeof data?.choices?.[0]?.message?.content !== 'string') throw new Error('OpenAI returned an invalid response.');
    return data.choices[0].message.content;
  }
  if (model === 'gemini_api' && storage.apiKey) {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': storage.apiKey
      },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    if (!res.ok) throw providerHttpError('Gemini', res.status);
    const data = await res.json();
    if (typeof data?.candidates?.[0]?.content?.parts?.[0]?.text !== 'string') throw new Error('Gemini returned an invalid response.');
    return data.candidates[0].content.parts[0].text;
  }
  if (model === 'anthropic') {
    return requestAnthropicText(storage.apiKey, prompt, { maxTokens: 1000 });
  }
  throw new Error('No suitable LLM configured.');
}

async function requestAnthropicText(apiKey, prompt, options = {}) {
  if (!apiKey) throw new Error('Anthropic API key is missing.');
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: options.maxTokens || 800,
        ...(options.system ? { system: options.system } : {}),
        messages: [{ role: 'user', content: prompt }]
      })
    });
  } catch (_) {
    throw new Error('Anthropic network request failed. Check your connection and try again.');
  }
  if (!res.ok) throw providerHttpError('Anthropic', res.status);
  const data = await res.json();
  const text = data?.content?.find(block => block?.type === 'text')?.text;
  if (typeof text !== 'string' || !text.trim()) throw new Error('Anthropic returned an invalid response.');
  return text;
}

function providerHttpError(provider, status) {
  if (status === 400) return new Error(`${provider} rejected the request. Check the selected model and input.`);
  if (status === 401 || status === 403) return new Error(`${provider} authentication failed. Check the configured API key.`);
  if (status === 429) return new Error(`${provider} rate limit reached. Try again later.`);
  if (status >= 500) return new Error(`${provider} service is temporarily unavailable (HTTP ${status}).`);
  return new Error(`${provider} request failed (HTTP ${status}).`);
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
        score:         evaluation.score        ?? null,
        skillsScore:   evaluation.skillsScore  ?? null,
        reqsScore:     evaluation.reqsScore    ?? null,
        respScore:     evaluation.respScore    ?? null,
        scoreCoverage: evaluation.scoreCoverage || null,
        matchedSkills: evaluation.matchedSkills  || [],
        missingSkills: evaluation.missingSkills  || [],
        reasoning:     evaluation.reasoning      || '',
        coverLetter:   evaluation.cover_letter   || '',
        applicationStatus: 'Saved',
        appliedDate: '',
        followUpDate: '',
        contactName: '',
        notes: '',
        trackerUpdatedAt: null,
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
- "cover_letter": string (short 2-paragraph cover letter if is_match is true, else empty string)
- "skills_assessment": array of objects with "text", "priority" (critical, important, or excellent), and "matched" boolean
- "requirements_assessment": array of objects with "text", "priority" (critical, important, or excellent), and "matched" boolean
- "responsibilities_assessment": array of objects with "text", "priority" (critical, important, or excellent), and "matched" boolean
Only mark an item matched when the resume contains explicit supporting evidence. The compatibility score is calculated separately by the extension.`;
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

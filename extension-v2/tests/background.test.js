const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadBackground(fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({}) }), initialStorage = {}) {
  const storage = { ...initialStorage };
  const chrome = {
    action: { onClicked: { addListener() {} } },
    sidePanel: { open() {} },
    runtime: {
      onMessage: { addListener() {} },
      sendMessage: () => Promise.resolve()
    },
    storage: {
      local: {
        get(keys, callback) {
          const result = Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, storage[key]]));
          if (callback) callback(result);
          return Promise.resolve(result);
        },
        set(values, callback) {
          Object.assign(storage, values);
          if (callback) callback();
          return Promise.resolve();
        }
      }
    }
  };
  const context = vm.createContext({ chrome, fetch: fetchImpl, console, URL, setTimeout, clearTimeout });
  const source = fs.readFileSync(path.join(__dirname, '..', 'background', 'background.js'), 'utf8');
  vm.runInContext(source, context);
  return {
    enrichEvaluation: vm.runInContext('enrichEvaluation', context),
    evaluateJob: vm.runInContext('evaluateJob', context),
    resolveMatchClassification: vm.runInContext('resolveMatchClassification', context),
    callLLM: vm.runInContext('callLLM', context),
    evalWithAnthropic: vm.runInContext('evalWithAnthropic', context),
    evalWithOpenAI: vm.runInContext('evalWithOpenAI', context),
    evalWithGeminiAPI: vm.runInContext('evalWithGeminiAPI', context),
    generateCoverLetter: vm.runInContext('generateCoverLetter', context),
    rewriteResume: vm.runInContext('rewriteResume', context),
    buildResumeRewritePrompt: vm.runInContext('buildResumeRewritePrompt', context),
    storage
  };
}

test('identical evidence produces identical deterministic scores', () => {
  const { enrichEvaluation } = loadBackground();
  const raw = {
    is_match: true,
    reasoning: 'Evidence aligns.',
    requirements_assessment: [
      { text: 'Python is required', priority: 'critical', matched: true },
      { text: 'AWS is preferred', priority: 'excellent', matched: false }
    ],
    responsibilities_assessment: [
      { text: 'Build FastAPI services', priority: 'important', matched: true }
    ]
  };
  const job = { description: 'Python FastAPI AWS\nRequirements\nPython is required\nResponsibilities\nBuild FastAPI services' };
  const profile = { resumeSummary: 'Python engineer building FastAPI services' };
  const first = enrichEvaluation(raw, job, profile);
  const second = enrichEvaluation(raw, job, profile);
  assert.deepEqual(first, second);
  assert.equal(first.skillsScore, 67);
  assert.equal(first.reqsScore, 80);
  assert.equal(first.respScore, 100);
  assert.equal(first.score, 80);
  assert.equal(first.scoreCoverage.status, 'full');
  assert.equal(first.scoreCoverage.assessedDimensions, 3);
});

test('scores remain unavailable when there is insufficient evidence', () => {
  const { enrichEvaluation } = loadBackground();
  const result = enrichEvaluation({ is_match: true, reasoning: 'Model guess.' }, { description: '' }, { resumeSummary: '' });
  assert.equal(result.score, null);
  assert.equal(result.skillsScore, null);
  assert.equal(result.reqsScore, null);
  assert.equal(result.respScore, null);
  assert.equal(result.scoreCoverage.status, 'unavailable');
});

test('shared actions call Anthropic and extract text without exposing the key', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: 'Tailored summary' }] })
    };
  };
  const { callLLM } = loadBackground(fetchImpl);
  const text = await callLLM({ aiModel: 'anthropic', apiKey: 'secret-key' }, 'Rewrite this summary');
  assert.equal(text, 'Tailored summary');
  assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(request.options.headers['x-api-key'], 'secret-key');
  assert.equal(request.options.headers['anthropic-version'], '2026-10-21');
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, 'claude-sonnet-5');
  assert.equal(body.max_tokens, 1000);
  assert.equal(body.messages[0].role, 'user');
  assert.equal('temperature' in body, false);
  assert.doesNotMatch(request.options.body, /secret-key/);
});

test('Anthropic authentication errors are safe and actionable', async () => {
  const { callLLM } = loadBackground(async () => ({ ok: false, status: 401, json: async () => ({}) }));
  await assert.rejects(
    callLLM({ aiModel: 'anthropic', apiKey: 'secret-key' }, 'Generate'),
    error => /authentication failed/.test(error.message) && !error.message.includes('secret-key')
  );
});

test('assessment changes affect evidence scores while model is_match does not', () => {
  const { enrichEvaluation } = loadBackground();
  const job = { description: 'Requirements\nPython is required' };
  const profile = { resumeSummary: 'Python engineer' };
  const matched = enrichEvaluation({
    is_match: true,
    requirements_assessment: [{ text: 'Python', priority: 'critical', matched: true }]
  }, job, profile);
  const unmatched = enrichEvaluation({
    is_match: true,
    requirements_assessment: [{ text: 'Python', priority: 'critical', matched: false }]
  }, job, profile);
  const flippedModel = enrichEvaluation({
    is_match: false,
    requirements_assessment: [{ text: 'Python', priority: 'critical', matched: true }]
  }, job, profile);
  assert.equal(matched.reqsScore, 100);
  assert.equal(unmatched.reqsScore, 0);
  assert.equal(matched.score, flippedModel.score);
});

test('coverage controls when the score may classify a match', () => {
  const { enrichEvaluation, resolveMatchClassification } = loadBackground();
  const profile = { resumeSummary: 'Python engineer' };
  const one = enrichEvaluation({
    is_match: false,
    skills_assessment: [{ text: 'Python', priority: 'critical', matched: true }]
  }, { description: 'Python' }, profile);
  assert.equal(one.scoreCoverage.assessedDimensions, 1);
  assert.equal(one.scoreCoverage.status, 'partial');
  assert.equal(resolveMatchClassification(false, one.score, one.scoreCoverage), false);

  const two = enrichEvaluation({
    is_match: false,
    skills_assessment: [{ text: 'Python', priority: 'critical', matched: true }],
    requirements_assessment: [{ text: 'Python required', priority: 'critical', matched: true }]
  }, { description: 'Python' }, profile);
  assert.equal(two.scoreCoverage.assessedDimensions, 2);
  assert.equal(two.scoreCoverage.meetsClassificationThreshold, true);
  assert.equal(resolveMatchClassification(false, two.score, two.scoreCoverage), true);
});

test('critical requirements influence scores more than preferred requirements', () => {
  const { enrichEvaluation } = loadBackground();
  const profile = { resumeSummary: 'Candidate profile' };
  const criticalMiss = enrichEvaluation({
    is_match: false,
    requirements_assessment: [
      { text: 'Critical requirement', priority: 'critical', matched: false },
      { text: 'Preferred requirement', priority: 'excellent', matched: true }
    ]
  }, { description: 'Requirements' }, profile);
  const preferredMiss = enrichEvaluation({
    is_match: false,
    requirements_assessment: [
      { text: 'Critical requirement', priority: 'critical', matched: true },
      { text: 'Preferred requirement', priority: 'excellent', matched: false }
    ]
  }, { description: 'Requirements' }, profile);
  assert.ok(criticalMiss.reqsScore < preferredMiss.reqsScore);
  for (const score of [criticalMiss.reqsScore, preferredMiss.reqsScore]) assert.ok(score >= 0 && score <= 100);
});

test('resume rewriting rejects missing or whitespace-only profiles without an API call', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error('should not run'); };
  for (const resumeSummary of [undefined, '', '   \n  ']) {
    const { rewriteResume } = loadBackground(fetchImpl, { aiModel: 'anthropic', apiKey: 'key', resumeSummary });
    const result = await rewriteResume({ title: 'Engineer', description: 'Python' });
    assert.equal(result.success, false);
    assert.match(result.error, /Profile section/);
  }
  assert.equal(calls, 0);
});

test('resume rewrite prompt prohibits fabricated facts and preserves stored profile', async () => {
  let requestBody;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'Existing Python engineer.' }] }) };
  };
  const original = 'Python engineer with existing leadership experience.';
  const { rewriteResume, storage } = loadBackground(fetchImpl, {
    aiModel: 'anthropic', apiKey: 'key', resumeSummary: original
  });
  const result = await rewriteResume({ title: 'Lead Engineer', company: 'Example', description: 'Requires Kubernetes' });
  assert.equal(result.success, true);
  assert.equal(result.rewritten, 'Existing Python engineer.');
  assert.equal(storage.resumeSummary, original);
  const prompt = requestBody.messages[0].content;
  assert.match(prompt, /Never invent employers/);
  assert.match(prompt, /Never increase years of experience/);
  assert.match(prompt, /Never convert a job requirement into an assumed candidate qualification/);
});

test('resume rewriting rejects empty AI output and reports API failures', async () => {
  const empty = loadBackground(async () => ({
    ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '   ' }] })
  }), { aiModel: 'anthropic', apiKey: 'key', resumeSummary: 'Python engineer' });
  const emptyResult = await empty.rewriteResume({ title: 'Engineer' });
  assert.equal(emptyResult.success, false);
  assert.match(emptyResult.error, /invalid response|empty resume summary/i);

  const failed = loadBackground(async () => ({ ok: false, status: 500, json: async () => ({}) }), {
    aiModel: 'anthropic', apiKey: 'key', resumeSummary: 'Python engineer'
  });
  const failedResult = await failed.rewriteResume({ title: 'Engineer' });
  assert.equal(failedResult.success, false);
  assert.match(failedResult.error, /temporarily unavailable/);
});

test('Anthropic shared helper serves evaluation, cover letter, and resume rewrite', async () => {
  const requests = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const isEvaluation = Boolean(body.system);
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: isEvaluation
        ? '{"is_match":true,"reasoning":"Match","cover_letter":"","skills_assessment":[],"requirements_assessment":[],"responsibilities_assessment":[]}'
        : 'Generated text' }] })
    };
  };
  const loaded = loadBackground(fetchImpl, {
    aiModel: 'anthropic', apiKey: 'key', resumeSummary: 'Python engineer'
  });
  assert.equal((await loaded.evalWithAnthropic({ title: 'Engineer', description: 'Python' }, { apiKey: 'key', resumeSummary: 'Python engineer' })).success, true);
  assert.equal((await loaded.generateCoverLetter({ title: 'Engineer', company: 'Example', description: 'Python' })).success, true);
  assert.equal((await loaded.rewriteResume({ title: 'Engineer', company: 'Example', description: 'Python' })).success, true);
  assert.equal(requests.length, 3);
  requests.forEach(body => assert.equal(body.model, 'claude-sonnet-5'));
});

test('Anthropic handles rate limits, invalid responses, network errors, and missing keys safely', async () => {
  const rateLimited = loadBackground(async () => ({ ok: false, status: 429, json: async () => ({}) }));
  await assert.rejects(rateLimited.callLLM({ aiModel: 'anthropic', apiKey: 'secret-key' }, 'Generate'), /rate limit/);

  const invalid = loadBackground(async () => ({ ok: true, status: 200, json: async () => ({ content: [] }) }));
  await assert.rejects(invalid.callLLM({ aiModel: 'anthropic', apiKey: 'secret-key' }, 'Generate'), /invalid response/);

  const network = loadBackground(async () => { throw new Error('secret-key transport failure'); });
  await assert.rejects(
    network.callLLM({ aiModel: 'anthropic', apiKey: 'secret-key' }, 'Generate'),
    error => /network request failed/.test(error.message) && !error.message.includes('secret-key')
  );

  const missing = loadBackground();
  await assert.rejects(missing.callLLM({ aiModel: 'anthropic', apiKey: '' }, 'Generate'), /API key is missing/);
});

test('Anthropic handles bad requests and forbidden keys without leaking credentials', async () => {
  for (const [status, pattern] of [[400, /rejected the request/], [403, /authentication failed/]]) {
    const loaded = loadBackground(async () => ({ ok: false, status, json: async () => ({}) }));
    await assert.rejects(
      loaded.callLLM({ aiModel: 'anthropic', apiKey: 'do-not-leak' }, 'Generate'),
      error => pattern.test(error.message) && !error.message.includes('do-not-leak')
    );
  }
});

test('Free shared actions retain Groq to Ollama fallback', async () => {
  const urls = [];
  const loaded = loadBackground(async (url) => {
    urls.push(url);
    if (url.includes('/groq/chat')) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ content: 'Ollama result' }) };
  });
  const result = await loaded.callLLM({ aiModel: 'free', ollamaBackendUrl: 'https://backend.example' }, 'Generate');
  assert.equal(result, 'Ollama result');
  assert.deepEqual(urls, [
    'https://backend.example/api/v1/groq/chat',
    'https://backend.example/api/v1/ollama/chat'
  ]);
});

test('OpenAI and Gemini evaluation paths remain functional with mocked APIs', async () => {
  const openai = loadBackground(async (url) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"is_match":true,"reasoning":"Match"}' } }] })
    };
  });
  assert.equal((await openai.evalWithOpenAI({ title: 'Engineer', description: 'Python' }, { apiKey: 'key', resumeSummary: 'Python' })).success, true);

  const gemini = loadBackground(async (url, options) => {
    assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash/);
    assert.equal(options.headers['x-goog-api-key'], 'key');
    assert.doesNotMatch(url, /[?&]key=/, 'API key must not appear in the URL');
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"is_match":true,"reasoning":"Match"}' }] } }] })
    };
  });
  assert.equal((await gemini.evalWithGeminiAPI({ title: 'Engineer', description: 'Python' }, { apiKey: 'key', resumeSummary: 'Python' })).success, true);
});

test('successful evaluated matches auto-save coverage metadata', async () => {
  const response = {
    is_match: true,
    reasoning: 'Evidence match',
    skills_assessment: [{ text: 'Python', priority: 'critical', matched: true }],
    requirements_assessment: [{ text: 'Python required', priority: 'critical', matched: true }],
    responsibilities_assessment: []
  };
  const loaded = loadBackground(async (url) => {
    assert.match(url, /\/api\/v1\/groq\/chat$/);
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(response) } }] })
    };
  }, { aiModel: 'free', resumeSummary: 'Python engineer', savedJobs: [] });
  const result = await loaded.evaluateJob({ id: '1', title: 'Engineer', company: 'Example', description: 'Python required' });
  assert.equal(result.success, true);
  assert.equal(loaded.storage.savedJobs.length, 1);
  assert.equal(loaded.storage.savedJobs[0].scoreCoverage.assessedDimensions, 2);
  assert.equal(loaded.storage.savedJobs[0].scoreCoverage.status, 'partial');
});

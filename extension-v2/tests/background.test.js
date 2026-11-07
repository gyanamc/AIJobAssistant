const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadBackground(fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({}) })) {
  const storage = {};
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
    callLLM: vm.runInContext('callLLM', context)
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
});

test('scores remain unavailable when there is insufficient evidence', () => {
  const { enrichEvaluation } = loadBackground();
  const result = enrichEvaluation({ is_match: true, reasoning: 'Model guess.' }, { description: '' }, { resumeSummary: '' });
  assert.equal(result.score, null);
  assert.equal(result.skillsScore, null);
  assert.equal(result.reqsScore, null);
  assert.equal(result.respScore, null);
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
  assert.doesNotMatch(request.options.body, /secret-key/);
});

test('Anthropic authentication errors are safe and actionable', async () => {
  const { callLLM } = loadBackground(async () => ({ ok: false, status: 401, json: async () => ({}) }));
  await assert.rejects(
    callLLM({ aiModel: 'anthropic', apiKey: 'secret-key' }, 'Generate'),
    error => /authentication failed/.test(error.message) && !error.message.includes('secret-key')
  );
});

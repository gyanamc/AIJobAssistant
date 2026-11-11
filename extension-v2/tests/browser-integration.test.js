const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('actual side panel enforces consent and renders malicious content safely in Chrome', () => {
  const script = path.join(__dirname, 'browser_integration.py');
  const result = spawnSync('python3', [script], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, `Browser integration failed:\n${result.stdout}\n${result.stderr}`);
});

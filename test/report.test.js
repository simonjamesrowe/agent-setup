'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { renderTable, exitCode } = require('../lib/report.js');

test('renders aligned table with one row per result and a totals line', () => {
  const results = [
    { provisioner: 'skills', item: 'local-env', tool: 'claude', status: 'installed' },
    { provisioner: 'mcp', item: 'playwright', tool: 'claude', status: 'failed', note: 'boom' },
  ];
  const out = renderTable(results);
  assert.match(out, /local-env\s+claude\s+installed/);
  assert.match(out, /playwright\s+claude\s+FAILED\s+boom/);
  assert.match(out, /1 installed.*1 failed/);
});

test('exit code 1 iff any failed', () => {
  assert.strictEqual(exitCode([{ status: 'installed' }]), 0);
  assert.strictEqual(exitCode([{ status: 'failed' }]), 1);
});

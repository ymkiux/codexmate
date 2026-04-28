import assert from 'assert';
import test from 'node:test';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
    buildAutomationEventKey,
    isCronMatch,
    matchAutomationRule,
    readAutomationConfig
} = require('../../lib/automation.js');

test('buildAutomationEventKey derives github event.action', () => {
    const key = buildAutomationEventKey('github', { 'x-github-event': 'issues' }, { action: 'opened' });
    assert.strictEqual(key, 'issues.opened');
});

test('matchAutomationRule supports trailing wildcard', () => {
    const rule = matchAutomationRule({
        rules: [
            { id: 'r1', enabled: true, source: 'github', event: 'issues.*', action: { type: 'task.queue.add' } }
        ],
        notifiers: []
    }, { source: 'github', event: 'issues.opened' });
    assert.ok(rule);
    assert.strictEqual(rule.id, 'r1');
});

test('readAutomationConfig expands env templates in notifier urls', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmate-auto-'));
    const filePath = path.join(tempDir, 'automation.json');
    fs.writeFileSync(filePath, JSON.stringify({
        version: 1,
        rules: [],
        notifiers: [
            { id: 'n1', type: 'webhook', url: '${TEST_WEBHOOK_URL}', events: ['task.completed'] }
        ]
    }), 'utf-8');
    const result = readAutomationConfig(filePath, { env: { TEST_WEBHOOK_URL: 'https://example.com/webhook' } });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.config.notifiers[0].url, 'https://example.com/webhook');
});

test('isCronMatch supports */n minute step', () => {
    const date = new Date('2026-01-01T00:10:00Z');
    assert.strictEqual(isCronMatch('*/5 * * * *', date), true);
    assert.strictEqual(isCronMatch('*/7 * * * *', date), false);
});

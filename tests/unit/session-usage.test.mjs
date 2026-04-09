import assert from 'assert';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logic = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'logic.mjs')));
const { buildUsageChartGroups } = logic;

test('buildUsageChartGroups aggregates codex and claude sessions into day buckets', () => {
    const now = Date.UTC(2026, 3, 6, 12, 0, 0);
    const result = buildUsageChartGroups([
        { source: 'codex', updatedAt: '2026-04-06T08:00:00.000Z', messageCount: 5, cwd: '/a' },
        { source: 'claude', updatedAt: '2026-04-06T09:00:00.000Z', messageCount: 7, cwd: '/a' },
        { source: 'codex', updatedAt: '2026-04-05T09:00:00.000Z', messageCount: 3, cwd: '/b' }
    ], { range: '7d', now });

    assert.strictEqual(result.summary.totalSessions, 3);
    assert.strictEqual(result.summary.totalMessages, 15);
    assert.strictEqual(result.summary.codexTotal, 2);
    assert.strictEqual(result.summary.claudeTotal, 1);
    assert.strictEqual(result.summary.avgMessagesPerSession, 5);
    assert.strictEqual(result.summary.busiestDay.label, '04-06');
    assert.strictEqual(result.summary.busiestDay.totalSessions, 2);
    assert.strictEqual(result.sourceShare.find(item => item.key === 'codex').percent, 67);
    assert.strictEqual(result.sourceShare.find(item => item.key === 'codex').messageTotal, 8);
    assert.strictEqual(result.sourceShare.find(item => item.key === 'claude').avgMessages, 7);
    assert.strictEqual(result.topPaths[0].path, '/a');
    assert.strictEqual(result.topPaths[0].count, 2);
    assert.strictEqual(result.topPaths[0].messageTotal, 12);
    assert.strictEqual(result.recentSessions[0].title, '未命名会话');
    assert.strictEqual(result.recentSessions[0].sourceLabel, 'Claude Code');
    assert.strictEqual(result.topSessionsByMessages[0].messageCount, 7);
    assert.strictEqual(result.hourActivity.find(item => item.key === '09').count, 2);
    assert.strictEqual(result.weekdayActivity.find(item => item.label === '周一').count, 2);
    const lastBucket = result.buckets[result.buckets.length - 1];
    assert.strictEqual(lastBucket.codex, 1);
    assert.strictEqual(lastBucket.claude, 1);
    assert.strictEqual(lastBucket.totalMessages, 12);
});

test('buildUsageChartGroups ignores invalid sessions and keeps empty buckets stable', () => {
    const now = Date.UTC(2026, 3, 6, 12, 0, 0);
    const result = buildUsageChartGroups([
        null,
        { source: 'other', updatedAt: '2026-04-06T08:00:00.000Z', messageCount: 9 },
        { source: 'codex', updatedAt: 'bad-date', messageCount: 2 }
    ], { range: '7d', now });

    assert.strictEqual(result.summary.totalSessions, 0);
    assert.strictEqual(result.summary.totalMessages, 0);
    assert.strictEqual(result.buckets.length, 7);
    assert.ok(result.buckets.every((item) => item.totalSessions === 0));
    assert.ok(result.hourActivity.every((item) => item.count === 0));
    assert.ok(result.weekdayActivity.every((item) => item.count === 0));
    assert.deepStrictEqual(result.recentSessions, []);
});

test('buildUsageChartGroups produces stable unique keys for sessions without ids', () => {
    const now = Date.UTC(2026, 3, 6, 12, 0, 0);
    const result = buildUsageChartGroups([
        { source: 'codex', updatedAt: '2026-04-06T09:00:00.000Z', messageCount: 4 },
        { source: 'codex', updatedAt: '2026-04-06T09:00:00.000Z', messageCount: 4 },
        { source: 'claude', updatedAt: '2026-04-06T09:00:00.000Z', messageCount: 4 }
    ], { range: '7d', now });

    const recentKeys = result.recentSessions.map((item) => item.key);
    const topKeys = result.topSessionsByMessages.map((item) => item.key);

    assert.strictEqual(new Set(recentKeys).size, recentKeys.length);
    assert.strictEqual(new Set(topKeys).size, topKeys.length);
});

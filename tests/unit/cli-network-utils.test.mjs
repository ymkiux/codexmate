import assert from 'assert';
import path from 'path';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const https = require('https');
const { probeJsonPost } = require(path.join(__dirname, '..', '..', 'lib', 'cli-network-utils.js'));

test('probeJsonPost retries with family=4 after a retryable network timeout', async () => {
    const originalRequest = https.request;
    const calls = [];

    try {
        https.request = (parsed, options, callback) => {
            calls.push({
                host: parsed.hostname,
                family: options.family || 0,
                method: options.method
            });

            const req = new EventEmitter();
            req.setTimeout = () => {};
            req.write = () => {};
            req.end = () => {
                process.nextTick(() => {
                    if (!options.family) {
                        req.emit('error', new Error('timeout'));
                        return;
                    }

                    const res = new EventEmitter();
                    res.statusCode = 200;
                    callback(res);
                    process.nextTick(() => {
                        res.emit('data', Buffer.from('{"ok":true}'));
                        res.emit('end');
                    });
                });
            };
            return req;
        };

        const result = await probeJsonPost('https://example.com/responses', { ping: true }, {
            timeoutMs: 1000,
            maxBytes: 1024
        });

        assert.deepStrictEqual(calls, [
            { host: 'example.com', family: 0, method: 'POST' },
            { host: 'example.com', family: 4, method: 'POST' }
        ]);
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.status, 200);
        assert.strictEqual(result.body, '{"ok":true}');
    } finally {
        https.request = originalRequest;
    }
});

test('probeJsonPost supports custom api key header and merges extra headers', async () => {
    const originalRequest = https.request;
    const seenHeaders = [];

    try {
        https.request = (_parsed, options, callback) => {
            seenHeaders.push(options.headers || {});
            const req = new EventEmitter();
            req.setTimeout = () => {};
            req.write = () => {};
            req.end = () => {
                const res = new EventEmitter();
                res.statusCode = 200;
                callback(res);
                process.nextTick(() => {
                    res.emit('data', Buffer.from('{"ok":true}'));
                    res.emit('end');
                });
            };
            return req;
        };

        const result = await probeJsonPost('https://example.com/v1/messages', { ping: true }, {
            apiKey: 'sk-demo',
            apiKeyHeader: 'x-api-key',
            headers: {
                'anthropic-version': '2023-06-01'
            },
            timeoutMs: 1000,
            maxBytes: 1024
        });

        assert.strictEqual(result.ok, true);
        assert.strictEqual(seenHeaders.length, 1);
        assert.strictEqual(seenHeaders[0]['x-api-key'], 'sk-demo');
        assert.strictEqual(seenHeaders[0]['anthropic-version'], '2023-06-01');
        assert.strictEqual(seenHeaders[0].Authorization, undefined);
    } finally {
        https.request = originalRequest;
    }
});

const http = require('http');
const https = require('https');

function probeUrl(targetUrl, options = {}) {
    return new Promise((resolve) => {
        let parsed;
        try {
            parsed = new URL(targetUrl);
        } catch (e) {
            return resolve({ ok: false, error: 'Invalid URL' });
        }

        const transport = parsed.protocol === 'https:' ? https : http;
        const headers = {
            'User-Agent': 'codexmate-health-check',
            'Accept': 'application/json'
        };
        if (options.apiKey) {
            headers['Authorization'] = `Bearer ${options.apiKey}`;
        }

        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 0;
        const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : 256 * 1024;
        const start = Date.now();
        const req = transport.request(parsed, { method: 'GET', headers }, (res) => {
            const chunks = [];
            let size = 0;
            res.on('data', (chunk) => {
                if (!chunk) return;
                size += chunk.length;
                if (size <= maxBytes) {
                    chunks.push(chunk);
                }
            });
            res.on('end', () => {
                const body = chunks.length > 0 ? Buffer.concat(chunks).toString('utf-8') : '';
                resolve({
                    ok: true,
                    status: res.statusCode || 0,
                    durationMs: Date.now() - start,
                    body
                });
            });
        });

        if (timeoutMs > 0) {
            req.setTimeout(timeoutMs, () => {
                req.destroy(new Error('timeout'));
            });
        }

        req.on('error', (err) => {
            resolve({
                ok: false,
                error: err.message || 'request failed',
                durationMs: Date.now() - start
            });
        });

        req.end();
    });
}

function probeJsonPost(targetUrl, body, options = {}) {
    return new Promise((resolve) => {
        let parsed;
        try {
            parsed = new URL(targetUrl);
        } catch (e) {
            return resolve({ ok: false, error: 'Invalid URL' });
        }

        const transport = parsed.protocol === 'https:' ? https : http;
        const headers = {
            'User-Agent': 'codexmate-health-check',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };
        if (options.apiKey) {
            headers['Authorization'] = `Bearer ${options.apiKey}`;
        }

        const payload = JSON.stringify(body || {});
        headers['Content-Length'] = Buffer.byteLength(payload);

        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 0;
        const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : 256 * 1024;
        const start = Date.now();
        const req = transport.request(parsed, { method: 'POST', headers }, (res) => {
            const chunks = [];
            let size = 0;
            res.on('data', (chunk) => {
                if (!chunk) return;
                size += chunk.length;
                if (size <= maxBytes) {
                    chunks.push(chunk);
                }
            });
            res.on('end', () => {
                const bodyText = chunks.length > 0 ? Buffer.concat(chunks).toString('utf-8') : '';
                resolve({
                    ok: true,
                    status: res.statusCode || 0,
                    durationMs: Date.now() - start,
                    body: bodyText
                });
            });
        });

        if (timeoutMs > 0) {
            req.setTimeout(timeoutMs, () => {
                req.destroy(new Error('timeout'));
            });
        }

        req.on('error', (err) => {
            resolve({
                ok: false,
                error: err.message || 'request failed',
                durationMs: Date.now() - start
            });
        });

        req.write(payload);
        req.end();
    });
}

module.exports = {
    probeUrl,
    probeJsonPost
};

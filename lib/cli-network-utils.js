const http = require('http');
const https = require('https');

function shouldRetryWithIpv4(result) {
    if (!result || result.ok || typeof result.error !== 'string') {
        return false;
    }
    return /timeout|timed out|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN/i.test(result.error);
}

function performProbeRequest(transport, parsed, requestOptions, options = {}) {
    return new Promise((resolve) => {
        const start = Date.now();
        const req = transport.request(parsed, requestOptions, (res) => {
            const chunks = [];
            let size = 0;
            res.on('data', (chunk) => {
                if (!chunk) return;
                size += chunk.length;
                if (size <= options.maxBytes) {
                    chunks.push(chunk);
                }
            });
            res.on('end', () => {
                resolve({
                    ok: true,
                    status: res.statusCode || 0,
                    durationMs: Date.now() - start,
                    body: chunks.length > 0 ? Buffer.concat(chunks).toString('utf-8') : ''
                });
            });
        });

        if (options.timeoutMs > 0) {
            req.setTimeout(options.timeoutMs, () => {
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

        if (options.payload) {
            req.write(options.payload);
        }
        req.end();
    });
}

async function probeUrl(targetUrl, options = {}) {
    let parsed;
    try {
        parsed = new URL(targetUrl);
    } catch (e) {
        return { ok: false, error: 'Invalid URL' };
    }

    const protocol = parsed.protocol;
    if (protocol !== 'http:' && protocol !== 'https:') {
        return {
            ok: false,
            error: `ERR_INVALID_PROTOCOL: Protocol "${protocol}" not supported. Expected "http:" or "https:"`
        };
    }

    const transport = protocol === 'https:' ? https : http;
    const headers = {
        'User-Agent': 'codexmate-health-check',
        'Accept': 'application/json'
    };
    if (options.apiKey) {
        headers['Authorization'] = `Bearer ${options.apiKey}`;
    }

    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 0;
    const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : 256 * 1024;
    const requestOptions = {
        method: 'GET',
        headers
    };

    const firstResult = await performProbeRequest(transport, parsed, requestOptions, {
        timeoutMs,
        maxBytes
    });
    if (!shouldRetryWithIpv4(firstResult)) {
        return firstResult;
    }

    const secondResult = await performProbeRequest(transport, parsed, {
        ...requestOptions,
        family: 4
    }, {
        timeoutMs,
        maxBytes
    });
    return secondResult.ok ? secondResult : firstResult;
}

async function probeJsonPost(targetUrl, body, options = {}) {
    let parsed;
    try {
        parsed = new URL(targetUrl);
    } catch (e) {
        return { ok: false, error: 'Invalid URL' };
    }

    const protocol = parsed.protocol;
    if (protocol !== 'http:' && protocol !== 'https:') {
        return {
            ok: false,
            error: `ERR_INVALID_PROTOCOL: Protocol "${protocol}" not supported. Expected "http:" or "https:"`
        };
    }

    const transport = protocol === 'https:' ? https : http;
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
    const requestOptions = {
        method: 'POST',
        headers
    };

    const firstResult = await performProbeRequest(transport, parsed, requestOptions, {
        timeoutMs,
        maxBytes,
        payload
    });
    if (!shouldRetryWithIpv4(firstResult)) {
        return firstResult;
    }

    const secondResult = await performProbeRequest(transport, parsed, {
        ...requestOptions,
        family: 4
    }, {
        timeoutMs,
        maxBytes,
        payload
    });
    return secondResult.ok ? secondResult : firstResult;
}

module.exports = {
    probeUrl,
    probeJsonPost
};

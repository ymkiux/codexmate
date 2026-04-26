const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const { isValidHttpUrl } = require('../lib/cli-utils');
const { MAX_SKILLS_ZIP_UPLOAD_SIZE, importSkillsFromZipFile } = require('./skills');

function resolveGithubArchiveZipUrl(inputUrl) {
    const raw = typeof inputUrl === 'string' ? inputUrl.trim() : '';
    if (!raw) return '';
    let parsed;
    try {
        parsed = new URL(raw);
    } catch (_) {
        return '';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return '';
    }
    if (parsed.hostname !== 'github.com') {
        return '';
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return '';
    const owner = parts[0];
    const repo = (parts[1] || '').endsWith('.git') ? parts[1].slice(0, -4) : parts[1];
    if (!owner || !repo) return '';
    let ref = 'main';
    if (parts[2] === 'tree' && parts[3]) {
        ref = parts[3];
    }
    return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/archive/refs/heads/${encodeURIComponent(ref)}.zip`;
}

function buildGithubArchiveZipCandidates(inputUrl) {
    const raw = typeof inputUrl === 'string' ? inputUrl.trim() : '';
    if (!raw) return [];
    let parsed;
    try {
        parsed = new URL(raw);
    } catch (_) {
        return [];
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return [];
    }
    if (parsed.hostname !== 'github.com') {
        return [];
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return [];
    const owner = parts[0];
    const repo = (parts[1] || '').endsWith('.git') ? parts[1].slice(0, -4) : parts[1];
    if (!owner || !repo) return [];
    const base = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/archive/refs`;
    if (parts[2] === 'tree' && parts[3]) {
        const ref = encodeURIComponent(parts[3]);
        return [
            `${base}/heads/${ref}.zip`,
            `${base}/tags/${ref}.zip`
        ];
    }
    return [
        `${base}/heads/main.zip`,
        `${base}/heads/master.zip`
    ];
}

function redactUrlForLog(inputUrl) {
    const raw = typeof inputUrl === 'string' ? inputUrl.trim() : '';
    if (!raw) return '';
    try {
        const parsed = new URL(raw);
        return `${parsed.origin}${parsed.pathname}`;
    } catch (_) {
        return raw;
    }
}

function extractHttpStatusFromError(err) {
    const message = err && err.message ? String(err.message) : '';
    const matched = message.match(/\bHTTP\s+(\d{3})\b/);
    if (!matched) return 0;
    const value = Number(matched[1]);
    return Number.isFinite(value) ? value : 0;
}

function downloadUrlToFile(targetUrl, filePath, options = {}) {
    const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0
        ? Math.floor(options.maxBytes)
        : MAX_SKILLS_ZIP_UPLOAD_SIZE;
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? Math.floor(options.timeoutMs)
        : 30000;
    const maxRedirects = Number.isFinite(options.maxRedirects) && options.maxRedirects >= 0
        ? Math.floor(options.maxRedirects)
        : 5;

    return new Promise((resolve, reject) => {
        let parsed;
        try {
            parsed = new URL(targetUrl);
        } catch (_) {
            reject(new Error('Invalid URL'));
            return;
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            reject(new Error(`ERR_INVALID_PROTOCOL: Protocol "${parsed.protocol}" not supported. Expected "http:" or "https:"`));
            return;
        }

        const transport = parsed.protocol === 'https:' ? https : http;
        const requestOptions = {
            method: 'GET',
            headers: {
                'User-Agent': 'codexmate-import-skills',
                'Accept': 'application/octet-stream,application/zip,*/*'
            }
        };

        const req = transport.request(parsed, requestOptions, (res) => {
            const status = Number(res.statusCode) || 0;
            const redirectLocation = res.headers && typeof res.headers.location === 'string' ? res.headers.location : '';
            if (status >= 300 && status < 400 && redirectLocation) {
                if (maxRedirects <= 0) {
                    reject(new Error('Too many redirects'));
                    return;
                }
                const nextUrl = redirectLocation.startsWith('http')
                    ? redirectLocation
                    : `${parsed.origin}${redirectLocation}`;
                res.resume();
                downloadUrlToFile(nextUrl, filePath, { maxBytes, timeoutMs, maxRedirects: maxRedirects - 1 })
                    .then(resolve)
                    .catch(reject);
                return;
            }
            if (status < 200 || status >= 300) {
                res.resume();
                reject(new Error(`HTTP ${status}`));
                return;
            }

            const out = fs.createWriteStream(filePath, { flags: 'w' });
            let bytes = 0;
            let finished = false;

            const fail = (err) => {
                if (finished) return;
                finished = true;
                try {
                    out.close();
                } catch (_) {}
                try {
                    fs.unlinkSync(filePath);
                } catch (_) {}
                reject(err);
            };

            res.on('data', (chunk) => {
                if (!chunk || finished) return;
                bytes += chunk.length;
                if (bytes > maxBytes) {
                    req.destroy(new Error('download too large'));
                    res.destroy(new Error('download too large'));
                    fail(new Error('Download too large'));
                }
            });

            res.on('error', fail);
            out.on('error', fail);
            out.on('finish', () => {
                if (finished) return;
                finished = true;
                resolve({ bytes });
            });

            res.pipe(out);
        });

        req.on('error', (err) => {
            reject(new Error(err && err.message ? err.message : 'request failed'));
        });
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error('timeout'));
        });
        req.end();
    });
}

function printImportSkillsUsage() {
    process.stdout.write('\n用法:\n');
    process.stdout.write('  codexmate import-skills <URL> [--target-app codex|claude] [--name <NAME>] [--timeout-ms <MS>]\n');
    process.stdout.write('\n示例:\n');
    process.stdout.write('  codexmate import-skills https://github.com/<owner>/<repo>\n');
    process.stdout.write('  codexmate import-skills https://github.com/<owner>/<repo>/tree/dev\n');
    process.stdout.write('  codexmate import-skills https://github.com/<owner>/<repo>/archive/refs/heads/main.zip\n');
}

function parseImportSkillsCommandArgs(argv = []) {
    const options = {
        url: '',
        targetApp: 'codex',
        name: '',
        timeoutMs: 30000,
        help: false
    };
    let cursor = 0;
    while (cursor < argv.length) {
        const token = String(argv[cursor] || '');
        if (token && !token.startsWith('--') && !options.url) {
            options.url = token.trim();
            cursor += 1;
            continue;
        }
        if (token === '--help' || token === '-h') {
            options.help = true;
            cursor += 1;
            continue;
        }
        if (token === '--target-app') {
            const value = String(argv[cursor + 1] || '').trim().toLowerCase();
            if (!value || value.startsWith('--')) {
                throw new Error('错误: --target-app 需要一个值（codex/claude）');
            }
            options.targetApp = value === 'claude' ? 'claude' : 'codex';
            cursor += 2;
            continue;
        }
        if (token === '--name') {
            const value = String(argv[cursor + 1] || '').trim();
            if (!value || value.startsWith('--')) {
                throw new Error('错误: --name 需要一个值');
            }
            options.name = value;
            cursor += 2;
            continue;
        }
        if (token === '--timeout-ms') {
            const value = Number(argv[cursor + 1]);
            if (!Number.isFinite(value) || value <= 0) {
                throw new Error('错误: --timeout-ms 需要一个正整数');
            }
            options.timeoutMs = Math.floor(value);
            cursor += 2;
            continue;
        }
        cursor += 1;
    }
    return options;
}

async function cmdImportSkills(argv = []) {
    const options = parseImportSkillsCommandArgs(argv);
    if (options.help) {
        printImportSkillsUsage();
        return;
    }
    if (!options.url || options.url.trim().startsWith('--')) {
        printImportSkillsUsage();
        throw new Error('错误: 缺少 URL（例如: https://github.com/<owner>/<repo>/archive/refs/heads/main.zip）');
    }
    const candidates = buildGithubArchiveZipCandidates(options.url);
    if (!candidates.length) {
        const resolvedGithubUrl = resolveGithubArchiveZipUrl(options.url);
        candidates.push(resolvedGithubUrl || options.url);
    }
    const uniqueCandidates = Array.from(new Set(candidates.filter(Boolean)));
    if (!uniqueCandidates.length || !uniqueCandidates.every(isValidHttpUrl)) {
        throw new Error('错误: URL 非法（仅支持 http/https）');
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmate-skills-url-'));
    const zipPath = path.join(tempDir, 'skills.zip');
    let finalUrl = uniqueCandidates[0];
    try {
        let lastError = null;
        for (const candidateUrl of uniqueCandidates) {
            finalUrl = candidateUrl;
            console.log(`\n[Skills] Download: ${redactUrlForLog(candidateUrl)}`);
            try {
                await downloadUrlToFile(candidateUrl, zipPath, {
                    maxBytes: MAX_SKILLS_ZIP_UPLOAD_SIZE,
                    timeoutMs: options.timeoutMs,
                    maxRedirects: 5
                });
                lastError = null;
                break;
            } catch (e) {
                lastError = e;
                if (extractHttpStatusFromError(e) === 404) {
                    continue;
                }
                throw e;
            }
        }
        if (lastError) {
            throw lastError;
        }
        const fallbackName = options.name || path.basename(new URL(finalUrl).pathname) || 'skills.zip';
        const result = await importSkillsFromZipFile(zipPath, {
            tempDir,
            targetApp: options.targetApp,
            fallbackName
        });
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } finally {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
    }
}

module.exports = {
    resolveGithubArchiveZipUrl,
    buildGithubArchiveZipCandidates,
    cmdImportSkills
};

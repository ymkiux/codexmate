const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const { isValidHttpUrl } = require('../lib/cli-utils');
const { MAX_SKILLS_ZIP_UPLOAD_SIZE, importSkillsFromZipFile } = require('./skills');

function decodeUrlPathPart(part) {
    try {
        return decodeURIComponent(part);
    } catch (_) {
        return part;
    }
}

function parseGithubRepoFromUrl(inputUrl) {
    const raw = typeof inputUrl === 'string' ? inputUrl.trim() : '';
    if (!raw) return null;
    let parsed;
    try {
        parsed = new URL(raw);
    } catch (_) {
        return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
    }
    if (parsed.hostname !== 'github.com') {
        return null;
    }
    const parts = parsed.pathname.split('/').filter(Boolean).map(decodeUrlPathPart);
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repoPart = parts[1] || '';
    const repo = repoPart.endsWith('.git') ? repoPart.slice(0, -4) : repoPart;
    if (!owner || !repo) return null;
    const ref = parts[2] === 'tree' && parts[3]
        ? parts.slice(3).join('/')
        : '';
    return { owner, repo, ref };
}

function buildGithubArchiveZipBase(repoInfo) {
    if (!repoInfo || !repoInfo.owner || !repoInfo.repo) return '';
    return `https://github.com/${encodeURIComponent(repoInfo.owner)}/${encodeURIComponent(repoInfo.repo)}/archive/refs`;
}

function encodeGithubRefPath(ref) {
    return String(ref || '')
        .split('/')
        .map(part => encodeURIComponent(part))
        .join('/');
}

function resolveGithubArchiveZipUrl(inputUrl) {
    const repoInfo = parseGithubRepoFromUrl(inputUrl);
    if (!repoInfo) return '';
    const base = buildGithubArchiveZipBase(repoInfo);
    const ref = repoInfo.ref || 'main';
    return `${base}/heads/${encodeGithubRefPath(ref)}.zip`;
}

function buildGithubArchiveZipCandidates(inputUrl) {
    const repoInfo = parseGithubRepoFromUrl(inputUrl);
    if (!repoInfo) return [];
    const base = buildGithubArchiveZipBase(repoInfo);
    if (repoInfo.ref) {
        const ref = encodeGithubRefPath(repoInfo.ref);
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

function isAllowedSkillsRedirectHost(originHost, nextHost) {
    const origin = typeof originHost === 'string' ? originHost.trim().toLowerCase() : '';
    const next = typeof nextHost === 'string' ? nextHost.trim().toLowerCase() : '';
    if (!origin || !next) return false;
    if (origin === next) return true;
    if (process.env.CODEXMATE_ALLOW_SKILLS_REDIRECT === '1') return true;
    if (origin === 'github.com' && next === 'codeload.github.com') return true;
    if (origin === 'github.com' && next.endsWith('.githubusercontent.com')) return true;
    return false;
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
                let originHost = typeof options.originHost === 'string' && options.originHost.trim()
                    ? options.originHost.trim()
                    : parsed.host;
                try {
                    const nextParsed = new URL(nextUrl);
                    if (!isAllowedSkillsRedirectHost(originHost, nextParsed.host)) {
                        res.resume();
                        reject(new Error('Cross-origin redirect is not allowed'));
                        return;
                    }
                } catch (_) {}
                res.resume();
                downloadUrlToFile(nextUrl, filePath, { maxBytes, timeoutMs, maxRedirects: maxRedirects - 1, originHost })
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
        if (token === '--help' || token === '-h') {
            options.help = true;
            cursor += 1;
            continue;
        }
        if (token && !token.startsWith('-') && !options.url) {
            options.url = token.trim();
            cursor += 1;
            continue;
        }
        if (token === '--target-app') {
            const value = String(argv[cursor + 1] || '').trim().toLowerCase();
            if (!value || value.startsWith('-')) {
                throw new Error('错误: --target-app 需要一个值（codex/claude）');
            }
            options.targetApp = value === 'claude' ? 'claude' : 'codex';
            cursor += 2;
            continue;
        }
        if (token === '--name') {
            const value = String(argv[cursor + 1] || '').trim();
            if (!value || value.startsWith('-')) {
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
        if (token.startsWith('-')) {
            throw new Error(`错误: 未知参数: ${token}`);
        }
        throw new Error(`错误: 多余参数: ${token}`);
    }
    return options;
}

async function cmdImportSkills(argv = []) {
    const options = parseImportSkillsCommandArgs(argv);
    if (options.help) {
        printImportSkillsUsage();
        return;
    }
    if (!options.url) {
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
    parseGithubRepoFromUrl,
    resolveGithubArchiveZipUrl,
    buildGithubArchiveZipCandidates,
    cmdImportSkills
};

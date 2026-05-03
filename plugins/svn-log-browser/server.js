const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');
const xml2js = require('xml2js');

const processors = xml2js.processors || {};
const stripPrefix = typeof processors.stripPrefix === 'function' ? processors.stripPrefix : (value) => value;

const CACHE_TTL_MS = 60 * 1000;
const DEFAULT_PAGE_SIZE = 25;
const DEFAULT_PORT = 3000;

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeUrlCandidate(value) {
    const raw = normalizeText(value);
    if (!raw) return '';
    let parsed;
    try {
        parsed = new URL(raw);
    } catch (err) {
        return '';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
}

function buildCacheKey(url, username, password) {
    return `${url}\n${username || ''}\n${password || ''}`;
}

function now() {
    return Date.now();
}

function pickFirst(value) {
    if (!value) return '';
    if (Array.isArray(value)) return pickFirst(value[0]);
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
        if (typeof value._ === 'string') return value._;
        if (typeof value.href === 'string') return value.href;
    }
    return '';
}

function resolveHref(baseUrl, href) {
    const raw = normalizeText(href);
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    try {
        return new URL(raw, baseUrl).toString();
    } catch (err) {
        return '';
    }
}

function extractRevisionFromCheckedIn(href) {
    const match = String(href || '').match(/\/!svn\/ver\/(\d+)\//i);
    if (!match) return 0;
    return Number(match[1]) || 0;
}

function buildBaselineCollectionHref(href, revision) {
    if (!href || !revision) return '';
    return href.replace(/\/!svn\/ver\/\d+\//i, `/!svn/bc/${revision}/`);
}

async function parseXml(xmlText) {
    const parser = new xml2js.Parser({
        explicitArray: false,
        ignoreAttrs: false,
        tagNameProcessors: [stripPrefix],
        attrNameProcessors: [stripPrefix]
    });
    return parser.parseStringPromise(xmlText);
}

async function sendDavRequest(method, url, username, password, headers, body) {
    const response = await axios({
        method,
        url,
        headers: headers || {},
        data: body || '',
        auth: username ? { username, password: password || '' } : undefined,
        validateStatus: () => true,
        maxBodyLength: 25 * 1024 * 1024,
        maxContentLength: 25 * 1024 * 1024,
        timeout: 20000
    });

    const text = typeof response.data === 'string'
        ? response.data
        : Buffer.isBuffer(response.data)
            ? response.data.toString('utf-8')
            : JSON.stringify(response.data || {});

    if (response.status >= 400) {
        const err = new Error(`svn http ${response.status}`);
        err.status = response.status;
        err.body = text.slice(0, 5000);
        throw err;
    }

    return text;
}

async function fetchSvnDavInfo(url, username, password) {
    const body = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<D:propfind xmlns:D="DAV:" xmlns:S="svn:">',
        '  <D:prop>',
        '    <S:repository-root/>',
        '    <S:baseline-relative-path/>',
        '    <D:checked-in/>',
        '    <D:version-controlled-configuration/>',
        '  </D:prop>',
        '</D:propfind>'
    ].join('\n');

    const xmlText = await sendDavRequest('PROPFIND', url, username, password, {
        Depth: '0',
        'Content-Type': 'text/xml; charset=utf-8'
    }, body);

    const parsed = await parseXml(xmlText);
    const multistatus = parsed && (parsed.multistatus || parsed['D:multistatus']);
    const responseNode = multistatus && multistatus.response ? multistatus.response : null;
    const responseItem = Array.isArray(responseNode) ? responseNode[0] : responseNode;
    const propstat = responseItem && responseItem.propstat ? responseItem.propstat : null;
    const propstatItem = Array.isArray(propstat) ? propstat[0] : propstat;
    const prop = propstatItem && propstatItem.prop ? propstatItem.prop : null;

    const repositoryRootRaw = pickFirst(prop && prop['repository-root']);
    const baselineRelativePathRaw = pickFirst(prop && prop['baseline-relative-path']);

    const checkedInHref = resolveHref(url, pickFirst(prop && prop['checked-in'] && prop['checked-in'].href));
    const vccHref = resolveHref(url, pickFirst(prop && prop['version-controlled-configuration'] && prop['version-controlled-configuration'].href));

    const repositoryRoot = resolveHref(url, repositoryRootRaw);
    const baselineRelativePath = normalizeText(baselineRelativePathRaw);

    const revision = extractRevisionFromCheckedIn(checkedInHref);
    const baselineCollection = buildBaselineCollectionHref(checkedInHref, revision);

    return {
        repositoryRoot,
        baselineRelativePath,
        checkedInHref,
        vccHref,
        revision,
        baselineCollection
    };
}

function deriveRelativePath(url, repositoryRoot, baselineRelativePath, checkedInHref) {
    if (baselineRelativePath) {
        return baselineRelativePath.replace(/^\/+/, '');
    }
    if (checkedInHref) {
        const match = String(checkedInHref).match(/\/!svn\/ver\/\d+\/(.+)$/i);
        if (match && match[1]) {
            return String(match[1]).replace(/^\/+/, '');
        }
    }
    if (repositoryRoot) {
        try {
            const root = new URL(repositoryRoot);
            const target = new URL(url);
            if (root.origin === target.origin && target.pathname.startsWith(root.pathname)) {
                const rel = target.pathname.slice(root.pathname.length);
                return rel.replace(/^\/+/, '');
            }
        } catch (err) {}
    }
    try {
        const target = new URL(url);
        return target.pathname.replace(/^\/+/, '');
    } catch (err) {
        return '';
    }
}

async function resolveSvnTarget(url, username, password) {
    const info = await fetchSvnDavInfo(url, username, password);
    const relativePath = deriveRelativePath(url, info.repositoryRoot, info.baselineRelativePath, info.checkedInHref);
    return {
        ...info,
        relativePath
    };
}

function buildLogReportBody(startRevision, endRevision, limit, relativePath) {
    const lines = [
        '<S:log-report xmlns:S="svn:" xmlns:D="DAV:">',
        `  <S:start-revision>${startRevision}</S:start-revision>`,
        `  <S:end-revision>${endRevision}</S:end-revision>`
    ];
    if (limit) {
        lines.push(`  <S:limit>${limit}</S:limit>`);
    }
    lines.push('  <S:discover-changed-paths/>');
    if (relativePath) {
        lines.push(`  <S:path>/${relativePath.replace(/^\/+/, '')}</S:path>`);
    }
    lines.push('</S:log-report>');
    return lines.join('\n');
}

function normalizeChangedPath(pathValue) {
    const raw = normalizeText(pathValue);
    if (!raw) return '';
    return raw.startsWith('/') ? raw : `/${raw}`;
}

function mapChangedPaths(item) {
    const paths = [];
    const defs = [
        { key: 'added-path', action: 'A' },
        { key: 'modified-path', action: 'M' },
        { key: 'deleted-path', action: 'D' },
        { key: 'replaced-path', action: 'R' }
    ];

    for (const def of defs) {
        const entry = item && item[def.key] ? item[def.key] : null;
        const list = Array.isArray(entry) ? entry : entry ? [entry] : [];
        for (const node of list) {
            const pathText = normalizeChangedPath(pickFirst(node));
            if (!pathText) continue;
            const copyFromPath = node && node.$ && typeof node.$['copyfrom-path'] === 'string'
                ? normalizeChangedPath(node.$['copyfrom-path'])
                : '';
            const copyFromRev = node && node.$ && node.$['copyfrom-rev']
                ? Number(node.$['copyfrom-rev']) || 0
                : 0;
            paths.push({
                action: def.action,
                path: pathText,
                copyFromPath,
                copyFromRev
            });
        }
    }

    return paths;
}

function normalizeLogItems(raw) {
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return list
        .map((item) => {
            const revision = Number(pickFirst(item && item['version-name'])) || 0;
            const author = normalizeText(pickFirst(item && item['creator-displayname']));
            const date = normalizeText(pickFirst(item && item.date));
            const message = typeof item === 'object' && item && typeof item.comment === 'string'
                ? item.comment
                : normalizeText(pickFirst(item && item.comment));
            return {
                revision,
                author,
                date,
                message,
                paths: mapChangedPaths(item)
            };
        })
        .filter((item) => item && item.revision);
}

function filterLogsByPath(items, relativePath) {
    const needle = normalizeChangedPath(relativePath);
    if (!needle || needle === '/') return items;
    return items.filter((item) => Array.isArray(item.paths) && item.paths.some((p) => p && typeof p.path === 'string' && (p.path === needle || p.path.startsWith(`${needle}/`))));
}

function pickPaging(payload) {
    const pageSizeCandidate = Number(payload.pageSize || payload.limit || '') || DEFAULT_PAGE_SIZE;
    const pageSize = Math.min(Math.max(pageSizeCandidate, 1), 200);
    const pageCandidate = Number(payload.page || '') || 1;
    const page = Math.min(Math.max(pageCandidate, 1), 10000);
    return { page, pageSize };
}

function loadMaxxConfig() {
    let config = {};
    try {
        config = require('./config');
    } catch (err) {}

    const maxxApiUrl = normalizeText(process.env.MAXX_API_URL || config.maxxApiUrl);
    const maxxApiKey = normalizeText(process.env.MAXX_API_KEY || config.maxxApiKey);
    const maxxModel = normalizeText(process.env.MAXX_MODEL || config.maxxModel);

    return { maxxApiUrl, maxxApiKey, maxxModel };
}

function createApp() {
    const cache = new Map();
    const app = express();

    app.use(cors());
    app.use(bodyParser.json({ limit: '2mb' }));
    app.use(express.static(path.join(__dirname, 'public')));

    app.post('/api/svn/info', async (req, res) => {
        const url = normalizeUrlCandidate(req.body && req.body.url);
        if (!url) return res.status(400).json({ error: 'invalid url' });

        const username = normalizeText(req.body && req.body.username);
        const password = normalizeText(req.body && req.body.password);
        const cacheKey = buildCacheKey(url, username, password);
        const entry = cache.get(cacheKey);
        if (entry && entry.expiresAt > now() && entry.info) {
            return res.json({ ok: true, cached: true, info: entry.info });
        }

        try {
            const resolved = await resolveSvnTarget(url, username, password);
            const info = {
                url,
                repositoryRoot: resolved.repositoryRoot,
                relativePath: resolved.relativePath,
                revision: resolved.revision,
                baselineCollection: resolved.baselineCollection
            };
            cache.set(cacheKey, {
                expiresAt: now() + CACHE_TTL_MS,
                info,
                logs: [],
                logsLimit: 0
            });
            res.json({ ok: true, cached: false, info });
        } catch (err) {
            res.status(502).json({
                error: err && err.message ? err.message : 'svn info failed',
                status: err && err.status ? err.status : undefined
            });
        }
    });

    app.post('/api/svn/logs', async (req, res) => {
        const url = normalizeUrlCandidate(req.body && req.body.url);
        if (!url) return res.status(400).json({ error: 'invalid url' });

        const username = normalizeText(req.body && req.body.username);
        const password = normalizeText(req.body && req.body.password);
        const { page, pageSize } = pickPaging(req.body || {});
        const requestedLimit = page * pageSize;
        const cacheKey = buildCacheKey(url, username, password);
        const entry = cache.get(cacheKey);
        const isFresh = entry && entry.expiresAt > now();
        const cachedInfo = isFresh ? entry.info : null;

        let info = cachedInfo;
        let logs = isFresh ? entry.logs : [];
        let logsLimit = isFresh ? entry.logsLimit : 0;

        try {
            if (!info) {
                const resolved = await resolveSvnTarget(url, username, password);
                info = {
                    url,
                    repositoryRoot: resolved.repositoryRoot,
                    relativePath: resolved.relativePath,
                    revision: resolved.revision,
                    baselineCollection: resolved.baselineCollection
                };
                logs = [];
                logsLimit = 0;
            }

            if (logsLimit < requestedLimit) {
                const targetUrl = info.baselineCollection || url;
                const startRevision = info.revision || 0;
                const body = buildLogReportBody(startRevision, 1, requestedLimit, info.relativePath);

                const xmlText = await sendDavRequest('REPORT', targetUrl, username, password, {
                    'Content-Type': 'text/xml; charset=utf-8'
                }, body);

                const parsed = await parseXml(xmlText);
                const report = parsed && (parsed['log-report'] || parsed['S:log-report']);
                const rawItems = report && report['log-item'] ? report['log-item'] : null;
                const items = normalizeLogItems(rawItems);
                const filtered = info.baselineCollection && !info.repositoryRoot
                    ? filterLogsByPath(items, info.relativePath)
                    : items;

                logs = filtered;
                logsLimit = requestedLimit;
            }

            cache.set(cacheKey, {
                expiresAt: now() + CACHE_TTL_MS,
                info,
                logs,
                logsLimit
            });

            const startIndex = (page - 1) * pageSize;
            const pageItems = logs.slice(startIndex, startIndex + pageSize);
            res.json({
                ok: true,
                cached: isFresh,
                page,
                pageSize,
                items: pageItems,
                total: logs.length
            });
        } catch (err) {
            res.status(502).json({
                error: err && err.message ? err.message : 'svn logs failed',
                status: err && err.status ? err.status : undefined
            });
        }
    });

    app.post('/api/ai/chat', async (req, res) => {
        const { maxxApiUrl, maxxApiKey, maxxModel } = loadMaxxConfig();
        if (!maxxApiUrl || !maxxApiKey) {
            return res.status(400).json({ error: 'missing maxx config' });
        }

        const messages = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
        if (!messages.length) return res.status(400).json({ error: 'missing messages' });

        try {
            const response = await axios.post(maxxApiUrl, {
                model: maxxModel || undefined,
                messages
            }, {
                headers: {
                    Authorization: `Bearer ${maxxApiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000,
                validateStatus: () => true
            });

            if (response.status >= 400) {
                return res.status(502).json({ error: `maxx http ${response.status}` });
            }

            const data = response.data && typeof response.data === 'object' ? response.data : {};
            const content = data && data.choices && data.choices[0] && data.choices[0].message && typeof data.choices[0].message.content === 'string'
                ? data.choices[0].message.content
                : typeof data.output_text === 'string'
                    ? data.output_text
                    : '';

            res.json({ ok: true, content });
        } catch (err) {
            res.status(502).json({ error: err && err.message ? err.message : 'maxx request failed' });
        }
    });

    return app;
}

if (require.main === module) {
    const port = Number(process.env.PORT || DEFAULT_PORT) || DEFAULT_PORT;
    createApp().listen(port, '0.0.0.0', () => {
        process.stdout.write(`listening on http://127.0.0.1:${port}\n`);
    });
}

module.exports = { createApp };

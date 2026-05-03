const xml2js = require('xml2js');
const http = require('http');
const https = require('https');

const processors = xml2js.processors || {};
const stripPrefix = typeof processors.stripPrefix === 'function' ? processors.stripPrefix : (value) => value;

const CACHE_TTL_MS = 60 * 1000;
const DEFAULT_PAGE_SIZE = 25;

const cache = new Map();

function now() {
    return Date.now();
}

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeUrlCandidate(value) {
    const raw = normalizeText(value);
    if (!raw) return '';
    let parsed;
    try {
        parsed = new URL(raw);
    } catch (_) {
        return '';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
}

function buildCacheKey(url, username, password) {
    return `${url}\n${username || ''}\n${password || ''}`;
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
    } catch (_) {
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

function buildBasicAuthHeader(username, password) {
    const user = normalizeText(username);
    if (!user) return '';
    const pass = password == null ? '' : String(password);
    const token = Buffer.from(`${user}:${pass}`, 'utf-8').toString('base64');
    return `Basic ${token}`;
}

async function sendDavRequest(method, url, username, password, headers, body, timeoutMs = 20000) {
    const authHeader = buildBasicAuthHeader(username, password);
    const mergedHeaders = {
        ...headers
    };
    if (authHeader) mergedHeaders.Authorization = authHeader;
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const requestOptions = {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : undefined,
        method,
        path: `${parsed.pathname || '/'}${parsed.search || ''}`,
        headers: mergedHeaders
    };

    return await new Promise((resolve, reject) => {
        const req = client.request(requestOptions, (res) => {
            let text = '';
            res.setEncoding('utf-8');
            res.on('data', (chunk) => {
                text += chunk;
                if (text.length > 25 * 1024 * 1024) {
                    req.destroy(new Error('Response too large'));
                }
            });
            res.on('end', () => {
                if (res.statusCode >= 400) {
                    const err = new Error(`svn http ${res.statusCode}`);
                    err.status = res.statusCode;
                    err.body = text.slice(0, 5000);
                    reject(err);
                    return;
                }
                resolve(text);
            });
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error('Request timeout'));
        });
        if (body) {
            req.write(body);
        }
        req.end();
    });
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
        } catch (_) {}
    }
    try {
        const target = new URL(url);
        return target.pathname.replace(/^\/+/, '');
    } catch (_) {
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
    const safe = payload && typeof payload === 'object' ? payload : {};
    const pageSizeCandidate = Number(safe.pageSize || safe.limit || '') || DEFAULT_PAGE_SIZE;
    const pageSize = Math.min(Math.max(pageSizeCandidate, 1), 200);
    const pageCandidate = Number(safe.page || '') || 1;
    const page = Math.min(Math.max(pageCandidate, 1), 10000);
    return { page, pageSize };
}

async function loadLogs(info, username, password, requestedLimit) {
    const targetUrl = info.baselineCollection || info.url;
    const startRevision = info.revision || 0;
    const body = buildLogReportBody(startRevision, 1, requestedLimit, info.relativePath);
    const xmlText = await sendDavRequest('REPORT', targetUrl, username, password, {
        'Content-Type': 'text/xml; charset=utf-8'
    }, body);
    const parsed = await parseXml(xmlText);
    const report = parsed && (parsed['log-report'] || parsed['S:log-report']);
    const rawItems = report && report['log-item'] ? report['log-item'] : null;
    const items = normalizeLogItems(rawItems);
    return info.baselineCollection && !info.repositoryRoot
        ? filterLogsByPath(items, info.relativePath)
        : items;
}

async function getOrCreateInfo(url, username, password, entry, cacheKey) {
    const isFresh = entry && entry.expiresAt > now();
    if (isFresh && entry.info) {
        return { info: entry.info, isFresh: true };
    }
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
    return { info, isFresh: false };
}

async function getSvnInfo(params) {
    const url = normalizeUrlCandidate(params && params.url);
    if (!url) {
        return { error: 'invalid url' };
    }
    const username = normalizeText(params && params.username);
    const password = normalizeText(params && params.password);
    const cacheKey = buildCacheKey(url, username, password);
    const entry = cache.get(cacheKey);
    const isFresh = entry && entry.expiresAt > now() && entry.info;
    if (isFresh) {
        return { ok: true, cached: true, info: entry.info };
    }
    const { info } = await getOrCreateInfo(url, username, password, entry, cacheKey);
    return { ok: true, cached: false, info };
}

async function getSvnLogs(params) {
    const url = normalizeUrlCandidate(params && params.url);
    if (!url) {
        return { error: 'invalid url' };
    }
    const username = normalizeText(params && params.username);
    const password = normalizeText(params && params.password);
    const { page, pageSize } = pickPaging(params || {});
    const requestedLimit = page * pageSize;
    const cacheKey = buildCacheKey(url, username, password);
    const entry = cache.get(cacheKey);

    const { info, isFresh } = await getOrCreateInfo(url, username, password, entry, cacheKey);
    const cachedEntry = cache.get(cacheKey);
    let logs = cachedEntry && cachedEntry.expiresAt > now() ? cachedEntry.logs : [];
    let logsLimit = cachedEntry && cachedEntry.expiresAt > now() ? cachedEntry.logsLimit : 0;

    if (logsLimit < requestedLimit) {
        logs = await loadLogs(info, username, password, requestedLimit);
        logsLimit = requestedLimit;
    }

    cache.set(cacheKey, {
        expiresAt: now() + CACHE_TTL_MS,
        info,
        logs,
        logsLimit
    });

    const startIndex = (page - 1) * pageSize;
    const items = logs.slice(startIndex, startIndex + pageSize);
    const hasMore = logs.length >= requestedLimit;

    return {
        ok: true,
        cached: isFresh,
        page,
        pageSize,
        hasMore,
        items,
        info
    };
}

module.exports = {
    getSvnInfo,
    getSvnLogs
};

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value, fallback) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (_) {
        return fallback;
    }
}

function normalizeText(value, maxLength = 4000) {
    const text = value === undefined || value === null ? '' : String(value).trim();
    if (!text) return '';
    return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function uniqueStringList(items = []) {
    const list = Array.isArray(items) ? items : [];
    const out = [];
    const seen = new Set();
    for (const item of list) {
        const text = normalizeText(item, 200);
        if (!text || seen.has(text)) continue;
        seen.add(text);
        out.push(text);
    }
    return out;
}

function expandEnvTemplate(value, env = process.env) {
    const text = String(value || '');
    if (!text) return '';
    return text.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => {
        const envValue = env && typeof env[key] === 'string' ? env[key] : '';
        return envValue ? envValue : '';
    });
}

function isPrivateNetworkHost(hostname) {
    const host = typeof hostname === 'string' ? hostname.trim().toLowerCase() : '';
    if (!host) return true;
    if (host === 'localhost') return true;
    const ipVer = net.isIP(host);
    if (!ipVer) return false;
    if (ipVer === 4) {
        const parts = host.split('.').map((x) => parseInt(x, 10));
        if (parts.length !== 4 || parts.some((x) => !Number.isFinite(x))) return true;
        const [a, b] = parts;
        if (a === 10) return true;
        if (a === 127) return true;
        if (a === 169 && b === 254) return true;
        if (a === 192 && b === 168) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        return false;
    }
    if (ipVer === 6) {
        if (host === '::1') return true;
        if (host.startsWith('fe80:')) return true;
        if (host.startsWith('fc') || host.startsWith('fd')) return true;
        return false;
    }
    return false;
}

function readAutomationConfig(configPath, options = {}) {
    const filePath = typeof configPath === 'string' ? configPath.trim() : '';
    if (!filePath) {
        return { ok: true, exists: false, config: createDefaultAutomationConfig() };
    }
    if (!fs.existsSync(filePath)) {
        return { ok: true, exists: false, config: createDefaultAutomationConfig() };
    }
    let raw = '';
    try {
        raw = fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
        return { ok: false, error: error && error.message ? error.message : 'failed to read automation config', exists: true };
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        return { ok: false, error: error && error.message ? error.message : 'invalid automation config json', exists: true };
    }
    const normalized = normalizeAutomationConfig(parsed, options);
    return { ok: true, exists: true, config: normalized };
}

function createDefaultAutomationConfig() {
    return {
        version: 1,
        rules: [],
        schedules: [],
        notifiers: []
    };
}

function normalizeAutomationRule(rule = {}) {
    const item = isPlainObject(rule) ? rule : {};
    return {
        id: normalizeText(item.id, 120),
        enabled: item.enabled !== false,
        source: normalizeText(item.source, 40).toLowerCase(),
        event: normalizeText(item.event, 120).toLowerCase(),
        action: cloneJson(isPlainObject(item.action) ? item.action : {}, {})
    };
}

function normalizeAutomationSchedule(schedule = {}) {
    const item = isPlainObject(schedule) ? schedule : {};
    return {
        id: normalizeText(item.id, 120),
        enabled: item.enabled !== false,
        cron: normalizeText(item.cron, 120),
        action: cloneJson(isPlainObject(item.action) ? item.action : {}, {})
    };
}

function normalizeAutomationNotifier(notifier = {}, options = {}) {
    const item = isPlainObject(notifier) ? notifier : {};
    const env = options.env || process.env;
    const url = normalizeText(item.url, 800);
    const normalizedUrl = url ? expandEnvTemplate(url, env) : '';
    return {
        id: normalizeText(item.id, 120),
        enabled: item.enabled !== false,
        type: normalizeText(item.type, 40).toLowerCase(),
        url: normalizedUrl,
        events: uniqueStringList(item.events || []).map((value) => value.toLowerCase()),
        headers: cloneJson(isPlainObject(item.headers) ? item.headers : {}, {})
    };
}

function normalizeAutomationConfig(config = {}, options = {}) {
    const base = isPlainObject(config) ? config : {};
    const defaults = createDefaultAutomationConfig();
    const rawRules = Array.isArray(base.rules) ? base.rules : [];
    const rawSchedules = Array.isArray(base.schedules) ? base.schedules : [];
    const rawNotifiers = Array.isArray(base.notifiers) ? base.notifiers : [];
    return {
        version: Number.isFinite(base.version) ? base.version : defaults.version,
        rules: rawRules.map(normalizeAutomationRule).filter((rule) => rule.id && rule.source && rule.event),
        schedules: rawSchedules.map(normalizeAutomationSchedule).filter((item) => item.id && item.cron),
        notifiers: rawNotifiers.map((item) => normalizeAutomationNotifier(item, options)).filter((item) => item.id && item.type)
    };
}

function matchAutomationRule(config = {}, event = {}) {
    const cfg = isPlainObject(config) ? config : createDefaultAutomationConfig();
    const source = normalizeText(event.source, 40).toLowerCase();
    const eventKey = normalizeText(event.event, 120).toLowerCase();
    if (!source || !eventKey) return null;
    const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
    for (const rule of rules) {
        if (!rule || rule.enabled === false) continue;
        if (rule.source !== source) continue;
        const pattern = rule.event;
        if (!pattern) continue;
        if (pattern.endsWith('*')) {
            const prefix = pattern.slice(0, -1);
            if (eventKey.startsWith(prefix)) return rule;
            continue;
        }
        if (pattern === eventKey) return rule;
    }
    return null;
}

function buildAutomationEventKey(source, headers = {}, payload = {}) {
    const src = normalizeText(source, 40).toLowerCase();
    const hdr = isPlainObject(headers) ? headers : {};
    const body = isPlainObject(payload) ? payload : {};
    if (!src) return '';

    if (src === 'github') {
        const eventName = normalizeText(hdr['x-github-event'] || hdr['X-GitHub-Event'], 80).toLowerCase();
        const action = normalizeText(body.action, 80).toLowerCase();
        if (!eventName) return '';
        return action ? `${eventName}.${action}` : eventName;
    }

    if (src === 'gitlab') {
        const eventName = normalizeText(hdr['x-gitlab-event'] || hdr['X-Gitlab-Event'], 120).toLowerCase();
        const kind = normalizeText(body.object_kind || body.event_type, 120).toLowerCase();
        const action = normalizeText(body.action, 80).toLowerCase();
        const base = kind || eventName;
        if (!base) return '';
        return action ? `${base}.${action}` : base;
    }

    const fallback = normalizeText(
        hdr['x-event'] || hdr['X-Event'] || hdr['x-codexmate-event'] || hdr['X-Codexmate-Event'],
        120
    ).toLowerCase();
    return fallback;
}

function httpPostJson(url, payload, headers = {}, options = {}) {
    const target = normalizeText(url, 800);
    if (!target) {
        return Promise.resolve({ ok: false, error: 'url is required' });
    }
    let parsed;
    try {
        parsed = new URL(target);
    } catch (_) {
        return Promise.resolve({ ok: false, error: 'invalid url' });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return Promise.resolve({ ok: false, error: 'invalid url protocol' });
    }
    const allowPrivate = process.env.CODEXMATE_ALLOW_AUTOMATION_PRIVATE_NETWORK === '1';
    if (!allowPrivate && isPrivateNetworkHost(parsed.hostname || '')) {
        return Promise.resolve({ ok: false, error: 'refusing to post to private network url' });
    }
    const transport = parsed.protocol === 'http:' ? http : https;
    const data = Buffer.from(JSON.stringify(payload || {}), 'utf-8');
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(200, Math.floor(options.timeoutMs)) : 4000;
    const requestOptions = {
        method: 'POST',
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
        path: `${parsed.pathname || '/'}${parsed.search || ''}`,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': data.length,
            ...headers
        }
    };
    return new Promise((resolve) => {
        const req = transport.request(requestOptions, (res) => {
            let body = '';
            res.setEncoding('utf-8');
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                resolve({
                    ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
                    statusCode: res.statusCode || 0,
                    body: body.slice(0, 2000)
                });
            });
        });
        req.on('error', (error) => {
            resolve({ ok: false, error: error && error.message ? error.message : 'request failed' });
        });
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error('timeout'));
        });
        req.write(data);
        req.end();
    });
}

function parseCronPart(part, min, max) {
    const text = normalizeText(part, 120);
    if (!text) return null;
    if (text === '*') return { any: true };
    if (text.startsWith('*/')) {
        const step = Number.parseInt(text.slice(2), 10);
        if (!Number.isFinite(step) || step <= 0) return null;
        return { step };
    }
    const list = text.split(',').map((chunk) => chunk.trim()).filter(Boolean);
    if (list.length === 0) return null;
    const ranges = [];
    for (const item of list) {
        if (item.includes('-')) {
            const [rawStart, rawEnd] = item.split('-', 2);
            const start = Number.parseInt(rawStart, 10);
            const end = Number.parseInt(rawEnd, 10);
            if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
            ranges.push({ start, end });
            continue;
        }
        const value = Number.parseInt(item, 10);
        if (!Number.isFinite(value)) return null;
        ranges.push({ start: value, end: value });
    }
    return { ranges, min, max };
}

function cronPartMatches(spec, value) {
    if (!spec) return false;
    if (spec.any) return true;
    if (spec.step) {
        return value % spec.step === 0;
    }
    const ranges = Array.isArray(spec.ranges) ? spec.ranges : [];
    for (const range of ranges) {
        const start = Number.isFinite(range.start) ? range.start : NaN;
        const end = Number.isFinite(range.end) ? range.end : NaN;
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
        const normalizedStart = Math.min(start, end);
        const normalizedEnd = Math.max(start, end);
        if (value >= normalizedStart && value <= normalizedEnd) {
            return true;
        }
    }
    return false;
}

function isCronMatch(expr, date = new Date()) {
    const text = normalizeText(expr, 120);
    if (!text) return false;
    const parts = text.split(/\s+/g).filter(Boolean);
    if (parts.length !== 5) return false;
    const [minExpr, hourExpr, domExpr, monExpr, dowExpr] = parts;
    const minute = date.getMinutes();
    const hour = date.getHours();
    const dom = date.getDate();
    const month = date.getMonth() + 1;
    const dow = date.getDay();
    const minSpec = parseCronPart(minExpr, 0, 59);
    const hourSpec = parseCronPart(hourExpr, 0, 23);
    const domSpec = parseCronPart(domExpr, 1, 31);
    const monSpec = parseCronPart(monExpr, 1, 12);
    const dowSpecRaw = parseCronPart(dowExpr, 0, 7);
    const dowValue = dow;
    if (!minSpec || !hourSpec || !domSpec || !monSpec || !dowSpecRaw) return false;
    const dowSpec = dowSpecRaw.step || dowSpecRaw.any ? dowSpecRaw : {
        ...dowSpecRaw,
        ranges: (dowSpecRaw.ranges || []).map((range) => ({
            start: range.start === 7 ? 0 : range.start,
            end: range.end === 7 ? 0 : range.end
        }))
    };
    return cronPartMatches(minSpec, minute)
        && cronPartMatches(hourSpec, hour)
        && cronPartMatches(domSpec, dom)
        && cronPartMatches(monSpec, month)
        && cronPartMatches(dowSpec, dowValue);
}

function formatTaskRunNotificationPayload(detail = {}) {
    const base = isPlainObject(detail) ? detail : {};
    const run = isPlainObject(base.run) ? base.run : {};
    const nodes = Array.isArray(run.nodes) ? run.nodes : [];
    return {
        kind: 'task-run',
        runId: base.runId || '',
        taskId: base.taskId || '',
        title: base.title || '',
        target: base.target || '',
        engine: base.engine || '',
        allowWrite: base.allowWrite === true,
        dryRun: base.dryRun === true,
        status: run.status || base.status || '',
        startedAt: run.startedAt || base.startedAt || '',
        endedAt: run.endedAt || base.endedAt || '',
        durationMs: run.durationMs || 0,
        summary: run.summary || base.summary || '',
        error: run.error || base.error || '',
        nodes: nodes.map((node) => ({
            id: node.id || '',
            kind: node.kind || '',
            status: node.status || '',
            attemptCount: node.attemptCount || 0,
            summary: node.summary || '',
            error: node.error || ''
        }))
    };
}

async function dispatchAutomationNotifiers(config, eventType, payload) {
    const cfg = isPlainObject(config) ? config : createDefaultAutomationConfig();
    const normalizedEvent = normalizeText(eventType, 80).toLowerCase();
    if (!normalizedEvent) return [];
    const out = [];
    const notifiers = Array.isArray(cfg.notifiers) ? cfg.notifiers : [];
    for (const notifier of notifiers) {
        if (!notifier || notifier.enabled === false) continue;
        const events = Array.isArray(notifier.events) ? notifier.events : [];
        if (events.length > 0 && !events.includes(normalizedEvent)) {
            continue;
        }
        if (notifier.type === 'webhook') {
            out.push({
                id: notifier.id,
                type: notifier.type,
                ...(await httpPostJson(notifier.url, payload, notifier.headers || {}))
            });
        }
    }
    return out;
}

module.exports = {
    createDefaultAutomationConfig,
    normalizeAutomationConfig,
    readAutomationConfig,
    matchAutomationRule,
    buildAutomationEventKey,
    isCronMatch,
    dispatchAutomationNotifiers,
    formatTaskRunNotificationPayload
};

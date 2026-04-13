const browserLocation = typeof location !== 'undefined' ? location : null;

export const API_BASE = (browserLocation && browserLocation.origin && browserLocation.origin !== 'null')
    ? browserLocation.origin
    : 'http://localhost:3737';

async function postApi(action, params = {}) {
    return await fetch(`${API_BASE}/api`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, params })
    });
}

function buildApiResponseContext(action, res, contentType) {
    return `${action} (${res.status} ${res.statusText}, content-type: ${contentType || 'unknown'})`;
}

function formatUnexpectedApiBodySnippet(body, contentType) {
    const raw = typeof body === 'string' ? body.trim() : '';
    if (!raw) {
        return '';
    }
    const normalizedContentType = String(contentType || '').toLowerCase();
    const looksLikeHtml = normalizedContentType.includes('text/html')
        || /<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]/i.test(raw);
    if (looksLikeHtml) {
        return '';
    }
    const singleLine = raw.replace(/\s+/g, ' ').trim();
    if (!singleLine) {
        return '';
    }
    return singleLine.length > 200
        ? `${singleLine.slice(0, 197)}...`
        : singleLine;
}

function withPayloadTooLargeErrorCode(res, payload) {
    if (res.status !== 413 || (payload && typeof payload === 'object' && payload.errorCode)) {
        return payload;
    }
    return { ...payload, errorCode: 'payload-too-large' };
}

export async function api(action, params = {}) {
    const res = await postApi(action, params);
    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.includes('application/json')) {
        const body = await res.text();
        const errorDetails = buildApiResponseContext(action, res, contentType);
        const bodySnippet = formatUnexpectedApiBodySnippet(body, contentType);
        const bodyDetails = bodySnippet ? `: ${bodySnippet}` : '';
        throw new Error(`Unexpected non-JSON API response for ${errorDetails}${bodyDetails}`);
    }
    try {
        return await res.json();
    } catch (error) {
        const errorDetails = buildApiResponseContext(action, res, contentType);
        throw new Error(`Failed to parse API response for ${errorDetails}: ${error.message}`);
    }
}

export async function apiWithMeta(action, params = {}) {
    const res = await postApi(action, params);
    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
        try {
            const payload = await res.json();
            if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
                return { ...withPayloadTooLargeErrorCode(res, payload), ok: res.ok, status: res.status };
            }
            return res.status === 413
                ? { ok: res.ok, status: res.status, data: payload, errorCode: 'payload-too-large' }
                : { ok: res.ok, status: res.status, data: payload };
        } catch (error) {
            if (res.status === 413) {
                return { ok: false, status: 413, errorCode: 'payload-too-large' };
            }
            throw error;
        }
    }
    const error = await res.text();
    return {
        ok: res.ok,
        status: res.status,
        error,
        errorCode: res.status === 413 ? 'payload-too-large' : ''
    };
}

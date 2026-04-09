const browserLocation = typeof location !== 'undefined' ? location : null;

export const API_BASE = (browserLocation && browserLocation.origin && browserLocation.origin !== 'null')
    ? browserLocation.origin
    : 'http://localhost:3737';

function createApiFetchSignal(options = {}) {
    const timeoutMs = Number(options.timeoutMs);
    const externalSignal = options.signal;
    const supportsAbort = typeof AbortController !== 'undefined';
    if (!supportsAbort && !externalSignal) {
        return {
            signal: undefined,
            cleanup() {},
            didTimeout() {
                return false;
            }
        };
    }

    const controller = supportsAbort ? new AbortController() : null;
    let timeoutId = null;
    let didTimeout = false;
    let detachExternalAbort = null;

    if (controller && externalSignal) {
        const abortFromExternal = () => {
            try {
                controller.abort(externalSignal.reason);
            } catch (_) {
                controller.abort();
            }
        };
        if (externalSignal.aborted) {
            abortFromExternal();
        } else if (typeof externalSignal.addEventListener === 'function') {
            externalSignal.addEventListener('abort', abortFromExternal, { once: true });
            detachExternalAbort = () => {
                try {
                    externalSignal.removeEventListener('abort', abortFromExternal);
                } catch (_) {}
            };
        }
    }

    if (controller && Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timeoutId = setTimeout(() => {
            didTimeout = true;
            try {
                controller.abort(new Error(`API request timed out after ${Math.floor(timeoutMs)}ms`));
            } catch (_) {
                controller.abort();
            }
        }, Math.floor(timeoutMs));
    }

    return {
        signal: controller ? controller.signal : externalSignal,
        cleanup() {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
            }
            if (detachExternalAbort) {
                detachExternalAbort();
            }
        },
        didTimeout() {
            return didTimeout;
        }
    };
}

async function postApi(action, params = {}, options = {}) {
    const fetchControl = createApiFetchSignal(options);
    try {
        return await fetch(`${API_BASE}/api`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, params }),
            signal: fetchControl.signal
        });
    } catch (error) {
        if (fetchControl.didTimeout()) {
            const timeoutMs = Math.max(1, Math.floor(Number(options.timeoutMs) || 0));
            throw new Error(`API request timed out for ${action} after ${timeoutMs}ms`);
        }
        throw error;
    } finally {
        fetchControl.cleanup();
    }
}

function buildApiResponseContext(action, res, contentType) {
    return `${action} (${res.status} ${res.statusText}, content-type: ${contentType || 'unknown'})`;
}

function withPayloadTooLargeErrorCode(res, payload) {
    if (res.status !== 413 || (payload && typeof payload === 'object' && payload.errorCode)) {
        return payload;
    }
    return { ...payload, errorCode: 'payload-too-large' };
}

export async function api(action, params = {}, options = {}) {
    const res = await postApi(action, params, options);
    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.includes('application/json')) {
        const body = await res.text();
        const errorDetails = buildApiResponseContext(action, res, contentType);
        const bodyDetails = body ? `: ${body}` : '';
        throw new Error(`Unexpected non-JSON API response for ${errorDetails}${bodyDetails}`);
    }
    try {
        return await res.json();
    } catch (error) {
        const errorDetails = buildApiResponseContext(action, res, contentType);
        throw new Error(`Failed to parse API response for ${errorDetails}: ${error.message}`);
    }
}

export async function apiWithMeta(action, params = {}, options = {}) {
    const res = await postApi(action, params, options);
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

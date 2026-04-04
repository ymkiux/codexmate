export const API_BASE = (location && location.origin && location.origin !== 'null')
    ? location.origin
    : 'http://localhost:3737';

async function postApi(action, params = {}) {
    return await fetch(`${API_BASE}/api`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, params })
    });
}

export async function api(action, params = {}) {
    const res = await postApi(action, params);
    return await res.json();
}

export async function apiWithMeta(action, params = {}) {
    const res = await postApi(action, params);
    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
        try {
            const payload = await res.json();
            if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
                return { ...payload, ok: res.ok, status: res.status };
            }
            return { ok: res.ok, status: res.status, data: payload };
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

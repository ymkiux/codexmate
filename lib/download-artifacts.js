const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_DOWNLOAD_ARTIFACT_TTL_MS = 10 * 60 * 1000;
const MAX_DOWNLOAD_ARTIFACTS = 200;
const g_downloadArtifacts = new Map();

function registerDownloadArtifact(filePath, options = {}) {
    const token = crypto.randomBytes(16).toString('hex');
    const fileName = typeof options.fileName === 'string' && options.fileName.trim()
        ? options.fileName.trim()
        : path.basename(filePath || '');
    const ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs > 0
        ? Math.floor(options.ttlMs)
        : DEFAULT_DOWNLOAD_ARTIFACT_TTL_MS;
    const expiresAt = Date.now() + ttlMs;
    const deleteAfterDownload = options.deleteAfterDownload !== false;

    g_downloadArtifacts.set(token, {
        filePath,
        fileName,
        deleteAfterDownload,
        expiresAt
    });

    while (g_downloadArtifacts.size > MAX_DOWNLOAD_ARTIFACTS) {
        const firstKey = g_downloadArtifacts.keys().next().value;
        if (!firstKey) break;
        const evicted = g_downloadArtifacts.get(firstKey);
        g_downloadArtifacts.delete(firstKey);
        if (evicted && evicted.deleteAfterDownload && evicted.filePath && fs.existsSync(evicted.filePath)) {
            try {
                fs.unlinkSync(evicted.filePath);
            } catch (_) {}
        }
    }

    const timer = setTimeout(() => {
        const artifact = g_downloadArtifacts.get(token);
        if (!artifact) return;
        if (Date.now() < artifact.expiresAt) return;
        g_downloadArtifacts.delete(token);
        if (artifact.deleteAfterDownload && artifact.filePath && fs.existsSync(artifact.filePath)) {
            try {
                fs.unlinkSync(artifact.filePath);
            } catch (_) {}
        }
    }, ttlMs + 2000);
    if (timer && typeof timer.unref === 'function') {
        timer.unref();
    }

    return {
        token,
        fileName,
        downloadPath: `/download/${encodeURIComponent(token)}`
    };
}

function resolveDownloadArtifact(tokenOrFileName, options = {}) {
    if (!tokenOrFileName) return null;
    const token = typeof tokenOrFileName === 'string' ? tokenOrFileName.trim() : '';
    if (!token) return null;

    const artifact = g_downloadArtifacts.get(token);
    if (!artifact) {
        return null;
    }
    if (Date.now() > artifact.expiresAt) {
        g_downloadArtifacts.delete(token);
        if (artifact.deleteAfterDownload && artifact.filePath && fs.existsSync(artifact.filePath)) {
            try {
                fs.unlinkSync(artifact.filePath);
            } catch (_) {}
        }
        return null;
    }
    if (options && options.consume === true) {
        g_downloadArtifacts.delete(token);
    }
    return {
        token,
        ...artifact
    };
}

module.exports = {
    DEFAULT_DOWNLOAD_ARTIFACT_TTL_MS,
    registerDownloadArtifact,
    resolveDownloadArtifact
};

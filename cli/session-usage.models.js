const { createConcurrencyLimiter } = require('./session-usage.concurrent');

function isConcreteSessionModelName(value) {
    if (typeof value !== 'string') {
        return false;
    }
    const normalized = value.trim();
    if (!normalized) {
        return false;
    }
    return normalized.toLowerCase() !== '<synthetic>';
}

function normalizeSessionModelList(values = []) {
    const models = [];
    for (const value of values) {
        if (!isConcreteSessionModelName(value)) {
            continue;
        }
        const normalized = value.trim();
        if (models.includes(normalized)) {
            continue;
        }
        models.push(normalized);
    }
    return models;
}

function extractModelsFromJsonlText(content) {
    const models = [];
    const pushModel = (value) => {
        if (!isConcreteSessionModelName(value)) {
            return;
        }
        const normalized = value.trim();
        if (models.includes(normalized)) {
            return;
        }
        models.push(normalized);
    };

    if (typeof content !== 'string' || !content) {
        return models;
    }

    // 性能优化：避免逐行 JSON.parse（CPU 重），改为正则扫描提取常见 model 字段。
    const modelKeyRegex = /"(?:model|model_name|model_id|modelId|modelName|model_slug|modelSlug)"\s*:\s*"([^"\r\n]+)"/g;
    for (const match of content.matchAll(modelKeyRegex)) {
        pushModel(match[1]);
    }

    const modelsArrayRegex = /"models"\s*:\s*\[([^\]]{0,5000})\]/g;
    for (const match of content.matchAll(modelsArrayRegex)) {
        const chunk = match[1] || '';
        for (const item of chunk.matchAll(/"([^"\r\n]+)"/g)) {
            pushModel(item[1]);
        }
    }

    return models;
}

function createSessionModelsFileReader(fs, options = {}) {
    const cache = new Map();
    const maxEntries = Number.isFinite(Number(options.maxEntries))
        ? Math.max(50, Math.floor(Number(options.maxEntries)))
        : 500;
    const maxConcurrency = Number.isFinite(Number(options.concurrency))
        ? Math.max(1, Math.floor(Number(options.concurrency)))
        : 8;
    const probeHeadBytes = Number.isFinite(Number(options.probeHeadBytes))
        ? Math.max(1024, Math.floor(Number(options.probeHeadBytes)))
        : 128 * 1024;
    const probeTailBytes = Number.isFinite(Number(options.probeTailBytes))
        ? Math.max(1024, Math.floor(Number(options.probeTailBytes)))
        : 128 * 1024;
    const limitIo = createConcurrencyLimiter(maxConcurrency);

    async function readSessionModelsFromFile(filePath) {
        const targetPath = typeof filePath === 'string' ? filePath.trim() : '';
        if (!targetPath) {
            return [];
        }

        let stat = null;
        try {
            stat = await fs.promises.stat(targetPath);
        } catch (_) {
            stat = null;
        }
        if (!stat) {
            return [];
        }

        const cacheKey = `${targetPath}:${stat.size}:${stat.mtimeMs}`;
        if (cache.has(cacheKey)) {
            const cached = cache.get(cacheKey);
            try {
                const resolved = await Promise.resolve(cached);
                return Array.isArray(resolved) ? [...resolved] : [];
            } catch (_) {
                cache.delete(cacheKey);
                return [];
            }
        }

        const loadPromise = limitIo(async () => {
            // I/O 优化：先只读头/尾小片段；命中模型名则不读全文件
            let handle = null;
            try {
                handle = await fs.promises.open(targetPath, 'r');
                const size = Number.isFinite(Number(stat.size)) ? Number(stat.size) : 0;
                const headSize = Math.min(size, probeHeadBytes);
                const tailSize = Math.min(size, probeTailBytes);

                const headBuffer = Buffer.alloc(headSize);
                if (headSize > 0) {
                    await handle.read(headBuffer, 0, headSize, 0);
                }

                const tailOffset = Math.max(0, size - tailSize);
                const tailBuffer = Buffer.alloc(tailSize);
                if (tailSize > 0) {
                    await handle.read(tailBuffer, 0, tailSize, tailOffset);
                }

                const probeText = `${headBuffer.toString('utf8')}\n${tailBuffer.toString('utf8')}`;
                const probed = extractModelsFromJsonlText(probeText);
                if (probed.length > 0) {
                    return probed;
                }
            } catch (_) {
                // ignore and fall back
            } finally {
                if (handle) {
                    try { await handle.close(); } catch (_) {}
                }
            }

            // 兜底：读全文件（CPU/IO 重），仅在头/尾未命中时触发
            let content = '';
            try {
                content = await fs.promises.readFile(targetPath, 'utf-8');
            } catch (_) {
                return [];
            }
            return extractModelsFromJsonlText(content);
        });

        cache.set(cacheKey, loadPromise);
        let models = [];
        try {
            models = await loadPromise;
        } catch (_) {
            models = [];
        }
        cache.set(cacheKey, models);
        if (cache.size > maxEntries) {
            const firstKey = cache.keys().next().value;
            if (firstKey) cache.delete(firstKey);
        }
        return [...models];
    }

    return {
        readSessionModelsFromFile
    };
}

module.exports = {
    isConcreteSessionModelName,
    normalizeSessionModelList,
    extractModelsFromJsonlText,
    createSessionModelsFileReader
};


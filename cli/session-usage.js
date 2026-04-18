function createConcurrencyLimiter(maxConcurrency) {
    const max = Number.isFinite(Number(maxConcurrency)) ? Math.max(1, Math.floor(Number(maxConcurrency))) : 8;
    let active = 0;
    const queue = [];
    const next = () => {
        const resolve = queue.shift();
        if (resolve) resolve();
    };
    return async (task) => {
        if (active >= max) {
            await new Promise((resolve) => queue.push(resolve));
        }
        active += 1;
        try {
            return await task();
        } finally {
            active -= 1;
            next();
        }
    };
}

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
    const maxEntries = Number.isFinite(Number(options.maxEntries)) ? Math.max(50, Math.floor(Number(options.maxEntries))) : 500;
    const maxConcurrency = Number.isFinite(Number(options.concurrency)) ? Math.max(1, Math.floor(Number(options.concurrency))) : 8;
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

async function listSessionUsageCore(params = {}, deps = {}) {
    const {
        fs,
        listSessionBrowse,
        parseCodexSessionSummary,
        parseClaudeSessionSummary,
        MAX_SESSION_USAGE_LIST_SIZE,
        SESSION_BROWSE_SUMMARY_READ_BYTES
    } = deps;

    const source = params.source === 'codex' || params.source === 'claude'
        ? params.source
        : 'all';
    const rawLimit = Number(params.limit);
    const limit = Number.isFinite(rawLimit)
        ? Math.max(1, Math.min(rawLimit, MAX_SESSION_USAGE_LIST_SIZE))
        : MAX_SESSION_USAGE_LIST_SIZE;

    const sessions = await listSessionBrowse({
        source,
        limit,
        forceRefresh: !!params.forceRefresh
    });
    if (!Array.isArray(sessions) || sessions.length === 0) {
        return [];
    }

    const { readSessionModelsFromFile } = createSessionModelsFileReader(fs, { concurrency: 16, maxEntries: 1000 });

    // CPU/IO 优化策略（面向 2000 会话）：
    // 1) 优先使用 listSessionBrowse 返回的 model/models（零 I/O）
    // 2) 仅当缺少模型名时才读取/解析文件（必要时全文件扫描）
    const limitNormalize = createConcurrencyLimiter(32);
    const normalizedSessions = await Promise.all(
        sessions.map((item) => limitNormalize(async () => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                return null;
            }
            const normalized = { ...item };
            delete normalized.__messageCountExact;

            const baseModels = normalizeSessionModelList([
                ...(Array.isArray(normalized.models) ? normalized.models : []),
                normalized.model,
                normalized.modelName,
                normalized.modelId
            ]);
            if (baseModels.length > 0) {
                normalized.models = baseModels;
                normalized.model = baseModels[0];
                return normalized;
            }

            const filePath = typeof normalized.filePath === 'string' ? normalized.filePath.trim() : '';
            if (!filePath) {
                return null;
            }

            // 快速路径：全文件正则扫描（并发 + 缓存）。只对“缺模型”的会话触发。
            const fullFileModels = await readSessionModelsFromFile(filePath);
            if (fullFileModels.length > 0) {
                normalized.models = fullFileModels;
                normalized.model = fullFileModels[0];
                return normalized;
            }

            // 兜底：摘要解析（可能补 provider 等字段）
            const summaryOptions = {
                summaryReadBytes: SESSION_BROWSE_SUMMARY_READ_BYTES,
                titleReadBytes: SESSION_BROWSE_SUMMARY_READ_BYTES
            };
            let summary = null;
            try {
                summary = normalized.source === 'claude'
                    ? parseClaudeSessionSummary(filePath, summaryOptions)
                    : parseCodexSessionSummary(filePath, summaryOptions);
            } catch (_) {
                summary = null;
            }
            if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
                return null;
            }
            const summaryModels = normalizeSessionModelList([
                ...(Array.isArray(summary.models) ? summary.models : []),
                summary.model
            ]);
            if (summaryModels.length === 0) {
                return null;
            }
            normalized.models = summaryModels;
            normalized.model = summaryModels[0];
            if ((!normalized.provider || !String(normalized.provider).trim()) && typeof summary.provider === 'string' && summary.provider.trim()) {
                normalized.provider = summary.provider.trim();
            }
            return normalized;
        }))
    );

    return normalizedSessions.filter(Boolean);
}

module.exports = {
    listSessionUsageCore
};


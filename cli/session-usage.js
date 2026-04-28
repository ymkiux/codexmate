const { createConcurrencyLimiter } = require('./session-usage.concurrent');
const { normalizeSessionModelList, createSessionModelsFileReader } = require('./session-usage.models');

async function listSessionUsageCore(params = {}, deps = {}) {
    const {
        fs,
        listSessionBrowse,
        parseCodexSessionSummary,
        parseClaudeSessionSummary,
        parseCodeBuddySessionSummary,
        parseGeminiSessionSummary,
        MAX_SESSION_USAGE_LIST_SIZE,
        SESSION_BROWSE_SUMMARY_READ_BYTES
    } = deps;

    const source = params.source === 'codex' || params.source === 'claude' || params.source === 'gemini' || params.source === 'codebuddy'
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

    const { readSessionModelsFromFile } = createSessionModelsFileReader(fs, {
        concurrency: 32,
        maxEntries: 1500,
        probeHeadBytes: 128 * 1024,
        probeTailBytes: 128 * 1024
    });

    // CPU/IO 优化策略（面向 2000 会话）：
    // 1) 优先使用 listSessionBrowse 返回的 model/models（零 I/O）
    // 2) 仅当缺少模型名时才读取/解析文件（必要时全文件扫描）
    const limitNormalize = createConcurrencyLimiter(64);
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
                    : (normalized.source === 'gemini'
                        ? parseGeminiSessionSummary(filePath, summaryOptions)
                        : (normalized.source === 'codebuddy'
                            ? parseCodeBuddySessionSummary(filePath, summaryOptions)
                            : parseCodexSessionSummary(filePath, summaryOptions)));
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

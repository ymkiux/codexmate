export const DEFAULT_API_BODY_LIMIT_BYTES = 4 * 1024 * 1024;

const LARGE_DIFF_LINE_LIMIT = 3000;
const LARGE_DIFF_SYNC_LOOKAHEAD = 64;

function measureUtf8ByteLength(input) {
    const text = typeof input === 'string' ? input : String(input ?? '');
    if (typeof TextEncoder === 'function') {
        return new TextEncoder().encode(text).length;
    }
    if (typeof Buffer !== 'undefined' && typeof Buffer.byteLength === 'function') {
        return Buffer.byteLength(text, 'utf8');
    }
    return unescape(encodeURIComponent(text)).length;
}

function buildApiRequestByteLength(action, params) {
    return measureUtf8ByteLength(JSON.stringify({ action, params }));
}

function normalizeDiffText(input) {
    const safe = typeof input === 'string' ? input : '';
    const withoutBom = safe.charCodeAt(0) === 0xFEFF ? safe.slice(1) : safe;
    return withoutBom.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function splitDiffLines(input) {
    let normalized = normalizeDiffText(input);
    if (!normalized) return [];
    if (normalized.endsWith('\n')) {
        normalized = normalized.slice(0, -1);
    }
    if (!normalized) return [];
    return normalized.split('\n');
}

function buildDiffLcsMatrix(beforeLines, afterLines) {
    const rows = beforeLines.length + 1;
    const cols = afterLines.length + 1;
    const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));
    for (let i = 1; i < rows; i += 1) {
        const beforeLine = beforeLines[i - 1];
        for (let j = 1; j < cols; j += 1) {
            if (beforeLine === afterLines[j - 1]) {
                matrix[i][j] = matrix[i - 1][j - 1] + 1;
            } else {
                const up = matrix[i - 1][j];
                const left = matrix[i][j - 1];
                matrix[i][j] = up >= left ? up : left;
            }
        }
    }
    return matrix;
}

function countDiffStats(lines) {
    let added = 0;
    let removed = 0;
    let unchanged = 0;
    for (const line of lines) {
        if (line.type === 'add') {
            added += 1;
        } else if (line.type === 'del') {
            removed += 1;
        } else {
            unchanged += 1;
        }
    }
    return { added, removed, unchanged };
}

function buildCollapsedContextLine(hiddenCount) {
    return {
        type: 'context',
        value: `... ${hiddenCount} unchanged lines ...`,
        oldNumber: null,
        newNumber: null
    };
}

function compactContextRuns(lines, contextSize = 3) {
    const compacted = [];
    const keepCount = Number.isFinite(contextSize) ? Math.max(1, Math.floor(contextSize)) : 3;
    let index = 0;
    while (index < lines.length) {
        if (!lines[index] || lines[index].type !== 'context') {
            compacted.push(lines[index]);
            index += 1;
            continue;
        }
        const start = index;
        while (index < lines.length && lines[index] && lines[index].type === 'context') {
            index += 1;
        }
        const run = lines.slice(start, index);
        if (run.length <= keepCount * 2 + 1) {
            compacted.push(...run);
            continue;
        }
        compacted.push(...run.slice(0, keepCount));
        compacted.push(buildCollapsedContextLine(run.length - keepCount * 2));
        compacted.push(...run.slice(-keepCount));
    }
    return compacted;
}

function buildExactDiffLines(beforeLines, afterLines) {
    const matrix = buildDiffLcsMatrix(beforeLines, afterLines);
    const lines = [];
    let i = beforeLines.length;
    let j = afterLines.length;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && beforeLines[i - 1] === afterLines[j - 1]) {
            lines.push({
                type: 'context',
                value: beforeLines[i - 1],
                oldNumber: i,
                newNumber: j
            });
            i -= 1;
            j -= 1;
            continue;
        }
        const canAdd = j > 0;
        const canDel = i > 0;
        if (canAdd && (!canDel || matrix[i][j - 1] >= matrix[i - 1][j])) {
            lines.push({
                type: 'add',
                value: afterLines[j - 1],
                oldNumber: null,
                newNumber: j
            });
            j -= 1;
            continue;
        }
        if (canDel) {
            lines.push({
                type: 'del',
                value: beforeLines[i - 1],
                oldNumber: i,
                newNumber: null
            });
            i -= 1;
        }
    }
    lines.reverse();
    return lines;
}

function findSyncPointInWindow(beforeLines, afterLines, beforeIndex, afterIndex, maxBeforeOffset, maxAfterOffset) {
    if (maxBeforeOffset <= 0 && maxAfterOffset <= 0) {
        return null;
    }

    for (let offset = 1; offset <= maxAfterOffset; offset += 1) {
        if (beforeLines[beforeIndex] === afterLines[afterIndex + offset]) {
            return { beforeIndex, afterIndex: afterIndex + offset };
        }
    }
    for (let offset = 1; offset <= maxBeforeOffset; offset += 1) {
        if (beforeLines[beforeIndex + offset] === afterLines[afterIndex]) {
            return { beforeIndex: beforeIndex + offset, afterIndex };
        }
    }

    const maxDistance = maxBeforeOffset + maxAfterOffset;
    for (let distance = 2; distance <= maxDistance; distance += 1) {
        const beforeStart = Math.max(1, distance - maxAfterOffset);
        const beforeEnd = Math.min(maxBeforeOffset, distance - 1);
        for (let beforeOffset = beforeStart; beforeOffset <= beforeEnd; beforeOffset += 1) {
            const afterOffset = distance - beforeOffset;
            if (beforeLines[beforeIndex + beforeOffset] === afterLines[afterIndex + afterOffset]) {
                return {
                    beforeIndex: beforeIndex + beforeOffset,
                    afterIndex: afterIndex + afterOffset
                };
            }
        }
    }
    return null;
}

function findNextSyncPoint(beforeLines, afterLines, beforeIndex, afterIndex, lookahead = LARGE_DIFF_SYNC_LOOKAHEAD) {
    const remainingBefore = Math.max(0, beforeLines.length - beforeIndex - 1);
    const remainingAfter = Math.max(0, afterLines.length - afterIndex - 1);
    const maxWindow = Math.max(remainingBefore, remainingAfter);
    if (maxWindow <= 0) {
        return null;
    }

    const initialWindow = Number.isFinite(lookahead)
        ? Math.max(1, Math.floor(lookahead))
        : LARGE_DIFF_SYNC_LOOKAHEAD;
    let window = Math.min(maxWindow, initialWindow);
    while (window > 0) {
        const syncPoint = findSyncPointInWindow(
            beforeLines,
            afterLines,
            beforeIndex,
            afterIndex,
            Math.min(window, remainingBefore),
            Math.min(window, remainingAfter)
        );
        if (syncPoint) {
            return syncPoint;
        }
        if (window >= maxWindow) {
            return null;
        }
        window = Math.min(maxWindow, window * 2);
    }
    return null;
}

function buildLargeDiffLines(beforeLines, afterLines) {
    const rawLines = [];
    let beforeIndex = 0;
    let afterIndex = 0;

    while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
        if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
            rawLines.push({
                type: 'context',
                value: beforeLines[beforeIndex],
                oldNumber: beforeIndex + 1,
                newNumber: afterIndex + 1
            });
            beforeIndex += 1;
            afterIndex += 1;
            continue;
        }

        const syncPoint = findNextSyncPoint(beforeLines, afterLines, beforeIndex, afterIndex);
        if (!syncPoint) {
            rawLines.push({
                type: 'del',
                value: beforeLines[beforeIndex],
                oldNumber: beforeIndex + 1,
                newNumber: null
            });
            rawLines.push({
                type: 'add',
                value: afterLines[afterIndex],
                oldNumber: null,
                newNumber: afterIndex + 1
            });
            beforeIndex += 1;
            afterIndex += 1;
            continue;
        }

        while (beforeIndex < syncPoint.beforeIndex) {
            rawLines.push({
                type: 'del',
                value: beforeLines[beforeIndex],
                oldNumber: beforeIndex + 1,
                newNumber: null
            });
            beforeIndex += 1;
        }
        while (afterIndex < syncPoint.afterIndex) {
            rawLines.push({
                type: 'add',
                value: afterLines[afterIndex],
                oldNumber: null,
                newNumber: afterIndex + 1
            });
            afterIndex += 1;
        }
    }

    while (beforeIndex < beforeLines.length) {
        rawLines.push({
            type: 'del',
            value: beforeLines[beforeIndex],
            oldNumber: beforeIndex + 1,
            newNumber: null
        });
        beforeIndex += 1;
    }
    while (afterIndex < afterLines.length) {
        rawLines.push({
            type: 'add',
            value: afterLines[afterIndex],
            oldNumber: null,
            newNumber: afterIndex + 1
        });
        afterIndex += 1;
    }

    return {
        lines: compactContextRuns(rawLines),
        stats: countDiffStats(rawLines)
    };
}

export function buildLineDiff(beforeText, afterText) {
    const beforeLines = splitDiffLines(beforeText);
    const afterLines = splitDiffLines(afterText);
    const result = (beforeLines.length > LARGE_DIFF_LINE_LIMIT || afterLines.length > LARGE_DIFF_LINE_LIMIT)
        ? buildLargeDiffLines(beforeLines, afterLines)
        : {
            lines: buildExactDiffLines(beforeLines, afterLines),
            stats: null
        };
    const stats = result.stats || countDiffStats(result.lines);
    return {
        lines: result.lines,
        stats,
        oldLineCount: beforeLines.length,
        newLineCount: afterLines.length,
        truncated: false
    };
}

export function buildAgentsDiffPreview(options = {}) {
    const beforeText = normalizeDiffText(options.baseContent);
    const afterText = normalizeDiffText(options.content);
    const diff = buildLineDiff(beforeText, afterText);
    return {
        ...diff,
        truncated: !!diff.truncated,
        hasChanges: diff.truncated
            ? beforeText !== afterText
            : (diff.stats.added > 0 || diff.stats.removed > 0)
    };
}

export function buildAgentsDiffPreviewRequest(options = {}) {
    const contextRaw = typeof options.context === 'string' ? options.context.trim() : '';
    const context = contextRaw || 'codex';
    const params = {
        content: typeof options.content === 'string' ? options.content : '',
        lineEnding: options.lineEnding === '\r\n' ? '\r\n' : '\n',
        context
    };
    if (context === 'openclaw-workspace') {
        const fileName = typeof options.fileName === 'string' ? options.fileName.trim() : '';
        if (fileName) {
            params.fileName = fileName;
        }
    }

    const maxRequestBytes = Number.isFinite(options.maxRequestBytes)
        ? Math.max(1024, Math.floor(options.maxRequestBytes))
        : DEFAULT_API_BODY_LIMIT_BYTES;
    const hasBaseContent = typeof options.baseContent === 'string';
    const paramsWithBaseContent = hasBaseContent
        ? { ...params, baseContent: options.baseContent }
        : params;
    if (!hasBaseContent) {
        return {
            params,
            omittedBaseContent: false,
            exceedsBodyLimit: buildApiRequestByteLength('preview-agents-diff', params) > maxRequestBytes
        };
    }
    if (buildApiRequestByteLength('preview-agents-diff', paramsWithBaseContent) <= maxRequestBytes) {
        return {
            params: paramsWithBaseContent,
            omittedBaseContent: false,
            exceedsBodyLimit: false
        };
    }
    return {
        params,
        omittedBaseContent: true,
        exceedsBodyLimit: buildApiRequestByteLength('preview-agents-diff', params) > maxRequestBytes
    };
}

export function isAgentsDiffPreviewPayloadTooLarge(result = {}) {
    const status = Number(result && result.status);
    const errorCode = result && typeof result.errorCode === 'string' ? result.errorCode : '';
    return status === 413 || errorCode === 'payload-too-large';
}

export function shouldApplyAgentsDiffPreviewResponse(options = {}) {
    const requestToken = options && options.requestToken;
    const activeRequestToken = options && options.activeRequestToken;
    if (!requestToken || requestToken !== activeRequestToken) {
        return false;
    }
    if (!options || !options.isVisible) {
        return false;
    }
    const requestFingerprint = typeof options.requestFingerprint === 'string' ? options.requestFingerprint : '';
    const currentFingerprint = typeof options.currentFingerprint === 'string' ? options.currentFingerprint : '';
    return requestFingerprint === currentFingerprint;
}

function normalizeLineFeed(input) {
    if (typeof input !== 'string') {
        return '';
    }
    return input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function splitLines(input) {
    let normalized = normalizeLineFeed(input);
    if (!normalized) return [];
    if (normalized.endsWith('\n')) {
        normalized = normalized.slice(0, -1);
    }
    if (!normalized) return [];
    return normalized.split('\n');
}

function buildLcsMatrix(beforeLines, afterLines) {
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

function buildLineDiff(beforeText, afterText) {
    const beforeLines = splitLines(beforeText);
    const afterLines = splitLines(afterText);
    const matrix = buildLcsMatrix(beforeLines, afterLines);
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

    return {
        lines,
        stats: {
            added,
            removed,
            unchanged
        },
        oldLineCount: beforeLines.length,
        newLineCount: afterLines.length
    };
}

module.exports = {
    buildLineDiff
};

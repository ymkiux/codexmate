const fs = require('fs');
const path = require('path');

const { parseMaxMessagesValue } = require('../lib/cli-session-utils');

function ensureDir(dirPath) {
    if (!dirPath) return;
    if (fs.existsSync(dirPath)) return;
    fs.mkdirSync(dirPath, { recursive: true });
}

function resolveOutputPath(outputPath, defaultFileName) {
    const fallback = path.resolve(process.cwd(), defaultFileName);
    if (typeof outputPath !== 'string' || !outputPath.trim()) return fallback;
    const trimmed = outputPath.trim();
    const resolved = path.resolve(trimmed);
    if (/[\\\/]$/.test(trimmed)) {
        ensureDir(resolved);
        return path.join(resolved, defaultFileName);
    }
    if (fs.existsSync(resolved)) {
        try { if (fs.statSync(resolved).isDirectory()) return path.join(resolved, defaultFileName); } catch (_) {}
    }
    return resolved;
}

function parseArgs(args = []) {
    const options = { from: '', to: '', sessionId: '', filePath: '', output: '', maxMessages: undefined };
    const errors = [];
    for (let i = 0; i < args.length; i += 1) {
        const arg = String(args[i] || '');
        const next = args[i + 1] || '';
        if (!arg) continue;
        if (arg === '--from') { options.from = next; i += 1; continue; }
        if (arg.startsWith('--from=')) { options.from = arg.slice(7); continue; }
        if (arg === '--to') { options.to = next; i += 1; continue; }
        if (arg.startsWith('--to=')) { options.to = arg.slice(5); continue; }
        if (arg === '--session-id') { options.sessionId = next; i += 1; continue; }
        if (arg.startsWith('--session-id=')) { options.sessionId = arg.slice(13); continue; }
        if (arg === '--file') { options.filePath = next; i += 1; continue; }
        if (arg.startsWith('--file=')) { options.filePath = arg.slice(7); continue; }
        if (arg === '--output') { options.output = next; i += 1; continue; }
        if (arg.startsWith('--output=')) { options.output = arg.slice(9); continue; }
        if (arg === '--max-messages') { options.maxMessages = next; i += 1; continue; }
        if (arg.startsWith('--max-messages=')) { options.maxMessages = arg.slice(15); continue; }
        errors.push(`未知参数: ${arg}`);
    }
    options.from = String(options.from || '').trim().toLowerCase();
    options.to = String(options.to || '').trim().toLowerCase();
    if (options.from !== 'codex' && options.from !== 'claude') errors.push('参数 --from 仅支持 codex 或 claude');
    if (options.to !== 'codex' && options.to !== 'claude') errors.push('参数 --to 仅支持 codex 或 claude');
    if (options.from && options.to && options.from === options.to) errors.push('--from 与 --to 不能相同');
    if (!options.from) errors.push('缺少 --from');
    if (!options.to) errors.push('缺少 --to');
    if (!options.sessionId && !options.filePath) errors.push('必须指定 --session-id 或 --file');
    if (options.maxMessages !== undefined) {
        const parsed = parseMaxMessagesValue(options.maxMessages);
        if (parsed === null) errors.push('参数 --max-messages 无效');
        else options.maxMessages = parsed === Infinity ? Infinity : Math.max(1, Math.floor(parsed));
    }
    return { options, error: errors.length ? errors.join('；') : '' };
}

module.exports = { ensureDir, resolveOutputPath, parseArgs };


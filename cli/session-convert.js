const fs = require('fs');
const path = require('path');

const { parseArgs, ensureDir, resolveOutputPath } = require('./session-convert-args');
const { readSessionMessages, buildTargetRecords } = require('./session-convert-io');

function printUsage() {
    console.log('\n用法:');
    console.log('  codexmate convert-session --from <codex|claude> --to <codex|claude> (--session-id <ID>|--file <PATH>) [--output <PATH>] [--max-messages <N|all|Infinity>]');
}

async function cmdConvertSession(args = [], deps = {}) {
    const parsed = parseArgs(args);
    if (parsed.error) {
        console.error('错误:', parsed.error);
        printUsage();
        process.exit(1);
    }
    if (!deps || typeof deps.resolveSessionFilePath !== 'function') {
        console.error('错误: convert-session missing resolver');
        process.exit(1);
    }
    const opt = parsed.options;
    const filePath = deps.resolveSessionFilePath(opt.from, opt.filePath, opt.sessionId);
    if (!filePath) {
        console.error('转换失败: Session file not found');
        process.exit(1);
    }
    const extracted = await readSessionMessages(filePath, opt.from, opt.maxMessages);
    const sessionId = extracted.sessionId || opt.sessionId || path.basename(filePath, '.jsonl');
    const safeSessionId = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const records = buildTargetRecords(opt.to, { sessionId, cwd: extracted.cwd || '', messages: extracted.messages });
    const jsonl = `${records.map(r => JSON.stringify(r)).join('\n')}\n`;
    const outputPath = resolveOutputPath(opt.output, `${opt.to}-session-${safeSessionId}.jsonl`);
    ensureDir(path.dirname(outputPath));
    fs.writeFileSync(outputPath, jsonl, 'utf-8');
    console.log('\n✓ 会话已转换:', outputPath);
    if (extracted.truncated) console.log('! 已截断: 可使用 --max-messages=all');
    console.log();
}

module.exports = { cmdConvertSession };


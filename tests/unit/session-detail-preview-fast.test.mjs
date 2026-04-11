import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const cliPath = path.join(__dirname, '..', '..', 'cli.js');
const cliContent = fs.readFileSync(cliPath, 'utf-8');

function extractFunction(content, funcName) {
    const regex = new RegExp(`(?:async\\s+)?function ${funcName}\\([^)]*\\)\\s*\\{[\\s\\S]*?^\\}`, 'm');
    const match = content.match(regex);
    if (!match) {
        throw new Error(`Function ${funcName} not found`);
    }
    return match[0];
}

const applySessionDetailRecordMetadataSrc = extractFunction(cliContent, 'applySessionDetailRecordMetadata');
const extractSessionDetailPreviewFromTailTextSrc = extractFunction(cliContent, 'extractSessionDetailPreviewFromTailText');
const extractSessionDetailPreviewFromFileFastSrc = extractFunction(cliContent, 'extractSessionDetailPreviewFromFileFast');
const extractMessageFromRecordSrc = extractFunction(cliContent, 'extractMessageFromRecord');

function instantiateExtractSessionDetailPreviewFromFileFast(bindings = {}) {
    const bindingNames = Object.keys(bindings);
    const bindingValues = Object.values(bindings);
    return Function(
        ...bindingNames,
        `${applySessionDetailRecordMetadataSrc}\n${extractMessageFromRecordSrc}\n${extractSessionDetailPreviewFromTailTextSrc}\n${extractSessionDetailPreviewFromFileFastSrc}\nreturn extractSessionDetailPreviewFromFileFast;`
    )(...bindingValues);
}

test('extractSessionDetailPreviewFromFileFast preserves clipped previews after fully reading a file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmate-fast-preview-'));
    const filePath = path.join(tmpDir, 'session.jsonl');

    try {
        const records = [{
            type: 'session_meta',
            payload: { id: 'fast-preview-session', cwd: '/tmp/fast-preview-session' },
            timestamp: '2025-04-12T00:00:00.000Z'
        }];
        for (let i = 0; i < 5; i += 1) {
            records.push({
                type: 'response_item',
                payload: {
                    type: 'message',
                    role: i % 2 === 0 ? 'user' : 'assistant',
                    content: `message-${i}-${'x'.repeat(48)}`
                },
                timestamp: `2025-04-12T00:00:0${i + 1}.000Z`
            });
        }
        fs.writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf-8');

        const extractSessionDetailPreviewFromFileFast = instantiateExtractSessionDetailPreviewFromFileFast({
            fs,
            getFileStatSafe(targetPath) {
                try {
                    return fs.statSync(targetPath);
                } catch (_) {
                    return null;
                }
            },
            FAST_SESSION_DETAIL_PREVIEW_FILE_BYTES: 32,
            FAST_SESSION_DETAIL_PREVIEW_MAX_BYTES: 4096,
            FAST_SESSION_DETAIL_PREVIEW_CHUNK_BYTES: 256,
            DEFAULT_SESSION_DETAIL_MESSAGES: 300,
            toIsoTime(value, fallback = '') {
                return typeof value === 'string' && value ? value : fallback;
            },
            normalizeRole(role) {
                const normalized = String(role || '').trim().toLowerCase();
                return normalized === 'user' || normalized === 'assistant' || normalized === 'system'
                    ? normalized
                    : '';
            },
            extractMessageText(content) {
                if (typeof content === 'string') {
                    return content;
                }
                return '';
            },
            removeLeadingSystemMessage(messages) {
                if (!Array.isArray(messages)) {
                    return [];
                }
                let startIndex = 0;
                while (startIndex < messages.length) {
                    const item = messages[startIndex];
                    const role = item && typeof item.role === 'string' ? item.role : '';
                    if (role === 'system') {
                        startIndex += 1;
                        continue;
                    }
                    break;
                }
                return startIndex > 0 ? messages.slice(startIndex) : messages;
            }
        });

        const preview = extractSessionDetailPreviewFromFileFast(filePath, 'codex', 2);

        assert(preview, 'fast preview should return a preview result for large files');
        assert.strictEqual(preview.messages.length, 2, 'fast preview should keep the requested tail window');
        assert.strictEqual(preview.clipped, true, 'fast preview should preserve clipped=true after the full file is read');
        assert.strictEqual(preview.totalMessages, null, 'fast preview should keep non-exact totals for tail previews');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('extractSessionDetailPreviewFromFileFast normalizes full-scan previews before returning', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmate-fast-preview-full-'));
    const filePath = path.join(tmpDir, 'session.jsonl');

    try {
        const records = [
            {
                type: 'response_item',
                payload: {
                    type: 'message',
                    role: 'system',
                    content: 'bootstrap'
                },
                timestamp: '2025-04-12T00:00:00.000Z'
            },
            {
                type: 'response_item',
                payload: {
                    type: 'message',
                    role: 'user',
                    content: 'hello'
                },
                timestamp: '2025-04-12T00:00:01.000Z'
            },
            {
                type: 'response_item',
                payload: {
                    type: 'message',
                    role: 'assistant',
                    content: 'world'
                },
                timestamp: '2025-04-12T00:00:02.000Z'
            }
        ];
        fs.writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf-8');

        const extractSessionDetailPreviewFromFileFast = instantiateExtractSessionDetailPreviewFromFileFast({
            fs,
            getFileStatSafe(targetPath) {
                try {
                    return fs.statSync(targetPath);
                } catch (_) {
                    return null;
                }
            },
            FAST_SESSION_DETAIL_PREVIEW_FILE_BYTES: 32,
            FAST_SESSION_DETAIL_PREVIEW_MAX_BYTES: 4096,
            FAST_SESSION_DETAIL_PREVIEW_CHUNK_BYTES: 256,
            DEFAULT_SESSION_DETAIL_MESSAGES: 300,
            toIsoTime(value, fallback = '') {
                return typeof value === 'string' && value ? value : fallback;
            },
            normalizeRole(role) {
                const normalized = String(role || '').trim().toLowerCase();
                return normalized === 'user' || normalized === 'assistant' || normalized === 'system'
                    ? normalized
                    : '';
            },
            extractMessageText(content) {
                return typeof content === 'string' ? content : '';
            },
            removeLeadingSystemMessage(messages) {
                if (!Array.isArray(messages)) {
                    return [];
                }
                let startIndex = 0;
                while (startIndex < messages.length) {
                    const item = messages[startIndex];
                    const role = item && typeof item.role === 'string' ? item.role : '';
                    if (role === 'system') {
                        startIndex += 1;
                        continue;
                    }
                    break;
                }
                return startIndex > 0 ? messages.slice(startIndex) : messages;
            }
        });

        const preview = extractSessionDetailPreviewFromFileFast(filePath, 'codex', 5);

        assert(preview, 'full-scan fast preview should still return a preview');
        assert.deepStrictEqual(
            preview.messages.map((item) => item.role),
            ['user', 'assistant'],
            'full-scan previews should strip leading system/bootstrap messages'
        );
        assert.strictEqual(preview.totalMessages, 2, 'full-scan previews should restore an exact total');
        assert.strictEqual(preview.clipped, false, 'full-scan previews should not stay clipped when all messages fit');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

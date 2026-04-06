import assert from 'assert';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logic = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'logic.mjs')));
const { createSessionBrowserMethods } = await import(
    pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'modules', 'app.methods.session-browser.mjs'))
);
const { createSessionComputed } = await import(
    pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'modules', 'app.computed.session.mjs'))
);

const { normalizeSessionMatch, findSessionMessageMatchKey } = logic;

test('normalizeSessionMatch extracts primary snippet and count', () => {
    const normalized = normalizeSessionMatch({
        match: {
            hit: true,
            count: 3,
            snippets: ['  first hit  ', '', 'second hit']
        }
    });

    assert.deepStrictEqual(normalized, {
        hit: true,
        count: 3,
        snippets: ['first hit', 'second hit'],
        primarySnippet: 'first hit',
        hasSnippet: true
    });
});

test('findSessionMessageMatchKey finds record key from matched snippet', () => {
    const messages = [
        { recordLineIndex: 1, text: 'hello there' },
        { recordLineIndex: 4, text: 'needle appears in this message body' }
    ];

    assert.strictEqual(findSessionMessageMatchKey(messages, ['appears in this message']), 'record-4');
});

test('sortedSessionsList keeps normalized match payload for UI display', () => {
    const computed = createSessionComputed();
    const list = computed.sortedSessionsList.call({
        sessionsList: [{ sessionId: 's1', match: { hit: true, count: 2, snippets: ['matched text'] } }],
        sessionPinnedMap: {},
        getSessionExportKey(session) {
            return session.sessionId;
        }
    });

    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].match.primarySnippet, 'matched text');
    assert.strictEqual(list[0].match.count, 2);
});

test('loadActiveSessionDetail annotates matched message and schedules jump', async () => {
    const methods = createSessionBrowserMethods({
        api: async () => ({
            messages: [
                { recordLineIndex: 1, role: 'user', text: 'hello world' },
                { recordLineIndex: 2, role: 'assistant', text: 'needle is right here in the answer' }
            ],
            clipped: false,
            messageLimit: 80,
            totalMessages: 2
        })
    });

    const jumps = [];
    const context = {
        activeSession: {
            source: 'codex',
            sessionId: 's1',
            filePath: '/tmp/demo.jsonl',
            match: {
                hit: true,
                count: 1,
                snippets: ['needle is right here']
            }
        },
        mainTab: 'sessions',
        sessionPreviewRenderEnabled: true,
        sessionDetailRequestSeq: 0,
        sessionDetailInitialMessageLimit: 80,
        sessionDetailMessageLimit: 80,
        sessionPreviewPendingVisibleCount: 0,
        sessionPreviewVisibleCount: 0,
        sessionMessageRefMap: Object.create(null),
        sessionMessageRefBinderMap: Object.create(null),
        resetSessionDetailPagination() {},
        resetSessionPreviewMessageRender() {},
        primeSessionPreviewMessageRender() {
            this.sessionPreviewVisibleCount = 2;
        },
        cancelSessionTimelineSync() {},
        clearSessionTimelineRefs() {},
        syncActiveSessionMessageCount() {},
        invalidateSessionTimelineMeasurementCache() {},
        $nextTick(fn) { fn(); },
        jumpToSessionTimelineNode(key) { jumps.push(key); },
        getRecordKey(message) {
            return String(message.recordLineIndex);
        },
        getRecordRenderKey(message, idx) {
            return `record-${message.recordLineIndex || idx}`;
        },
        normalizeSessionMessage: methods.normalizeSessionMessage,
        pendingSessionMatchKey: ''
    };

    await methods.loadActiveSessionDetail.call(context);

    assert.strictEqual(context.pendingSessionMatchKey, 'record-2');
    assert.strictEqual(context.activeSessionMessages[1].isSearchMatch, true);
    assert.strictEqual(context.activeSessionMessages[1].matchSnippet, 'needle is right here');
    assert.deepStrictEqual(jumps, ['record-2']);
});

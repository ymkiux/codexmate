import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const fs = require('fs');

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

const listSessionUsageSrc = extractFunction(cliContent, 'listSessionUsage');
const listSessionBrowseSrc = extractFunction(cliContent, 'listSessionBrowse');
const buildSessionInventoryCacheKeySrc = extractFunction(cliContent, 'buildSessionInventoryCacheKey');
const cloneSessionInventoryCacheValueSrc = extractFunction(cliContent, 'cloneSessionInventoryCacheValue');
const getSessionInventoryCacheSrc = extractFunction(cliContent, 'getSessionInventoryCache');
const registerSessionFileLookupEntriesSrc = extractFunction(cliContent, 'registerSessionFileLookupEntries');
const setSessionInventoryCacheSrc = extractFunction(cliContent, 'setSessionInventoryCache');
const listSessionInventoryBySourceSrc = extractFunction(cliContent, 'listSessionInventoryBySource');
const listSessionPathsSrc = extractFunction(cliContent, 'listSessionPaths');
const resolveSessionFilePathSrc = extractFunction(cliContent, 'resolveSessionFilePath');
const getFileHeadTextSrc = extractFunction(cliContent, 'getFileHeadText');
const getFileTailTextSrc = extractFunction(cliContent, 'getFileTailText');
const parseJsonlContentSrc = extractFunction(cliContent, 'parseJsonlContent');
const parseJsonlHeadRecordsSrc = extractFunction(cliContent, 'parseJsonlHeadRecords');
const parseJsonlTailRecordsSrc = extractFunction(cliContent, 'parseJsonlTailRecords');
const isSessionSummaryMessageCountExactSrc = extractFunction(cliContent, 'isSessionSummaryMessageCountExact');
const removeLeadingSystemMessageSrc = extractFunction(cliContent, 'removeLeadingSystemMessage');
const readNonNegativeIntegerSrc = extractFunction(cliContent, 'readNonNegativeInteger');
const readTotalTokensFromUsageSrc = extractFunction(cliContent, 'readTotalTokensFromUsage');
const readUsageTotalsFromUsageSrc = extractFunction(cliContent, 'readUsageTotalsFromUsage');
const readContextWindowValueSrc = extractFunction(cliContent, 'readContextWindowValue');
const applyUsageTotalsToStateSrc = extractFunction(cliContent, 'applyUsageTotalsToState');
const readSessionModelFromRecordSrc = extractFunction(cliContent, 'readSessionModelFromRecord');
const readExplicitSessionProviderFromRecordSrc = extractFunction(cliContent, 'readExplicitSessionProviderFromRecord');
const readSessionProviderFromRecordSrc = extractFunction(cliContent, 'readSessionProviderFromRecord');
const applySessionUsageSummaryFromRecordSrc = extractFunction(cliContent, 'applySessionUsageSummaryFromRecord');
const parseCodexSessionSummarySrc = extractFunction(cliContent, 'parseCodexSessionSummary');

function instantiateListSessionUsage(bindings = {}) {
    const bindingNames = Object.keys(bindings);
    const bindingValues = Object.values(bindings);
    return Function(...bindingNames, `${listSessionUsageSrc}\nreturn listSessionUsage;`)(...bindingValues);
}

function instantiateListSessionBrowse(bindings = {}) {
    const bindingNames = Object.keys(bindings);
    const bindingValues = Object.values(bindings);
    return Function(...bindingNames, `${listSessionBrowseSrc}\nreturn listSessionBrowse;`)(...bindingValues);
}

function instantiateFunctionBundle(sources, exportName, bindings = {}) {
    const bindingNames = Object.keys(bindings);
    const bindingValues = Object.values(bindings);
    return Function(...bindingNames, `${sources.join('\n\n')}\nreturn ${exportName};`)(...bindingValues);
}

test('listSessionBrowse uses lightweight session listing without exact hydration', async () => {
    const calls = [];
    const listAllSessions = async (params) => {
        calls.push({ type: 'listAllSessions', params });
        return [
            {
                source: 'codex',
                sessionId: 'sess-1',
                messageCount: 12,
                __messageCountExact: false,
                query: 'kept'
            }
        ];
    };
    const listAllSessionsData = async () => {
        calls.push({ type: 'listAllSessionsData' });
        throw new Error('should not call listAllSessionsData');
    };
    const listSessionBrowse = instantiateListSessionBrowse({
        listAllSessions,
        listAllSessionsData
    });

    const result = await listSessionBrowse({
        source: 'all',
        limit: 200,
        query: 'error',
        pathFilter: '/repo',
        forceRefresh: true
    });

    assert.deepStrictEqual(calls, [
        {
            type: 'listAllSessions',
            params: {
                source: 'all',
                limit: 200,
                query: 'error',
                pathFilter: '/repo',
                forceRefresh: true,
                browseLightweight: true
            }
        }
    ]);
    assert.deepStrictEqual(result, [
        {
            source: 'codex',
            sessionId: 'sess-1',
            messageCount: 12,
            query: 'kept'
        }
    ]);
});

test('listSessionUsage uses lightweight session listing without exact hydration', async () => {
    const calls = [];
    const listSessionBrowse = async (params) => {
        calls.push({ type: 'listSessionBrowse', params });
        return [
            {
                source: 'codex',
                sessionId: 'sess-1',
                messageCount: 12,
                totalTokens: 345,
                contextWindow: 128000,
                __messageCountExact: false
            }
        ];
    };
    const listAllSessionsData = async () => {
        calls.push({ type: 'listAllSessionsData' });
        throw new Error('should not call listAllSessionsData');
    };
    const listSessionUsage = instantiateListSessionUsage({
        MAX_SESSION_USAGE_LIST_SIZE: 2000,
        listSessionBrowse,
        listAllSessionsData
    });

    const result = await listSessionUsage({
        source: 'all',
        limit: 200,
        forceRefresh: true
    });

    assert.deepStrictEqual(
        calls,
        [
            {
                type: 'listSessionBrowse',
                params: {
                    source: 'all',
                    limit: 200,
                    forceRefresh: true
                }
            }
        ]
    );
    assert.deepStrictEqual(result, [
        {
            source: 'codex',
            sessionId: 'sess-1',
            messageCount: 12,
            totalTokens: 345,
            contextWindow: 128000
        }
    ]);
});

test('listSessionUsage normalizes source and default limit for lightweight usage aggregation', async () => {
    const calls = [];
    const listSessionBrowse = async (params) => {
        calls.push(params);
        return [];
    };
    const listSessionUsage = instantiateListSessionUsage({
        MAX_SESSION_USAGE_LIST_SIZE: 2000,
        listSessionBrowse,
        listAllSessionsData: async () => {
            throw new Error('should not call listAllSessionsData');
        }
    });

    await listSessionUsage({
        source: 'invalid',
        limit: '9999',
        forceRefresh: 1
    });
    await listSessionUsage({});

    assert.deepStrictEqual(calls, [
        {
            source: 'all',
            limit: 2000,
            forceRefresh: true
        },
        {
            source: 'all',
            limit: 2000,
            forceRefresh: false
        }
    ]);
});

test('parseCodexSessionSummary reads token totals and model data from tail records', () => {
    const parseCodexSessionSummary = instantiateFunctionBundle(
        [
            getFileHeadTextSrc,
            getFileTailTextSrc,
            parseJsonlContentSrc,
            parseJsonlHeadRecordsSrc,
            parseJsonlTailRecordsSrc,
            isSessionSummaryMessageCountExactSrc,
            removeLeadingSystemMessageSrc,
            readNonNegativeIntegerSrc,
            readTotalTokensFromUsageSrc,
            readUsageTotalsFromUsageSrc,
            readContextWindowValueSrc,
            applyUsageTotalsToStateSrc,
            readSessionModelFromRecordSrc,
            readExplicitSessionProviderFromRecordSrc,
            readSessionProviderFromRecordSrc,
            applySessionUsageSummaryFromRecordSrc,
            parseCodexSessionSummarySrc
        ],
        'parseCodexSessionSummary',
        {
            fs,
            path,
            Buffer,
            SESSION_SUMMARY_READ_BYTES: 512,
            SESSION_TITLE_READ_BYTES: 512,
            SESSION_USAGE_TAIL_READ_BYTES: 256,
            toIsoTime(value, fallback = '') {
                const iso = new Date(value).toISOString();
                return iso === 'Invalid Date' ? fallback : iso;
            },
            updateLatestIso(current, next) {
                const currentMs = Date.parse(current || '');
                const nextMs = Date.parse(next || '');
                if (!Number.isFinite(nextMs)) return current || '';
                if (!Number.isFinite(currentMs) || nextMs > currentMs) return new Date(nextMs).toISOString();
                return current || '';
            },
            normalizeRole(role) {
                return typeof role === 'string' ? role.trim().toLowerCase() : '';
            },
            extractMessageText(content) {
                if (typeof content === 'string') return content;
                if (Array.isArray(content)) {
                    return content.map((item) => item && item.text ? item.text : '').join(' ').trim();
                }
                return '';
            },
            truncateText(text) {
                return typeof text === 'string' ? text : '';
            },
            isBootstrapLikeText() {
                return false;
            }
        }
    );

    const tempDir = fs.mkdtempSync(path.join(__dirname, 'tmp-session-usage-'));
    const filePath = path.join(tempDir, 'codex-tail.jsonl');
    fs.writeFileSync(filePath, [
        JSON.stringify({
            timestamp: '2026-04-12T09:07:26.688Z',
            type: 'session_meta',
            payload: {
                id: 'codex-tail',
                timestamp: '2026-04-12T09:07:24.127Z',
                cwd: '/repo',
                model_provider: 'maxx'
            }
        }),
        JSON.stringify({
            timestamp: '2026-04-12T09:07:26.690Z',
            type: 'response_item',
            payload: {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: 'hello world' }]
            }
        }),
        JSON.stringify({
            timestamp: '2026-04-12T09:11:35.573Z',
            type: 'turn_context',
            payload: {
                model: 'gpt-5.3-codex',
                model_context_window: 258400
            }
        }),
        JSON.stringify({
            timestamp: '2026-04-12T09:11:35.588Z',
            type: 'event_msg',
            payload: {
                type: 'token_count',
                info: {
                    total_token_usage: {
                        input_tokens: 348969,
                        cached_input_tokens: 305664,
                        output_tokens: 3032,
                        reasoning_output_tokens: 1515,
                        total_tokens: 352001
                    },
                    model_context_window: 258400
                }
            }
        })
    ].join('\n'));

    try {
        const result = parseCodexSessionSummary(filePath, { summaryReadBytes: 512, titleReadBytes: 512 });
        assert(result, 'expected codex session summary');
        assert.strictEqual(result.provider, 'maxx');
        assert.strictEqual(result.model, 'gpt-5.3-codex');
        assert.strictEqual(result.totalTokens, 352001);
        assert.strictEqual(result.inputTokens, 348969);
        assert.strictEqual(result.cachedInputTokens, 305664);
        assert.strictEqual(result.outputTokens, 3032);
        assert.strictEqual(result.reasoningOutputTokens, 1515);
        assert.strictEqual(result.contextWindow, 258400);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('listSessionInventoryBySource reuses cached summaries and registers session lookups', () => {
    const codexCalls = [];
    const g_sessionInventoryCache = new Map();
    const g_sessionFileLookupCache = {
        codex: new Map(),
        claude: new Map()
    };
    const listSessionInventoryBySource = instantiateFunctionBundle(
        [
            buildSessionInventoryCacheKeySrc,
            cloneSessionInventoryCacheValueSrc,
            getSessionInventoryCacheSrc,
            registerSessionFileLookupEntriesSrc,
            setSessionInventoryCacheSrc,
            listSessionInventoryBySourceSrc
        ],
        'listSessionInventoryBySource',
        {
            g_sessionInventoryCache,
            g_sessionFileLookupCache,
            SESSION_LIST_CACHE_TTL_MS: 4000,
            SESSION_INVENTORY_CACHE_MAX_ENTRIES: 12,
            listCodexSessions(limit, options) {
                codexCalls.push({ limit, options });
                return [{
                    source: 'codex',
                    sessionId: 'sess-1',
                    filePath: '/tmp/sess-1.jsonl'
                }];
            },
            listClaudeSessions() {
                throw new Error('claude inventory should not be used');
            },
            Date: { now: () => 1000 },
            Number,
            Math,
            Map
        }
    );

    const first = listSessionInventoryBySource('codex', 120, { summaryReadBytes: 4096 }, { forceRefresh: false });
    const second = listSessionInventoryBySource('codex', 120, { summaryReadBytes: 4096 }, { forceRefresh: false });

    assert.strictEqual(codexCalls.length, 1);
    assert.deepStrictEqual(first, second);
    assert.strictEqual(g_sessionFileLookupCache.codex.get('sess-1'), '/tmp/sess-1.jsonl');
});

test('listSessionInventoryBySource returns cloned cache entries so UI-side mutations do not leak back into cache', () => {
    const g_sessionInventoryCache = new Map();
    const g_sessionFileLookupCache = {
        codex: new Map(),
        claude: new Map()
    };
    const listSessionInventoryBySource = instantiateFunctionBundle(
        [
            buildSessionInventoryCacheKeySrc,
            cloneSessionInventoryCacheValueSrc,
            getSessionInventoryCacheSrc,
            registerSessionFileLookupEntriesSrc,
            setSessionInventoryCacheSrc,
            listSessionInventoryBySourceSrc
        ],
        'listSessionInventoryBySource',
        {
            g_sessionInventoryCache,
            g_sessionFileLookupCache,
            SESSION_LIST_CACHE_TTL_MS: 4000,
            SESSION_INVENTORY_CACHE_MAX_ENTRIES: 12,
            listCodexSessions() {
                return [{
                    source: 'codex',
                    sessionId: 'sess-1',
                    filePath: '/tmp/sess-1.jsonl',
                    match: {
                        hit: true,
                        count: 1,
                        snippets: ['alpha']
                    }
                }];
            },
            listClaudeSessions() {
                throw new Error('claude inventory should not be used');
            },
            Date: { now: () => 1000 },
            Number,
            Math,
            Map,
            Array
        }
    );

    const first = listSessionInventoryBySource('codex', 120, {}, { forceRefresh: false });
    first[0].title = 'mutated';
    first[0].match.snippets.push('beta');

    const second = listSessionInventoryBySource('codex', 120, {}, { forceRefresh: false });

    assert.strictEqual(second[0].title, undefined);
    assert.deepStrictEqual(second[0].match.snippets, ['alpha']);
});

test('listSessionInventoryBySource discards invalid non-array cache entries and rebuilds from source', () => {
    const buildSessionInventoryCacheKey = instantiateFunctionBundle(
        [buildSessionInventoryCacheKeySrc],
        'buildSessionInventoryCacheKey',
        { Number, Math }
    );
    const cacheKey = buildSessionInventoryCacheKey('codex', 120, {});
    const g_sessionInventoryCache = new Map([
        [cacheKey, {
            timestamp: 1000,
            source: 'codex',
            value: { broken: true }
        }]
    ]);
    const g_sessionFileLookupCache = {
        codex: new Map(),
        claude: new Map()
    };
    let codexCalls = 0;
    const listSessionInventoryBySource = instantiateFunctionBundle(
        [
            buildSessionInventoryCacheKeySrc,
            cloneSessionInventoryCacheValueSrc,
            getSessionInventoryCacheSrc,
            registerSessionFileLookupEntriesSrc,
            setSessionInventoryCacheSrc,
            listSessionInventoryBySourceSrc
        ],
        'listSessionInventoryBySource',
        {
            g_sessionInventoryCache,
            g_sessionFileLookupCache,
            SESSION_LIST_CACHE_TTL_MS: 4000,
            SESSION_INVENTORY_CACHE_MAX_ENTRIES: 12,
            listCodexSessions() {
                codexCalls += 1;
                return [{
                    source: 'codex',
                    sessionId: 'sess-1',
                    filePath: '/tmp/sess-1.jsonl'
                }];
            },
            listClaudeSessions() {
                throw new Error('claude inventory should not be used');
            },
            Date: { now: () => 1000 },
            Number,
            Math,
            Map,
            Array
        }
    );

    const result = listSessionInventoryBySource('codex', 120, {}, { forceRefresh: false });

    assert.strictEqual(codexCalls, 1);
    assert.deepStrictEqual(result, [{
        source: 'codex',
        sessionId: 'sess-1',
        filePath: '/tmp/sess-1.jsonl'
    }]);
});

test('listSessionPaths reuses cached lightweight inventory and dedupes cwd values', () => {
    const cachedResults = new Map();
    const helperCalls = [];
    const listSessionPaths = instantiateFunctionBundle(
        [listSessionPathsSrc],
        'listSessionPaths',
        {
            MAX_SESSION_PATH_LIST_SIZE: 2000,
            SESSION_SCAN_FACTOR: 4,
            SESSION_SCAN_MIN_FILES: 800,
            SESSION_BROWSE_SUMMARY_READ_BYTES: 64 * 1024,
            getSessionListCache(cacheKey, forceRefresh) {
                if (forceRefresh) {
                    cachedResults.delete(cacheKey);
                    return null;
                }
                return cachedResults.has(cacheKey) ? cachedResults.get(cacheKey) : null;
            },
            setSessionListCache(cacheKey, value) {
                cachedResults.set(cacheKey, value);
            },
            listSessionInventoryBySource(source, limit, options) {
                helperCalls.push({ source, limit, options });
                return [
                    { cwd: '/repo/a', updatedAt: '2026-04-10T10:00:00.000Z' },
                    { cwd: '/repo/a', updatedAt: '2026-04-10T09:00:00.000Z' },
                    { cwd: '/repo/b', updatedAt: '2026-04-10T08:00:00.000Z' }
                ];
            },
            sortSessionsByUpdatedAt(items) {
                return [...items].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
            },
            Number,
            Math,
            Set
        }
    );

    const first = listSessionPaths({ source: 'codex', limit: 2, forceRefresh: false });
    const second = listSessionPaths({ source: 'codex', limit: 2, forceRefresh: false });

    assert.deepStrictEqual(first, ['/repo/a', '/repo/b']);
    assert.deepStrictEqual(second, ['/repo/a', '/repo/b']);
    assert.strictEqual(helperCalls.length, 1);
    assert.strictEqual(helperCalls[0].limit, 800);
    assert.strictEqual(helperCalls[0].options.summaryReadBytes, 64 * 1024);
    assert.strictEqual(helperCalls[0].options.titleReadBytes, 64 * 1024);
});

test('resolveSessionFilePath prefers cached session lookup before full filesystem scan', () => {
    let collectCalls = 0;
    const resolveSessionFilePath = instantiateFunctionBundle(
        [resolveSessionFilePathSrc],
        'resolveSessionFilePath',
        {
            g_sessionFileLookupCache: {
                codex: new Map([['sess-1', '/root/sessions/sess-1.jsonl']]),
                claude: new Map()
            },
            getCodexSessionsDir() {
                return '/root/sessions';
            },
            getClaudeProjectsDir() {
                return '/root/claude';
            },
            fs: {
                existsSync(target) {
                    return target === '/root/sessions' || target === '/root/sessions/sess-1.jsonl';
                }
            },
            expandHomePath(value) {
                return value;
            },
            isPathInside(target, root) {
                return String(target).startsWith(String(root));
            },
            collectJsonlFiles() {
                collectCalls += 1;
                return [];
            },
            path: {
                resolve(value) {
                    return value;
                },
                basename(value, ext) {
                    return value.endsWith(ext) ? value.slice(0, -ext.length).split('/').pop() : value.split('/').pop();
                }
            }
        }
    );

    const result = resolveSessionFilePath('codex', '', 'sess-1');

    assert.strictEqual(result, '/root/sessions/sess-1.jsonl');
    assert.strictEqual(collectCalls, 0);
});

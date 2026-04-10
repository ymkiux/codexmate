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
    const regex = new RegExp(`async function ${funcName}\\([^)]*\\)\\s*\\{[\\s\\S]*?^\\}`, 'm');
    const match = content.match(regex);
    if (!match) {
        throw new Error(`Function ${funcName} not found`);
    }
    return match[0];
}

const listSessionUsageSrc = extractFunction(cliContent, 'listSessionUsage');

function instantiateListSessionUsage(bindings = {}) {
    const bindingNames = Object.keys(bindings);
    const bindingValues = Object.values(bindings);
    return Function(...bindingNames, `${listSessionUsageSrc}\nreturn listSessionUsage;`)(...bindingValues);
}

test('listSessionUsage uses lightweight session listing without exact hydration', async () => {
    const calls = [];
    const listAllSessions = async (params) => {
        calls.push({ type: 'listAllSessions', params });
        return [
            {
                source: 'codex',
                sessionId: 'sess-1',
                messageCount: 12,
                __messageCountExact: false
            }
        ];
    };
    const listAllSessionsData = async () => {
        calls.push({ type: 'listAllSessionsData' });
        throw new Error('should not call listAllSessionsData');
    };
    const listSessionUsage = instantiateListSessionUsage({
        MAX_SESSION_LIST_SIZE: 300,
        listAllSessions,
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
                type: 'listAllSessions',
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
            messageCount: 12
        }
    ]);
});

test('listSessionUsage normalizes source and default limit for lightweight usage aggregation', async () => {
    const calls = [];
    const listAllSessions = async (params) => {
        calls.push(params);
        return [];
    };
    const listSessionUsage = instantiateListSessionUsage({
        MAX_SESSION_LIST_SIZE: 300,
        listAllSessions,
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
            limit: 300,
            forceRefresh: true
        },
        {
            source: 'all',
            limit: 200,
            forceRefresh: false
        }
    ]);
});

import assert from 'assert';
import { pathToFileURL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const pluginRoot = path.join(root, 'plugins', 'prompt-templates');

test('prompt template ownership is bound to builtin template id', async () => {
    const templates = [
        {
            folder: 'comment-polish',
            expectedId: 'builtin_comment_polish'
        },
        {
            folder: 'rule-ack',
            expectedId: 'builtin_rule_ack'
        }
    ];

    for (const tpl of templates) {
        const buildUrl = pathToFileURL(path.join(pluginRoot, tpl.folder, 'index.mjs')).href;
        const ownershipUrl = pathToFileURL(path.join(pluginRoot, tpl.folder, 'ownership.mjs')).href;
        const ownershipMod = await import(`${ownershipUrl}?t=${Date.now()}`);
        const ownership = tpl.folder === 'comment-polish' ? ownershipMod.commentPolishOwnership : ownershipMod.ruleAckOwnership;
        assert.ok(ownership && typeof ownership === 'object');
        assert.strictEqual(ownership.templateId, tpl.expectedId);
        assert.ok(typeof ownership.createdBy === 'string' && ownership.createdBy.trim());
        assert.ok(Array.isArray(ownership.maintainers) && ownership.maintainers.length > 0);

        const mod = await import(`${buildUrl}?t=${Date.now()}`);
        const buildFn = tpl.folder === 'comment-polish' ? mod.buildBuiltinCommentPolishTemplate : mod.buildBuiltinRuleAckTemplate;
        const built = buildFn(null);
        assert.strictEqual(built.id, tpl.expectedId);
        assert.strictEqual(built.createdBy, ownership.createdBy);
    }
});

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');
const pluginsDir = path.join(root, 'plugins');

function listPluginFolders() {
    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => !name.startsWith('.'))
        .sort((a, b) => a.localeCompare(b, 'en-US'));
}

function isPluginFolder(name) {
    const manifestPath = path.join(pluginsDir, name, 'manifest.mjs');
    const overviewPath = path.join(pluginsDir, name, 'overview.mjs');
    return fs.existsSync(manifestPath) && fs.existsSync(overviewPath);
}

test('each builtin plugin has ownership file matched to plugin id', async () => {
    const folders = listPluginFolders().filter((name) => isPluginFolder(name));
    assert.ok(folders.length > 0, 'expected at least one builtin plugin folder');

    for (const folder of folders) {
        const ownershipPath = path.join(pluginsDir, folder, 'ownership.mjs');
        assert.ok(fs.existsSync(ownershipPath), `missing ownership.mjs for plugin: ${folder}`);

        const manifestUrl = pathToFileURL(path.join(pluginsDir, folder, 'manifest.mjs')).href;
        const ownershipUrl = pathToFileURL(ownershipPath).href;
        const { pluginMeta } = await import(`${manifestUrl}?t=${Date.now()}`);
        const mod = await import(`${ownershipUrl}?t=${Date.now()}`);
        const pluginOwnership = mod && mod.pluginOwnership ? mod.pluginOwnership : null;

        assert.ok(pluginMeta && typeof pluginMeta === 'object', `invalid pluginMeta for plugin: ${folder}`);
        assert.strictEqual(pluginMeta.id, folder, `pluginMeta.id must match folder name: ${folder}`);
        assert.ok(pluginOwnership && typeof pluginOwnership === 'object', `invalid pluginOwnership for plugin: ${folder}`);
        assert.strictEqual(pluginOwnership.pluginId, folder, `ownership pluginId must match folder name: ${folder}`);
        assert.ok(typeof pluginOwnership.createdBy === 'string' && pluginOwnership.createdBy.trim(), `ownership createdBy must be a github handle for plugin: ${folder}`);
        assert.ok(Array.isArray(pluginOwnership.maintainers) && pluginOwnership.maintainers.length > 0, `ownership maintainers must be non-empty for plugin: ${folder}`);
        for (const maintainer of pluginOwnership.maintainers) {
            assert.ok(typeof maintainer === 'string' && maintainer.trim(), `ownership maintainer must be a github handle for plugin: ${folder}`);
        }
    }
});

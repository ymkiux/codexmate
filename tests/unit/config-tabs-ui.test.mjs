import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

function readProjectFile(relativePath) {
    return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

test('config template includes gemini and opencode tabs in top and side navigation', () => {
    const html = readProjectFile('web-ui/index.html');
    assert.match(html, /id="tab-config-gemini"/);
    assert.match(html, /id="tab-config-opencode"/);
    assert.match(html, /id="side-tab-config-gemini"/);
    assert.match(html, /id="side-tab-config-opencode"/);
    assert.match(html, /switchConfigMode\('gemini'\)/);
    assert.match(html, /switchConfigMode\('opencode'\)/);
    assert.match(html, /activeProviderBridgeHint/);
    assert.match(html, /isProviderConfigMode/);
});

test('web ui script defines provider mode metadata for codex gemini and opencode', () => {
    const appScript = readProjectFile('web-ui/app.js');
    const configModeComputed = readProjectFile('web-ui/modules/config-mode.computed.mjs');

    assert.match(appScript, /CONFIG_MODE_SET/);
    assert.match(appScript, /getProviderConfigModeMeta/);
    assert.match(appScript, /createConfigModeComputed/);
    assert.match(appScript, /\.\.\.createConfigModeComputed\(\)/);
    assert.match(appScript, /switchConfigMode\(mode\)/);
    assert.match(appScript, /mode\.trim\(\)\.toLowerCase\(\)/);

    assert.match(configModeComputed, /const PROVIDER_CONFIG_MODE_META = Object\.freeze\(/);
    assert.match(configModeComputed, /gemini:\s*Object\.freeze\(/);
    assert.match(configModeComputed, /opencode:\s*Object\.freeze\(/);
    assert.match(configModeComputed, /export const CONFIG_MODE_SET = new Set\(/);
    assert.match(configModeComputed, /isProviderConfigMode\(\)/);
    assert.match(configModeComputed, /activeProviderModelPlaceholder\(\)/);
});

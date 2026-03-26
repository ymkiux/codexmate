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

test('config template keeps expected config tabs in top and side navigation', () => {
    const html = readProjectFile('web-ui/index.html');
    const topTabModes = [...html.matchAll(/id="tab-config-([a-z]+)"/g)]
        .map((match) => match[1]);
    const sideTabModes = [...html.matchAll(/id="side-tab-config-([a-z]+)"/g)]
        .map((match) => match[1]);

    assert.deepStrictEqual(topTabModes, ['codex', 'claude', 'openclaw']);
    assert.deepStrictEqual(sideTabModes, ['codex', 'claude', 'openclaw']);
    assert.match(html, /activeProviderBridgeHint/);
    assert.match(html, /isProviderConfigMode/);
    assert.match(html, /provider-fast-switch-select/);
    assert.match(html, /forceCompactLayout/);
    assert.match(html, /quickSwitchProvider\(\$event\.target\.value\)/);
    assert.match(html, /<button class="card-action-btn"[^>]*@click="copyClaudeShareCommand\(name\)"[^>]*disabled[^>]*>/);
});

test('web ui script defines provider mode metadata for codex only', () => {
    const appScript = readProjectFile('web-ui/app.js');
    const configModeComputed = readProjectFile('web-ui/modules/config-mode.computed.mjs');

    assert.match(appScript, /CONFIG_MODE_SET/);
    assert.match(appScript, /getProviderConfigModeMeta/);
    assert.match(appScript, /createConfigModeComputed/);
    assert.match(appScript, /\.\.\.createConfigModeComputed\(\)/);
    assert.match(appScript, /switchConfigMode\(mode\)/);
    assert.match(appScript, /mode\.trim\(\)\.toLowerCase\(\)/);
    assert.match(appScript, /quickSwitchProvider\(name\)/);
    assert.match(appScript, /performProviderSwitch\(name\)/);
    assert.match(appScript, /waitForCodexApplyIdle\(maxWaitMs = 20000\)/);
    assert.match(appScript, /target === this\.pendingProviderSwitch/);
    assert.match(appScript, /!this\.providerSwitchInProgress && target === this\.currentProvider/);
    assert.match(appScript, /await this\.waitForCodexApplyIdle\(\);/);
    assert.match(appScript, /runLatestOnlyQueue\(/);
    assert.match(appScript, /providerSwitchInProgress:\s*false/);
    assert.match(appScript, /pendingProviderSwitch:\s*''/);

    assert.match(configModeComputed, /const PROVIDER_CONFIG_MODE_META = Object\.freeze\(/);
    const providerModeKeys = [...configModeComputed.matchAll(/^\s*([a-z]+):\s*Object\.freeze\(/gm)]
        .map((match) => match[1]);
    assert.deepStrictEqual(providerModeKeys, ['codex']);
    assert.match(configModeComputed, /export const CONFIG_MODE_SET = new Set\(/);
    assert.match(configModeComputed, /isProviderConfigMode\(\)/);
    assert.match(configModeComputed, /activeProviderModelPlaceholder\(\)/);
});

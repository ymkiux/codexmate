import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tests = [];
globalThis.test = (name, fn) => tests.push({ name, fn });

await import(pathToFileURL(path.join(__dirname, 'web-ui-logic.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'web-ui-runtime-navigation-regression.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'api-module.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'reset-main.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'session-query.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'mcp-stdio.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'workflow-engine.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'skills-modal-ui.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'skills-market-runtime.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'readme-docs-consistency.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'config-tabs-ui.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'compact-layout-ui.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'web-ui-source-bundle.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'startup-claude-star-prompt.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'install-methods.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'cli-network-utils.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'config-health-module.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'openclaw-core.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'openclaw-editing.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'openclaw-persist-regression.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'agents-modal-guards.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'session-actions-standalone.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'session-browser-timeline-regression.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'session-detail-preview-fast.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'session-usage.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'session-usage-backend.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'agents-diff-ui.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'text-diff.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'claude-settings-sync.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'unzip-ext.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'provider-share-command.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'providers-validation.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'provider-switch-regression.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'codex-proxy-options.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'claude-proxy-adapter.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'coderabbit-workflows.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'ci-workflow-contract.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'lint-contract.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'session-tab-switch-performance.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'session-trash-state.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'web-ui-restart.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'web-ui-behavior-parity.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'web-run-host.test.mjs')));

let failures = 0;
for (const { name, fn } of tests) {
    try {
        await fn();
        console.log(`\u2713 ${name}`);
    } catch (err) {
        failures += 1;
        console.error(`\u2717 ${name}`);
        console.error(err);
    }
}

if (failures) {
    console.error(`Failed ${failures} test(s).`);
    process.exit(1);
} else {
    console.log(`All ${tests.length} tests passed.`);
}

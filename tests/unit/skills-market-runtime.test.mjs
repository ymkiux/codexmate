import assert from 'assert';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { createSkillsMethods } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'modules', 'skills.methods.mjs')));
const { createSkillsComputed } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web-ui', 'modules', 'skills.computed.mjs')));

function buildVm(apiImpl, overrides = {}) {
    const methods = createSkillsMethods({ api: apiImpl });
    const vm = {
        skillsTargetApp: 'codex',
        skillsRootPath: '',
        skillsList: [],
        skillsSelectedNames: [],
        skillsLoading: false,
        skillsDeleting: false,
        skillsKeyword: '',
        skillsStatusFilter: 'all',
        skillsImportList: [],
        skillsImportSelectedKeys: [],
        skillsScanningImports: false,
        skillsImporting: false,
        skillsZipImporting: false,
        skillsExporting: false,
        skillsMarketLoading: false,
        skillsMarketLocalLoadedOnce: false,
        skillsMarketImportLoadedOnce: false,
        showSkillsModal: false,
        messageLog: [],
        showMessage(message, type) {
            this.messageLog.push({ message, type });
        },
        requestConfirmDialog: async () => true,
        $refs: {},
        ...methods,
        ...overrides
    };

    const computed = createSkillsComputed();
    for (const [key, getter] of Object.entries(computed)) {
        Object.defineProperty(vm, key, {
            configurable: true,
            enumerable: true,
            get() {
                return getter.call(vm);
            }
        });
    }

    return vm;
}

test('refreshSkillsList requests generic skills API for current host target', async () => {
    const calls = [];
    const vm = buildVm(async (action, params) => {
        calls.push({ action, params });
        return {
            exists: true,
            root: '/tmp/claude-skills',
            items: [{ name: 'demo-skill', hasSkillFile: true }]
        };
    }, {
        skillsTargetApp: 'claude'
    });

    const ok = await vm.refreshSkillsList({ silent: true });

    assert.strictEqual(ok, true);
    assert.deepStrictEqual(calls, [{
        action: 'list-skills',
        params: { targetApp: 'claude' }
    }]);
    assert.strictEqual(vm.skillsRootPath, '/tmp/claude-skills');
    assert.strictEqual(vm.skillsList.length, 1);
});

test('setSkillsTargetApp resets local state and reloads local market slices only', async () => {
    let receivedOptions = null;
    const vm = buildVm(async () => ({}), {
        skillsTargetApp: 'codex',
        skillsRootPath: '/tmp/codex-skills',
        skillsList: [{ name: 'alpha', hasSkillFile: true }],
        skillsImportList: [{ name: 'beta', sourceApp: 'claude' }]
    });
    vm.loadSkillsMarketOverview = async (options) => {
        receivedOptions = options;
        return true;
    };

    const ok = await vm.setSkillsTargetApp('claude', { silent: false });

    assert.strictEqual(ok, true);
    assert.strictEqual(vm.skillsTargetApp, 'claude');
    assert.deepStrictEqual(vm.skillsList, []);
    assert.deepStrictEqual(vm.skillsImportList, []);
    assert.deepStrictEqual(receivedOptions, {
        forceRefresh: true,
        silent: false
    });
});

test('loadSkillsMarketOverview refreshes installed skills and importable sources only', async () => {
    const steps = [];
    const vm = buildVm(async () => ({}));
    vm.refreshSkillsList = async (options) => {
        steps.push(['refresh', options]);
        vm.skillsMarketLocalLoadedOnce = true;
        return true;
    };
    vm.scanImportableSkills = async (options) => {
        steps.push(['scan', options]);
        vm.skillsMarketImportLoadedOnce = true;
        return true;
    };

    const ok = await vm.loadSkillsMarketOverview({ forceRefresh: true, silent: true });

    assert.strictEqual(ok, true);
    assert.deepStrictEqual(steps, [
        ['refresh', { silent: true }],
        ['scan', { silent: true }]
    ]);
    assert.strictEqual(vm.skillsMarketLoading, false);
});

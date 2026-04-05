import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import {
    projectRoot,
    readExecutableBundledWebUiScript
} from './web-ui-source.mjs';

const require = createRequire(import.meta.url);
const sourceBundle = require(path.join(projectRoot, 'web-ui', 'source-bundle.cjs'));

const HEAD_WEB_UI_ENTRY = 'web-ui/app.js';
const WEB_UI_ROOT = 'web-ui';

function setGlobalOverride(name, value) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {
        configurable: true,
        writable: true,
        value
    });
    return () => {
        if (previous) {
            Object.defineProperty(globalThis, name, previous);
            return;
        }
        delete globalThis[name];
    };
}

export async function withGlobalOverrides(overrides, callback) {
    const restoreStack = [];
    try {
        for (const [name, value] of Object.entries(overrides || {})) {
            restoreStack.push(setGlobalOverride(name, value));
        }
        return await callback();
    } finally {
        while (restoreStack.length) {
            const restore = restoreStack.pop();
            restore();
        }
    }
}

function readGitProjectFile(ref, relativePath) {
    return execFileSync('git', ['show', `${ref}:${relativePath}`], {
        cwd: projectRoot,
        encoding: 'utf8'
    });
}

function listGitTreeFiles(ref, relativePath) {
    const output = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', ref, '--', relativePath], {
        cwd: projectRoot,
        encoding: 'utf8'
    });
    return output
        .split('\0')
        .map((item) => item.trim())
        .filter(Boolean);
}

function gitRefExists(ref) {
    try {
        execFileSync('git', ['rev-parse', '--verify', ref], {
            cwd: projectRoot,
            stdio: 'ignore'
        });
        return true;
    } catch (_) {
        return false;
    }
}

function resolveBehaviorParityBaselineRef() {
    const override = String(process.env.WEB_UI_PARITY_BASE_REF || '').trim();
    if (override && gitRefExists(override)) {
        return override;
    }
    return 'HEAD';
}

function createGitWebUiFixture(ref) {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmate-head-web-ui-'));
    const projectPaths = listGitTreeFiles(ref, WEB_UI_ROOT);

    for (const relativePath of projectPaths) {
        const targetPath = path.join(fixtureRoot, relativePath.replace(/^web-ui[\\/]/, ''));
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, readGitProjectFile(ref, relativePath), 'utf8');
    }
    return fixtureRoot;
}

function createCaptureDocument(listeners) {
    return {
        body: {
            appendChild() {},
            removeChild() {},
            classList: {
                add() {},
                remove() {},
                toggle() {}
            }
        },
        documentElement: {
            clientWidth: 0
        },
        addEventListener(name, fn) {
            listeners[name] = fn;
        },
        querySelector() {
            return null;
        },
        querySelectorAll() {
            return [];
        },
        getElementById() {
            return null;
        },
        createElement() {
            return {
                className: '',
                textContent: '',
                href: '',
                download: '',
                appendChild() {},
                removeAttribute() {},
                click() {},
                setAttribute() {},
                select() {},
                setSelectionRange() {},
                parentNode: {
                    removeChild() {}
                },
                classList: {
                    add() {},
                    remove() {},
                    toggle() {}
                },
                style: {}
            };
        },
        execCommand() {
            return false;
        }
    };
}

async function captureAppOptionsFromScript(scriptSource, label) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `codexmate-bundled-web-ui-${label}-`));
    const tempFile = path.join(tempDir, 'app.bundle.mjs');
    const listeners = Object.create(null);
    let appOptions = null;

    fs.writeFileSync(tempFile, scriptSource, 'utf8');

    try {
        await withGlobalOverrides({
            document: createCaptureDocument(listeners),
            location: {
                origin: 'http://127.0.0.1:3737',
                href: 'http://127.0.0.1:3737/web-ui',
                pathname: '/web-ui',
                search: ''
            },
            window: {
                location: {
                    origin: 'http://127.0.0.1:3737',
                    href: 'http://127.0.0.1:3737/web-ui',
                    pathname: '/web-ui',
                    search: ''
                },
                addEventListener() {},
                removeEventListener() {},
                open() {},
                isSecureContext: false,
                screen: {
                    width: 0,
                    height: 0
                },
                innerWidth: 0,
                matchMedia() {
                    return { matches: false };
                }
            },
            localStorage: {
                getItem() {
                    return null;
                },
                setItem() {},
                removeItem() {}
            },
            navigator: {
                clipboard: {
                    async writeText() {}
                },
                maxTouchPoints: 0,
                userAgent: ''
            },
            fetch: async () => ({
                ok: true,
                status: 200,
                headers: {
                    get() {
                        return 'application/json';
                    }
                },
                async json() {
                    return {};
                },
                async text() {
                    return '';
                }
            }),
            requestAnimationFrame(callback) {
                return setTimeout(() => {
                    callback();
                }, 0);
            },
            cancelAnimationFrame(id) {
                clearTimeout(id);
            },
            ResizeObserver: function ResizeObserver() {
                this.observe = () => {};
                this.disconnect = () => {};
            },
            Vue: {
                createApp(options) {
                    appOptions = options;
                    return {
                        mount() {}
                    };
                }
            }
        }, async () => {
            await import(`${pathToFileURL(tempFile).href}?t=${Date.now()}-${Math.random()}`);
            if (typeof listeners.DOMContentLoaded === 'function') {
                await listeners.DOMContentLoaded();
            }
        });
    } finally {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
    }

    if (!appOptions) {
        throw new Error(`Failed to capture app options for ${label}`);
    }
    return appOptions;
}

export async function captureCurrentBundledAppOptions() {
    return captureAppOptionsFromScript(readExecutableBundledWebUiScript(), 'current');
}

export async function captureGitBundledAppOptions(ref) {
    const fixtureRoot = createGitWebUiFixture(ref);
    try {
        const scriptSource = sourceBundle.readExecutableBundledWebUiScript(
            path.join(fixtureRoot, HEAD_WEB_UI_ENTRY.replace(/^web-ui[\\/]/, ''))
        );
        return await captureAppOptionsFromScript(scriptSource, `git-${String(ref).replace(/[^\w.-]+/g, '-')}`);
    } finally {
        try {
            fs.rmSync(fixtureRoot, { recursive: true, force: true });
        } catch (_) {}
    }
}

export async function captureBehaviorParityBaselineAppOptions() {
    const ref = resolveBehaviorParityBaselineRef();
    return {
        ref,
        options: await captureGitBundledAppOptions(ref)
    };
}

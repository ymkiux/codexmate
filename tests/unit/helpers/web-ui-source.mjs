import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..', '..');
const require = createRequire(import.meta.url);
const sourceBundle = require(path.join(projectRoot, 'web-ui', 'source-bundle.cjs'));

export function readProjectFile(relativePath) {
    return sourceBundle.readUtf8Text(path.join(projectRoot, relativePath));
}

export function readBundledWebUiHtml() {
    return sourceBundle.readBundledWebUiHtml(path.join(projectRoot, 'web-ui', 'index.html'));
}

export function readBundledWebUiCss() {
    return sourceBundle.readBundledWebUiCss(path.join(projectRoot, 'web-ui', 'styles.css'));
}

export function readBundledWebUiScript() {
    return sourceBundle.readBundledWebUiScript(path.join(projectRoot, 'web-ui', 'app.js'));
}

export function readExecutableBundledWebUiScript() {
    return sourceBundle.readExecutableBundledWebUiScript(path.join(projectRoot, 'web-ui', 'app.js'));
}

export function readExecutableBundledWebUiModule(relativePath) {
    return sourceBundle.readExecutableBundledJavaScriptModule(path.join(projectRoot, relativePath));
}

export { projectRoot };

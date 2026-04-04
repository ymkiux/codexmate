const fs = require('fs');
const path = require('path');

const HTML_INCLUDE_RE = /^[ \t]*<!--\s*@include\s+(.+?)\s*-->\s*$/gm;
const CSS_IMPORT_RE = /^[ \t]*@import\s+(?:url\(\s*)?(['"]?)([^'")]+)\1\s*\)?\s*;/gm;
const JS_IMPORT_RE = /(?:^|\n)\s*import\s+(?:[\s\S]*?\s+from\s+)?['"](\.[^'"]+)['"]\s*;?/g;
const JS_EXPORT_FROM_RE = /(?:^|\n)\s*export\s+\*\s+from\s+['"](\.[^'"]+)['"]\s*;?/g;
const JS_RELATIVE_IMPORT_STATEMENT_RE = /(^|\n)([ \t]*)import\s+([\s\S]*?)\s+from\s+['"](\.[^'"]+)['"]\s*;?[ \t]*/g;
const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;

function stripBom(content) {
    return content.replace(/^\uFEFF/, '');
}

function readUtf8Text(filePath) {
    return stripBom(fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n'));
}

function normalizeIncludeTarget(rawTarget) {
    const trimmed = String(rawTarget || '').trim();
    if (!trimmed) return '';
    return trimmed.replace(/^['"]|['"]$/g, '');
}

function assertNoCircularDependency(filePath, stack) {
    if (!stack.includes(filePath)) {
        return;
    }
    const cycle = [...stack, filePath]
        .map(item => path.relative(path.join(__dirname, '..'), item))
        .join(' -> ');
    throw new Error(`Detected circular source include: ${cycle}`);
}

function bundleHtmlFile(filePath, stack = []) {
    assertNoCircularDependency(filePath, stack);
    const source = readUtf8Text(filePath);
    return source.replace(HTML_INCLUDE_RE, (_match, rawTarget) => {
        const target = normalizeIncludeTarget(rawTarget);
        if (!target) {
            return '';
        }
        const targetPath = path.resolve(path.dirname(filePath), target);
        return bundleHtmlFile(targetPath, [...stack, filePath]);
    });
}

function bundleCssFile(filePath, stack = []) {
    assertNoCircularDependency(filePath, stack);
    const source = readUtf8Text(filePath);
    return source.replace(CSS_IMPORT_RE, (match, _quote, rawTarget) => {
        const target = normalizeIncludeTarget(rawTarget);
        if (!target || !target.startsWith('.')) {
            return match;
        }
        const targetPath = path.resolve(path.dirname(filePath), target);
        return bundleCssFile(targetPath, [...stack, filePath]);
    });
}

function resolveJavaScriptDependencies(filePath) {
    const source = readUtf8Text(filePath);
    const dependencies = [];
    for (const pattern of [JS_IMPORT_RE, JS_EXPORT_FROM_RE]) {
        let match = pattern.exec(source);
        while (match) {
            const target = normalizeIncludeTarget(match[1]);
            if (target.startsWith('.')) {
                dependencies.push(path.resolve(path.dirname(filePath), target));
            }
            match = pattern.exec(source);
        }
        pattern.lastIndex = 0;
    }
    return dependencies;
}

function bundleJavaScriptFile(filePath, visited = new Set()) {
    if (visited.has(filePath)) {
        return '';
    }
    visited.add(filePath);

    const relativePath = path.relative(path.join(__dirname, '..'), filePath).replace(/\\/g, '/');
    const source = readUtf8Text(filePath);
    const chunks = [
        `// ===== FILE: ${relativePath} =====`,
        source.trimEnd(),
        ''
    ];

    for (const dependencyPath of resolveJavaScriptDependencies(filePath)) {
        chunks.push(bundleJavaScriptFile(dependencyPath, visited).trimEnd());
        chunks.push('');
    }

    return chunks.join('\n').trimEnd() + '\n';
}

function collectJavaScriptFiles(filePath, ordered = [], visited = new Set(), stack = []) {
    assertNoCircularDependency(filePath, stack);
    if (visited.has(filePath)) {
        return ordered;
    }
    visited.add(filePath);
    for (const dependencyPath of resolveJavaScriptDependencies(filePath)) {
        collectJavaScriptFiles(dependencyPath, ordered, visited, [...stack, filePath]);
    }
    ordered.push(filePath);
    return ordered;
}

function splitCommaSeparatedSpecifiers(source) {
    const items = [];
    let current = '';
    let depth = 0;
    for (let i = 0; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '{' || ch === '[' || ch === '(') {
            depth += 1;
        } else if (ch === '}' || ch === ']' || ch === ')') {
            depth = Math.max(0, depth - 1);
        }
        if (ch === ',' && depth === 0) {
            items.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    if (current) {
        items.push(current);
    }
    return items.map(item => item.trim()).filter(Boolean);
}

function buildRelativeImportAliasStatements(importClause, filePath) {
    const clause = String(importClause || '').trim();
    if (!clause) {
        return '';
    }
    if (!clause.startsWith('{') || !clause.endsWith('}')) {
        throw new Error(`Unsupported executable bundle import in ${filePath}: ${clause}`);
    }

    const innerClause = clause.slice(1, -1).trim();
    if (!innerClause) {
        return '';
    }

    const statements = [];
    for (const specifier of splitCommaSeparatedSpecifiers(innerClause)) {
        const parts = specifier.split(/\s+as\s+/);
        const imported = String(parts[0] || '').trim();
        const local = String(parts[1] || imported).trim();
        if (!IDENTIFIER_RE.test(imported) || !IDENTIFIER_RE.test(local)) {
            throw new Error(`Unsupported executable bundle import specifier in ${filePath}: ${specifier}`);
        }
        if (local !== imported) {
            statements.push(`const ${local} = ${imported};`);
        }
    }
    return statements.join('\n');
}

function transformJavaScriptModuleSource(source, options = {}) {
    const preserveExports = !!options.preserveExports;
    const sourcePath = typeof source === 'string' ? source : String(source || '');
    let transformed = readUtf8Text(sourcePath);
    transformed = transformed.replace(JS_RELATIVE_IMPORT_STATEMENT_RE, (_match, prefix, indent, importClause) => {
        const aliases = buildRelativeImportAliasStatements(importClause, sourcePath);
        if (!aliases) {
            return prefix || '';
        }
        const indentedAliases = aliases
            .split('\n')
            .map(line => `${indent || ''}${line}`)
            .join('\n');
        return `${prefix || ''}${indentedAliases}\n`;
    });
    transformed = transformed.replace(/^[ \t]*export\s+\*\s+from\s+['"]\.[^'"]+['"]\s*;?\s*$/gm, '');
    if (!preserveExports) {
        transformed = transformed.replace(/(^|\n)([ \t]*)export\s+(?=(?:async\s+function|const|let|class|function)\b)/g, '$1$2');
    }
    return transformed.trimEnd();
}

function bundleExecutableJavaScriptFile(entryPath, options = {}) {
    const orderedFiles = collectJavaScriptFiles(entryPath);
    const preserveExports = !!options.preserveExports;
    const chunks = [];
    for (const filePath of orderedFiles) {
        const transformed = transformJavaScriptModuleSource(filePath, { preserveExports });
        if (!transformed) {
            continue;
        }
        chunks.push(transformed);
    }
    return chunks.join('\n\n').trimEnd() + '\n';
}

function readBundledWebUiHtml(entryPath = path.join(__dirname, 'index.html')) {
    return bundleHtmlFile(entryPath).trimEnd() + '\n';
}

function readBundledWebUiCss(entryPath = path.join(__dirname, 'styles.css')) {
    return bundleCssFile(entryPath).trimEnd() + '\n';
}

function readBundledWebUiScript(entryPath = path.join(__dirname, 'app.js')) {
    return bundleJavaScriptFile(entryPath);
}

function readExecutableBundledWebUiScript(entryPath = path.join(__dirname, 'app.js')) {
    return bundleExecutableJavaScriptFile(entryPath, { preserveExports: false });
}

function readExecutableBundledJavaScriptModule(entryPath) {
    return bundleExecutableJavaScriptFile(entryPath, { preserveExports: true });
}

module.exports = {
    collectJavaScriptFiles,
    readUtf8Text,
    readBundledWebUiHtml,
    readBundledWebUiCss,
    readBundledWebUiScript,
    readExecutableBundledWebUiScript,
    readExecutableBundledJavaScriptModule
};

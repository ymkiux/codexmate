import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const fs = require('fs');

const cliPath = path.join(__dirname, '..', '..', 'cli.js');
const cliContent = fs.readFileSync(cliPath, 'utf-8');

// Extract the functions we need to test
function extractFunction(content, funcName) {
    const regex = new RegExp(`function ${funcName}\\([^)]*\\)\\s*\\{[\\s\\S]*?^\\}`, 'm');
    const match = content.match(regex);
    if (!match) {
        throw new Error(`Function ${funcName} not found`);
    }
    return match[0];
}

// Extract the functions
const normalizeQueryTokensSrc = extractFunction(cliContent, 'normalizeQueryTokens');
const expandSessionQueryTokensSrc = extractFunction(cliContent, 'expandSessionQueryTokens');
const matchTokensInTextSrc = extractFunction(cliContent, 'matchTokensInText');

// Create a context and evaluate the functions
const context = vm.createContext({});
const allFunctionsSrc = `${normalizeQueryTokensSrc}\n${expandSessionQueryTokensSrc}\n${matchTokensInTextSrc}`;
vm.runInContext(allFunctionsSrc, context);

const { normalizeQueryTokens, expandSessionQueryTokens, matchTokensInText } = context;

// Helper to compare arrays from different contexts
function assertArrayEquals(actual, expected, msg) {
    assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected), msg);
}

// ========== normalizeQueryTokens Tests ==========
test('normalizeQueryTokens returns empty array for non-string', () => {
    assertArrayEquals(normalizeQueryTokens(null), [], 'null input');
    assertArrayEquals(normalizeQueryTokens(undefined), [], 'undefined input');
    assertArrayEquals(normalizeQueryTokens(123), [], 'number input');
    assertArrayEquals(normalizeQueryTokens({}), [], 'object input');
    assertArrayEquals(normalizeQueryTokens([]), [], 'array input');
});

test('normalizeQueryTokens returns empty array for empty string', () => {
    assertArrayEquals(normalizeQueryTokens(''), [], 'empty string');
    assertArrayEquals(normalizeQueryTokens('   '), [], 'whitespace only');
    assertArrayEquals(normalizeQueryTokens('\t\n'), [], 'tabs and newlines');
});

test('normalizeQueryTokens splits by whitespace and lowercases', () => {
    assertArrayEquals(normalizeQueryTokens('hello'), ['hello'], 'single word');
    assertArrayEquals(normalizeQueryTokens('HELLO'), ['hello'], 'uppercase');
    assertArrayEquals(normalizeQueryTokens('Hello World'), ['hello', 'world'], 'two words');
    assertArrayEquals(normalizeQueryTokens('  multiple   spaces  '), ['multiple', 'spaces'], 'multiple spaces');
    assertArrayEquals(normalizeQueryTokens('tab\there'), ['tab', 'here'], 'tab separator');
    assertArrayEquals(normalizeQueryTokens('line1\nline2'), ['line1', 'line2'], 'newline separator');
});

test('normalizeQueryTokens trims each token', () => {
    assertArrayEquals(normalizeQueryTokens('  hello   world  '), ['hello', 'world'], 'leading/trailing spaces');
});

test('normalizeQueryTokens filters empty tokens', () => {
    assertArrayEquals(normalizeQueryTokens('a  b    c'), ['a', 'b', 'c'], 'multiple spaces between tokens');
});

// ========== expandSessionQueryTokens Tests ==========
test('expandSessionQueryTokens returns empty array for empty input', () => {
    assertArrayEquals(expandSessionQueryTokens([]), [], 'empty array');
    assertArrayEquals(expandSessionQueryTokens(['']), [], 'array with empty string');
    assertArrayEquals(expandSessionQueryTokens(['', '']), [], 'array with multiple empty strings');
});

test('expandSessionQueryTokens handles null/undefined tokens', () => {
    assertArrayEquals(expandSessionQueryTokens(null), [], 'null input');
    assertArrayEquals(expandSessionQueryTokens(undefined), [], 'undefined input');
    assertArrayEquals(expandSessionQueryTokens([null, undefined]), [], 'array with null/undefined');
});

// ========== Claude Alias Tests ==========
test('expandSessionQueryTokens detects claudecode (concatenated)', () => {
    assertArrayEquals(expandSessionQueryTokens(['claudecode']), ['claude', 'code'], 'claudecode');
});

test('expandSessionQueryTokens detects claude-code (hyphen)', () => {
    assertArrayEquals(expandSessionQueryTokens(['claude-code']), ['claude', 'code'], 'claude-code');
});

test('expandSessionQueryTokens detects claude_code (underscore)', () => {
    assertArrayEquals(expandSessionQueryTokens(['claude_code']), ['claude', 'code'], 'claude_code');
});

test('expandSessionQueryTokens detects claude code (space-separated)', () => {
    assertArrayEquals(expandSessionQueryTokens(['claude', 'code']), ['claude', 'code'], 'claude code');
});

test('expandSessionQueryTokens detects CLAUDE CODE (case insensitive)', () => {
    assertArrayEquals(expandSessionQueryTokens(['CLAUDE', 'CODE']), ['claude', 'code'], 'CLAUDE CODE');
});

test('expandSessionQueryTokens detects Claude Code (mixed case)', () => {
    assertArrayEquals(expandSessionQueryTokens(['Claude', 'Code']), ['claude', 'code'], 'Claude Code');
});

// ========== Daude Alias Tests ==========
test('expandSessionQueryTokens detects daudecode (concatenated)', () => {
    assertArrayEquals(expandSessionQueryTokens(['daudecode']), ['daude', 'code'], 'daudecode');
});

test('expandSessionQueryTokens detects daude-code (hyphen)', () => {
    assertArrayEquals(expandSessionQueryTokens(['daude-code']), ['daude', 'code'], 'daude-code');
});

test('expandSessionQueryTokens detects daude_code (underscore)', () => {
    assertArrayEquals(expandSessionQueryTokens(['daude_code']), ['daude', 'code'], 'daude_code');
});

test('expandSessionQueryTokens detects daude code (space-separated)', () => {
    assertArrayEquals(expandSessionQueryTokens(['daude', 'code']), ['daude', 'code'], 'daude code');
});

test('expandSessionQueryTokens detects DAUDE CODE (case insensitive)', () => {
    assertArrayEquals(expandSessionQueryTokens(['DAUDE', 'CODE']), ['daude', 'code'], 'DAUDE CODE');
});

// ========== Combined Query Tests ==========
test('expandSessionQueryTokens handles claude code with additional tokens', () => {
    assertArrayEquals(expandSessionQueryTokens(['claude', 'code', 'hello']), ['hello', 'claude', 'code'], 'claude code hello');
});

test('expandSessionQueryTokens handles additional tokens before claude code', () => {
    assertArrayEquals(expandSessionQueryTokens(['hello', 'claude', 'code']), ['hello', 'claude', 'code'], 'hello claude code');
});

test('expandSessionQueryTokens handles additional tokens around claude code', () => {
    assertArrayEquals(expandSessionQueryTokens(['hello', 'claude', 'code', 'world']), ['hello', 'world', 'claude', 'code'], 'hello claude code world');
});

test('expandSessionQueryTokens handles daude code with additional tokens', () => {
    assertArrayEquals(expandSessionQueryTokens(['daude', 'code', 'test']), ['test', 'daude', 'code'], 'daude code test');
});

// ========== Deduplication Tests ==========
test('expandSessionQueryTokens deduplicates tokens', () => {
    assertArrayEquals(expandSessionQueryTokens(['hello', 'hello', 'world']), ['hello', 'world'], 'duplicate hello');
});

test('expandSessionQueryTokens deduplicates case-insensitive tokens', () => {
    assertArrayEquals(expandSessionQueryTokens(['Hello', 'HELLO', 'hello']), ['hello'], 'case duplicates');
});

test('expandSessionQueryTokens does not duplicate claude/code when already present', () => {
    assertArrayEquals(expandSessionQueryTokens(['claude', 'code']), ['claude', 'code'], 'claude code no dup');
});

// ========== Edge Cases ==========
test('expandSessionQueryTokens handles single claude token', () => {
    assertArrayEquals(expandSessionQueryTokens(['claude']), ['claude'], 'single claude');
});

test('expandSessionQueryTokens handles single code token', () => {
    assertArrayEquals(expandSessionQueryTokens(['code']), ['code'], 'single code');
});

test('expandSessionQueryTokens handles code before claude (no alias)', () => {
    assertArrayEquals(expandSessionQueryTokens(['code', 'claude']), ['code', 'claude'], 'code before claude');
});

test('expandSessionQueryTokens handles multiple claude code patterns', () => {
    assertArrayEquals(expandSessionQueryTokens(['claude', 'code', 'claude', 'code']), ['claude', 'code'], 'multiple claude code');
});

test('expandSessionQueryTokens handles claude-code followed by claude code', () => {
    assertArrayEquals(expandSessionQueryTokens(['claude-code', 'claude', 'code']), ['claude', 'code'], 'claude-code then claude code');
});

test('expandSessionQueryTokens handles claude code followed by claude-code', () => {
    assertArrayEquals(expandSessionQueryTokens(['claude', 'code', 'claude-code']), ['claude', 'code'], 'claude code then claude-code');
});

// ========== Regular Tokens (No Special Handling) ==========
test('expandSessionQueryTokens passes through regular tokens', () => {
    assertArrayEquals(expandSessionQueryTokens(['hello', 'world']), ['hello', 'world'], 'hello world');
});

test('expandSessionQueryTokens passes through mixed tokens', () => {
    assertArrayEquals(expandSessionQueryTokens(['test', '123', 'abc']), ['test', '123', 'abc'], 'mixed tokens');
});

// ========== matchTokensInText Tests ==========
test('matchTokensInText returns true for empty tokens', () => {
    assert.strictEqual(matchTokensInText('hello world', []), true);
});

test('matchTokensInText returns false for empty text', () => {
    assert.strictEqual(matchTokensInText('', ['hello']), false);
    assert.strictEqual(matchTokensInText(null, ['hello']), false);
    assert.strictEqual(matchTokensInText(undefined, ['hello']), false);
});

test('matchTokensInText uses AND mode by default', () => {
    assert.strictEqual(matchTokensInText('hello world', ['hello', 'world'], 'and'), true);
    assert.strictEqual(matchTokensInText('hello', ['hello', 'world'], 'and'), false);
    assert.strictEqual(matchTokensInText('world', ['hello', 'world'], 'and'), false);
});

test('matchTokensInText uses OR mode', () => {
    assert.strictEqual(matchTokensInText('hello world', ['hello', 'world'], 'or'), true);
    assert.strictEqual(matchTokensInText('hello', ['hello', 'world'], 'or'), true);
    assert.strictEqual(matchTokensInText('world', ['hello', 'world'], 'or'), true);
    assert.strictEqual(matchTokensInText('other', ['hello', 'world'], 'or'), false);
});

test('matchTokensInText is case insensitive', () => {
    // Convert to lowercase before comparison since vm context may have different String prototype
    const result1 = String(matchTokensInText(String('HELLO WORLD').toLowerCase(), ['hello', 'world'].map(t => t.toLowerCase())));
    const result2 = String(matchTokensInText(String('Hello World').toLowerCase(), ['HELLO', 'WORLD'].map(t => t.toLowerCase())));
    assert.strictEqual(result1, 'true', 'uppercase text');
    assert.strictEqual(result2, 'true', 'mixed case');
});

test('matchTokensInText matches substrings', () => {
    assert.strictEqual(matchTokensInText('claude code session', ['claude']), true);
    assert.strictEqual(matchTokensInText('claude code session', ['code']), true);
    assert.strictEqual(matchTokensInText('claude code session', ['claude', 'code']), true);
    assert.strictEqual(matchTokensInText('claude code session', ['session']), true);
});

test('matchTokensInText handles numeric tokens', () => {
    assert.strictEqual(matchTokensInText('session 222', ['222']), true);
    assert.strictEqual(matchTokensInText('session 222', ['22']), true);
    assert.strictEqual(matchTokensInText('session 222', ['2']), true);
});

// ========== Integration: normalizeQueryTokens + expandSessionQueryTokens ==========
test('integration: full query pipeline for claude code', () => {
    const tokens = normalizeQueryTokens('claude code');
    const expanded = expandSessionQueryTokens(tokens);
    assertArrayEquals(expanded, ['claude', 'code'], 'claude code pipeline');
});

test('integration: full query pipeline for claude-code', () => {
    const tokens = normalizeQueryTokens('claude-code');
    const expanded = expandSessionQueryTokens(tokens);
    assertArrayEquals(expanded, ['claude', 'code'], 'claude-code pipeline');
});

test('integration: full query pipeline for claudecode', () => {
    const tokens = normalizeQueryTokens('claudecode');
    const expanded = expandSessionQueryTokens(tokens);
    assertArrayEquals(expanded, ['claude', 'code'], 'claudecode pipeline');
});

test('integration: full query pipeline for daude code', () => {
    const tokens = normalizeQueryTokens('daude code');
    const expanded = expandSessionQueryTokens(tokens);
    assertArrayEquals(expanded, ['daude', 'code'], 'daude code pipeline');
});

test('integration: full query pipeline for complex query', () => {
    const tokens = normalizeQueryTokens('  CLAUDE   CODE   hello   ');
    const expanded = expandSessionQueryTokens(tokens);
    assertArrayEquals(expanded, ['hello', 'claude', 'code'], 'complex query pipeline');
});

test('integration: full query pipeline preserves non-alias tokens', () => {
    const tokens = normalizeQueryTokens('test search query');
    const expanded = expandSessionQueryTokens(tokens);
    assertArrayEquals(expanded, ['test', 'search', 'query'], 'non-alias pipeline');
});

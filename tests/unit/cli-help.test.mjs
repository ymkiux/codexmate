import assert from 'assert';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.join(__dirname, '..', '..', 'cli.js');

function runCli(args = []) {
    return spawnSync(process.execPath, [cliPath, ...args], {
        cwd: path.join(__dirname, '..', '..'),
        encoding: 'utf-8'
    });
}

test('top-level help flags print usage and exit successfully', () => {
    for (const args of [[], ['--help'], ['-h'], ['help']]) {
        const result = runCli(args);
        assert.strictEqual(result.status, 0, `args ${args.join(' ')} stderr: ${result.stderr}`);
        assert.match(result.stdout, /Codex Mate/);
        assert.match(result.stdout, /codexmate import-skills/);
        assert.equal(result.stderr, '');
    }
});

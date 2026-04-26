import assert from 'assert';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { resolveGithubArchiveZipUrl, buildGithubArchiveZipCandidates, cmdImportSkills } = require('../../cli/import-skills-url');

assert.equal(
    resolveGithubArchiveZipUrl('https://github.com/foo/bar'),
    'https://github.com/foo/bar/archive/refs/heads/main.zip'
);
assert.equal(
    resolveGithubArchiveZipUrl('https://github.com/foo/bar/'),
    'https://github.com/foo/bar/archive/refs/heads/main.zip'
);
assert.equal(
    resolveGithubArchiveZipUrl('https://github.com/foo/bar.git'),
    'https://github.com/foo/bar/archive/refs/heads/main.zip'
);
assert.equal(
    resolveGithubArchiveZipUrl('https://github.com/foo/bar/tree/dev'),
    'https://github.com/foo/bar/archive/refs/heads/dev.zip'
);
assert.equal(resolveGithubArchiveZipUrl('https://example.com/foo/bar.zip'), '');
assert.equal(resolveGithubArchiveZipUrl('not a url'), '');

assert.deepEqual(buildGithubArchiveZipCandidates('https://github.com/foo/bar'), [
    'https://github.com/foo/bar/archive/refs/heads/main.zip',
    'https://github.com/foo/bar/archive/refs/heads/master.zip'
]);
assert.deepEqual(buildGithubArchiveZipCandidates('https://github.com/foo/bar/tree/dev'), [
    'https://github.com/foo/bar/archive/refs/heads/dev.zip',
    'https://github.com/foo/bar/archive/refs/tags/dev.zip'
]);
assert.deepEqual(buildGithubArchiveZipCandidates('https://example.com/foo/bar'), []);

let captured = '';
const originalWrite = process.stdout.write;
process.stdout.write = (chunk) => {
    captured += String(chunk || '');
    return true;
};
await cmdImportSkills(['--help']);
process.stdout.write = originalWrite;
assert.ok(captured.includes('codexmate import-skills'));

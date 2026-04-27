import assert from 'assert';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
    parseGithubRepoFromUrl,
    resolveGithubArchiveZipUrl,
    buildGithubArchiveZipCandidates,
    cmdImportSkills
} = require('../../cli/import-skills-url');

assert.deepEqual(parseGithubRepoFromUrl('https://github.com/foo/bar/tree/feature/x'), {
    owner: 'foo',
    repo: 'bar',
    ref: 'feature/x'
});
assert.deepEqual(parseGithubRepoFromUrl('https://github.com/foo/bar.git'), {
    owner: 'foo',
    repo: 'bar',
    ref: ''
});
assert.equal(parseGithubRepoFromUrl('not a url'), null);

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
assert.equal(
    resolveGithubArchiveZipUrl('https://github.com/foo/bar/tree/feature/x'),
    'https://github.com/foo/bar/archive/refs/heads/feature/x.zip'
);
assert.equal(
    resolveGithubArchiveZipUrl('https://github.com/foo/bar/tree/release candidate/x'),
    'https://github.com/foo/bar/archive/refs/heads/release%20candidate/x.zip'
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
assert.deepEqual(buildGithubArchiveZipCandidates('https://github.com/foo/bar/tree/feature/x'), [
    'https://github.com/foo/bar/archive/refs/heads/feature/x.zip',
    'https://github.com/foo/bar/archive/refs/tags/feature/x.zip'
]);
assert.deepEqual(buildGithubArchiveZipCandidates('https://github.com/foo/bar/tree/release candidate/x'), [
    'https://github.com/foo/bar/archive/refs/heads/release%20candidate/x.zip',
    'https://github.com/foo/bar/archive/refs/tags/release%20candidate/x.zip'
]);
assert.deepEqual(buildGithubArchiveZipCandidates('https://github.com/foo/bar.git'), [
    'https://github.com/foo/bar/archive/refs/heads/main.zip',
    'https://github.com/foo/bar/archive/refs/heads/master.zip'
]);
assert.deepEqual(buildGithubArchiveZipCandidates('https://github.com/foo/bar/'), [
    'https://github.com/foo/bar/archive/refs/heads/main.zip',
    'https://github.com/foo/bar/archive/refs/heads/master.zip'
]);
assert.deepEqual(buildGithubArchiveZipCandidates('https://example.com/foo/bar'), []);
assert.deepEqual(buildGithubArchiveZipCandidates('not a url'), []);

let captured = '';
const originalWrite = process.stdout.write;
process.stdout.write = (chunk) => {
    captured += String(chunk || '');
    return true;
};
await cmdImportSkills(['--help']);
process.stdout.write = originalWrite;
assert.ok(captured.includes('codexmate import-skills'));

captured = '';
process.stdout.write = (chunk) => {
    captured += String(chunk || '');
    return true;
};
await cmdImportSkills(['-h']);
process.stdout.write = originalWrite;
assert.ok(captured.includes('codexmate import-skills'));

await assert.rejects(
    () => cmdImportSkills(['--bogus']),
    /未知参数: --bogus/
);

await assert.rejects(
    () => cmdImportSkills(['-x']),
    /未知参数: -x/
);

await assert.rejects(
    () => cmdImportSkills(['--target-app', '-h', 'https://github.com/foo/bar']),
    /--target-app 需要一个值/
);

await assert.rejects(
    () => cmdImportSkills(['https://github.com/foo/bar', 'https://github.com/foo/baz']),
    /多余参数: https:\/\/github\.com\/foo\/baz/
);

import assert from 'assert';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
    getSupplementalModelsForBaseUrl,
    mergeModelCatalog
} = await import(pathToFileURL(path.join(__dirname, '..', '..', 'lib', 'cli-models-utils.js')));

test('getSupplementalModelsForBaseUrl returns the BigModel Claude-compatible catalog including glm-5.1', () => {
    const models = getSupplementalModelsForBaseUrl('https://open.bigmodel.cn/api/anthropic');

    assert(models.includes('glm-4.7'));
    assert(models.includes('glm-5.1'));
    assert(models.includes('glm-coding'));
    assert(!models.includes('glm-image'));
});

test('getSupplementalModelsForBaseUrl returns Anthropic Claude models for official endpoints', () => {
    const models = getSupplementalModelsForBaseUrl('https://api.anthropic.com');

    assert(models.includes('claude-opus-4-1'));
    assert(models.includes('claude-sonnet-4'));
    assert(models.includes('claude-3-7-sonnet'));
    assert(models.includes('claude-3-haiku'));
    assert(!models.includes('glm-5.1'));
});

test('mergeModelCatalog keeps remote order and appends missing Claude endpoint extras once', () => {
    const merged = mergeModelCatalog(
        ['glm-4.7', 'glm-5'],
        ['glm-5', 'glm-5.1', 'glm-4.7-flash']
    );

    assert.deepStrictEqual(merged, ['glm-4.7', 'glm-5', 'glm-5.1', 'glm-4.7-flash']);
});

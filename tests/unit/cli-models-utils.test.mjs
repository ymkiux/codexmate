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

test('mergeModelCatalog keeps remote order and appends missing Claude endpoint extras once', () => {
    const merged = mergeModelCatalog(
        ['glm-4.7', 'glm-5'],
        ['glm-5', 'glm-5.1', 'glm-4.7-flash']
    );

    assert.deepStrictEqual(merged, ['glm-4.7', 'glm-5', 'glm-5.1', 'glm-4.7-flash']);
});

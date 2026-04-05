import assert from 'assert';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
    buildModelConversationSpecs,
    extractModelResponseText
} = await import(pathToFileURL(path.join(__dirname, '..', '..', 'lib', 'cli-models-utils.js')));

test('buildModelConversationSpecs keeps direct provider routes ahead of injected /v1 fallback', () => {
    const specs = buildModelConversationSpecs(
        { wire_api: 'responses' },
        'gpt-5.4',
        'https://example.com/project/ym',
        'hello'
    );

    assert.ok(Array.isArray(specs) && specs.length > 0);
    assert.strictEqual(specs[0].url, 'https://example.com/project/ym/responses');
    assert.strictEqual(specs[0].body.input, 'hello');
});

test('extractModelResponseText parses responses and chat-completions payloads', () => {
    const responsesText = extractModelResponseText({
        output: [{
            type: 'message',
            content: [{ type: 'output_text', text: 'responses ok' }]
        }]
    });
    const chatText = extractModelResponseText({
        choices: [{
            message: {
                content: [{ type: 'text', text: 'chat ok' }]
            }
        }]
    });

    assert.strictEqual(responsesText, 'responses ok');
    assert.strictEqual(chatText, 'chat ok');
});

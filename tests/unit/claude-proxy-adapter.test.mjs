import assert from 'assert';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
    buildBuiltinClaudeResponsesRequest,
    buildAnthropicMessageFromResponses,
    buildAnthropicStreamEvents,
    buildAnthropicModelsPayload
} = require('../../cli/claude-proxy');

test('buildBuiltinClaudeResponsesRequest maps anthropic messages/tools into responses payload', () => {
    const payload = buildBuiltinClaudeResponsesRequest({
        model: 'gpt-4.1',
        max_tokens: 256,
        system: [{ type: 'text', text: 'system prompt' }],
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'hello' },
                    { type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'tool ok' }] }
                ]
            },
            {
                role: 'assistant',
                content: [
                    { type: 'tool_use', id: 'toolu_1', name: 'lookup', input: { q: 'hi' } },
                    { type: 'text', text: 'done' }
                ]
            }
        ],
        tools: [
            {
                name: 'lookup',
                description: 'Lookup something',
                input_schema: { type: 'object', properties: { q: { type: 'string' } } }
            }
        ],
        tool_choice: { type: 'tool', name: 'lookup' },
        stop_sequences: ['END'],
        metadata: { source: 'e2e' }
    });

    assert.strictEqual(payload.model, 'gpt-4.1');
    assert.strictEqual(payload.instructions, 'system prompt');
    assert.strictEqual(payload.max_output_tokens, 256);
    assert.deepStrictEqual(payload.stop, ['END']);
    assert.deepStrictEqual(payload.metadata, { source: 'e2e' });
    assert.deepStrictEqual(payload.tool_choice, { type: 'function', name: 'lookup' });
    assert.deepStrictEqual(payload.tools, [{
        type: 'function',
        name: 'lookup',
        description: 'Lookup something',
        parameters: { type: 'object', properties: { q: { type: 'string' } } }
    }]);
    assert.deepStrictEqual(payload.input, [
        { role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
        { type: 'function_call_output', call_id: 'toolu_1', output: 'tool ok' },
        { type: 'function_call', call_id: 'toolu_1', name: 'lookup', arguments: '{"q":"hi"}' },
        { role: 'assistant', content: [{ type: 'output_text', text: 'done' }] }
    ]);
});

test('buildAnthropicMessageFromResponses maps responses output into anthropic message', () => {
    const message = buildAnthropicMessageFromResponses({
        id: 'resp_123',
        model: 'gpt-4.1',
        output: [
            {
                type: 'message',
                content: [{ type: 'output_text', text: 'proxy ok' }]
            },
            {
                type: 'function_call',
                call_id: 'toolu_9',
                name: 'lookup',
                arguments: '{"city":"tokyo"}'
            }
        ],
        usage: {
            input_tokens: 12,
            output_tokens: 7
        }
    }, {
        model: 'fallback-model'
    });

    assert.strictEqual(message.id, 'resp_123');
    assert.strictEqual(message.model, 'gpt-4.1');
    assert.strictEqual(message.role, 'assistant');
    assert.strictEqual(message.stop_reason, 'tool_use');
    assert.deepStrictEqual(message.usage, {
        input_tokens: 12,
        output_tokens: 7
    });
    assert.deepStrictEqual(message.content, [
        { type: 'text', text: 'proxy ok' },
        { type: 'tool_use', id: 'toolu_9', name: 'lookup', input: { city: 'tokyo' } }
    ]);
});

test('buildAnthropicStreamEvents emits anthropic-style SSE events', () => {
    const events = buildAnthropicStreamEvents({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'gpt-4.1',
        content: [
            { type: 'text', text: 'hello stream' },
            { type: 'tool_use', id: 'toolu_stream', name: 'lookup', input: { city: 'tokyo' } }
        ],
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: {
            input_tokens: 10,
            output_tokens: 4
        }
    });

    assert.deepStrictEqual(events.map((item) => item.event), [
        'message_start',
        'content_block_start',
        'content_block_delta',
        'content_block_stop',
        'content_block_start',
        'content_block_delta',
        'content_block_stop',
        'message_delta',
        'message_stop'
    ]);
    assert.strictEqual(events[2].data.delta.text, 'hello stream');
    assert.strictEqual(events[5].data.delta.partial_json, '{"city":"tokyo"}');
    assert.strictEqual(events[7].data.delta.stop_reason, 'tool_use');
    assert.strictEqual(events[7].data.usage.output_tokens, 4);
});

test('buildAnthropicModelsPayload reshapes upstream models list', () => {
    const payload = buildAnthropicModelsPayload({
        data: [{ id: 'gpt-4.1' }, { id: 'gpt-4o-mini' }]
    });

    assert.strictEqual(payload.first_id, 'gpt-4.1');
    assert.strictEqual(payload.last_id, 'gpt-4o-mini');
    assert.strictEqual(payload.has_more, false);
    assert.deepStrictEqual(payload.data, [
        {
            type: 'model',
            id: 'gpt-4.1',
            display_name: 'gpt-4.1',
            created_at: '1970-01-01T00:00:00Z'
        },
        {
            type: 'model',
            id: 'gpt-4o-mini',
            display_name: 'gpt-4o-mini',
            created_at: '1970-01-01T00:00:00Z'
        }
    ]);
});
